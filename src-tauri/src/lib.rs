use base64::{engine::general_purpose::STANDARD as BASE64, Engine};
use serde::Serialize;
use std::{
    fs::OpenOptions,
    io::{self, BufWriter, Write},
    path::{Path, PathBuf},
    sync::atomic::{AtomicU64, Ordering},
    time::{Duration, SystemTime, UNIX_EPOCH},
};
use tauri::Manager;

mod git;
mod mathtype;
mod pandoc;

static IMAGE_SEQUENCE: AtomicU64 = AtomicU64::new(0);
static ATOMIC_WRITE_SEQUENCE: AtomicU64 = AtomicU64::new(0);

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct SavedImage {
    relative_path: String,
    asset_folder: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct SavedEmfImage {
    relative_path: String,
    original_relative_path: String,
    asset_folder: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct StoredDocumentFormat {
    asset_folder: String,
    content: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct SharePackage {
    package_path: String,
    markdown_path: String,
    asset_folder: String,
}

pub(crate) fn is_markdown_path(path: &Path) -> bool {
    matches!(
        path.extension().and_then(|extension| extension.to_str()),
        Some("md" | "markdown" | "mdx")
    )
}

fn allow_asset_directory(app: &tauri::AppHandle, document_dir: &Path) -> Result<(), String> {
    app.asset_protocol_scope()
        .allow_directory(document_dir, true)
        .map_err(|error| format!("无法授权读取文稿资源目录：{error}"))
}

/// Replace one document file through a same-directory temporary file.  The
/// completed file is flushed before rename, so an interrupted save cannot
/// leave a partially written Markdown file or hakurou.json at the target.
fn atomic_write(path: &Path, content: &[u8]) -> io::Result<()> {
    let directory = path
        .parent()
        .filter(|directory| !directory.as_os_str().is_empty())
        .unwrap_or_else(|| Path::new("."));
    let filename = path
        .file_name()
        .and_then(|name| name.to_str())
        .ok_or_else(|| io::Error::new(io::ErrorKind::InvalidInput, "target path has no file name"))?;
    let nonce = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_err(io::Error::other)?
        .as_nanos();
    let sequence = ATOMIC_WRITE_SEQUENCE.fetch_add(1, Ordering::Relaxed);
    let temporary_path = (0..128)
        .map(|attempt| directory.join(format!(".{filename}.{nonce}.{sequence}.{attempt}.tmp")))
        .find(|candidate| !candidate.exists())
        .ok_or_else(|| io::Error::new(io::ErrorKind::AlreadyExists, "could not allocate a temporary save file"))?;

    let result = (|| -> io::Result<()> {
        let mut temporary = OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(&temporary_path)?;
        temporary.write_all(content)?;
        temporary.sync_all()?;
        drop(temporary);
        std::fs::rename(&temporary_path, path)?;
        Ok(())
    })();
    if result.is_err() {
        let _ = std::fs::remove_file(&temporary_path);
    }
    result
}

#[tauri::command]
fn read_markdown(app: tauri::AppHandle, path: String) -> Result<String, String> {
    let path = Path::new(&path);
    if !is_markdown_path(path) {
        return Err("只能打开 Markdown 文件。".into());
    }
    let document_dir = path.parent().ok_or("无法确定文稿所在目录。")?;
    allow_asset_directory(&app, document_dir)?;

    std::fs::read_to_string(path).map_err(|error| format!("无法打开文稿：{error}"))
}

#[tauri::command]
fn write_markdown(path: String, content: String) -> Result<(), String> {
    let path = Path::new(&path);
    if !is_markdown_path(path) {
        return Err("请使用 .md、.markdown 或 .mdx 文件扩展名。".into());
    }

    atomic_write(path, content.as_bytes()).map_err(|error| format!("无法保存文稿：{error}"))
}

#[tauri::command]
fn close_application(app: tauri::AppHandle) {
    app.exit(0);
}

fn safe_asset_folder(value: &str) -> String {
    let normalized: String = value
        .chars()
        .map(|character| match character {
            '<' | '>' | ':' | '"' | '/' | '\\' | '|' | '?' | '*' => '_',
            _ if character.is_control() => '_',
            _ => character,
        })
        .collect();
    let trimmed =
        normalized.trim_matches(|character: char| character == '.' || character.is_whitespace());
    if trimmed.is_empty() {
        "document".into()
    } else {
        trimmed.chars().take(72).collect()
    }
}

fn stable_path_suffix(path: &Path) -> String {
    let mut hash: u32 = 0x811c9dc5;
    for byte in path.to_string_lossy().as_bytes() {
        hash ^= u32::from(*byte);
        hash = hash.wrapping_mul(0x01000193);
    }
    format!("{hash:08x}")[..6].to_string()
}

pub(crate) fn document_asset_folder(document_path: &Path, asset_folder: Option<String>) -> String {
    let stem = document_path
        .file_stem()
        .and_then(|stem| stem.to_str())
        .unwrap_or("document");
    asset_folder
        .as_deref()
        .map(safe_asset_folder)
        .unwrap_or_else(|| {
            format!(
                "{}-{}",
                safe_asset_folder(stem),
                stable_path_suffix(document_path)
            )
        })
}

pub(crate) fn copy_directory(source: &Path, destination: &Path) -> Result<(), String> {
    for entry in std::fs::read_dir(source).map_err(|error| format!("无法读取文稿资源：{error}"))?
    {
        let entry = entry.map_err(|error| format!("无法读取文稿资源：{error}"))?;
        let file_type = entry
            .file_type()
            .map_err(|error| format!("无法读取文稿资源：{error}"))?;
        let source_path = entry.path();
        let destination_path = destination.join(entry.file_name());

        if file_type.is_symlink() {
            return Err("文稿资源中包含链接文件，无法安全创建分享包。".into());
        }
        if file_type.is_dir() {
            std::fs::create_dir(&destination_path)
                .map_err(|error| format!("无法创建分享包资源目录：{error}"))?;
            copy_directory(&source_path, &destination_path)?;
        } else if file_type.is_file() {
            std::fs::copy(&source_path, &destination_path)
                .map_err(|error| format!("无法复制文稿资源：{error}"))?;
        }
    }
    Ok(())
}

fn create_share_package_directory(
    destination_dir: &Path,
    document_name: &str,
) -> Result<PathBuf, String> {
    if !destination_dir.is_dir() {
        return Err("请选择一个有效的分享包保存文件夹。".into());
    }

    let base = safe_asset_folder(document_name);
    for index in 1..10_000 {
        let name = if index == 1 {
            format!("{base}-share")
        } else {
            format!("{base}-share-{index}")
        };
        let candidate = destination_dir.join(name);
        match std::fs::create_dir(&candidate) {
            Ok(()) => return Ok(candidate),
            Err(error) if error.kind() == std::io::ErrorKind::AlreadyExists => continue,
            Err(error) => return Err(format!("无法创建分享包：{error}")),
        }
    }

    Err("同名分享包过多，无法创建新的分享包。".into())
}

fn content_references_asset_folder(content: &str, asset_folder: &str) -> bool {
    content.contains(&format!("](./assets/{asset_folder}/"))
}

fn export_share_package_impl(
    document_path: &Path,
    content: &str,
    asset_folder: Option<String>,
    format_content: &str,
    destination_dir: &Path,
) -> Result<SharePackage, String> {
    if !is_markdown_path(document_path) {
        return Err("分享包只能从 Markdown 文稿创建。".into());
    }
    if !document_path.is_file() {
        return Err("原文稿已不存在，请先重新保存后再创建分享包。".into());
    }

    let document_dir = document_path.parent().ok_or("无法确定文稿所在目录。")?;
    let filename = document_path.file_name().ok_or("无法确定文稿文件名。")?;
    let document_name = document_path
        .file_stem()
        .and_then(|stem| stem.to_str())
        .unwrap_or("document");
    let source_folder = document_asset_folder(document_path, asset_folder);
    let package_dir = create_share_package_directory(destination_dir, document_name)?;
    let markdown_path = package_dir.join(filename);
    let package_folder = if content_references_asset_folder(content, &source_folder) {
        source_folder.clone()
    } else {
        document_asset_folder(&markdown_path, None)
    };
    let source_assets = document_dir.join("assets").join(&source_folder);
    let package_assets = package_dir.join("assets").join(&package_folder);

    let result = (|| -> Result<(), String> {
        std::fs::write(&markdown_path, content)
            .map_err(|error| format!("无法写入分享文稿：{error}"))?;
        if source_assets.is_dir() {
            std::fs::create_dir_all(&package_assets)
                .map_err(|error| format!("无法创建分享包资源目录：{error}"))?;
            copy_directory(&source_assets, &package_assets)?;
        }
        std::fs::create_dir_all(&package_assets)
            .map_err(|error| format!("无法创建分享包资源目录：{error}"))?;
        std::fs::write(package_assets.join("hakurou.json"), format_content)
            .map_err(|error| format!("无法写入分享包格式设置：{error}"))?;
        Ok(())
    })();

    if let Err(error) = result {
        let _ = std::fs::remove_dir_all(&package_dir);
        return Err(error);
    }

    Ok(SharePackage {
        package_path: package_dir.to_string_lossy().to_string(),
        markdown_path: markdown_path.to_string_lossy().to_string(),
        asset_folder: package_folder,
    })
}

#[tauri::command]
fn export_share_package(
    document_path: String,
    content: String,
    asset_folder: Option<String>,
    format_content: String,
    destination_dir: String,
) -> Result<SharePackage, String> {
    export_share_package_impl(
        Path::new(&document_path),
        &content,
        asset_folder,
        &format_content,
        Path::new(&destination_dir),
    )
}

#[tauri::command]
fn read_document_format(
    app: tauri::AppHandle,
    document_path: String,
    asset_folder: Option<String>,
) -> Result<Option<StoredDocumentFormat>, String> {
    let document_path = PathBuf::from(document_path);
    if !is_markdown_path(&document_path) {
        return Err("格式设置必须关联到 Markdown 文稿。".into());
    }
    let document_dir = document_path.parent().ok_or("无法确定文稿所在目录。")?;
    allow_asset_directory(&app, document_dir)?;
    let folder = document_asset_folder(&document_path, asset_folder);
    let format_path = document_dir
        .join("assets")
        .join(&folder)
        .join("hakurou.json");
    if !format_path.is_file() {
        return Ok(None);
    }
    let content = std::fs::read_to_string(format_path)
        .map_err(|error| format!("无法读取文稿格式设置：{error}"))?;
    Ok(Some(StoredDocumentFormat {
        asset_folder: folder,
        content,
    }))
}

#[tauri::command]
fn write_document_format(
    app: tauri::AppHandle,
    document_path: String,
    asset_folder: Option<String>,
    content: String,
) -> Result<StoredDocumentFormat, String> {
    let document_path = PathBuf::from(document_path);
    if !is_markdown_path(&document_path) {
        return Err("格式设置必须关联到 Markdown 文稿。".into());
    }
    let document_dir = document_path.parent().ok_or("无法确定文稿所在目录。")?;
    let folder = document_asset_folder(&document_path, asset_folder);
    let asset_dir = document_dir.join("assets").join(&folder);
    std::fs::create_dir_all(&asset_dir)
        .map_err(|error| format!("无法创建文稿资源目录：{error}"))?;
    allow_asset_directory(&app, document_dir)?;
    atomic_write(&asset_dir.join("hakurou.json"), content.as_bytes())
        .map_err(|error| format!("无法保存文稿格式设置：{error}"))?;
    Ok(StoredDocumentFormat {
        asset_folder: folder,
        content,
    })
}

fn image_extension(mime_type: &str) -> &'static str {
    match mime_type {
        "image/jpeg" | "image/jpg" => "jpg",
        "image/gif" => "gif",
        "image/webp" => "webp",
        "image/bmp" => "bmp",
        _ => "png",
    }
}

fn image_filename_stem() -> Result<String, String> {
    let timestamp = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_err(|error| error.to_string())?
        .as_millis();
    let sequence = IMAGE_SEQUENCE.fetch_add(1, Ordering::Relaxed);
    Ok(format!("{timestamp}-{sequence:04}"))
}

#[tauri::command]
fn save_pasted_image(
    app: tauri::AppHandle,
    document_path: String,
    data_base64: String,
    mime_type: String,
    asset_folder: Option<String>,
) -> Result<SavedImage, String> {
    let document_path = PathBuf::from(document_path);
    if !is_markdown_path(&document_path) {
        return Err("图片必须关联到已保存的 Markdown 文稿。".into());
    }
    let document_dir = document_path.parent().ok_or("无法确定文稿所在目录。")?;
    let folder = document_asset_folder(&document_path, asset_folder);
    let image_bytes = BASE64
        .decode(data_base64)
        .map_err(|error| format!("无法读取剪贴板图片：{error}"))?;
    if image_bytes.is_empty() {
        return Err("剪贴板中没有可保存的图片内容。".into());
    }

    let asset_dir = document_dir.join("assets").join(&folder);
    std::fs::create_dir_all(&asset_dir)
        .map_err(|error| format!("无法创建图片资源目录：{error}"))?;
    allow_asset_directory(&app, document_dir)?;
    let filename = format!("{}.{}", image_filename_stem()?, image_extension(&mime_type));
    std::fs::write(asset_dir.join(&filename), image_bytes)
        .map_err(|error| format!("无法保存图片：{error}"))?;

    Ok(SavedImage {
        relative_path: format!("./assets/{folder}/{filename}"),
        asset_folder: folder,
    })
}

#[cfg(target_os = "windows")]
fn clipboard_emf_preview(
    asset_dir: &Path,
    filename_stem: &str,
) -> Result<Option<(PathBuf, PathBuf)>, String> {
    use std::{ffi::c_void, mem::size_of, os::windows::ffi::OsStrExt, ptr};
    use windows_sys::Win32::{
        Foundation::RECT,
        Graphics::Gdi::{
            CopyEnhMetaFileW, CreateCompatibleDC, CreateDIBSection, DeleteDC, DeleteEnhMetaFile,
            DeleteObject, GetEnhMetaFileHeader, PlayEnhMetaFile, SelectObject, BITMAPINFO,
            BITMAPINFOHEADER, BI_RGB, DIB_RGB_COLORS, ENHMETAHEADER,
        },
        System::{
            DataExchange::{
                CloseClipboard, GetClipboardData, IsClipboardFormatAvailable, OpenClipboard,
            },
            Ole::CF_ENHMETAFILE,
        },
    };

    unsafe {
        if IsClipboardFormatAvailable(u32::from(CF_ENHMETAFILE)) == 0 {
            return Ok(None);
        }
        let mut clipboard_opened = false;
        for _ in 0..8 {
            if OpenClipboard(ptr::null_mut()) != 0 {
                clipboard_opened = true;
                break;
            }
            std::thread::sleep(Duration::from_millis(15));
        }
        if !clipboard_opened {
            return Err("无法读取剪贴板中的 PowerPoint 图元。请稍后重试。".into());
        }

        let clipboard_handle = GetClipboardData(u32::from(CF_ENHMETAFILE));
        if clipboard_handle.is_null() {
            let _ = CloseClipboard();
            return Err("剪贴板中的 EMF 图元不可用。".into());
        }

        let emf_path = asset_dir.join(format!("{filename_stem}.emf"));
        let mut emf_path_wide: Vec<u16> =
            emf_path.as_os_str().encode_wide().chain(Some(0)).collect();
        let saved_handle = CopyEnhMetaFileW(clipboard_handle.cast(), emf_path_wide.as_mut_ptr());
        if saved_handle.is_null() {
            let _ = CloseClipboard();
            return Err("无法保存 PowerPoint 的 EMF 图元。".into());
        }

        let mut header = ENHMETAHEADER::default();
        let header_size = size_of::<ENHMETAHEADER>() as u32;
        if GetEnhMetaFileHeader(saved_handle, header_size, &mut header) == 0 {
            let _ = CloseClipboard();
            let _ = DeleteEnhMetaFile(saved_handle);
            let _ = std::fs::remove_file(&emf_path);
            return Err("无法读取 PowerPoint 图元尺寸。".into());
        }

        let source_width = i64::from(header.rclBounds.right) - i64::from(header.rclBounds.left);
        let source_height = i64::from(header.rclBounds.bottom) - i64::from(header.rclBounds.top);
        let _ = CloseClipboard();
        if source_width <= 0 || source_height <= 0 {
            let _ = DeleteEnhMetaFile(saved_handle);
            let _ = std::fs::remove_file(&emf_path);
            return Err("PowerPoint 图元没有可用的画布尺寸。".into());
        }

        const MAX_PREVIEW_EDGE: i64 = 4096;
        let largest_source_edge = source_width.max(source_height);
        let scale = if largest_source_edge <= MAX_PREVIEW_EDGE / 2 {
            2
        } else {
            1
        };
        let shrink_divisor =
            ((largest_source_edge * scale) + MAX_PREVIEW_EDGE - 1) / MAX_PREVIEW_EDGE;
        let width = ((source_width * scale) / shrink_divisor).clamp(1, MAX_PREVIEW_EDGE) as i32;
        let height = ((source_height * scale) / shrink_divisor).clamp(1, MAX_PREVIEW_EDGE) as i32;
        let byte_len = usize::try_from(i64::from(width) * i64::from(height) * 4)
            .map_err(|_| "PowerPoint 图元预览尺寸过大。")?;

        let mut bitmap_info = BITMAPINFO {
            bmiHeader: BITMAPINFOHEADER {
                biSize: u32::try_from(size_of::<BITMAPINFOHEADER>())
                    .map_err(|_| "位图信息过大。")?,
                biWidth: width,
                biHeight: -height,
                biPlanes: 1,
                biBitCount: 32,
                biCompression: BI_RGB,
                ..Default::default()
            },
            ..Default::default()
        };
        let dc = CreateCompatibleDC(ptr::null_mut());
        if dc.is_null() {
            let _ = DeleteEnhMetaFile(saved_handle);
            let _ = std::fs::remove_file(&emf_path);
            return Err("无法创建 PowerPoint 图元预览画布。".into());
        }
        let mut bits: *mut c_void = ptr::null_mut();
        let bitmap = CreateDIBSection(
            dc,
            &mut bitmap_info,
            DIB_RGB_COLORS,
            &mut bits,
            ptr::null_mut(),
            0,
        );
        if bitmap.is_null() || bits.is_null() {
            let _ = DeleteDC(dc);
            let _ = DeleteEnhMetaFile(saved_handle);
            let _ = std::fs::remove_file(&emf_path);
            return Err("无法创建 PowerPoint 图元预览位图。".into());
        }
        let previous = SelectObject(dc, bitmap);
        if previous.is_null() || previous as isize == -1 {
            let _ = DeleteObject(bitmap);
            let _ = DeleteDC(dc);
            let _ = DeleteEnhMetaFile(saved_handle);
            let _ = std::fs::remove_file(&emf_path);
            return Err("无法准备 PowerPoint 图元预览画布。".into());
        }
        ptr::write_bytes(bits, 0xff, byte_len);
        let target = RECT {
            left: 0,
            top: 0,
            right: width,
            bottom: height,
        };
        if PlayEnhMetaFile(dc, saved_handle, &target) == 0 {
            let _ = SelectObject(dc, previous);
            let _ = DeleteObject(bitmap);
            let _ = DeleteDC(dc);
            let _ = DeleteEnhMetaFile(saved_handle);
            let _ = std::fs::remove_file(&emf_path);
            return Err("无法渲染 PowerPoint 图元预览。".into());
        }
        let bgra = std::slice::from_raw_parts(bits.cast::<u8>(), byte_len);
        let mut rgba = vec![0; byte_len];
        for (source, destination) in bgra.chunks_exact(4).zip(rgba.chunks_exact_mut(4)) {
            destination[0] = source[2];
            destination[1] = source[1];
            destination[2] = source[0];
            destination[3] = 0xff;
        }
        let _ = SelectObject(dc, previous);
        let _ = DeleteObject(bitmap);
        let _ = DeleteDC(dc);
        let _ = DeleteEnhMetaFile(saved_handle);

        let png_path = asset_dir.join(format!("{filename_stem}.png"));
        let write_result = (|| -> Result<(), String> {
            let file = std::fs::File::create(&png_path)
                .map_err(|error| format!("无法创建图片预览：{error}"))?;
            let mut encoder = png::Encoder::new(BufWriter::new(file), width as u32, height as u32);
            encoder.set_color(png::ColorType::Rgba);
            encoder.set_depth(png::BitDepth::Eight);
            let mut writer = encoder
                .write_header()
                .map_err(|error| format!("无法写入图片预览：{error}"))?;
            writer
                .write_image_data(&rgba)
                .map_err(|error| format!("无法写入图片预览：{error}"))
        })();
        if let Err(error) = write_result {
            let _ = std::fs::remove_file(&emf_path);
            let _ = std::fs::remove_file(&png_path);
            return Err(error);
        }
        Ok(Some((emf_path, png_path)))
    }
}

#[cfg(not(target_os = "windows"))]
fn clipboard_emf_preview(
    _asset_dir: &Path,
    _filename_stem: &str,
) -> Result<Option<(PathBuf, PathBuf)>, String> {
    Ok(None)
}

#[tauri::command]
fn save_clipboard_emf_preview(
    app: tauri::AppHandle,
    document_path: String,
    asset_folder: Option<String>,
) -> Result<Option<SavedEmfImage>, String> {
    let document_path = PathBuf::from(document_path);
    if !is_markdown_path(&document_path) {
        return Err("PowerPoint 图元必须关联到已保存的 Markdown 文稿。".into());
    }
    let document_dir = document_path.parent().ok_or("无法确定文稿所在目录。")?;
    let folder = document_asset_folder(&document_path, asset_folder);
    let asset_dir = document_dir.join("assets").join(&folder);
    std::fs::create_dir_all(&asset_dir)
        .map_err(|error| format!("无法创建图片资源目录：{error}"))?;
    allow_asset_directory(&app, document_dir)?;
    let filename_stem = image_filename_stem()?;
    let Some((emf_path, png_path)) = clipboard_emf_preview(&asset_dir, &filename_stem)? else {
        return Ok(None);
    };
    let emf_name = emf_path
        .file_name()
        .and_then(|name| name.to_str())
        .ok_or("无法确定 EMF 文件名。")?;
    let png_name = png_path
        .file_name()
        .and_then(|name| name.to_str())
        .ok_or("无法确定预览文件名。")?;
    Ok(Some(SavedEmfImage {
        relative_path: format!("./assets/{folder}/{png_name}"),
        original_relative_path: format!("./assets/{folder}/{emf_name}"),
        asset_folder: folder,
    }))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn atomic_write_replaces_a_complete_existing_document() {
        let nonce = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("system time should be after the Unix epoch")
            .as_nanos();
        let root = std::env::temp_dir().join(format!(
            "hakurou-atomic-write-{}-{nonce}",
            std::process::id()
        ));
        std::fs::create_dir_all(&root).expect("temporary directory should be created");
        let document = root.join("paper.md");
        std::fs::write(&document, "old draft").expect("initial draft should be written");

        atomic_write(&document, b"complete replacement").expect("atomic replacement should succeed");

        assert_eq!(
            std::fs::read_to_string(&document).expect("replacement should be readable"),
            "complete replacement"
        );
        assert!(std::fs::read_dir(&root)
            .expect("temporary directory should be readable")
            .all(|entry| !entry.expect("directory entry should be readable").file_name().to_string_lossy().ends_with(".tmp")));
        let _ = std::fs::remove_dir_all(root);
    }

    #[test]
    fn share_package_copies_document_assets_and_uses_a_unique_folder() {
        let nonce = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("system time should be after the Unix epoch")
            .as_nanos();
        let root = std::env::temp_dir().join(format!(
            "hakurou-share-package-{}-{nonce}",
            std::process::id()
        ));
        let source_dir = root.join("source");
        let destination_dir = root.join("exports");
        let document_path = source_dir.join("paper.md");
        let asset_folder = "paper-assets";
        let source_asset = source_dir.join("assets").join(asset_folder).join("figures");

        std::fs::create_dir_all(&source_asset).expect("source assets should be created");
        std::fs::create_dir_all(&destination_dir).expect("destination should be created");
        std::fs::write(&document_path, "old document").expect("source document should be written");
        std::fs::write(source_asset.join("plot.png"), b"image bytes")
            .expect("image should be written");
        std::fs::write(
            source_dir
                .join("assets")
                .join(asset_folder)
                .join("hakurou.json"),
            "old settings",
        )
        .expect("source settings should be written");

        let markdown = "# Shared paper\n\n![Plot](./assets/paper-assets/figures/plot.png)\n";
        let settings = r#"{"version":1,"defaults":{"tableStyle":"three-line"}}"#;
        let first = export_share_package_impl(
            &document_path,
            markdown,
            Some(asset_folder.into()),
            settings,
            &destination_dir,
        )
        .expect("first package should be exported");
        let second = export_share_package_impl(
            &document_path,
            markdown,
            Some(asset_folder.into()),
            settings,
            &destination_dir,
        )
        .expect("second package should not overwrite the first");

        assert_eq!(
            std::fs::read_to_string(&first.markdown_path).unwrap(),
            markdown
        );
        assert_eq!(
            std::fs::read_to_string(
                Path::new(&first.package_path)
                    .join("assets")
                    .join(asset_folder)
                    .join("hakurou.json")
            )
            .unwrap(),
            settings
        );
        assert_eq!(
            std::fs::read(
                Path::new(&first.package_path)
                    .join("assets")
                    .join(asset_folder)
                    .join("figures")
                    .join("plot.png")
            )
            .unwrap(),
            b"image bytes"
        );
        assert!(second.package_path.ends_with("paper-share-2"));
        assert_eq!(first.asset_folder, asset_folder);

        let _ = std::fs::remove_dir_all(root);
    }

    #[test]
    fn share_package_rehomes_format_settings_when_markdown_has_no_asset_link() {
        let nonce = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("system time should be after the Unix epoch")
            .as_nanos();
        let root = std::env::temp_dir().join(format!(
            "hakurou-share-package-plain-{}-{nonce}",
            std::process::id()
        ));
        let source_dir = root.join("source");
        let destination_dir = root.join("exports");
        let document_path = source_dir.join("plain.md");
        let source_folder = "plain-source-assets";

        std::fs::create_dir_all(source_dir.join("assets").join(source_folder))
            .expect("source asset directory should be created");
        std::fs::create_dir_all(&destination_dir).expect("destination should be created");
        std::fs::write(&document_path, "source document")
            .expect("source document should be written");

        let package = export_share_package_impl(
            &document_path,
            "# Plain document\n\nNo image links here.\n",
            Some(source_folder.into()),
            r#"{"version":1,"defaults":{"firstLineIndent":true}}"#,
            &destination_dir,
        )
        .expect("plain document package should be exported");
        let expected_folder = document_asset_folder(Path::new(&package.markdown_path), None);

        assert_eq!(package.asset_folder, expected_folder);
        assert!(Path::new(&package.package_path)
            .join("assets")
            .join(&package.asset_folder)
            .join("hakurou.json")
            .is_file());

        let _ = std::fs::remove_dir_all(root);
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .invoke_handler(tauri::generate_handler![
            read_markdown,
            write_markdown,
            read_document_format,
            write_document_format,
            save_pasted_image,
            save_clipboard_emf_preview,
            export_share_package,
            mathtype::inspect_math_type,
            mathtype::confirm_manual_mathtype_step,
            git::inspect_git,
            git::inspect_version_repository,
            git::init_version_repository,
            git::get_version_changes,
            git::get_version_comparison,
            git::get_version_diff,
            git::get_revision_text_snapshot,
            git::get_revision_asset,
            git::create_version,
            git::get_version_history,
            git::inspect_version_identity,
            git::configure_version_identity,
            git::get_restore_preflight,
            git::restore_version,
            pandoc::inspect_pandoc,
            pandoc::export_docx,
            close_application
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
