use base64::{engine::general_purpose::STANDARD as BASE64, Engine};
use serde::Serialize;
use tauri::Manager;
use std::{
    path::{Path, PathBuf},
    sync::atomic::{AtomicU64, Ordering},
    time::{SystemTime, UNIX_EPOCH},
};

static IMAGE_SEQUENCE: AtomicU64 = AtomicU64::new(0);

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct SavedImage {
    relative_path: String,
    asset_folder: String,
}

fn is_markdown_path(path: &Path) -> bool {
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

    std::fs::write(path, content).map_err(|error| format!("无法保存文稿：{error}"))
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
    let trimmed = normalized.trim_matches(|character: char| character == '.' || character.is_whitespace());
    if trimmed.is_empty() { "document".into() } else { trimmed.chars().take(72).collect() }
}

fn stable_path_suffix(path: &Path) -> String {
    let mut hash: u32 = 0x811c9dc5;
    for byte in path.to_string_lossy().as_bytes() {
        hash ^= u32::from(*byte);
        hash = hash.wrapping_mul(0x01000193);
    }
    format!("{hash:08x}")[..6].to_string()
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
    let stem = document_path.file_stem().and_then(|stem| stem.to_str()).unwrap_or("document");
    let folder = asset_folder
        .as_deref()
        .map(safe_asset_folder)
        .unwrap_or_else(|| format!("{}-{}", safe_asset_folder(stem), stable_path_suffix(&document_path)));
    let image_bytes = BASE64.decode(data_base64).map_err(|error| format!("无法读取剪贴板图片：{error}"))?;
    if image_bytes.is_empty() {
        return Err("剪贴板中没有可保存的图片内容。".into());
    }

    let asset_dir = document_dir.join("assets").join(&folder);
    std::fs::create_dir_all(&asset_dir).map_err(|error| format!("无法创建图片资源目录：{error}"))?;
    allow_asset_directory(&app, document_dir)?;
    let timestamp = SystemTime::now().duration_since(UNIX_EPOCH).map_err(|error| error.to_string())?.as_millis();
    let sequence = IMAGE_SEQUENCE.fetch_add(1, Ordering::Relaxed);
    let filename = format!("{timestamp}-{sequence:04}.{}", image_extension(&mime_type));
    std::fs::write(asset_dir.join(&filename), image_bytes).map_err(|error| format!("无法保存图片：{error}"))?;

    Ok(SavedImage {
        relative_path: format!("./assets/{folder}/{filename}"),
        asset_folder: folder,
    })
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .invoke_handler(tauri::generate_handler![read_markdown, write_markdown, save_pasted_image, close_application])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
