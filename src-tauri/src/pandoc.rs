use base64::{engine::general_purpose::STANDARD as BASE64, Engine};
use cfb::CompoundFile;
use serde::{Deserialize, Serialize};
use std::{
    collections::HashMap,
    fs::File,
    io::{Cursor, Read, Write},
    path::{Path, PathBuf},
    process::{Command, Output},
    time::{SystemTime, UNIX_EPOCH},
};
use tauri::{AppHandle, Emitter};
use uuid::Uuid;
use zip::{write::FileOptions, ZipArchive, ZipWriter};

use crate::{copy_directory, document_asset_folder, is_markdown_path, mathtype};

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PandocStatus {
    available: bool,
    version: Option<String>,
    message: Option<String>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DocxExport {
    output_path: String,
    used_emf_assets: usize,
    used_preview_fallback_assets: usize,
}

pub const DOCX_EXPORT_PROGRESS_EVENT: &str = "docx-export-progress";

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct DocxExportProgress {
    phase: &'static str,
    completed: usize,
    total: usize,
    batch_index: Option<usize>,
    batch_count: Option<usize>,
}

fn emit_docx_export_progress(
    app: &AppHandle,
    phase: &'static str,
    completed: usize,
    total: usize,
    batch_index: Option<usize>,
    batch_count: Option<usize>,
) {
    let _ = app.emit(
        DOCX_EXPORT_PROGRESS_EVENT,
        DocxExportProgress {
            phase,
            completed,
            total,
            batch_index,
            batch_count,
        },
    );
}

#[derive(Clone, Copy, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum FormulaExportMode {
    Word,
    MathType,
    MathTypeBatch,
    KatexPreview,
}

// Formula text becomes a stable placeholder first.  The MathType bridge later
// replaces it inside Word with a real Equation.DSMT4 OLE object after feeding
// MathML through MathType's own conversion interface.
const MATH_TYPE_OLE_FILTER: &str = r#"
local formula_index = 0

function Math(element)
  formula_index = formula_index + 1
  local placeholder = string.format("HAKUROU_MTEF_FORMULA_%04d", formula_index)
  return pandoc.Span({pandoc.Str(placeholder)}, { ["custom-style"] = "HakurouMathTypePlaceholder" })
end
"#;

// Numbering is applied to display-equation paragraphs after Pandoc emits
// OMML, so Word gets a centered formula plus a true right-aligned label.  The
// source marker only controls whether that label exists; it is not part of the
// mathematical expression handed to Word or MathType.
const WORD_EQUATION_LAYOUT_FILTER: &str = r#"
function Math(element)
  local tex = element.text
  tex = tex:gsub("\\notag%s*", "")
  tex = tex:gsub("\\nonumber%s*", "")
  element.text = tex
  return element
end
"#;

// MathType's Word add-in converts OMML reliably, but its legacy translator
// can mistake TeX's *visual-only* spacing commands for formula content after
// Pandoc has expanded them.  Drop those commands only in the batch-export
// staging copy: `\\ `, `\\,`, `\\;`, `\\quad`, etc. do not alter the
// mathematical expression and the saved Markdown remains byte-for-byte
// untouched.  Deliberate textual spaces (for example in `\\text{...}`) are
// not matched by this filter.
const MATHTYPE_BATCH_EQUATION_FILTER: &str = r#"
function Math(element)
  local tex = element.text
  tex = tex:gsub("\\notag%s*", "")
  tex = tex:gsub("\\nonumber%s*", "")
  tex = tex:gsub("\\[ ,;:!]%s*", "")
  tex = tex:gsub("\\qquad%s*", "")
  tex = tex:gsub("\\quad%s*", "")
  element.text = tex
  return element
end
"#;

const KATEX_MTEF_FILTER: &str = r#"
local preview_index = 0

function Math(element)
  preview_index = preview_index + 1
  local placeholder = string.format("HAKUROU_MTEF_FORMULA_%04d", preview_index)
  return pandoc.Span({pandoc.Str(placeholder)}, { ["custom-style"] = "HakurouMtefPlaceholder" })
end
"#;

const DIRECT_MTEF_EMBED_SCRIPT: &str = include_str!("../tools/mathtype_mtef_embed.py");
const MATHTYPE_CLSID: &str = "0002ce03-0000-0000-c000-000000000046";
const MATHTYPE_OLE_STREAMS: [&str; 4] =
    ["\x01CompObj", "\x01Ole", "\x03ObjInfo", "Equation Native"];

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AssetResource {
    format: String,
    path: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ExportAsset {
    source: AssetResource,
    preview: Option<AssetResource>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FormulaPreviewAsset {
    data_base64: String,
    width_px: u32,
    height_px: u32,
    mathml: String,
    display: bool,
    latex: String,
}

#[derive(Deserialize)]
struct MathTypeOleStreamManifest {
    objects: Vec<MathTypeOleStreamObject>,
}

#[derive(Deserialize)]
struct MathTypeOleStreamObject {
    entry: String,
    streams: HashMap<String, String>,
}

/// 定位 Pandoc 可执行文件，按以下顺序：
/// 1. 随应用分发的 `pandoc/pandoc.exe`（发布包可将 pandoc 目录放在 exe 旁）；
/// 2. 开发模式下的项目根目录 `pandoc/pandoc.exe`（`target/debug` 向上三级）；
/// 3. 回退到系统 PATH 中的 `pandoc`。
fn resolve_pandoc() -> PathBuf {
    let binary = if cfg!(windows) {
        "pandoc.exe"
    } else {
        "pandoc"
    };
    if let Ok(exe) = std::env::current_exe() {
        if let Some(dir) = exe.parent() {
            let candidates = [
                dir.join("pandoc").join(binary),
                dir.join("..")
                    .join("..")
                    .join("..")
                    .join("pandoc")
                    .join(binary),
            ];
            for candidate in candidates {
                if candidate.is_file() {
                    return candidate;
                }
            }
        }
    }
    PathBuf::from("pandoc")
}

fn pandoc_version() -> Result<String, String> {
    let output = Command::new(resolve_pandoc())
        .arg("--version")
        .output()
        .map_err(|_| {
            "未检测到可用的 Pandoc。请安装 Pandoc 并确保其位于系统 PATH 中，或将 pandoc.exe 放入应用目录的 pandoc 文件夹。".to_string()
        })?;
    if !output.status.success() {
        return Err("Pandoc 无法正常启动。请检查安装是否完整。".into());
    }
    let version = String::from_utf8_lossy(&output.stdout)
        .lines()
        .next()
        .map(str::trim)
        .filter(|line| !line.is_empty())
        .unwrap_or("Pandoc")
        .to_string();
    Ok(version)
}

#[tauri::command]
pub fn inspect_pandoc() -> PandocStatus {
    match pandoc_version() {
        Ok(version) => PandocStatus {
            available: true,
            version: Some(version),
            message: None,
        },
        Err(message) => PandocStatus {
            available: false,
            version: None,
            message: Some(message),
        },
    }
}

fn create_export_directory() -> Result<PathBuf, String> {
    let root = std::env::temp_dir().join("hakurou-paper-export");
    std::fs::create_dir_all(&root).map_err(|error| format!("无法创建临时导出目录：{error}"))?;
    let stamp = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_err(|error| format!("无法生成临时导出目录：{error}"))?
        .as_nanos();
    for index in 0..1000 {
        let candidate = root.join(format!("{}-{stamp}-{index}", std::process::id()));
        match std::fs::create_dir(&candidate) {
            Ok(()) => return Ok(candidate),
            Err(error) if error.kind() == std::io::ErrorKind::AlreadyExists => continue,
            Err(error) => return Err(format!("无法创建临时导出目录：{error}")),
        }
    }
    Err("无法创建唯一的临时导出目录。".into())
}

fn is_safe_asset_path(path: &str) -> bool {
    let normalized = path.replace('\\', "/");
    normalized.starts_with("./assets/")
        && !normalized.contains("/../")
        && !normalized.ends_with("/..")
        && normalized.len() <= 420
}

fn rewrite_emf_preview_links(content: &str, assets: &[ExportAsset]) -> (String, usize) {
    let mut rewritten = content.to_string();
    let mut replacements = 0;
    for asset in assets {
        let Some(preview) = &asset.preview else {
            continue;
        };
        if !asset.source.format.eq_ignore_ascii_case("emf")
            || !is_safe_asset_path(&asset.source.path)
            || !is_safe_asset_path(&preview.path)
        {
            continue;
        }
        if rewritten.contains(&preview.path) {
            rewritten = rewritten.replace(&preview.path, &asset.source.path);
            replacements += 1;
        }
    }
    (rewritten, replacements)
}

/// Pandoc treats an empty paragraph inside a `$$ … $$` block as the end of
/// that display-math block.  Authors commonly use a blank line only for
/// visual spacing while editing long equations, so normalize that staging-only
/// form before the MathType filter assigns its ordered placeholders.
///
/// This leaves the saved Markdown untouched and deliberately avoids fenced
/// code blocks, where a literal `$$` must remain literal text.
fn normalize_display_math_blocks(content: &str) -> String {
    let mut normalized = String::with_capacity(content.len());
    let mut display_math = false;
    let mut fence: Option<char> = None;

    for line in content.split_inclusive('\n') {
        let trimmed = line.trim();
        if let Some(marker) = trimmed.chars().next().filter(|marker| *marker == '`' || *marker == '~')
        {
            if trimmed.starts_with(&marker.to_string().repeat(3)) {
                fence = match fence {
                    Some(active) if active == marker => None,
                    None => Some(marker),
                    current => current,
                };
                normalized.push_str(line);
                continue;
            }
        }
        if fence.is_none() && trimmed == "$$" {
            display_math = !display_math;
            normalized.push_str(line);
            continue;
        }
        if display_math && trimmed.is_empty() {
            continue;
        }
        normalized.push_str(line);
    }
    normalized
}

/// Labels are derived from the Markdown at export time instead of being saved
/// into the expression.  This keeps Markdown portable and lets a newly
/// inserted block formula receive the correct number after document edits.
fn collect_display_equation_labels(content: &str) -> Vec<Option<String>> {
    let mut labels = Vec::new();
    let mut display_math = false;
    let mut formula = String::new();
    let mut fence: Option<char> = None;
    let mut sequence = 0usize;

    for line in content.split_inclusive('\n') {
        let trimmed = line.trim();
        if let Some(marker) = trimmed
            .chars()
            .next()
            .filter(|marker| *marker == '`' || *marker == '~')
        {
            if trimmed.starts_with(&marker.to_string().repeat(3)) {
                fence = match fence {
                    Some(active) if active == marker => None,
                    None => Some(marker),
                    current => current,
                };
                continue;
            }
        }
        if fence.is_none() && trimmed == "$$" {
            if display_math {
                labels.push(display_equation_label(&formula, &mut sequence));
                formula.clear();
            }
            display_math = !display_math;
            continue;
        }
        if display_math {
            formula.push_str(line);
        }
    }
    labels
}

fn display_equation_label(formula: &str, sequence: &mut usize) -> Option<String> {
    if contains_latex_command(formula, "notag") || contains_latex_command(formula, "nonumber") {
        return None;
    }
    if let Some((tag, starred)) = find_equation_tag(formula) {
        if let Some(value) = numeric_equation_tag(&tag) {
            *sequence = value;
        } else {
            *sequence += 1;
        }
        return Some(if starred || (tag.starts_with('(') && tag.ends_with(')')) {
            tag
        } else {
            format!("({tag})")
        });
    }
    *sequence += 1;
    Some(format!("({sequence})"))
}

fn contains_latex_command(value: &str, command: &str) -> bool {
    let needle = format!("\\{command}");
    let mut start = 0;
    while let Some(offset) = value[start..].find(&needle) {
        let index = start + offset;
        let after = value[index + needle.len()..].chars().next();
        if !after.is_some_and(|character| character.is_ascii_alphabetic()) {
            return true;
        }
        start = index + needle.len();
    }
    false
}

fn find_equation_tag(value: &str) -> Option<(String, bool)> {
    let mut found = None;
    let mut start = 0;
    while let Some(offset) = value[start..].find("\\tag") {
        let index = start + offset;
        let bytes = value.as_bytes();
        let mut cursor = index + "\\tag".len();
        let starred = bytes.get(cursor) == Some(&b'*');
        if starred {
            cursor += 1;
        }
        while bytes.get(cursor).is_some_and(u8::is_ascii_whitespace) {
            cursor += 1;
        }
        if bytes.get(cursor) != Some(&b'{') {
            start = cursor;
            continue;
        }
        cursor += 1;
        let tag_start = cursor;
        let mut depth = 1usize;
        while let Some(byte) = bytes.get(cursor) {
            match byte {
                b'{' => depth += 1,
                b'}' => {
                    depth -= 1;
                    if depth == 0 {
                        let tag = value[tag_start..cursor].trim();
                        if !tag.is_empty() {
                            found = Some((tag.to_string(), starred));
                        }
                        cursor += 1;
                        break;
                    }
                }
                _ => {}
            }
            cursor += 1;
        }
        start = cursor;
    }
    found
}

fn numeric_equation_tag(tag: &str) -> Option<usize> {
    let tag = tag.trim().trim_start_matches('(').trim_end_matches(')').trim();
    tag.parse().ok()
}

fn uses_display_equation_layout(formula_mode: FormulaExportMode) -> bool {
    matches!(formula_mode, FormulaExportMode::Word | FormulaExportMode::MathTypeBatch)
}

/// Turn Pandoc's standalone display-equation paragraph into a pair of Word
/// tabs: a center tab for the equation and a right tab for its label.  This
/// produces the conventional paper layout without putting `\\tag` text into
/// the editable MathType object.
fn apply_display_equation_layout(docx_path: &Path, labels: &[Option<String>]) -> Result<(), String> {
    if labels.is_empty() {
        return Ok(());
    }
    let replacement_path = docx_path.with_extension("equation-layout.docx");
    let source = File::open(docx_path)
        .map_err(|error| format!("无法读取公式编号 Word 文档：{error}"))?;
    let mut archive = ZipArchive::new(source)
        .map_err(|error| format!("公式编号 Word 文档不是有效 DOCX：{error}"))?;
    let target = File::create(&replacement_path)
        .map_err(|error| format!("无法创建公式编号 Word 文档：{error}"))?;
    let mut writer = ZipWriter::new(target);
    let mut transformed = 0usize;
    for index in 0..archive.len() {
        let mut entry = archive
            .by_index(index)
            .map_err(|error| format!("无法读取公式编号 Word 内容：{error}"))?;
        let entry_name = entry.name().to_owned();
        let options = FileOptions::default().compression_method(entry.compression());
        if entry.is_dir() {
            writer
                .add_directory(&entry_name, options)
                .map_err(|error| format!("无法写入公式编号 DOCX 文件夹：{error}"))?;
            continue;
        }
        writer
            .start_file(&entry_name, options)
            .map_err(|error| format!("无法写入公式编号 DOCX 内容：{error}"))?;
        if entry_name == "word/document.xml" {
            let mut xml = String::new();
            entry
                .read_to_string(&mut xml)
                .map_err(|error| format!("无法读取公式编号文档 XML：{error}"))?;
            let (rewritten, count) = rewrite_display_equation_paragraphs(&xml, labels);
            transformed = count;
            writer
                .write_all(rewritten.as_bytes())
                .map_err(|error| format!("无法写入公式编号文档 XML：{error}"))?;
        } else {
            std::io::copy(&mut entry, &mut writer)
                .map_err(|error| format!("无法复制公式编号 DOCX 内容：{error}"))?;
        }
    }
    writer
        .finish()
        .map_err(|error| format!("无法完成公式编号 Word 文档：{error}"))?;
    if transformed == 0 && labels.iter().any(Option::is_some) {
        let _ = std::fs::remove_file(&replacement_path);
        return Err("未在 Word 文档中找到可编号的块公式。".into());
    }
    std::fs::copy(&replacement_path, docx_path)
        .map_err(|error| format!("无法写入公式编号 Word 文档：{error}"))?;
    let _ = std::fs::remove_file(&replacement_path);
    Ok(())
}

fn rewrite_display_equation_paragraphs(xml: &str, labels: &[Option<String>]) -> (String, usize) {
    let (center_tab, right_tab) = word_equation_tab_positions(xml);
    let mut rewritten = String::with_capacity(xml.len() + labels.len() * 160);
    let mut remaining = xml;
    let mut label_index = 0usize;
    let mut transformed = 0usize;

    while let Some(start) = find_word_paragraph_start(remaining) {
        rewritten.push_str(&remaining[..start]);
        let Some(end) = remaining[start..].find("</w:p>") else {
            rewritten.push_str(&remaining[start..]);
            break;
        };
        let end = start + end + "</w:p>".len();
        let paragraph = &remaining[start..end];
        if paragraph.contains("<m:oMathPara") {
            let label = labels.get(label_index).cloned().flatten();
            label_index += 1;
            if let Some(label) = label {
                if let Some(layout) = layout_display_equation_paragraph(paragraph, &label, center_tab, right_tab) {
                    rewritten.push_str(&layout);
                    transformed += 1;
                } else {
                    rewritten.push_str(paragraph);
                }
            } else {
                rewritten.push_str(paragraph);
            }
        } else {
            rewritten.push_str(paragraph);
        }
        remaining = &remaining[end..];
    }
    rewritten.push_str(remaining);
    (rewritten, transformed)
}

fn find_word_paragraph_start(value: &str) -> Option<usize> {
    let mut start = 0;
    while let Some(offset) = value[start..].find("<w:p") {
        let index = start + offset;
        let next = value.as_bytes().get(index + 4);
        if matches!(next, Some(b'>') | Some(b' ') | Some(b'\t') | Some(b'\r') | Some(b'\n')) {
            return Some(index);
        }
        start = index + 4;
    }
    None
}

fn layout_display_equation_paragraph(
    paragraph: &str,
    label: &str,
    center_tab: usize,
    right_tab: usize,
) -> Option<String> {
    let math_start = paragraph.find("<m:oMath>")?;
    let math_end = math_start + paragraph[math_start..].find("</m:oMath>")? + "</m:oMath>".len();
    let math = &paragraph[math_start..math_end];
    let opening_end = paragraph.find('>')? + 1;
    let opening = &paragraph[..opening_end];
    let body = &paragraph[opening_end..];
    let tabs = format!(
        "<w:tabs><w:tab w:val=\"center\" w:pos=\"{center_tab}\"/><w:tab w:val=\"right\" w:pos=\"{right_tab}\"/></w:tabs>"
    );
    let properties = if body.starts_with("<w:pPr>") {
        let properties_end = body.find("</w:pPr>")? + "</w:pPr>".len();
        let existing = &body[..properties_end];
        if let Some(tabs_end) = existing.find("</w:tabs>") {
            format!(
                "{}<w:tab w:val=\"center\" w:pos=\"{center_tab}\"/><w:tab w:val=\"right\" w:pos=\"{right_tab}\"/>{}",
                &existing[..tabs_end],
                &existing[tabs_end..]
            )
        } else {
            format!("{}{}", &existing[..existing.len() - "</w:pPr>".len()], tabs) + "</w:pPr>"
        }
    } else {
        format!("<w:pPr>{tabs}</w:pPr>")
    };
    Some(format!(
        "{opening}{properties}<w:r><w:tab/></w:r>{math}<w:r><w:tab/></w:r><w:r><w:t>{}</w:t></w:r></w:p>",
        escape_word_xml(label)
    ))
}

fn word_equation_tab_positions(xml: &str) -> (usize, usize) {
    let page_width = word_xml_attribute(xml, "w:pgSz", "w:w").unwrap_or(11906);
    let left_margin = word_xml_attribute(xml, "w:pgMar", "w:left").unwrap_or(1440);
    let right_margin = word_xml_attribute(xml, "w:pgMar", "w:right").unwrap_or(1440);
    let text_width = page_width.saturating_sub(left_margin.saturating_add(right_margin)).max(2880);
    (text_width / 2, text_width)
}

fn word_xml_attribute(xml: &str, element: &str, attribute: &str) -> Option<usize> {
    let element_start = xml.rfind(&format!("<{element}"))?;
    let tag = &xml[element_start..xml[element_start..].find('>')? + element_start];
    let attribute_start = tag.find(&format!("{attribute}=\""))? + attribute.len() + 2;
    let value = &tag[attribute_start..];
    value[..value.find('"')?].parse().ok()
}

fn escape_word_xml(value: &str) -> String {
    value
        .replace('&', "&amp;")
        .replace('<', "&lt;")
        .replace('>', "&gt;")
}

fn summarize_pandoc_output(output: Output) -> String {
    let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
    let stdout = String::from_utf8_lossy(&output.stdout).trim().to_string();
    let detail = if stderr.is_empty() { stdout } else { stderr };
    if detail.is_empty() {
        format!("Pandoc 以状态码 {:?} 退出。", output.status.code())
    } else {
        detail.chars().take(3000).collect()
    }
}

fn run_pandoc(
    stage_dir: &Path,
    output_path: &Path,
    reference_doc_path: Option<&Path>,
    formula_mode: FormulaExportMode,
) -> Result<(), String> {
    let mut command = Command::new(resolve_pandoc());
    command
        .current_dir(stage_dir)
        .arg("--from=markdown")
        .arg("--to=docx")
        .arg("--standalone")
        .arg("--resource-path=.")
        .arg("--output")
        .arg(output_path)
        .arg("document.md");
    match formula_mode {
        FormulaExportMode::MathType => {
            command.arg("--lua-filter").arg("math-as-mathtype-ole.lua");
        }
        FormulaExportMode::MathTypeBatch => {
            command
                .arg("--lua-filter")
                .arg("mathtype-export-formulas.lua");
        }
        FormulaExportMode::KatexPreview => {
            command.arg("--lua-filter").arg("math-as-katex-mtef.lua");
        }
        FormulaExportMode::Word => {
            command.arg("--lua-filter").arg("equation-layout.lua");
        }
    }
    if let Some(template) = reference_doc_path {
        command.arg("--reference-doc").arg(template);
    }
    let output = command
        .output()
        .map_err(|error| format!("无法启动 Pandoc：{error}"))?;
    if output.status.success() {
        Ok(())
    } else {
        Err(summarize_pandoc_output(output))
    }
}

fn prepare_mathtype_formulas(
    previews: &[FormulaPreviewAsset],
) -> Result<Vec<mathtype::MathTypeFormula>, String> {
    const MAX_FORMULA_COUNT: usize = 10_000;
    const MAX_MATHML_CHARS: usize = 1_000_000;
    if previews.len() > MAX_FORMULA_COUNT {
        return Err("MathType 公式数量超过安全上限。".into());
    }
    previews
        .iter()
        .enumerate()
        .map(|(index, preview)| {
            let mathml = preview.mathml.trim();
            if mathml.is_empty()
                || mathml.len() > MAX_MATHML_CHARS
                || !mathml.starts_with("<math")
            {
                return Err(format!("第 {} 个 MathType MathML 无效。", index + 1));
            }
            Ok(mathtype::MathTypeFormula {
                mathml: mathml.to_owned(),
                display: preview.display,
            })
        })
        .collect()
}

fn prepare_katex_formula_previews(
    stage_dir: &Path,
    previews: &[FormulaPreviewAsset],
) -> Result<(), String> {
    const MAX_PREVIEW_COUNT: usize = 10_000;
    const MAX_PREVIEW_EDGE_PX: u32 = 10_000;
    const MAX_PREVIEW_BYTES: usize = 12 * 1024 * 1024;
    const MAX_TOTAL_BYTES: usize = 160 * 1024 * 1024;

    if previews.len() > MAX_PREVIEW_COUNT {
        return Err("KaTeX 公式预览数量超过安全上限。".into());
    }
    let preview_dir = stage_dir.join("hakurou-formula-previews");
    std::fs::create_dir_all(&preview_dir)
        .map_err(|error| format!("无法准备 KaTeX 公式预览目录：{error}"))?;

    let mut total_bytes = 0usize;
    let mut equations = Vec::with_capacity(previews.len());
    for (index, preview) in previews.iter().enumerate() {
        if preview.width_px == 0
            || preview.height_px == 0
            || preview.width_px > MAX_PREVIEW_EDGE_PX
            || preview.height_px > MAX_PREVIEW_EDGE_PX
        {
            return Err(format!("第 {} 个 KaTeX 公式预览尺寸无效。", index + 1));
        }
        let bytes = BASE64.decode(&preview.data_base64).map_err(|error| {
            format!(
                "第 {} 个 KaTeX 公式预览不是有效 PNG 数据：{error}",
                index + 1
            )
        })?;
        if bytes.len() < 8
            || bytes.len() > MAX_PREVIEW_BYTES
            || !bytes.starts_with(b"\x89PNG\r\n\x1a\n")
        {
            return Err(format!(
                "第 {} 个 KaTeX 公式预览不是有效 PNG 文件。",
                index + 1
            ));
        }
        total_bytes = total_bytes.saturating_add(bytes.len());
        if total_bytes > MAX_TOTAL_BYTES {
            return Err("KaTeX 公式预览数据总量超过安全上限。".into());
        }
        std::fs::write(
            preview_dir.join(format!("formula-{:04}.png", index + 1)),
            bytes,
        )
        .map_err(|error| format!("无法写入第 {} 个 KaTeX 公式预览：{error}", index + 1))?;
        if preview.mathml.len() > 1_000_000 || !preview.mathml.trim_start().starts_with("<math") {
            return Err(format!("第 {} 个 KaTeX MathML 无效。", index + 1));
        }
        equations.push(serde_json::json!({
            "placeholder": format!("HAKUROU_MTEF_FORMULA_{:04}", index + 1),
            "mathml": preview.mathml,
            "display": preview.display,
            "previewPath": preview_dir.join(format!("formula-{:04}.png", index + 1)),
            "latex": preview.latex,
        }));
    }

    std::fs::write(stage_dir.join("math-as-katex-mtef.lua"), KATEX_MTEF_FILTER)
        .map_err(|error| format!("无法准备 KaTeX MTEF 公式转换：{error}"))?;
    let manifest = serde_json::json!({ "equations": equations });
    std::fs::write(
        stage_dir.join("mathtype-mtef-manifest.json"),
        serde_json::to_vec(&manifest)
            .map_err(|error| format!("无法序列化 MTEF 公式清单：{error}"))?,
    )
    .map_err(|error| format!("无法准备 MTEF 公式清单：{error}"))?;
    Ok(())
}

fn inject_katex_mathtype_ole(
    stage_dir: &Path,
    source_docx: &Path,
    output_docx: &Path,
    reference_doc_path: Option<&Path>,
) -> Result<(), String> {
    let script_path = stage_dir.join("mathtype_mtef_embed.py");
    std::fs::write(&script_path, DIRECT_MTEF_EMBED_SCRIPT)
        .map_err(|error| format!("无法准备 MTEF 直写器：{error}"))?;
    let patched_docx = stage_dir.join("mtef-patched.docx");
    let manifest_path = stage_dir.join("mathtype-mtef-manifest.json");
    let stream_manifest_path = stage_dir.join("mathtype-mtef-ole-streams.json");
    let mut manifest: serde_json::Value = serde_json::from_slice(
        &std::fs::read(&manifest_path)
            .map_err(|error| format!("无法读取 MTEF 公式清单：{error}"))?,
    )
    .map_err(|error| format!("无法读取 MTEF 公式清单：{error}"))?;
    manifest["sourceDocx"] = serde_json::Value::String(source_docx.to_string_lossy().to_string());
    manifest["outputDocx"] = serde_json::Value::String(patched_docx.to_string_lossy().to_string());
    manifest["streamManifest"] =
        serde_json::Value::String(stream_manifest_path.to_string_lossy().to_string());
    if let Some(template) = reference_doc_path {
        manifest["templateDocx"] =
            serde_json::Value::String(template.to_string_lossy().to_string());
    }
    std::fs::write(
        &manifest_path,
        serde_json::to_vec(&manifest)
            .map_err(|error| format!("无法更新 MTEF 公式清单：{error}"))?,
    )
    .map_err(|error| format!("无法更新 MTEF 公式清单：{error}"))?;

    let output = Command::new("py")
        .arg("-3")
        .arg("-X")
        .arg("utf8")
        .arg(&script_path)
        .arg(&manifest_path)
        .current_dir(stage_dir)
        .output()
        .map_err(|error| format!("无法启动 MTEF 直写器：{error}"))?;
    if !output.status.success() {
        return Err(format!(
            "MTEF 直写失败：{}",
            summarize_pandoc_output(output)
        ));
    }
    if !patched_docx.is_file() {
        return Err("MTEF 直写器没有生成 Word 文档。".into());
    }
    repack_mathtype_ole_cfb(&patched_docx, &stream_manifest_path)?;
    // The temporary export directory can live on a different Windows drive
    // from the user-selected output folder, where rename() returns EXDEV.
    // Copying keeps the final replacement atomic enough for this private,
    // per-export file and works across volumes.
    std::fs::copy(&patched_docx, output_docx)
        .map_err(|error| format!("无法完成 MTEF Word 文档写入：{error}"))?;
    let _ = std::fs::remove_file(&patched_docx);
    let _ = std::fs::remove_file(&stream_manifest_path);
    Ok(())
}

/// Rebuild docx-equation's four OLE streams with a standards-compliant CFB
/// writer.  Its MathML/MTEF encoder is retained; only its hand-written CFB
/// container is discarded before the exported DOCX is handed to the user.
fn repack_mathtype_ole_cfb(docx_path: &Path, stream_manifest_path: &Path) -> Result<(), String> {
    let manifest: MathTypeOleStreamManifest = serde_json::from_slice(
        &std::fs::read(stream_manifest_path)
            .map_err(|error| format!("无法读取 MTEF OLE stream 清单：{error}"))?,
    )
    .map_err(|error| format!("无法解析 MTEF OLE stream 清单：{error}"))?;
    if manifest.objects.is_empty() {
        return Err("MTEF OLE stream 清单为空。".into());
    }

    let mut replacements = HashMap::new();
    for object in manifest.objects {
        if !object.entry.starts_with("word/embeddings/") || !object.entry.ends_with(".bin") {
            return Err("MTEF OLE stream 清单包含无效 DOCX 路径。".into());
        }
        if replacements
            .insert(
                object.entry.clone(),
                build_mathtype_ole_cfb(&object.streams)?,
            )
            .is_some()
        {
            return Err("MTEF OLE stream 清单包含重复对象。".into());
        }
    }

    let replacement_path = docx_path.with_extension("cfb-repacked.docx");
    let source =
        File::open(docx_path).map_err(|error| format!("无法读取 MTEF Word 文档：{error}"))?;
    let mut archive =
        ZipArchive::new(source).map_err(|error| format!("MTEF Word 文档不是有效 DOCX：{error}"))?;
    let target = File::create(&replacement_path)
        .map_err(|error| format!("无法创建 CFB 重封装 Word 文档：{error}"))?;
    let mut writer = ZipWriter::new(target);
    let mut written = 0usize;
    for index in 0..archive.len() {
        let mut entry = archive
            .by_index(index)
            .map_err(|error| format!("无法读取 MTEF Word 内容：{error}"))?;
        let entry_name = entry.name().to_owned();
        let options = FileOptions::default().compression_method(entry.compression());
        if entry.is_dir() {
            writer
                .add_directory(&entry_name, options)
                .map_err(|error| format!("无法写入 DOCX 文件夹：{error}"))?;
            continue;
        }
        writer
            .start_file(&entry_name, options)
            .map_err(|error| format!("无法写入 DOCX 内容：{error}"))?;
        if let Some(replacement) = replacements.get(&entry_name) {
            writer
                .write_all(replacement)
                .map_err(|error| format!("无法写入重封装 MathType OLE：{error}"))?;
            written += 1;
        } else {
            std::io::copy(&mut entry, &mut writer)
                .map_err(|error| format!("无法复制 DOCX 内容：{error}"))?;
        }
    }
    writer
        .finish()
        .map_err(|error| format!("无法完成 CFB 重封装 Word 文档：{error}"))?;
    if written != replacements.len() {
        let _ = std::fs::remove_file(&replacement_path);
        return Err(format!(
            "MTEF Word 文档缺少 {} 个待重封装的 MathType OLE 对象。",
            replacements.len() - written
        ));
    }
    std::fs::copy(&replacement_path, docx_path)
        .map_err(|error| format!("无法替换 MTEF Word 文档中的 OLE 容器：{error}"))?;
    let _ = std::fs::remove_file(&replacement_path);
    Ok(())
}

fn build_mathtype_ole_cfb(streams: &HashMap<String, String>) -> Result<Vec<u8>, String> {
    let clsid = Uuid::parse_str(MATHTYPE_CLSID).expect("MathType CLSID is valid");
    let stream_bytes = MATHTYPE_OLE_STREAMS
        .iter()
        .map(|name| {
            let encoded = streams
                .get(*name)
                .ok_or_else(|| format!("MTEF OLE 缺少 {name:?} stream。"))?;
            let bytes = BASE64
                .decode(encoded)
                .map_err(|error| format!("MTEF OLE 的 {name:?} stream 不是 Base64：{error}"))?;
            if bytes.len() > 8 * 1024 * 1024 {
                return Err(format!("MTEF OLE 的 {name:?} stream 过大。"));
            }
            Ok::<_, String>((*name, bytes))
        })
        .collect::<Result<Vec<_>, _>>()?;

    let mut compound = CompoundFile::create(Cursor::new(Vec::new()))
        .map_err(|error| format!("无法创建 MathType CFB 容器：{error}"))?;
    compound
        .set_storage_clsid("/", clsid)
        .map_err(|error| format!("无法设置 MathType CFB CLSID：{error}"))?;
    for (name, bytes) in &stream_bytes {
        let mut stream = compound
            .create_stream(format!("/{name}"))
            .map_err(|error| format!("无法创建 MathType {name:?} stream：{error}"))?;
        stream
            .write_all(bytes)
            .map_err(|error| format!("无法写入 MathType {name:?} stream：{error}"))?;
    }
    compound
        .flush()
        .map_err(|error| format!("无法完成 MathType CFB 写入：{error}"))?;
    let bytes = compound.into_inner().into_inner();

    let mut verified = CompoundFile::open_strict(Cursor::new(bytes.clone()))
        .map_err(|error| format!("MathType CFB 未通过严格格式验证：{error}"))?;
    if *verified.root_entry().clsid() != clsid {
        return Err("MathType CFB 的 Root CLSID 不正确。".into());
    }
    for (name, expected) in &stream_bytes {
        let mut stream = verified
            .open_stream(format!("/{name}"))
            .map_err(|error| format!("无法复核 MathType {name:?} stream：{error}"))?;
        let mut actual = Vec::new();
        stream
            .read_to_end(&mut actual)
            .map_err(|error| format!("无法读取 MathType {name:?} stream：{error}"))?;
        if &actual != expected {
            return Err(format!("MathType CFB 意外修改了 {name:?} stream。"));
        }
    }
    Ok(bytes)
}

fn validate_docx_output(path: &Path) -> Result<(), String> {
    if !matches!(path.extension().and_then(|extension| extension.to_str()), Some(extension) if extension.eq_ignore_ascii_case("docx"))
    {
        return Err("导出文件必须使用 .docx 扩展名。".into());
    }
    let parent = path.parent().ok_or("无法确定导出文件夹。")?;
    if !parent.is_dir() {
        return Err("请选择一个有效的导出文件夹。".into());
    }
    if path.exists() {
        return Err("目标 Word 文件已存在。请选择新的文件名，避免覆盖已有交付件。".into());
    }
    Ok(())
}

fn complete_formula_delivery(
    app: &AppHandle,
    formula_mode: FormulaExportMode,
    output_path: &Path,
    math_type_formulas: Option<&[mathtype::MathTypeFormula]>,
    math_type_cache_dir: Option<&Path>,
    stage_dir: &Path,
    reference_doc_path: Option<&Path>,
) -> Result<(), String> {
    match formula_mode {
        FormulaExportMode::MathType => {
            let formulas = math_type_formulas
                .ok_or("MathType 导出缺少已准备的公式数据。")?;
            emit_docx_export_progress(app, "mathtypeRendering", 0, formulas.len(), None, None);
            mathtype::convert_docx_formulas_with_cache_and_progress(
                output_path,
                formulas,
                math_type_cache_dir,
                |progress| {
                let phase = if progress.batch_started {
                    "mathtypeStartingBatch"
                } else {
                    "mathtypeRendering"
                };
                emit_docx_export_progress(
                    app,
                    phase,
                    progress.completed,
                    progress.total,
                    Some(progress.batch_index),
                    Some(progress.batch_count),
                );
                },
            )?;
            emit_docx_export_progress(app, "saving", formulas.len(), formulas.len(), None, None);
        }
        FormulaExportMode::MathTypeBatch => {
            // MathType's official add-in performs this as one document-wide
            // operation. It cannot report per-formula counts, but its helper
            // streams dialog states so the user can take over when a legacy
            // MathType dialog cannot be automated.
            emit_docx_export_progress(app, "mathtypeBatchConverting", 0, 0, None, None);
            mathtype::convert_docx_formulas_official_batch(output_path, stage_dir, |phase| {
                let phase = match phase {
                    "mathtypeAwaitingConvertDialog" => "mathtypeAwaitingConvertDialog",
                    "mathtypeConvertDialogReady" => "mathtypeConvertDialogReady",
                    "mathtypeManualConvertNeeded" => "mathtypeManualConvertNeeded",
                    "mathtypeFormatting" => "mathtypeFormatting",
                    "mathtypeAwaitingFormatDialog" => "mathtypeAwaitingFormatDialog",
                    "mathtypeFormatDialogReady" => "mathtypeFormatDialogReady",
                    "mathtypeManualFormatNeeded" => "mathtypeManualFormatNeeded",
                    "mathtypeFormattingSkipped" => "mathtypeFormattingSkipped",
                    "saving" => "saving",
                    "mathtypeBatchConverting" => "mathtypeBatchConverting",
                    _ => "mathtypeBatchConverting",
                };
                emit_docx_export_progress(app, phase, 0, 0, None, None);
            })?;
            emit_docx_export_progress(app, "saving", 0, 0, None, None);
        }
        FormulaExportMode::Word => {}
        FormulaExportMode::KatexPreview => {
            inject_katex_mathtype_ole(stage_dir, output_path, output_path, reference_doc_path)?;
        }
    }
    Ok(())
}

#[tauri::command]
pub async fn export_docx(
    app: AppHandle,
    document_path: String,
    content: String,
    asset_folder: Option<String>,
    assets: Vec<ExportAsset>,
    output_path: String,
    reference_doc_path: Option<String>,
    formula_mode: Option<FormulaExportMode>,
    formula_previews: Option<Vec<FormulaPreviewAsset>>,
) -> Result<DocxExport, String> {
    tauri::async_runtime::spawn_blocking(move || {
        export_docx_impl(
            &app,
            document_path,
            content,
            asset_folder,
            assets,
            output_path,
            reference_doc_path,
            formula_mode,
            formula_previews,
        )
    })
    .await
    .map_err(|error| format!("Word 导出任务意外中断：{error}"))?
}

fn export_docx_impl(
    app: &AppHandle,
    document_path: String,
    content: String,
    asset_folder: Option<String>,
    assets: Vec<ExportAsset>,
    output_path: String,
    reference_doc_path: Option<String>,
    formula_mode: Option<FormulaExportMode>,
    formula_previews: Option<Vec<FormulaPreviewAsset>>,
) -> Result<DocxExport, String> {
    emit_docx_export_progress(app, "preparing", 0, 0, None, None);
    let document_path = PathBuf::from(document_path);
    if !is_markdown_path(&document_path) || !document_path.is_file() {
        return Err("请先保存有效的 Markdown 文稿，再导出 Word 文档。".into());
    }
    let output_path = PathBuf::from(output_path);
    validate_docx_output(&output_path)?;
    let formula_mode = formula_mode.unwrap_or(FormulaExportMode::Word);
    let display_equation_labels = uses_display_equation_layout(formula_mode)
        .then(|| collect_display_equation_labels(&content));

    let reference_doc_path = reference_doc_path.map(PathBuf::from);
    if let Some(template) = &reference_doc_path {
        if !template.is_file()
            || !matches!(template.extension().and_then(|extension| extension.to_str()), Some(extension) if extension.eq_ignore_ascii_case("docx"))
        {
            return Err("请选择有效的 .docx Word 模板。".into());
        }
    }
    pandoc_version()?;

    let document_dir = document_path.parent().ok_or("无法确定文稿所在目录。")?;
    let folder = document_asset_folder(&document_path, asset_folder);
    let source_assets = document_dir.join("assets").join(&folder);
    let math_type_cache_dir = matches!(formula_mode, FormulaExportMode::MathType)
        .then(|| source_assets.join(".hakurou").join("mathtype-native-cache"));
    let stage_dir = create_export_directory()?;
    let stage_markdown = stage_dir.join("document.md");
    // MathType's Word add-in must have an editable document.  Opening the
    // user-selected destination directly can make Word silently fall back to
    // read-only mode when that path is already open or briefly locked.  Keep
    // the full batch workflow private to this export directory, then publish
    // the completed document only after Word has closed it.
    let delivery_docx = matches!(formula_mode, FormulaExportMode::MathTypeBatch)
        .then(|| stage_dir.join("mathtype-batch-result.docx"))
        .unwrap_or_else(|| output_path.clone());

    let result = (|| -> Result<DocxExport, String> {
        let math_type_formulas = if matches!(formula_mode, FormulaExportMode::MathType) {
            Some(prepare_mathtype_formulas(
                formula_previews
                    .as_deref()
                    .ok_or("MathType 导出缺少公式 MathML 数据。")?,
            )?)
        } else {
            None
        };
        let stage_assets = stage_dir.join("assets").join(&folder);
        std::fs::create_dir_all(&stage_assets)
            .map_err(|error| format!("无法准备导出资源目录：{error}"))?;
        if source_assets.is_dir() {
            copy_directory(&source_assets, &stage_assets)?;
        }

        let staged_content = if matches!(formula_mode, FormulaExportMode::MathType) {
            normalize_display_math_blocks(&content)
        } else {
            content.clone()
        };
        let (emf_content, emf_assets) = rewrite_emf_preview_links(&staged_content, &assets);
        std::fs::write(&stage_markdown, &emf_content)
            .map_err(|error| format!("无法准备临时 Markdown：{error}"))?;
        if matches!(formula_mode, FormulaExportMode::MathType) {
            std::fs::write(
                stage_dir.join("math-as-mathtype-ole.lua"),
                MATH_TYPE_OLE_FILTER,
            )
                .map_err(|error| format!("无法准备 MathType 公式转换：{error}"))?;
        }
        if matches!(formula_mode, FormulaExportMode::MathTypeBatch) {
            std::fs::write(
                stage_dir.join("mathtype-export-formulas.lua"),
                MATHTYPE_BATCH_EQUATION_FILTER,
            )
            .map_err(|error| format!("无法准备 MathType 公式空格兼容处理：{error}"))?;
        }
        if matches!(formula_mode, FormulaExportMode::Word) {
            std::fs::write(
                stage_dir.join("equation-layout.lua"),
                WORD_EQUATION_LAYOUT_FILTER,
            )
            .map_err(|error| format!("无法准备公式编号处理：{error}"))?;
        }
        if matches!(formula_mode, FormulaExportMode::KatexPreview) {
            prepare_katex_formula_previews(
                &stage_dir,
                formula_previews.as_deref().unwrap_or_default(),
            )?;
        }

        emit_docx_export_progress(app, "generating", 0, 0, None, None);
        match run_pandoc(
            &stage_dir,
            &delivery_docx,
            reference_doc_path.as_deref(),
            formula_mode,
        ) {
            Ok(()) => {
                if let Some(labels) = &display_equation_labels {
                    apply_display_equation_layout(&delivery_docx, labels)?;
                }
                complete_formula_delivery(
                    app,
                    formula_mode,
                    &delivery_docx,
                    math_type_formulas.as_deref(),
                    math_type_cache_dir.as_deref(),
                    &stage_dir,
                    reference_doc_path.as_deref(),
                )?;
                if delivery_docx != output_path {
                    std::fs::copy(&delivery_docx, &output_path).map_err(|error| {
                        format!(
                            "MathType 已完成转换，但无法写入最终 Word 文档：{error}。请关闭同名 Word 文档后重试。"
                        )
                    })?;
                }
                Ok(DocxExport {
                    output_path: output_path.to_string_lossy().to_string(),
                    used_emf_assets: emf_assets,
                    used_preview_fallback_assets: 0,
                })
            }
            Err(emf_error) if emf_assets > 0 => {
                let _ = std::fs::remove_file(&delivery_docx);
                std::fs::write(&stage_markdown, &content)
                    .map_err(|error| format!("无法准备 PNG 回退导出：{error}"))?;
                run_pandoc(&stage_dir, &delivery_docx, reference_doc_path.as_deref(), formula_mode).map_err(|preview_error| {
                    format!("使用 EMF 原图元导出失败：{emf_error}\n\n使用 PNG 预览重试仍失败：{preview_error}")
                })?;
                if let Some(labels) = &display_equation_labels {
                    apply_display_equation_layout(&delivery_docx, labels)?;
                }
                complete_formula_delivery(
                    app,
                    formula_mode,
                    &delivery_docx,
                    math_type_formulas.as_deref(),
                    math_type_cache_dir.as_deref(),
                    &stage_dir,
                    reference_doc_path.as_deref(),
                )?;
                if delivery_docx != output_path {
                    std::fs::copy(&delivery_docx, &output_path).map_err(|error| {
                        format!(
                            "MathType 已完成转换，但无法写入最终 Word 文档：{error}。请关闭同名 Word 文档后重试。"
                        )
                    })?;
                }
                Ok(DocxExport {
                    output_path: output_path.to_string_lossy().to_string(),
                    used_emf_assets: 0,
                    used_preview_fallback_assets: emf_assets,
                })
            }
            Err(error) => Err(error),
        }
    })();

    if result.is_err() && delivery_docx == output_path {
        let _ = std::fs::remove_file(&output_path);
    }
    let _ = std::fs::remove_dir_all(&stage_dir);
    result
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn emf_assets_replace_only_the_preview_in_the_export_copy() {
        let content = "![figure](./assets/paper/figure.png)\n";
        let assets = vec![ExportAsset {
            source: AssetResource {
                format: "emf".into(),
                path: "./assets/paper/figure.emf".into(),
            },
            preview: Some(AssetResource {
                format: "png".into(),
                path: "./assets/paper/figure.png".into(),
            }),
        }];

        let (rewritten, replacements) = rewrite_emf_preview_links(content, &assets);
        assert_eq!(replacements, 1);
        assert_eq!(rewritten, "![figure](./assets/paper/figure.emf)\n");
        assert_eq!(content, "![figure](./assets/paper/figure.png)\n");
    }

    #[test]
    fn mathtype_filter_uses_stable_ordered_placeholders() {
        assert!(MATH_TYPE_OLE_FILTER.contains("formula_index"));
        assert!(MATH_TYPE_OLE_FILTER.contains("HAKUROU_MTEF_FORMULA"));
        assert!(MATH_TYPE_OLE_FILTER.contains("HakurouMathTypePlaceholder"));
    }

    #[test]
    fn normalizes_blank_lines_inside_display_math_only_in_staging_content() {
        let source = "before\n$$\na + b\n\n+ c\n$$\nafter\n```tex\n$$\n\n$$\n```\n";
        let normalized = normalize_display_math_blocks(source);
        assert_eq!(
            normalized,
            "before\n$$\na + b\n+ c\n$$\nafter\n```tex\n$$\n\n$$\n```\n"
        );
        assert_eq!(source, "before\n$$\na + b\n\n+ c\n$$\nafter\n```tex\n$$\n\n$$\n```\n");
    }

    #[test]
    fn display_equation_labels_auto_number_and_respect_standard_latex_overrides() {
        let source = "$$\na=b\n$$\n$$\nc=d\\notag\n$$\n$$\ne=f\\tag{7}\n$$\n$$\ng=h\n$$\n$$\ni=j\\tag*{A}\n$$\n";
        assert_eq!(
            collect_display_equation_labels(source),
            vec![
                Some("(1)".into()),
                None,
                Some("(7)".into()),
                Some("(8)".into()),
                Some("A".into()),
            ]
        );
    }

    #[test]
    fn display_equation_layout_uses_center_and_right_word_tabs() {
        let xml = r#"<w:document><w:body><w:p><w:pPr><w:pStyle w:val="BodyText"/></w:pPr><m:oMathPara><m:oMathParaPr><m:jc m:val="center"/></m:oMathParaPr><m:oMath><m:r><m:t>x</m:t></m:r></m:oMath></m:oMathPara></w:p><w:sectPr><w:pgSz w:w="11906"/><w:pgMar w:left="1440" w:right="1440"/></w:sectPr></w:body></w:document>"#;
        let (rewritten, transformed) = rewrite_display_equation_paragraphs(xml, &[Some("(1)".into())]);
        assert_eq!(transformed, 1);
        assert!(!rewritten.contains("<m:oMathPara"));
        assert!(rewritten.contains("<m:oMath><m:r><m:t>x</m:t></m:r></m:oMath>"));
        assert!(rewritten.contains("w:val=\"center\" w:pos=\"4513\""));
        assert!(rewritten.contains("w:val=\"right\" w:pos=\"9026\""));
        assert!(rewritten.contains("<w:t>(1)</w:t>"));
    }

    #[test]
    fn equation_layout_rewrites_the_docx_container_without_dropping_entries() {
        let nonce = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("system time should be after the Unix epoch")
            .as_nanos();
        let stage = std::env::temp_dir().join(format!(
            "hakurou-equation-layout-test-{}-{nonce}",
            std::process::id()
        ));
        std::fs::create_dir_all(&stage).expect("stage directory should be created");
        let docx_path = stage.join("source.docx");
        let source = File::create(&docx_path).expect("source docx should be created");
        let mut writer = ZipWriter::new(source);
        writer
            .start_file("word/document.xml", FileOptions::default())
            .expect("document entry should be created");
        writer
            .write_all(b"<w:document><w:body><w:p><m:oMathPara><m:oMath><m:r><m:t>x</m:t></m:r></m:oMath></m:oMathPara></w:p></w:body></w:document>")
            .expect("document XML should be written");
        writer
            .start_file("word/media/keep.bin", FileOptions::default())
            .expect("unrelated entry should be created");
        writer
            .write_all(b"keep")
            .expect("unrelated entry should be written");
        writer.finish().expect("source docx should be finished");

        apply_display_equation_layout(&docx_path, &[Some("(1)".into())])
            .expect("layout should be applied");

        let source = File::open(&docx_path).expect("rewritten docx should exist");
        let mut archive = ZipArchive::new(source).expect("rewritten document should remain a ZIP");
        let mut xml = String::new();
        archive
            .by_name("word/document.xml")
            .expect("rewritten document XML should exist")
            .read_to_string(&mut xml)
            .expect("rewritten XML should be readable");
        assert!(xml.contains("<w:t>(1)</w:t>"));
        let mut preserved = Vec::new();
        archive
            .by_name("word/media/keep.bin")
            .expect("unrelated entry should remain")
            .read_to_end(&mut preserved)
            .expect("unrelated entry should be readable");
        assert_eq!(preserved, b"keep");
        let _ = std::fs::remove_dir_all(&stage);
    }

    #[test]
    fn prepares_indexed_katex_png_previews_for_pandoc() {
        let nonce = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("system time should be after the Unix epoch")
            .as_nanos();
        let stage = std::env::temp_dir().join(format!(
            "hakurou-katex-preview-test-{}-{nonce}",
            std::process::id()
        ));
        std::fs::create_dir_all(&stage).expect("stage directory should be created");
        let previews = vec![FormulaPreviewAsset {
            // A valid transparent 1×1 PNG. The production path validates only
            // the PNG signature here; the browser paints the KaTeX canvas.
            data_base64: "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScL9WQAAAABJRU5ErkJggg==".into(),
            width_px: 18,
            height_px: 14,
            mathml: "<math xmlns=\"http://www.w3.org/1998/Math/MathML\"><mi>x</mi></math>"
                .into(),
            display: false,
            latex: "x".into(),
        }];

        prepare_katex_formula_previews(&stage, &previews)
            .expect("preview assets should be prepared");
        assert!(stage
            .join("hakurou-formula-previews")
            .join("formula-0001.png")
            .is_file());
        let filter = std::fs::read_to_string(stage.join("math-as-katex-mtef.lua"))
            .expect("filter should be written");
        assert!(filter.contains("HAKUROU_MTEF_FORMULA_%04d"));
        let manifest = std::fs::read_to_string(stage.join("mathtype-mtef-manifest.json"))
            .expect("manifest should be written");
        assert!(manifest.contains("HAKUROU_MTEF_FORMULA_0001"));
        assert!(manifest.contains("<mi>x</mi>"));

        let _ = std::fs::remove_dir_all(stage);
    }

    #[test]
    fn repacks_mathtype_streams_with_a_strict_cfb_container() {
        let nonce = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("system time should be after the Unix epoch")
            .as_nanos();
        let stage = std::env::temp_dir().join(format!(
            "hakurou-mathtype-cfb-test-{}-{nonce}",
            std::process::id()
        ));
        std::fs::create_dir_all(&stage).expect("stage directory should be created");
        let docx_path = stage.join("source.docx");
        let stream_manifest_path = stage.join("streams.json");
        let streams: HashMap<String, String> = HashMap::from([
            ("\x01CompObj".into(), BASE64.encode(b"compobj")),
            ("\x01Ole".into(), BASE64.encode(b"ole")),
            ("\x03ObjInfo".into(), BASE64.encode(b"objinfo")),
            ("Equation Native".into(), BASE64.encode(b"native")),
        ]);
        let manifest = serde_json::json!({
            "objects": [{
                "entry": "word/embeddings/oleObjectMathType001.bin",
                "streams": streams,
            }]
        });
        std::fs::write(
            &stream_manifest_path,
            serde_json::to_vec(&manifest).unwrap(),
        )
        .expect("stream manifest should be written");
        let source = File::create(&docx_path).expect("source docx should be created");
        let mut writer = ZipWriter::new(source);
        writer
            .start_file("word/document.xml", FileOptions::default())
            .expect("document entry should be created");
        writer
            .write_all(b"<w:document/>")
            .expect("document XML should be written");
        writer
            .start_file(
                "word/embeddings/oleObjectMathType001.bin",
                FileOptions::default(),
            )
            .expect("OLE entry should be created");
        writer
            .write_all(b"temporary-invalid-cfb")
            .expect("temporary OLE should be written");
        writer.finish().expect("source docx should be finished");

        repack_mathtype_ole_cfb(&docx_path, &stream_manifest_path)
            .expect("CFB repack should succeed");

        let source = File::open(&docx_path).expect("repacked docx should exist");
        let mut archive = ZipArchive::new(source).expect("repacked document should be a ZIP");
        let mut packed = Vec::new();
        archive
            .by_name("word/embeddings/oleObjectMathType001.bin")
            .expect("repacked OLE should be present")
            .read_to_end(&mut packed)
            .expect("repacked OLE should be readable");
        let mut cfb = CompoundFile::open_strict(Cursor::new(packed))
            .expect("repacked OLE should pass strict CFB validation");
        assert_eq!(
            *cfb.root_entry().clsid(),
            Uuid::parse_str(MATHTYPE_CLSID).unwrap()
        );
        let mut native = Vec::new();
        cfb.open_stream("/Equation Native")
            .expect("Equation Native should exist")
            .read_to_end(&mut native)
            .expect("Equation Native should be readable");
        assert_eq!(native, b"native");

        let _ = std::fs::remove_dir_all(stage);
    }
}
