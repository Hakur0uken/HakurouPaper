use base64::{engine::general_purpose::STANDARD as BASE64, Engine};
use serde::{Deserialize, Serialize};
use std::{
    ffi::OsStr,
    fs,
    path::{Component, Path, PathBuf},
    process::{Command, Output},
    time::{SystemTime, UNIX_EPOCH},
};

use crate::is_markdown_path;

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GitInstallationStatus {
    available: bool,
    version: Option<String>,
    message: Option<String>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct VersionDocumentScope {
    document_path: String,
    asset_folder_path: Option<String>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct VersionRepositoryInfo {
    is_repository: bool,
    repository_root: Option<String>,
    current_branch: Option<String>,
    has_commits: bool,
    document_scope: VersionDocumentScope,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum VersionChangeKind {
    Added,
    Modified,
    Deleted,
    Renamed,
    Untracked,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum VersionResourceKind {
    Markdown,
    Image,
    Metadata,
    Other,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct VersionChange {
    path: String,
    is_document: bool,
    kind: VersionChangeKind,
    resource_kind: VersionResourceKind,
    old_path: Option<String>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum DiffLineKind {
    Context,
    Added,
    Removed,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DiffLine {
    kind: DiffLineKind,
    old_line_number: Option<usize>,
    new_line_number: Option<usize>,
    content: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DiffHunk {
    old_start: usize,
    old_lines: usize,
    new_start: usize,
    new_lines: usize,
    lines: Vec<DiffLine>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(
    tag = "kind",
    rename_all = "lowercase",
    rename_all_fields = "camelCase"
)]
pub enum FileDiff {
    Text {
        path: String,
        change_kind: VersionChangeKind,
        old_path: Option<String>,
        hunks: Vec<DiffHunk>,
    },
    Binary {
        path: String,
        change_kind: VersionChangeKind,
        old_path: Option<String>,
        // Kept intentionally empty for now. Future versions can add previewBefore/previewAfter.
    },
}

#[derive(Debug, Clone, Copy, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum RevisionKind {
    CurrentDocument,
    Version,
    Empty,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RevisionDescriptor {
    kind: RevisionKind,
    id: Option<String>,
    short_id: Option<String>,
    title: Option<String>,
    timestamp: Option<String>,
    author_name: Option<String>,
    author_email: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct VersionComparisonSummary {
    changed_files: usize,
    added_lines: usize,
    removed_lines: usize,
    internal_files: usize,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct VersionComparison {
    base_revision: RevisionDescriptor,
    target_revision: RevisionDescriptor,
    changes: Vec<VersionChange>,
    summary: VersionComparisonSummary,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RevisionAssetSnapshot {
    path: String,
    mime_type: String,
    data_base64: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RevisionDocumentSnapshot {
    revision: RevisionDescriptor,
    markdown: String,
    metadata: Option<String>,
    assets: Vec<RevisionAssetSnapshot>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct VersionRecord {
    id: String,
    short_id: String,
    message: String,
    timestamp: String,
    author_name: Option<String>,
    author_email: Option<String>,
    parent_ids: Vec<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct VersionAuthorIdentity {
    name: Option<String>,
    email: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RestoreVersionPreflight {
    has_unversioned_scope_changes: bool,
    target_version: VersionRecord,
}

#[derive(Debug, Clone, Copy, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum RestoreStrategy {
    SaveCurrentVersionFirst,
    DiscardCurrentChanges,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RestoreVersionResult {
    restored_from: VersionRecord,
    created_version: Option<VersionRecord>,
    already_equivalent: bool,
}

struct TargetScopeFile {
    path: String,
    content: Vec<u8>,
}

struct ScopePaths {
    document: String,
    asset_folder: Option<String>,
}

struct RepositoryContext {
    root: PathBuf,
    scope: ScopePaths,
    has_commits: bool,
}

fn output_message(output: &Output) -> String {
    let message = String::from_utf8_lossy(&output.stderr).trim().to_string();
    if message.is_empty() {
        String::from_utf8_lossy(&output.stdout).trim().to_string()
    } else {
        message
    }
}

fn git_version_with_program(program: &OsStr) -> Result<String, String> {
    let output = Command::new(program)
        .arg("--version")
        .output()
        .map_err(|_| "未检测到 Git。请安装 Git 并确保其位于系统 PATH 中。".to_string())?;
    if !output.status.success() {
        return Err(format!("Git 无法正常启动：{}", output_message(&output)));
    }
    let stdout = String::from_utf8_lossy(&output.stdout);
    let version_line = stdout
        .lines()
        .next()
        .map(str::trim)
        .filter(|line| !line.is_empty())
        .unwrap_or("Git");
    Ok(version_line
        .strip_prefix("git version ")
        .unwrap_or(version_line)
        .to_string())
}

fn git_installation_status(program: &OsStr) -> GitInstallationStatus {
    match git_version_with_program(program) {
        Ok(version) => GitInstallationStatus {
            available: true,
            version: Some(version),
            message: None,
        },
        Err(message) => GitInstallationStatus {
            available: false,
            version: None,
            message: Some(message),
        },
    }
}

fn git_output_in(directory: &Path, arguments: &[&str]) -> Result<Output, String> {
    Command::new("git")
        .arg("-C")
        .arg(directory)
        .args(arguments)
        .output()
        .map_err(|_| "未检测到 Git。请安装 Git 并确保其位于系统 PATH 中。".to_string())
}

fn git_output_in_owned(directory: &Path, arguments: &[String]) -> Result<Output, String> {
    Command::new("git")
        .arg("-C")
        .arg(directory)
        .args(arguments)
        .output()
        .map_err(|_| "未检测到 Git。请安装 Git 并确保其位于系统 PATH 中。".to_string())
}

fn validate_document_path(value: &str) -> Result<PathBuf, String> {
    let path = PathBuf::from(value);
    if !is_markdown_path(&path) {
        return Err("版本管理只能关联已保存的 Markdown 文稿。".into());
    }
    if !path.is_file() {
        return Err("文稿文件不存在，请先重新保存文稿。".into());
    }
    if !path.parent().is_some_and(Path::is_dir) {
        return Err("无法确定有效的文稿所在目录。".into());
    }
    path.canonicalize()
        .map_err(|error| format!("无法解析文稿路径：{error}"))
}

fn safe_asset_folder(value: &str) -> bool {
    if value.trim().is_empty() || value == "." || value == ".." || value.contains(['/', '\\']) {
        return false;
    }
    let mut components = Path::new(value).components();
    matches!(components.next(), Some(Component::Normal(_))) && components.next().is_none()
}

/// Finds the document-local Hakurou asset folder referenced by Markdown.
/// This is deliberately limited to `./assets/<folder>/…` paths so it cannot widen
/// the Git scope beyond the current document's dedicated resource folder.
fn asset_folder_from_markdown(markdown: &str) -> Option<String> {
    const PREFIX: &str = "./assets/";
    let mut cursor = 0;
    while let Some(offset) = markdown[cursor..].find(PREFIX) {
        let start = cursor + offset + PREFIX.len();
        let remaining = &markdown[start..];
        let folder = remaining
            .split(|character: char| {
                character == '/'
                    || character == '\\'
                    || character == ')'
                    || character.is_whitespace()
            })
            .next()
            .unwrap_or_default();
        if safe_asset_folder(folder) {
            return Some(folder.to_string());
        }
        cursor = start;
    }
    None
}

fn document_scope(
    document_path: &Path,
    asset_folder: Option<&str>,
) -> Result<VersionDocumentScope, String> {
    let document_dir = document_path.parent().ok_or("无法确定文稿所在目录。")?;
    let asset_folder_path = asset_folder
        .filter(|folder| safe_asset_folder(folder))
        .map(|folder| {
            document_dir
                .join("assets")
                .join(folder)
                .to_string_lossy()
                .to_string()
        });

    Ok(VersionDocumentScope {
        document_path: document_path.to_string_lossy().to_string(),
        asset_folder_path,
    })
}

fn repository_root(document_dir: &Path) -> Result<Option<PathBuf>, String> {
    let output = git_output_in(document_dir, &["rev-parse", "--show-toplevel"])?;
    if !output.status.success() {
        return Ok(None);
    }
    let root = String::from_utf8_lossy(&output.stdout).trim().to_string();
    if root.is_empty() {
        return Err("Git 未返回仓库根目录。".into());
    }
    PathBuf::from(root)
        .canonicalize()
        .map(Some)
        .map_err(|error| format!("无法解析 Git 仓库根目录：{error}"))
}

fn current_branch(document_dir: &Path) -> Result<Option<String>, String> {
    let output = git_output_in(
        document_dir,
        &["symbolic-ref", "--quiet", "--short", "HEAD"],
    )?;
    if !output.status.success() {
        return Ok(None);
    }
    let branch = String::from_utf8_lossy(&output.stdout).trim().to_string();
    Ok((!branch.is_empty()).then_some(branch))
}

fn has_commits(document_dir: &Path) -> Result<bool, String> {
    let output = git_output_in(document_dir, &["rev-parse", "--verify", "--quiet", "HEAD"])?;
    Ok(output.status.success())
}

fn repository_relative_path(root: &Path, path: &Path) -> Result<String, String> {
    let relative = path
        .strip_prefix(root)
        .map_err(|_| "当前文稿不在 Git 仓库范围内。")?;
    normalize_repository_path(relative)
}

fn normalize_repository_path(path: &Path) -> Result<String, String> {
    let mut components = Vec::new();
    for component in path.components() {
        match component {
            Component::Normal(value) => components.push(value.to_string_lossy().to_string()),
            Component::CurDir => {}
            Component::ParentDir | Component::RootDir | Component::Prefix(_) => {
                return Err("版本管理路径不在允许范围内。".into());
            }
        }
    }
    if components.is_empty() {
        return Err("版本管理路径不能为空。".into());
    }
    Ok(components.join("/"))
}

fn scope_paths(
    root: &Path,
    document_path: &Path,
    asset_folder: Option<&str>,
) -> Result<ScopePaths, String> {
    let document_dir = document_path.parent().ok_or("无法确定文稿所在目录。")?;
    let asset_folder = asset_folder
        .filter(|folder| safe_asset_folder(folder))
        .map(|folder| repository_relative_path(root, &document_dir.join("assets").join(folder)))
        .transpose()?;
    Ok(ScopePaths {
        document: repository_relative_path(root, document_path)?,
        asset_folder,
    })
}

fn path_is_in_scope(path: &str, scope: &ScopePaths) -> bool {
    if path == scope.document {
        return true;
    }
    scope.asset_folder.as_ref().is_some_and(|assets| {
        path == assets
            || path
                .strip_prefix(assets)
                .is_some_and(|remaining| remaining.starts_with('/'))
    })
}

fn scope_pathspecs(scope: &ScopePaths) -> Vec<String> {
    let mut paths = vec![scope.document.clone()];
    if let Some(asset_folder) = &scope.asset_folder {
        paths.push(asset_folder.clone());
    }
    paths
}

fn repository_context(
    document_path: &Path,
    asset_folder: Option<&str>,
) -> Result<RepositoryContext, String> {
    let document_dir = document_path.parent().ok_or("无法确定文稿所在目录。")?;
    let root = repository_root(document_dir)?.ok_or("当前文稿尚未启用版本管理。")?;
    let scope = scope_paths(&root, document_path, asset_folder)?;
    Ok(RepositoryContext {
        has_commits: has_commits(&root)?,
        root,
        scope,
    })
}

fn resource_kind(path: &str, scope: &ScopePaths) -> VersionResourceKind {
    let file_name = Path::new(path)
        .file_name()
        .and_then(|name| name.to_str())
        .unwrap_or_default();
    let extension = Path::new(path)
        .extension()
        .and_then(|extension| extension.to_str())
        .unwrap_or_default()
        .to_ascii_lowercase();
    if matches!(extension.as_str(), "md" | "markdown" | "mdx") {
        return VersionResourceKind::Markdown;
    }
    if file_name.eq_ignore_ascii_case("hakurou.json") {
        return VersionResourceKind::Metadata;
    }
    let is_asset = scope.asset_folder.as_ref().is_some_and(|asset_folder| {
        path.strip_prefix(asset_folder)
            .is_some_and(|remaining| remaining.starts_with('/'))
    });
    if is_asset
        && matches!(
            extension.as_str(),
            "png" | "jpg" | "jpeg" | "webp" | "gif" | "bmp" | "svg" | "emf" | "wmf" | "pdf"
        )
    {
        return VersionResourceKind::Image;
    }
    VersionResourceKind::Other
}

fn normalize_status_path(value: &str) -> Result<String, String> {
    normalize_repository_path(Path::new(value))
}

fn record_path(record: &str, parts: usize) -> Option<&str> {
    record
        .splitn(parts, ' ')
        .nth(parts - 1)
        .filter(|path| !path.is_empty())
}

fn ordinary_change_kind(xy: &str, exists: bool) -> VersionChangeKind {
    if !exists && xy.contains('D') {
        VersionChangeKind::Deleted
    } else if xy.contains('A') {
        VersionChangeKind::Added
    } else {
        VersionChangeKind::Modified
    }
}

fn parse_status(output: &[u8], root: &Path, scope: &ScopePaths) -> Vec<VersionChange> {
    let mut changes = Vec::new();
    let mut records = output
        .split(|byte| *byte == b'\0')
        .filter(|record| !record.is_empty());
    while let Some(record) = records.next() {
        let record = String::from_utf8_lossy(record);
        let Some(kind) = record.as_bytes().first().copied() else {
            continue;
        };
        match kind {
            b'1' => {
                let xy = record.splitn(3, ' ').nth(1).unwrap_or_default();
                let Some(path) =
                    record_path(&record, 9).and_then(|value| normalize_status_path(value).ok())
                else {
                    continue;
                };
                if !path_is_in_scope(&path, scope) {
                    continue;
                }
                let change_kind = ordinary_change_kind(xy, root.join(&path).exists());
                changes.push(VersionChange {
                    resource_kind: resource_kind(&path, scope),
                    is_document: path == scope.document,
                    path,
                    kind: change_kind,
                    old_path: None,
                });
            }
            b'2' => {
                let xy = record.splitn(3, ' ').nth(1).unwrap_or_default();
                let Some(path) =
                    record_path(&record, 10).and_then(|value| normalize_status_path(value).ok())
                else {
                    continue;
                };
                let old_record = records.next().map(String::from_utf8_lossy);
                let old_path = old_record
                    .as_deref()
                    .and_then(|value| normalize_status_path(value).ok());
                if !path_is_in_scope(&path, scope) {
                    continue;
                }
                let is_rename = xy.contains('R')
                    && old_path
                        .as_deref()
                        .is_some_and(|old| path_is_in_scope(old, scope));
                changes.push(VersionChange {
                    resource_kind: resource_kind(&path, scope),
                    is_document: path == scope.document,
                    path,
                    kind: if is_rename {
                        VersionChangeKind::Renamed
                    } else {
                        VersionChangeKind::Added
                    },
                    old_path: if is_rename { old_path } else { None },
                });
            }
            b'?' => {
                let Some(path) = record
                    .strip_prefix("? ")
                    .and_then(|value| normalize_status_path(value).ok())
                else {
                    continue;
                };
                if !path_is_in_scope(&path, scope) {
                    continue;
                }
                changes.push(VersionChange {
                    resource_kind: resource_kind(&path, scope),
                    is_document: path == scope.document,
                    path,
                    kind: VersionChangeKind::Untracked,
                    old_path: None,
                });
            }
            // A conflicted path is still an obvious current modification. Conflict handling itself
            // deliberately stays out of this read-only phase.
            b'u' => {
                let Some(path) =
                    record_path(&record, 11).and_then(|value| normalize_status_path(value).ok())
                else {
                    continue;
                };
                if !path_is_in_scope(&path, scope) {
                    continue;
                }
                changes.push(VersionChange {
                    resource_kind: resource_kind(&path, scope),
                    is_document: path == scope.document,
                    path,
                    kind: VersionChangeKind::Modified,
                    old_path: None,
                });
            }
            _ => {}
        }
    }
    changes
}

fn changes_for_context(context: &RepositoryContext) -> Result<Vec<VersionChange>, String> {
    let mut arguments = vec![
        "status".to_string(),
        "--porcelain=v2".to_string(),
        "-z".to_string(),
        "--untracked-files=all".to_string(),
        "--".to_string(),
    ];
    arguments.extend(scope_pathspecs(&context.scope));
    let output = git_output_in_owned(&context.root, &arguments)?;
    if !output.status.success() {
        return Err(format!(
            "无法读取 Git 修改状态：{}",
            output_message(&output)
        ));
    }
    Ok(parse_status(&output.stdout, &context.root, &context.scope))
}

fn current_document_revision() -> RevisionDescriptor {
    RevisionDescriptor {
        kind: RevisionKind::CurrentDocument,
        id: None,
        short_id: None,
        title: None,
        timestamp: None,
        author_name: None,
        author_email: None,
    }
}

fn current_base_revision(context: &RepositoryContext) -> Result<RevisionDescriptor, String> {
    if !has_commits(&context.root)? {
        return Ok(empty_revision());
    }
    let mut arguments = vec![
        "log".to_string(),
        "-1".to_string(),
        "--format=%H%x00%h%x00%s%x00%cI%x00%an%x00%ae%x00%P%x00".to_string(),
        "--".to_string(),
    ];
    arguments.extend(scope_pathspecs(&context.scope));
    let output = git_output_in_owned(&context.root, &arguments)?;
    if !output.status.success() {
        return Err(format!(
            "无法读取当前文稿最近版本：{}",
            output_message(&output)
        ));
    }
    Ok(version_records_from_output(&output.stdout)
        .first()
        .map(revision_from_record)
        .unwrap_or_else(empty_revision))
}

fn is_text_resource(change: &VersionChange) -> bool {
    matches!(
        change.resource_kind,
        VersionResourceKind::Markdown | VersionResourceKind::Metadata
    )
}

fn line_count(text: &str) -> usize {
    text.lines().count()
}

fn tracked_line_summary(context: &RepositoryContext) -> Result<(usize, usize), String> {
    if !context.has_commits {
        return Ok((0, 0));
    }
    let mut arguments = vec![
        "diff".to_string(),
        "--numstat".to_string(),
        "-z".to_string(),
        "HEAD".to_string(),
        "--".to_string(),
    ];
    arguments.extend(scope_pathspecs(&context.scope));
    let output = git_output_in_owned(&context.root, &arguments)?;
    if !output.status.success() {
        return Err(format!("无法读取版本比较统计：{}", output_message(&output)));
    }
    let mut added = 0;
    let mut removed = 0;
    for record in output
        .stdout
        .split(|byte| *byte == b'\0')
        .filter(|record| !record.is_empty())
    {
        let record = String::from_utf8_lossy(record);
        let mut fields = record.splitn(3, '\t');
        let (Some(additions), Some(deletions)) = (fields.next(), fields.next()) else {
            continue;
        };
        if let Ok(value) = additions.parse::<usize>() {
            added += value;
        }
        if let Ok(value) = deletions.parse::<usize>() {
            removed += value;
        }
    }
    Ok((added, removed))
}

fn comparison_summary(
    context: &RepositoryContext,
    changes: &[VersionChange],
) -> Result<VersionComparisonSummary, String> {
    let (mut added_lines, removed_lines) = tracked_line_summary(context)?;
    if context.has_commits {
        for change in changes.iter().filter(|change| {
            change.kind == VersionChangeKind::Untracked && is_text_resource(change)
        }) {
            added_lines += line_count(&text_from_working_tree(&context.root, &change.path)?);
        }
    } else {
        for change in changes
            .iter()
            .filter(|change| is_text_resource(change) && change.kind != VersionChangeKind::Deleted)
        {
            added_lines += line_count(&text_from_working_tree(&context.root, &change.path)?);
        }
    }
    Ok(VersionComparisonSummary {
        changed_files: changes.len(),
        added_lines,
        removed_lines,
        internal_files: changes
            .iter()
            .filter(|change| change.resource_kind == VersionResourceKind::Metadata)
            .count(),
    })
}

fn version_record_from_fields(fields: &[String]) -> Option<VersionRecord> {
    let id = fields.first()?.trim();
    let short_id = fields.get(1)?.trim();
    let message = fields.get(2)?.trim();
    let timestamp = fields.get(3)?.trim();
    if id.is_empty() || short_id.is_empty() || message.is_empty() || timestamp.is_empty() {
        return None;
    }
    let author_name = fields
        .get(4)
        .map(String::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(str::to_owned);
    let author_email = fields
        .get(5)
        .map(String::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(str::to_owned);
    let parent_ids: Vec<String> = fields
        .get(6)
        .map(String::as_str)
        .map(str::trim)
        .map(|parents| parents.split_whitespace().map(str::to_owned).collect())
        .unwrap_or_default();
    Some(VersionRecord {
        id: id.to_owned(),
        short_id: short_id.to_owned(),
        message: message.to_owned(),
        timestamp: timestamp.to_owned(),
        author_name,
        author_email,
        parent_ids,
    })
}

fn primary_parent_id(record: &VersionRecord) -> Option<&str> {
    record.parent_ids.first().map(String::as_str)
}

fn version_records_from_output(output: &[u8]) -> Vec<VersionRecord> {
    let mut fields: Vec<String> = output
        .split(|byte| *byte == b'\0')
        .map(|field| String::from_utf8_lossy(field).trim().to_string())
        .collect();
    if fields.last().is_some_and(|field| field.is_empty()) {
        fields.pop();
    }
    fields
        .chunks_exact(7)
        .filter_map(version_record_from_fields)
        .collect()
}

fn version_record_for_id(root: &Path, id: &str) -> Result<VersionRecord, String> {
    if id != "HEAD"
        && (id.len() < 7 || id.len() > 64 || !id.bytes().all(|byte| byte.is_ascii_hexdigit()))
    {
        return Err("无效的版本标识。".into());
    }
    let output = git_output_in_owned(
        root,
        &[
            "show".to_string(),
            "-s".to_string(),
            "--format=%H%x00%h%x00%s%x00%cI%x00%an%x00%ae%x00%P%x00".to_string(),
            id.to_string(),
        ],
    )?;
    if !output.status.success() {
        return Err("未找到指定的版本。".into());
    }
    version_records_from_output(&output.stdout)
        .into_iter()
        .next()
        .ok_or("无法读取版本信息。".into())
}

fn revision_from_record(record: &VersionRecord) -> RevisionDescriptor {
    RevisionDescriptor {
        kind: RevisionKind::Version,
        id: Some(record.id.clone()),
        short_id: Some(record.short_id.clone()),
        title: Some(record.message.clone()),
        timestamp: Some(record.timestamp.clone()),
        author_name: record.author_name.clone(),
        author_email: record.author_email.clone(),
    }
}

fn empty_revision() -> RevisionDescriptor {
    RevisionDescriptor {
        kind: RevisionKind::Empty,
        id: None,
        short_id: None,
        title: None,
        timestamp: None,
        author_name: None,
        author_email: None,
    }
}

fn parse_name_status(output: &[u8], scope: &ScopePaths) -> Vec<VersionChange> {
    let mut changes = Vec::new();
    let mut records = output
        .split(|byte| *byte == b'\0')
        .filter(|record| !record.is_empty());
    while let Some(status) = records.next() {
        let status = String::from_utf8_lossy(status);
        let status_code = status.chars().next().unwrap_or_default();
        if matches!(status_code, 'R' | 'C') {
            let old_path = records
                .next()
                .map(String::from_utf8_lossy)
                .and_then(|path| normalize_status_path(&path).ok());
            let Some(path) = records
                .next()
                .map(String::from_utf8_lossy)
                .and_then(|path| normalize_status_path(&path).ok())
            else {
                continue;
            };
            if !path_is_in_scope(&path, scope) {
                continue;
            }
            let is_rename = status_code == 'R'
                && old_path
                    .as_deref()
                    .is_some_and(|old| path_is_in_scope(old, scope));
            changes.push(VersionChange {
                resource_kind: resource_kind(&path, scope),
                is_document: path == scope.document,
                path,
                kind: if is_rename {
                    VersionChangeKind::Renamed
                } else {
                    VersionChangeKind::Added
                },
                old_path: if is_rename { old_path } else { None },
            });
            continue;
        }
        let Some(path) = records
            .next()
            .map(String::from_utf8_lossy)
            .and_then(|path| normalize_status_path(&path).ok())
        else {
            continue;
        };
        if !path_is_in_scope(&path, scope) {
            continue;
        }
        let kind = match status_code {
            'A' => VersionChangeKind::Added,
            'D' => VersionChangeKind::Deleted,
            _ => VersionChangeKind::Modified,
        };
        changes.push(VersionChange {
            resource_kind: resource_kind(&path, scope),
            is_document: path == scope.document,
            path,
            kind,
            old_path: None,
        });
    }
    changes
}

fn changes_between_versions(
    context: &RepositoryContext,
    parent_id: Option<&str>,
    version_id: &str,
) -> Result<Vec<VersionChange>, String> {
    let mut arguments = if let Some(parent_id) = parent_id {
        vec![
            "diff".to_string(),
            "--name-status".to_string(),
            "-z".to_string(),
            "--find-renames".to_string(),
            parent_id.to_string(),
            version_id.to_string(),
            "--".to_string(),
        ]
    } else {
        vec![
            "diff-tree".to_string(),
            "--root".to_string(),
            "--no-commit-id".to_string(),
            "-r".to_string(),
            "--name-status".to_string(),
            "-z".to_string(),
            "--find-renames".to_string(),
            version_id.to_string(),
            "--".to_string(),
        ]
    };
    arguments.extend(scope_pathspecs(&context.scope));
    let output = git_output_in_owned(&context.root, &arguments)?;
    if !output.status.success() {
        return Err(format!("无法读取版本修改内容：{}", output_message(&output)));
    }
    Ok(parse_name_status(&output.stdout, &context.scope))
}

fn line_summary_between_versions(
    context: &RepositoryContext,
    parent_id: Option<&str>,
    version_id: &str,
) -> Result<(usize, usize), String> {
    let mut arguments = if let Some(parent_id) = parent_id {
        vec![
            "diff".to_string(),
            "--numstat".to_string(),
            "-z".to_string(),
            parent_id.to_string(),
            version_id.to_string(),
            "--".to_string(),
        ]
    } else {
        vec![
            "diff-tree".to_string(),
            "--root".to_string(),
            "--no-commit-id".to_string(),
            "-r".to_string(),
            "--numstat".to_string(),
            "-z".to_string(),
            version_id.to_string(),
            "--".to_string(),
        ]
    };
    arguments.extend(scope_pathspecs(&context.scope));
    let output = git_output_in_owned(&context.root, &arguments)?;
    if !output.status.success() {
        return Err(format!("无法读取版本比较统计：{}", output_message(&output)));
    }
    let mut added = 0;
    let mut removed = 0;
    for record in output
        .stdout
        .split(|byte| *byte == b'\0')
        .filter(|record| !record.is_empty())
    {
        let record = String::from_utf8_lossy(record);
        let mut fields = record.splitn(3, '\t');
        let (Some(additions), Some(deletions)) = (fields.next(), fields.next()) else {
            continue;
        };
        if let Ok(value) = additions.parse::<usize>() {
            added += value;
        }
        if let Ok(value) = deletions.parse::<usize>() {
            removed += value;
        }
    }
    Ok((added, removed))
}

fn version_comparison_summary(
    context: &RepositoryContext,
    parent_id: Option<&str>,
    version_id: &str,
    changes: &[VersionChange],
) -> Result<VersionComparisonSummary, String> {
    let (added_lines, removed_lines) =
        line_summary_between_versions(context, parent_id, version_id)?;
    Ok(VersionComparisonSummary {
        changed_files: changes.len(),
        added_lines,
        removed_lines,
        internal_files: changes
            .iter()
            .filter(|change| change.resource_kind == VersionResourceKind::Metadata)
            .count(),
    })
}

fn parse_hunk_range(value: &str) -> Option<(usize, usize)> {
    let value = value.strip_prefix(['-', '+'])?;
    match value.split_once(',') {
        Some((start, lines)) => Some((start.parse().ok()?, lines.parse().ok()?)),
        None => Some((value.parse().ok()?, 1)),
    }
}

fn parse_unified_hunks(output: &[u8]) -> Vec<DiffHunk> {
    let mut hunks = Vec::new();
    let mut current: Option<(DiffHunk, usize, usize)> = None;
    for line in String::from_utf8_lossy(output).lines() {
        if let Some(header) = line.strip_prefix("@@ ") {
            if let Some((hunk, _, _)) = current.take() {
                hunks.push(hunk);
            }
            let Some(ranges) = header.split(" @@").next() else {
                continue;
            };
            let mut ranges = ranges.split_whitespace();
            let (Some(old_range), Some(new_range)) = (ranges.next(), ranges.next()) else {
                continue;
            };
            let (Some((old_start, old_lines)), Some((new_start, new_lines))) =
                (parse_hunk_range(old_range), parse_hunk_range(new_range))
            else {
                continue;
            };
            current = Some((
                DiffHunk {
                    old_start,
                    old_lines,
                    new_start,
                    new_lines,
                    lines: Vec::new(),
                },
                old_start,
                new_start,
            ));
            continue;
        }
        let Some((hunk, old_line, new_line)) = current.as_mut() else {
            continue;
        };
        if let Some(content) = line.strip_prefix(' ') {
            hunk.lines.push(DiffLine {
                kind: DiffLineKind::Context,
                old_line_number: Some(*old_line),
                new_line_number: Some(*new_line),
                content: content.to_string(),
            });
            *old_line += 1;
            *new_line += 1;
        } else if let Some(content) = line.strip_prefix('+') {
            hunk.lines.push(DiffLine {
                kind: DiffLineKind::Added,
                old_line_number: None,
                new_line_number: Some(*new_line),
                content: content.to_string(),
            });
            *new_line += 1;
        } else if let Some(content) = line.strip_prefix('-') {
            hunk.lines.push(DiffLine {
                kind: DiffLineKind::Removed,
                old_line_number: Some(*old_line),
                new_line_number: None,
                content: content.to_string(),
            });
            *old_line += 1;
        }
    }
    if let Some((hunk, _, _)) = current {
        hunks.push(hunk);
    }
    hunks
}

fn whole_file_hunk(content: &str, kind: VersionChangeKind) -> Vec<DiffHunk> {
    let lines: Vec<_> = content.lines().collect();
    let (old_start, old_lines, new_start, new_lines) = match kind {
        VersionChangeKind::Deleted => (1, lines.len(), 0, 0),
        _ => (0, 0, 1, lines.len()),
    };
    let diff_lines = lines
        .into_iter()
        .enumerate()
        .map(|(index, content)| DiffLine {
            kind: if kind == VersionChangeKind::Deleted {
                DiffLineKind::Removed
            } else {
                DiffLineKind::Added
            },
            old_line_number: (kind == VersionChangeKind::Deleted).then_some(index + 1),
            new_line_number: (kind != VersionChangeKind::Deleted).then_some(index + 1),
            content: content.to_string(),
        })
        .collect();
    vec![DiffHunk {
        old_start,
        old_lines,
        new_start,
        new_lines,
        lines: diff_lines,
    }]
}

fn text_from_working_tree(root: &Path, path: &str) -> Result<String, String> {
    fs::read(root.join(path))
        .map(|bytes| String::from_utf8_lossy(&bytes).to_string())
        .map_err(|error| format!("无法读取当前文件内容：{error}"))
}

fn text_from_head(root: &Path, path: &str) -> Result<String, String> {
    let output = git_output_in_owned(root, &["show".to_string(), format!("HEAD:{path}")])?;
    if !output.status.success() {
        return Err(format!(
            "无法读取当前版本文件内容：{}",
            output_message(&output)
        ));
    }
    Ok(String::from_utf8_lossy(&output.stdout).to_string())
}

fn revision_asset_mime_type(path: &str) -> &'static str {
    match Path::new(path)
        .extension()
        .and_then(|extension| extension.to_str())
        .unwrap_or_default()
        .to_ascii_lowercase()
        .as_str()
    {
        "jpg" | "jpeg" => "image/jpeg",
        "gif" => "image/gif",
        "webp" => "image/webp",
        "bmp" => "image/bmp",
        "svg" => "image/svg+xml",
        "wmf" => "image/wmf",
        "emf" => "image/emf",
        "pdf" => "application/pdf",
        _ => "image/png",
    }
}

fn markdown_asset_path(
    context: &RepositoryContext,
    repository_path: &str,
) -> Result<String, String> {
    let document_path = Path::new(&context.scope.document);
    let document_dir = document_path
        .parent()
        .filter(|path| !path.as_os_str().is_empty());
    let relative = match document_dir {
        Some(directory) => Path::new(repository_path)
            .strip_prefix(directory)
            .map_err(|_| "版本资源不属于当前文稿目录。")?,
        None => Path::new(repository_path),
    };
    Ok(format!("./{}", normalize_repository_path(relative)?))
}

fn revision_assets_from_files(
    context: &RepositoryContext,
    files: impl IntoIterator<Item = (String, Vec<u8>)>,
) -> Result<Vec<RevisionAssetSnapshot>, String> {
    files
        .into_iter()
        .filter(|(path, _)| resource_kind(path, &context.scope) == VersionResourceKind::Image)
        .map(|(path, bytes)| {
            Ok(RevisionAssetSnapshot {
                path: markdown_asset_path(context, &path)?,
                mime_type: revision_asset_mime_type(&path).to_string(),
                data_base64: BASE64.encode(bytes),
            })
        })
        .collect()
}

fn collect_working_asset_files(
    context: &RepositoryContext,
    directory: &Path,
    files: &mut Vec<(String, Vec<u8>)>,
) -> Result<(), String> {
    for entry in
        fs::read_dir(directory).map_err(|error| format!("无法读取当前文稿资源：{error}"))?
    {
        let entry = entry.map_err(|error| format!("无法读取当前文稿资源：{error}"))?;
        let file_type = entry
            .file_type()
            .map_err(|error| format!("无法读取当前文稿资源：{error}"))?;
        // Never follow symbolic links while preparing a read-only snapshot.
        if file_type.is_symlink() {
            continue;
        }
        if file_type.is_dir() {
            collect_working_asset_files(context, &entry.path(), files)?;
            continue;
        }
        if !file_type.is_file() {
            continue;
        }
        let path = repository_relative_path(&context.root, &entry.path())?;
        if resource_kind(&path, &context.scope) != VersionResourceKind::Image {
            continue;
        }
        let bytes =
            fs::read(entry.path()).map_err(|error| format!("无法读取当前文稿资源：{error}"))?;
        files.push((path, bytes));
    }
    Ok(())
}

fn working_revision_snapshot(
    context: &RepositoryContext,
    working_content: Option<String>,
) -> Result<RevisionDocumentSnapshot, String> {
    let markdown = working_content.unwrap_or_else(|| {
        fs::read_to_string(context.root.join(&context.scope.document)).unwrap_or_default()
    });
    if markdown.is_empty() && !context.root.join(&context.scope.document).is_file() {
        return Err("无法读取当前文稿内容。".into());
    }
    let metadata_path = context
        .scope
        .asset_folder
        .as_ref()
        .map(|folder| format!("{folder}/hakurou.json"));
    let metadata = metadata_path
        .as_ref()
        .filter(|path| context.root.join(path).is_file())
        .map(|path| fs::read_to_string(context.root.join(path)))
        .transpose()
        .map_err(|error| format!("无法读取文稿设置：{error}"))?;
    let mut files = Vec::new();
    if let Some(folder) = &context.scope.asset_folder {
        let directory = context.root.join(folder);
        if directory.is_dir() {
            collect_working_asset_files(context, &directory, &mut files)?;
        }
    }
    Ok(RevisionDocumentSnapshot {
        revision: current_document_revision(),
        markdown,
        metadata,
        assets: revision_assets_from_files(context, files)?,
    })
}

fn version_revision_snapshot(
    context: &RepositoryContext,
    version: &VersionRecord,
) -> Result<RevisionDocumentSnapshot, String> {
    let files = target_scope_files(context, version)?;
    let markdown = files
        .iter()
        .find(|file| file.path == context.scope.document)
        .map(|file| String::from_utf8_lossy(&file.content).to_string())
        .ok_or("该历史版本缺少当前文稿内容。")?;
    let metadata_path = context
        .scope
        .asset_folder
        .as_ref()
        .map(|folder| format!("{folder}/hakurou.json"));
    let metadata = metadata_path.and_then(|path| {
        files
            .iter()
            .find(|file| file.path == path)
            .map(|file| String::from_utf8_lossy(&file.content).to_string())
    });
    let assets = revision_assets_from_files(
        context,
        files.into_iter().map(|file| (file.path, file.content)),
    )?;
    Ok(RevisionDocumentSnapshot {
        revision: revision_from_record(version),
        markdown,
        metadata,
        assets,
    })
}

fn text_diff_from_git(
    context: &RepositoryContext,
    change: &VersionChange,
) -> Result<Vec<DiffHunk>, String> {
    let mut arguments = vec![
        "diff".to_string(),
        "--no-ext-diff".to_string(),
        "--unified=3".to_string(),
        "--find-renames".to_string(),
        "HEAD".to_string(),
        "--".to_string(),
    ];
    if let Some(old_path) = &change.old_path {
        arguments.push(old_path.clone());
    }
    arguments.push(change.path.clone());
    let output = git_output_in_owned(&context.root, &arguments)?;
    if !output.status.success() {
        return Err(format!(
            "无法读取 Git 比较内容：{}",
            output_message(&output)
        ));
    }
    Ok(parse_unified_hunks(&output.stdout))
}

fn text_diff_between_versions(
    context: &RepositoryContext,
    parent_id: Option<&str>,
    version_id: &str,
    change: &VersionChange,
) -> Result<Vec<DiffHunk>, String> {
    let mut arguments = if let Some(parent_id) = parent_id {
        vec![
            "diff".to_string(),
            "--no-ext-diff".to_string(),
            "--unified=3".to_string(),
            "--find-renames".to_string(),
            parent_id.to_string(),
            version_id.to_string(),
            "--".to_string(),
        ]
    } else {
        vec![
            "diff-tree".to_string(),
            "--root".to_string(),
            "--no-commit-id".to_string(),
            "-r".to_string(),
            "-p".to_string(),
            "--unified=3".to_string(),
            "--find-renames".to_string(),
            version_id.to_string(),
            "--".to_string(),
        ]
    };
    if let Some(old_path) = &change.old_path {
        arguments.push(old_path.clone());
    }
    arguments.push(change.path.clone());
    let output = git_output_in_owned(&context.root, &arguments)?;
    if !output.status.success() {
        return Err(format!("无法读取版本比较内容：{}", output_message(&output)));
    }
    Ok(parse_unified_hunks(&output.stdout))
}

fn inspect_repository_impl(
    document: &Path,
    asset_folder: Option<&str>,
) -> Result<VersionRepositoryInfo, String> {
    let document_dir = document.parent().ok_or("无法确定文稿所在目录。")?;
    let scope = document_scope(document, asset_folder)?;
    let Some(root) = repository_root(document_dir)? else {
        return Ok(VersionRepositoryInfo {
            is_repository: false,
            repository_root: None,
            current_branch: None,
            has_commits: false,
            document_scope: scope,
        });
    };

    Ok(VersionRepositoryInfo {
        is_repository: true,
        repository_root: Some(root.to_string_lossy().to_string()),
        current_branch: current_branch(&root)?,
        has_commits: has_commits(&root)?,
        document_scope: scope,
    })
}

fn validate_version_message(value: &str) -> Result<String, String> {
    let message = value.trim();
    if message.is_empty() {
        return Err("请填写版本说明。".into());
    }
    if message.chars().count() > 160 {
        return Err("版本说明不能超过 160 个字符。".into());
    }
    if message.chars().any(char::is_control) {
        return Err("版本说明不能包含换行或控制字符。".into());
    }
    Ok(message.to_owned())
}

fn git_config_value(root: &Path, key: &str) -> Result<Option<String>, String> {
    let output = git_output_in(root, &["config", "--get", key])?;
    if !output.status.success() {
        return Ok(None);
    }
    let value = String::from_utf8_lossy(&output.stdout).trim().to_string();
    Ok((!value.is_empty()).then_some(value))
}

fn ensure_version_identity(root: &Path) -> Result<(), String> {
    if git_config_value(root, "user.name")?.is_some()
        && git_config_value(root, "user.email")?.is_some()
    {
        Ok(())
    } else {
        Err("创建版本前需要设置版本作者信息。请先在 Git 中设置用户名和邮箱。".into())
    }
}

fn stage_change(root: &Path, change: &VersionChange) -> Result<(), String> {
    let stage = |arguments: Vec<String>| -> Result<(), String> {
        let output = git_output_in_owned(root, &arguments)?;
        if output.status.success() {
            Ok(())
        } else {
            Err(format!("无法记录当前文稿修改：{}", output_message(&output)))
        }
    };
    if change.kind == VersionChangeKind::Deleted {
        stage(vec![
            "add".into(),
            "-u".into(),
            "--".into(),
            change.path.clone(),
        ])?;
    } else {
        stage(vec!["add".into(), "--".into(), change.path.clone()])?;
    }
    if let Some(old_path) = &change.old_path {
        stage(vec![
            "add".into(),
            "-u".into(),
            "--".into(),
            old_path.clone(),
        ])?;
    }
    Ok(())
}

fn create_version_impl(
    context: &RepositoryContext,
    message: &str,
) -> Result<VersionRecord, String> {
    let changes = changes_for_context(context)?;
    if changes.is_empty() {
        return Err("当前文稿相对于上一个版本没有修改。".into());
    }
    ensure_version_identity(&context.root)?;
    for change in &changes {
        stage_change(&context.root, change)?;
    }
    let mut arguments = vec![
        "commit".to_string(),
        "--only".to_string(),
        "-m".to_string(),
        message.to_string(),
        "--".to_string(),
    ];
    for change in &changes {
        if let Some(old_path) = &change.old_path {
            arguments.push(old_path.clone());
        }
        arguments.push(change.path.clone());
    }
    let output = git_output_in_owned(&context.root, &arguments)?;
    if !output.status.success() {
        return Err(format!("无法创建版本：{}", output_message(&output)));
    }
    version_record_for_id(&context.root, "HEAD")
}

fn history_for_context(
    context: &RepositoryContext,
    limit: usize,
) -> Result<Vec<VersionRecord>, String> {
    if !has_commits(&context.root)? {
        return Ok(Vec::new());
    }
    let mut arguments = vec![
        "log".to_string(),
        "--format=%H%x00%h%x00%s%x00%cI%x00%an%x00%ae%x00%P%x00".to_string(),
        "-n".to_string(),
        limit.clamp(1, 30).to_string(),
        "--".to_string(),
    ];
    arguments.extend(scope_pathspecs(&context.scope));
    let output = git_output_in_owned(&context.root, &arguments)?;
    if !output.status.success() {
        return Err(format!("无法读取版本历史：{}", output_message(&output)));
    }
    Ok(version_records_from_output(&output.stdout))
}

fn version_author_identity(root: &Path) -> Result<VersionAuthorIdentity, String> {
    Ok(VersionAuthorIdentity {
        name: git_config_value(root, "user.name")?,
        email: git_config_value(root, "user.email")?,
    })
}

fn validate_identity_value(value: &str, field_name: &str) -> Result<String, String> {
    let value = value.trim();
    if value.is_empty() || value.chars().count() > 160 || value.chars().any(char::is_control) {
        return Err(format!("请填写有效的版本作者{field_name}。"));
    }
    Ok(value.to_owned())
}

fn configure_version_identity_impl(
    root: &Path,
    name: &str,
    email: &str,
) -> Result<VersionAuthorIdentity, String> {
    let name = validate_identity_value(name, "姓名")?;
    let email = validate_identity_value(email, "邮箱")?;
    if !email.contains('@') {
        return Err("请填写有效的版本作者邮箱。".into());
    }
    for (key, value) in [("user.name", name), ("user.email", email)] {
        let output = git_output_in_owned(
            root,
            &[
                "config".to_string(),
                "--local".to_string(),
                key.to_string(),
                value,
            ],
        )?;
        if !output.status.success() {
            return Err("无法保存当前文稿的版本作者信息。".into());
        }
    }
    version_author_identity(root)
}

fn target_version_for_context(
    context: &RepositoryContext,
    target_id: &str,
) -> Result<VersionRecord, String> {
    let target = version_record_for_id(&context.root, target_id)?;
    if !history_for_context(context, 30)?
        .iter()
        .any(|version| version.id == target.id)
    {
        return Err("该版本不属于当前文稿的版本历史，无法恢复。".into());
    }
    Ok(target)
}

fn target_scope_files(
    context: &RepositoryContext,
    target: &VersionRecord,
) -> Result<Vec<TargetScopeFile>, String> {
    let mut arguments = vec![
        "ls-tree".to_string(),
        "-r".to_string(),
        "-z".to_string(),
        target.id.clone(),
        "--".to_string(),
    ];
    arguments.extend(scope_pathspecs(&context.scope));
    let output = git_output_in_owned(&context.root, &arguments)?;
    if !output.status.success() {
        return Err("无法读取目标版本的文稿内容。".into());
    }

    let mut files = Vec::new();
    for record in output
        .stdout
        .split(|byte| *byte == b'\0')
        .filter(|record| !record.is_empty())
    {
        let Some((header, raw_path)) = record
            .splitn(2, |byte: &u8| *byte == b'\t')
            .collect::<Vec<_>>()
            .split_first()
            .and_then(|(header, rest)| rest.first().map(|path| (*header, *path)))
        else {
            return Err("目标版本包含无法识别的文件记录。".into());
        };
        let header = String::from_utf8_lossy(header);
        let mut header_fields = header.split_whitespace();
        let mode = header_fields.next().unwrap_or_default();
        let object_type = header_fields.next().unwrap_or_default();
        let path = normalize_status_path(&String::from_utf8_lossy(raw_path))?;
        if !path_is_in_scope(&path, &context.scope) || object_type != "blob" || mode == "120000" {
            return Err("目标版本包含不安全的文稿资源路径。".into());
        }
        let content = git_output_in_owned(
            &context.root,
            &["show".to_string(), format!("{}:{path}", target.id)],
        )?;
        if !content.status.success() {
            return Err("无法准备目标版本的文稿内容。".into());
        }
        files.push(TargetScopeFile {
            path,
            content: content.stdout,
        });
    }
    files.sort_by(|left, right| left.path.cmp(&right.path));
    if !files.iter().any(|file| file.path == context.scope.document) {
        return Err("该版本不包含当前文稿，无法恢复。".into());
    }
    Ok(files)
}

fn checked_scope_path(context: &RepositoryContext, relative_path: &str) -> Result<PathBuf, String> {
    if !path_is_in_scope(relative_path, &context.scope) {
        return Err("恢复路径不在当前文稿范围内。".into());
    }
    let mut path = context.root.clone();
    for component in Path::new(relative_path).components() {
        let Component::Normal(component) = component else {
            return Err("恢复路径不安全。".into());
        };
        path.push(component);
        if path.exists()
            && fs::symlink_metadata(&path)
                .map_err(|_| "无法验证恢复路径。")?
                .file_type()
                .is_symlink()
        {
            return Err("当前文稿范围包含符号链接，无法安全恢复。".into());
        }
    }
    Ok(path)
}

fn collect_directory_files(
    context: &RepositoryContext,
    directory: &Path,
    files: &mut Vec<TargetScopeFile>,
) -> Result<(), String> {
    for entry in fs::read_dir(directory).map_err(|_| "无法读取当前文稿资源目录。")? {
        let entry = entry.map_err(|_| "无法读取当前文稿资源目录。")?;
        let path = entry.path();
        let metadata = fs::symlink_metadata(&path).map_err(|_| "无法验证当前文稿资源。")?;
        if metadata.file_type().is_symlink() {
            return Err("当前文稿范围包含符号链接，无法安全恢复。".into());
        }
        if metadata.is_dir() {
            collect_directory_files(context, &path, files)?;
            continue;
        }
        if !metadata.is_file() {
            return Err("当前文稿范围包含不支持的资源类型，无法安全恢复。".into());
        }
        let relative = repository_relative_path(&context.root, &path)?;
        if !path_is_in_scope(&relative, &context.scope) {
            return Err("恢复路径不在当前文稿范围内。".into());
        }
        files.push(TargetScopeFile {
            path: relative,
            content: fs::read(&path).map_err(|_| "无法读取当前文稿资源。")?,
        });
    }
    Ok(())
}

fn current_scope_files(context: &RepositoryContext) -> Result<Vec<TargetScopeFile>, String> {
    let document_path = checked_scope_path(context, &context.scope.document)?;
    let document_metadata =
        fs::symlink_metadata(&document_path).map_err(|_| "无法读取当前文稿。")?;
    if document_metadata.file_type().is_symlink() || !document_metadata.is_file() {
        return Err("当前文稿路径不安全，无法恢复。".into());
    }
    let mut files = vec![TargetScopeFile {
        path: context.scope.document.clone(),
        content: fs::read(&document_path).map_err(|_| "无法读取当前文稿。")?,
    }];
    if let Some(asset_folder) = &context.scope.asset_folder {
        let asset_path = checked_scope_path(context, asset_folder)?;
        if asset_path.exists() {
            let metadata =
                fs::symlink_metadata(&asset_path).map_err(|_| "无法验证文稿资源目录。")?;
            if metadata.file_type().is_symlink() || !metadata.is_dir() {
                return Err("文稿资源目录不安全，无法恢复。".into());
            }
            collect_directory_files(context, &asset_path, &mut files)?;
        }
    }
    files.sort_by(|left, right| left.path.cmp(&right.path));
    Ok(files)
}

fn scope_matches_target(
    context: &RepositoryContext,
    target_files: &[TargetScopeFile],
) -> Result<bool, String> {
    let current_files = current_scope_files(context)?;
    Ok(current_files.len() == target_files.len()
        && current_files
            .iter()
            .zip(target_files)
            .all(|(current, target)| {
                current.path == target.path && current.content == target.content
            }))
}

fn restore_workspace(root: &Path) -> Result<PathBuf, String> {
    let nonce = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_err(|_| "无法准备恢复操作。")?
        .as_nanos();
    let workspace = root.join(format!(".hakurou-restore-{}-{nonce}", std::process::id()));
    fs::create_dir_all(&workspace).map_err(|_| "无法准备恢复操作。")?;
    Ok(workspace)
}

fn write_prepared_scope(
    workspace: &Path,
    target_files: &[TargetScopeFile],
) -> Result<PathBuf, String> {
    let prepared = workspace.join("prepared");
    for file in target_files {
        let relative = Path::new(&file.path);
        let destination = prepared.join(relative);
        let parent = destination.parent().ok_or("无法准备恢复内容。")?;
        fs::create_dir_all(parent).map_err(|_| "无法准备恢复内容。")?;
        fs::write(destination, &file.content).map_err(|_| "无法准备恢复内容。")?;
    }
    Ok(prepared)
}

fn remove_scope_path(path: &Path) {
    if let Ok(metadata) = fs::symlink_metadata(path) {
        if metadata.is_dir() {
            let _ = fs::remove_dir_all(path);
        } else {
            let _ = fs::remove_file(path);
        }
    }
}

fn apply_prepared_scope(
    context: &RepositoryContext,
    workspace: &Path,
    target_files: &[TargetScopeFile],
) -> Result<(), String> {
    let prepared = write_prepared_scope(workspace, target_files)?;
    let backup = workspace.join("backup");
    fs::create_dir_all(&backup).map_err(|_| "无法准备恢复备份。")?;
    let document_path = checked_scope_path(context, &context.scope.document)?;
    let document_backup = backup.join("document");
    let asset_path = context
        .scope
        .asset_folder
        .as_deref()
        .map(|path| checked_scope_path(context, path))
        .transpose()?;
    let asset_backup = backup.join("assets");
    let target_has_assets = context
        .scope
        .asset_folder
        .as_ref()
        .is_some_and(|asset_folder| {
            target_files
                .iter()
                .any(|file| file.path.starts_with(&format!("{asset_folder}/")))
        });

    fs::rename(&document_path, &document_backup).map_err(|_| "无法准备当前文稿备份。")?;
    let assets_backed_up = match &asset_path {
        Some(path) if path.exists() => {
            if !fs::symlink_metadata(path)
                .map_err(|_| "无法验证文稿资源目录。")?
                .is_dir()
            {
                let _ = fs::rename(&document_backup, &document_path);
                return Err("文稿资源目录不安全，无法恢复。".into());
            }
            if let Err(_) = fs::rename(path, &asset_backup) {
                let _ = fs::rename(&document_backup, &document_path);
                return Err("无法准备当前文稿资源备份。".into());
            }
            true
        }
        _ => false,
    };

    let apply_result = (|| -> Result<(), String> {
        fs::rename(prepared.join(&context.scope.document), &document_path)
            .map_err(|_| "无法写入恢复后的文稿。")?;
        if target_has_assets {
            let asset_folder = context
                .scope
                .asset_folder
                .as_ref()
                .ok_or("无法确定文稿资源目录。")?;
            let asset_path = asset_path.as_ref().ok_or("无法确定文稿资源目录。")?;
            fs::rename(prepared.join(asset_folder), asset_path)
                .map_err(|_| "无法写入恢复后的文稿资源。")?;
        }
        Ok(())
    })();

    if apply_result.is_err() {
        remove_scope_path(&document_path);
        if let Some(asset_path) = &asset_path {
            remove_scope_path(asset_path);
        }
        let _ = fs::rename(&document_backup, &document_path);
        if assets_backed_up {
            if let Some(asset_path) = &asset_path {
                let _ = fs::rename(&asset_backup, asset_path);
            }
        }
        return Err("恢复未完成，已尝试还原当前文稿。".into());
    }
    let _ = fs::remove_dir_all(&backup);
    Ok(())
}

fn restore_message(target: &VersionRecord) -> String {
    let prefix = "恢复至：";
    let available = 160usize.saturating_sub(prefix.chars().count());
    format!(
        "{prefix}{}",
        target.message.chars().take(available).collect::<String>()
    )
}

fn restore_version_impl(
    context: &RepositoryContext,
    target_id: &str,
    strategy: RestoreStrategy,
    safety_message: Option<&str>,
) -> Result<RestoreVersionResult, String> {
    let target = target_version_for_context(context, target_id)?;
    let target_files = target_scope_files(context, &target)?;
    let has_unversioned_scope_changes = !changes_for_context(context)?.is_empty();
    let mut safety_version = None;
    if has_unversioned_scope_changes {
        match strategy {
            RestoreStrategy::SaveCurrentVersionFirst => {
                let message = safety_message.ok_or("恢复前请填写版本说明。")?;
                safety_version = Some(create_version_impl(
                    context,
                    &validate_version_message(message)?,
                )?);
            }
            RestoreStrategy::DiscardCurrentChanges => {}
        }
    }

    if scope_matches_target(context, &target_files)? {
        return Ok(RestoreVersionResult {
            restored_from: target,
            created_version: safety_version,
            already_equivalent: true,
        });
    }
    ensure_version_identity(&context.root)?;
    let workspace = restore_workspace(&context.root)?;
    let result = apply_prepared_scope(context, &workspace, &target_files)
        .and_then(|_| create_version_impl(context, &restore_message(&target)));
    let _ = fs::remove_dir_all(&workspace);
    let created_version = result?;
    Ok(RestoreVersionResult {
        restored_from: target,
        created_version: Some(created_version),
        already_equivalent: false,
    })
}

#[tauri::command]
pub fn inspect_git() -> GitInstallationStatus {
    git_installation_status(OsStr::new("git"))
}

#[tauri::command]
pub fn inspect_version_repository(
    document_path: String,
    asset_folder: Option<String>,
) -> Result<VersionRepositoryInfo, String> {
    let document = validate_document_path(&document_path)?;
    inspect_repository_impl(&document, asset_folder.as_deref())
}

#[tauri::command]
pub fn init_version_repository(
    document_path: String,
    asset_folder: Option<String>,
) -> Result<VersionRepositoryInfo, String> {
    let document = validate_document_path(&document_path)?;
    let document_dir = document.parent().ok_or("无法确定文稿所在目录。")?;

    // Re-check through Git before initialising to avoid nested repositories.
    if repository_root(document_dir)?.is_none() {
        let output = git_output_in(document_dir, &["init"])?;
        if !output.status.success() {
            return Err(format!("无法启用版本管理：{}", output_message(&output)));
        }
    }

    inspect_repository_impl(&document, asset_folder.as_deref())
}

#[tauri::command]
pub fn get_version_changes(
    document_path: String,
    asset_folder: Option<String>,
) -> Result<Vec<VersionChange>, String> {
    let document = validate_document_path(&document_path)?;
    let context = repository_context(&document, asset_folder.as_deref())?;
    changes_for_context(&context)
}

#[tauri::command]
pub fn get_version_comparison(
    document_path: String,
    asset_folder: Option<String>,
    version_id: Option<String>,
) -> Result<VersionComparison, String> {
    let document = validate_document_path(&document_path)?;
    let context = repository_context(&document, asset_folder.as_deref())?;
    if let Some(version_id) = version_id.filter(|value| !value.trim().is_empty()) {
        let version = version_record_for_id(&context.root, &version_id)?;
        let parent_id = primary_parent_id(&version);
        let changes = changes_between_versions(&context, parent_id, &version.id)?;
        if changes.is_empty() {
            return Err("指定版本不包含当前文稿的修改。".into());
        }
        return Ok(VersionComparison {
            base_revision: parent_id
                .map(|parent_id| {
                    version_record_for_id(&context.root, parent_id)
                        .map(|record| revision_from_record(&record))
                })
                .transpose()?
                .unwrap_or_else(empty_revision),
            target_revision: revision_from_record(&version),
            summary: version_comparison_summary(&context, parent_id, &version.id, &changes)?,
            changes,
        });
    }
    let changes = changes_for_context(&context)?;
    Ok(VersionComparison {
        base_revision: current_base_revision(&context)?,
        target_revision: current_document_revision(),
        summary: comparison_summary(&context, &changes)?,
        changes,
    })
}

/// Read a complete revision snapshot without checking out, switching, or writing Git state.
/// Historical image bytes are returned directly from Git objects so they can never overwrite
/// the current document's assets.
#[tauri::command]
pub fn get_revision_document_snapshot(
    document_path: String,
    asset_folder: Option<String>,
    revision_id: Option<String>,
    use_working_copy: Option<bool>,
    working_content: Option<String>,
) -> Result<RevisionDocumentSnapshot, String> {
    let document = validate_document_path(&document_path)?;
    let supplied_asset_folder = asset_folder.filter(|folder| safe_asset_folder(folder));
    let working_asset_folder = use_working_copy
        .unwrap_or(false)
        .then(|| {
            working_content
                .as_deref()
                .and_then(asset_folder_from_markdown)
        })
        .flatten();
    let context = repository_context(
        &document,
        supplied_asset_folder
            .as_deref()
            .or(working_asset_folder.as_deref()),
    )?;
    if use_working_copy.unwrap_or(false) {
        return working_revision_snapshot(&context, working_content);
    }
    if let Some(revision_id) = revision_id.filter(|value| !value.trim().is_empty()) {
        let version = version_record_for_id(&context.root, &revision_id)?;
        let snapshot = version_revision_snapshot(&context, &version)?;
        if supplied_asset_folder.is_some() {
            return Ok(snapshot);
        }
        if let Some(discovered_asset_folder) = asset_folder_from_markdown(&snapshot.markdown) {
            let discovered_context = repository_context(&document, Some(&discovered_asset_folder))?;
            return version_revision_snapshot(&discovered_context, &version);
        }
        return Ok(snapshot);
    }
    Ok(RevisionDocumentSnapshot {
        revision: empty_revision(),
        markdown: String::new(),
        metadata: None,
        assets: Vec::new(),
    })
}

#[tauri::command]
pub fn get_version_diff(
    document_path: String,
    asset_folder: Option<String>,
    path: String,
    version_id: Option<String>,
) -> Result<FileDiff, String> {
    let document = validate_document_path(&document_path)?;
    let context = repository_context(&document, asset_folder.as_deref())?;
    let requested_path = normalize_status_path(&path)?;
    let version = version_id
        .filter(|value| !value.trim().is_empty())
        .map(|value| version_record_for_id(&context.root, &value))
        .transpose()?;
    let changes = match &version {
        Some(version) => {
            changes_between_versions(&context, primary_parent_id(version), &version.id)?
        }
        None => changes_for_context(&context)?,
    };
    let change = changes
        .into_iter()
        .find(|change| change.path == requested_path)
        .ok_or("只能比较当前文稿或其专属资源目录中的修改。")?;

    if !matches!(
        change.resource_kind,
        VersionResourceKind::Markdown | VersionResourceKind::Metadata
    ) {
        return Ok(FileDiff::Binary {
            path: change.path,
            change_kind: change.kind,
            old_path: change.old_path,
        });
    }

    let hunks = if let Some(version) = version {
        text_diff_between_versions(&context, primary_parent_id(&version), &version.id, &change)?
    } else if !context.has_commits || change.kind == VersionChangeKind::Untracked {
        let content = if change.kind == VersionChangeKind::Deleted {
            text_from_head(&context.root, &change.path)?
        } else {
            text_from_working_tree(&context.root, &change.path)?
        };
        whole_file_hunk(&content, change.kind)
    } else {
        text_diff_from_git(&context, &change)?
    };

    Ok(FileDiff::Text {
        path: change.path,
        change_kind: change.kind,
        old_path: change.old_path,
        hunks,
    })
}

#[tauri::command]
pub fn create_version(
    document_path: String,
    asset_folder: Option<String>,
    message: String,
) -> Result<VersionRecord, String> {
    let document = validate_document_path(&document_path)?;
    let context = repository_context(&document, asset_folder.as_deref())?;
    create_version_impl(&context, &validate_version_message(&message)?)
}

#[tauri::command]
pub fn get_version_history(
    document_path: String,
    asset_folder: Option<String>,
    limit: Option<usize>,
) -> Result<Vec<VersionRecord>, String> {
    let document = validate_document_path(&document_path)?;
    let context = repository_context(&document, asset_folder.as_deref())?;
    history_for_context(&context, limit.unwrap_or(30))
}

#[tauri::command]
pub fn inspect_version_identity(
    document_path: String,
    asset_folder: Option<String>,
) -> Result<VersionAuthorIdentity, String> {
    let document = validate_document_path(&document_path)?;
    let context = repository_context(&document, asset_folder.as_deref())?;
    version_author_identity(&context.root)
}

#[tauri::command]
pub fn configure_version_identity(
    document_path: String,
    asset_folder: Option<String>,
    name: String,
    email: String,
) -> Result<VersionAuthorIdentity, String> {
    let document = validate_document_path(&document_path)?;
    let context = repository_context(&document, asset_folder.as_deref())?;
    configure_version_identity_impl(&context.root, &name, &email)
}

#[tauri::command]
pub fn get_restore_preflight(
    document_path: String,
    asset_folder: Option<String>,
    target_commit_id: String,
) -> Result<RestoreVersionPreflight, String> {
    let document = validate_document_path(&document_path)?;
    let context = repository_context(&document, asset_folder.as_deref())?;
    let target_version = target_version_for_context(&context, &target_commit_id)?;
    target_scope_files(&context, &target_version)?;
    Ok(RestoreVersionPreflight {
        has_unversioned_scope_changes: !changes_for_context(&context)?.is_empty(),
        target_version,
    })
}

#[tauri::command]
pub fn restore_version(
    document_path: String,
    asset_folder: Option<String>,
    target_commit_id: String,
    strategy: RestoreStrategy,
    safety_version_message: Option<String>,
) -> Result<RestoreVersionResult, String> {
    let document = validate_document_path(&document_path)?;
    let context = repository_context(&document, asset_folder.as_deref())?;
    restore_version_impl(
        &context,
        &target_commit_id,
        strategy,
        safety_version_message.as_deref(),
    )
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::time::{SystemTime, UNIX_EPOCH};

    fn test_directory(label: &str) -> PathBuf {
        let nonce = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("system time should be after the Unix epoch")
            .as_nanos();
        let path =
            std::env::temp_dir().join(format!("hakurou-{label}-{}-{nonce}", std::process::id()));
        std::fs::create_dir_all(&path).expect("test directory should be created");
        path
    }

    fn normalized(path: &Path) -> String {
        path.canonicalize()
            .unwrap_or_else(|_| path.to_path_buf())
            .to_string_lossy()
            .replace('\\', "/")
    }

    #[test]
    fn missing_git_is_reported_as_an_unavailable_runtime() {
        let status = git_installation_status(OsStr::new("hakurou-git-command-that-does-not-exist"));
        assert!(!status.available);
        assert!(status.version.is_none());
        assert!(status.message.is_some());
    }

    #[test]
    fn document_scope_keeps_the_document_asset_folder_even_before_it_exists() {
        let root = test_directory("scope-空 格");
        let document = root.join("paper.md");
        std::fs::write(&document, "# Paper").expect("document should be written");
        let scope =
            document_scope(&document, Some("paper-a1b2c3")).expect("scope should be resolved");
        assert_eq!(
            normalized(Path::new(&scope.document_path)),
            normalized(&document)
        );
        assert_eq!(
            scope
                .asset_folder_path
                .as_deref()
                .map(|path| normalized(Path::new(path))),
            Some(normalized(&root.join("assets").join("paper-a1b2c3")))
        );
        let _ = std::fs::remove_dir_all(root);
    }

    #[test]
    fn scope_paths_reject_paths_outside_the_current_document_and_assets() {
        let scope = ScopePaths {
            document: "paper/paper.md".into(),
            asset_folder: Some("paper/assets/paper-a1b2c3".into()),
        };
        assert!(path_is_in_scope("paper/paper.md", &scope));
        assert!(path_is_in_scope(
            "paper/assets/paper-a1b2c3/图 1.png",
            &scope
        ));
        assert!(!path_is_in_scope(
            "paper/assets/another-paper-x9y8z7/图 1.png",
            &scope
        ));
        assert!(!path_is_in_scope("code/private.rs", &scope));
        assert!(normalize_status_path("../../secret.txt").is_err());
    }

    #[test]
    fn unified_diff_parser_assigns_line_numbers() {
        let hunks = parse_unified_hunks(
            b"diff --git a/paper.md b/paper.md\n@@ -2,2 +2,3 @@\n same\n-old\n+new\n+tail\n",
        );
        assert_eq!(hunks.len(), 1);
        assert_eq!(hunks[0].old_start, 2);
        assert_eq!(hunks[0].new_lines, 3);
        assert_eq!(hunks[0].lines[1].old_line_number, Some(3));
        assert_eq!(hunks[0].lines[2].new_line_number, Some(3));
    }

    #[test]
    fn porcelain_v2_rename_keeps_only_scoped_old_and_new_paths() {
        let root = test_directory("porcelain rename");
        let scope = ScopePaths {
            document: "paper/paper.md".into(),
            asset_folder: Some("paper/assets/paper-a1b2c3".into()),
        };
        let output = b"2 R. N... 100644 100644 100644 abcdef abcdef R100 paper/assets/paper-a1b2c3/new name.png\0paper/assets/paper-a1b2c3/old name.png\0";
        let changes = parse_status(output, &root, &scope);
        assert_eq!(changes.len(), 1);
        assert_eq!(changes[0].kind, VersionChangeKind::Renamed);
        assert_eq!(
            changes[0].old_path.as_deref(),
            Some("paper/assets/paper-a1b2c3/old name.png")
        );
        let _ = std::fs::remove_dir_all(root);
    }

    #[test]
    fn changes_ignore_other_assets_and_repository_files() {
        if !inspect_git().available {
            return;
        }
        let root = test_directory("working tree 中文 space");
        let document_dir = root.join("paper folder");
        let document = document_dir.join("paper.md");
        let current_assets = document_dir.join("assets").join("paper-a1b2c3");
        let other_assets = document_dir.join("assets").join("other-paper-x9y8z7");
        std::fs::create_dir_all(&current_assets).expect("current assets should be created");
        std::fs::create_dir_all(&other_assets).expect("other assets should be created");
        std::fs::create_dir_all(root.join("code")).expect("code directory should be created");
        std::fs::write(&document, "# Baseline\n").expect("document should be written");
        std::fs::write(current_assets.join("hakurou.json"), "{\"version\":1}\n")
            .expect("metadata should be written");
        std::fs::write(current_assets.join("figure01.png"), b"old image")
            .expect("image should be written");
        std::fs::write(other_assets.join("outside.png"), b"outside")
            .expect("other asset should be written");
        std::fs::write(root.join("code").join("private.rs"), "fn main() {}\n")
            .expect("code should be written");
        assert!(git_output_in(&root, &["init"])
            .expect("git init should run")
            .status
            .success());
        assert!(git_output_in(&root, &["add", "."])
            .expect("git add should run")
            .status
            .success());
        assert!(git_output_in_owned(
            &root,
            &[
                "-c".into(),
                "user.name=Hakurou Test".into(),
                "-c".into(),
                "user.email=hakurou@example.invalid".into(),
                "commit".into(),
                "-m".into(),
                "baseline".into(),
            ]
        )
        .expect("git commit should run")
        .status
        .success());

        std::fs::write(&document, "# Baseline\nmodified\n").expect("document should be modified");
        std::fs::write(current_assets.join("hakurou.json"), "{\"version\":2}\n")
            .expect("metadata should be modified");
        std::fs::write(current_assets.join("figure01.png"), b"new image")
            .expect("image should be modified");
        std::fs::write(current_assets.join("新增.emf"), b"vector image")
            .expect("new image should be written");
        std::fs::write(other_assets.join("outside.png"), b"changed outside")
            .expect("other asset should be modified");
        std::fs::write(
            root.join("code").join("private.rs"),
            "fn main() { changed(); }\n",
        )
        .expect("code should be modified");

        let canonical_document = document.canonicalize().expect("document should resolve");
        let context = repository_context(&canonical_document, Some("paper-a1b2c3"))
            .expect("context should be resolved");
        let changes = changes_for_context(&context).expect("changes should be read");
        assert_eq!(changes.len(), 4);
        assert!(changes
            .iter()
            .any(|change| change.path.ends_with("paper.md")
                && change.resource_kind == VersionResourceKind::Markdown));
        assert!(changes.iter().any(|change| change.is_document));
        assert!(changes
            .iter()
            .any(|change| change.path.ends_with("hakurou.json")
                && change.resource_kind == VersionResourceKind::Metadata));
        assert!(changes
            .iter()
            .any(|change| change.path.ends_with("figure01.png")
                && change.resource_kind == VersionResourceKind::Image));
        assert!(changes
            .iter()
            .any(|change| change.path.ends_with("新增.emf")
                && change.kind == VersionChangeKind::Untracked));
        assert!(!changes
            .iter()
            .any(|change| change.path.contains("other-paper-x9y8z7")
                || change.path.contains("private.rs")));

        let markdown_change = changes
            .iter()
            .find(|change| change.resource_kind == VersionResourceKind::Markdown)
            .expect("markdown change should exist");
        let diff =
            text_diff_from_git(&context, markdown_change).expect("markdown diff should be read");
        assert!(diff
            .iter()
            .flat_map(|hunk| &hunk.lines)
            .any(|line| line.kind == DiffLineKind::Added && line.content == "modified"));
        let summary = comparison_summary(&context, &changes).expect("summary should be read");
        assert_eq!(summary.changed_files, 4);
        assert_eq!(summary.internal_files, 1);
        assert!(summary.added_lines >= 2);
        let _ = std::fs::remove_dir_all(root);
    }

    #[test]
    fn creating_a_version_only_records_the_current_document_scope() {
        if !inspect_git().available {
            return;
        }
        let root = test_directory("create version 中文 scope");
        let document_dir = root.join("paper folder");
        let document = document_dir.join("paper.md");
        let current_assets = document_dir.join("assets").join("paper-a1b2c3");
        let other_assets = document_dir.join("assets").join("other-paper-x9y8z7");
        std::fs::create_dir_all(&current_assets).expect("current assets should be created");
        std::fs::create_dir_all(&other_assets).expect("other assets should be created");
        std::fs::create_dir_all(root.join("code")).expect("code directory should be created");
        std::fs::write(&document, "# Baseline\n").expect("document should be written");
        std::fs::write(current_assets.join("hakurou.json"), "{\"version\":1}\n")
            .expect("metadata should be written");
        std::fs::write(current_assets.join("figure.png"), b"old image")
            .expect("image should be written");
        std::fs::write(other_assets.join("outside.png"), b"outside")
            .expect("other asset should be written");
        std::fs::write(root.join("code").join("private.rs"), "fn main() {}\n")
            .expect("code should be written");

        assert!(git_output_in(&root, &["init"])
            .expect("git init should run")
            .status
            .success());
        assert!(
            git_output_in(&root, &["config", "user.name", "Hakurou Test"])
                .expect("user name should be configured")
                .status
                .success()
        );
        assert!(
            git_output_in(&root, &["config", "user.email", "hakurou@example.invalid"])
                .expect("user email should be configured")
                .status
                .success()
        );
        assert!(git_output_in(&root, &["add", "."])
            .expect("git add should run")
            .status
            .success());
        assert!(git_output_in(&root, &["commit", "-m", "baseline"])
            .expect("git commit should run")
            .status
            .success());

        std::fs::write(&document, "# Baseline\nupdated\n").expect("document should be modified");
        std::fs::write(current_assets.join("hakurou.json"), "{\"version\":2}\n")
            .expect("metadata should be modified");
        std::fs::write(current_assets.join("figure.png"), b"new image")
            .expect("image should be modified");
        std::fs::write(other_assets.join("outside.png"), b"outside changed")
            .expect("other asset should be modified");
        std::fs::write(
            root.join("code").join("private.rs"),
            "fn main() { changed(); }\n",
        )
        .expect("code should be modified");
        assert!(git_output_in(
            &root,
            &[
                "add",
                "code/private.rs",
                "paper folder/assets/other-paper-x9y8z7/outside.png",
            ],
        )
        .expect("out-of-scope files may already be staged")
        .status
        .success());

        let context = repository_context(
            &document.canonicalize().expect("document should resolve"),
            Some("paper-a1b2c3"),
        )
        .expect("context should be resolved");
        let version = create_version_impl(&context, "补充实验结果")
            .expect("scoped version should be created");
        assert_eq!(version.message, "补充实验结果");
        assert_eq!(version.parent_ids.len(), 1);

        let changed_paths = git_output_in_owned(
            &root,
            &[
                "show".into(),
                "--format=".into(),
                "--name-only".into(),
                version.id.clone(),
            ],
        )
        .expect("version files should be readable");
        assert!(changed_paths.status.success());
        let changed_paths = String::from_utf8_lossy(&changed_paths.stdout);
        assert!(changed_paths.contains("paper folder/paper.md"));
        assert!(changed_paths.contains("paper folder/assets/paper-a1b2c3/hakurou.json"));
        assert!(changed_paths.contains("paper folder/assets/paper-a1b2c3/figure.png"));
        assert!(!changed_paths.contains("other-paper-x9y8z7"));
        assert!(!changed_paths.contains("private.rs"));

        let history = history_for_context(&context, 30).expect("history should be readable");
        assert_eq!(
            history.first().map(|record| record.message.as_str()),
            Some("补充实验结果")
        );
        let comparison = get_version_comparison(
            document.to_string_lossy().to_string(),
            Some("paper-a1b2c3".into()),
            Some(version.id.clone()),
        )
        .expect("version comparison should be readable");
        assert!(matches!(
            comparison.target_revision.kind,
            RevisionKind::Version
        ));
        assert!(comparison.changes.iter().any(|change| change.is_document));
        let diff = get_version_diff(
            document.to_string_lossy().to_string(),
            Some("paper-a1b2c3".into()),
            context.scope.document.clone(),
            Some(version.id),
        )
        .expect("version diff should be readable");
        assert!(matches!(diff, FileDiff::Text { .. }));
        assert!(create_version_impl(&context, "空版本").is_err());
        let _ = std::fs::remove_dir_all(root);
    }

    #[test]
    fn revision_snapshot_reads_historical_markdown_and_assets_without_touching_the_worktree() {
        if !inspect_git().available {
            return;
        }
        let root = test_directory("revision snapshot read only");
        let document = root.join("paper.md");
        let assets = root.join("assets").join("paper-a1b2c3");
        std::fs::create_dir_all(&assets).expect("assets should be created");
        std::fs::write(
            &document,
            "# 初稿\n\n![图](./assets/paper-a1b2c3/figure.png)\n",
        )
        .expect("document should be written");
        std::fs::write(
            assets.join("hakurou.json"),
            "{\"schemaVersion\":1,\"document\":{\"schemaVersion\":1,\"documentId\":\"paper\",\"kind\":\"markdown\"},\"assets\":[]}",
        )
        .expect("metadata should be written");
        std::fs::write(assets.join("figure.png"), b"old image").expect("image should be written");
        assert!(git_output_in(&root, &["init"])
            .expect("git init should run")
            .status
            .success());
        assert!(
            git_output_in(&root, &["config", "user.name", "Hakurou Test"])
                .expect("name should be configured")
                .status
                .success()
        );
        assert!(
            git_output_in(&root, &["config", "user.email", "hakurou@example.invalid"])
                .expect("email should be configured")
                .status
                .success()
        );
        assert!(git_output_in(&root, &["add", "."])
            .expect("files should stage")
            .status
            .success());
        assert!(git_output_in(&root, &["commit", "-m", "初稿"])
            .expect("baseline should commit")
            .status
            .success());

        let context = repository_context(
            &document.canonicalize().expect("document should resolve"),
            Some("paper-a1b2c3"),
        )
        .expect("context should resolve");
        let version = version_record_for_id(&root, "HEAD").expect("version should resolve");
        std::fs::write(&document, "# 当前稿\n").expect("document should change");
        std::fs::write(assets.join("figure.png"), b"new image").expect("image should change");
        let status_before = git_output_in(&root, &["status", "--porcelain=v1", "-z"])
            .expect("status should read")
            .stdout;

        let historical =
            version_revision_snapshot(&context, &version).expect("historical snapshot should read");
        assert!(historical.markdown.contains("# 初稿"));
        assert_eq!(historical.assets.len(), 1);
        assert_eq!(
            BASE64.decode(&historical.assets[0].data_base64).unwrap(),
            b"old image"
        );
        let working = working_revision_snapshot(&context, Some("# 内存修改\n".into()))
            .expect("working snapshot should read");
        assert_eq!(working.markdown, "# 内存修改\n");
        let discovered_historical = get_revision_document_snapshot(
            document.to_string_lossy().to_string(),
            None,
            Some(version.id.clone()),
            None,
            None,
        )
        .expect("historical snapshot should discover its assets folder from Markdown");
        assert_eq!(discovered_historical.assets.len(), 1);
        let discovered_working = get_revision_document_snapshot(
            document.to_string_lossy().to_string(),
            None,
            None,
            Some(true),
            Some("# 当前稿\n\n![图](./assets/paper-a1b2c3/figure.png)\n".into()),
        )
        .expect("working snapshot should discover its assets folder from Markdown");
        assert_eq!(discovered_working.assets.len(), 1);
        assert_eq!(
            BASE64
                .decode(&discovered_working.assets[0].data_base64)
                .unwrap(),
            b"new image"
        );
        let status_after = git_output_in(&root, &["status", "--porcelain=v1", "-z"])
            .expect("status should read")
            .stdout;
        assert_eq!(status_before, status_after);
        let _ = std::fs::remove_dir_all(root);
    }

    #[test]
    fn first_version_creation_works_without_an_existing_head() {
        if !inspect_git().available {
            return;
        }
        let root = test_directory("first version no head");
        let document = root.join("paper.md");
        let assets = root.join("assets").join("paper-a1b2c3");
        std::fs::create_dir_all(&assets).expect("assets should be created");
        std::fs::write(&document, "# 初稿\n").expect("document should be written");
        std::fs::write(assets.join("hakurou.json"), "{\"version\":1}\n")
            .expect("metadata should be written");
        assert!(git_output_in(&root, &["init"])
            .expect("git init should run")
            .status
            .success());
        assert!(
            git_output_in(&root, &["config", "--local", "user.name", "Hakurou Test"])
                .expect("name should be configured")
                .status
                .success()
        );
        assert!(git_output_in(
            &root,
            &["config", "--local", "user.email", "hakurou@example.invalid"]
        )
        .expect("email should be configured")
        .status
        .success());
        let context = repository_context(
            &document.canonicalize().expect("document should resolve"),
            Some("paper-a1b2c3"),
        )
        .expect("context should resolve");
        assert!(!context.has_commits);
        let version =
            create_version_impl(&context, "初稿").expect("first version should be created");
        assert_eq!(version.message, "初稿");
        assert!(has_commits(&root).expect("head should be checked"));
        assert_eq!(
            history_for_context(&context, 30)
                .expect("history should read")
                .len(),
            1
        );
        let _ = std::fs::remove_dir_all(root);
    }

    #[test]
    fn restoring_a_version_reconciles_only_the_document_scope_and_preserves_other_staging() {
        if !inspect_git().available {
            return;
        }
        let root = test_directory("restore 中文 scope");
        let document_dir = root.join("paper folder");
        let document = document_dir.join("paper.md");
        let current_assets = document_dir.join("assets").join("paper-a1b2c3");
        let other_assets = document_dir.join("assets").join("other-paper-x9y8z7");
        std::fs::create_dir_all(&current_assets).expect("current assets should be created");
        std::fs::create_dir_all(&other_assets).expect("other assets should be created");
        std::fs::create_dir_all(root.join("code")).expect("code should be created");
        std::fs::write(&document, "# Initial\n").expect("document should be written");
        std::fs::write(current_assets.join("hakurou.json"), "{\"version\":1}\n")
            .expect("metadata should be written");
        std::fs::write(current_assets.join("figure01.png"), b"initial image")
            .expect("initial asset should be written");
        std::fs::write(other_assets.join("other.png"), b"outside")
            .expect("other asset should be written");
        std::fs::write(root.join("code").join("main.rs"), "fn main() {}\n")
            .expect("code should be written");
        assert!(git_output_in(&root, &["init"])
            .expect("git init should run")
            .status
            .success());
        assert!(
            git_output_in(&root, &["config", "user.name", "Hakurou Test"])
                .expect("name should be configured")
                .status
                .success()
        );
        assert!(
            git_output_in(&root, &["config", "user.email", "hakurou@example.invalid"])
                .expect("email should be configured")
                .status
                .success()
        );
        assert!(git_output_in(&root, &["add", "."])
            .expect("git add should run")
            .status
            .success());
        assert!(git_output_in(&root, &["commit", "-m", "初稿"])
            .expect("baseline should commit")
            .status
            .success());
        let initial =
            version_record_for_id(&root, "HEAD").expect("initial version should be readable");

        std::fs::write(&document, "# Second\n").expect("document should change");
        std::fs::write(current_assets.join("hakurou.json"), "{\"version\":2}\n")
            .expect("metadata should change");
        std::fs::write(current_assets.join("figure02.emf"), b"second asset")
            .expect("second asset should be written");
        let context = repository_context(
            &document.canonicalize().expect("document should resolve"),
            Some("paper-a1b2c3"),
        )
        .expect("context should resolve");
        let second =
            create_version_impl(&context, "第二版").expect("second version should be created");

        std::fs::write(&document, "# Unversioned\n").expect("document should change again");
        std::fs::remove_file(current_assets.join("figure01.png"))
            .expect("old asset should be removed");
        std::fs::write(current_assets.join("untracked.png"), b"untracked asset")
            .expect("untracked asset should be written");
        std::fs::write(
            root.join("code").join("main.rs"),
            "fn main() { changed(); }\n",
        )
        .expect("outside code should change");
        std::fs::write(other_assets.join("other.png"), b"outside changed")
            .expect("outside asset should change");
        assert!(git_output_in(
            &root,
            &[
                "add",
                "code/main.rs",
                "paper folder/assets/other-paper-x9y8z7/other.png",
            ],
        )
        .expect("outside changes should stage")
        .status
        .success());

        let restored = restore_version_impl(
            &context,
            &initial.id,
            RestoreStrategy::DiscardCurrentChanges,
            None,
        )
        .expect("initial version should restore safely");
        assert!(!restored.already_equivalent);
        assert_eq!(
            std::fs::read_to_string(&document).expect("document should read"),
            "# Initial\n"
        );
        assert_eq!(
            std::fs::read(current_assets.join("figure01.png")).expect("old asset should return"),
            b"initial image"
        );
        assert!(!current_assets.join("figure02.emf").exists());
        assert!(!current_assets.join("untracked.png").exists());
        assert_eq!(
            std::fs::read_to_string(current_assets.join("hakurou.json"))
                .expect("metadata should read"),
            "{\"version\":1}\n"
        );
        assert_eq!(
            std::fs::read_to_string(root.join("code").join("main.rs"))
                .expect("outside code should remain"),
            "fn main() { changed(); }\n"
        );
        assert_eq!(
            std::fs::read(other_assets.join("other.png")).expect("outside asset should remain"),
            b"outside changed"
        );

        let staged = git_output_in(&root, &["diff", "--cached", "--name-only"])
            .expect("staged status should be readable");
        let staged = String::from_utf8_lossy(&staged.stdout);
        assert!(staged.contains("code/main.rs"));
        assert!(staged.contains("other-paper-x9y8z7/other.png"));
        let restore_commit = restored
            .created_version
            .expect("restore should create a version");
        let restore_paths = git_output_in_owned(
            &root,
            &[
                "show".into(),
                "--format=".into(),
                "--name-only".into(),
                restore_commit.id,
            ],
        )
        .expect("restore version files should be readable");
        let restore_paths = String::from_utf8_lossy(&restore_paths.stdout);
        assert!(!restore_paths.contains("code/main.rs"));
        assert!(!restore_paths.contains("other-paper-x9y8z7"));
        assert!(restore_paths.contains("paper folder/paper.md"));
        assert!(history_for_context(&context, 30)
            .expect("history should read")
            .iter()
            .any(|version| version.id == second.id));

        let already_current = restore_version_impl(
            &context,
            &initial.id,
            RestoreStrategy::DiscardCurrentChanges,
            None,
        )
        .expect("matching version should be accepted");
        assert!(already_current.already_equivalent);
        assert!(already_current.created_version.is_none());

        std::fs::write(&document, "# Protect this change\n")
            .expect("document should change before safe restore");
        let safely_restored = restore_version_impl(
            &context,
            &second.id,
            RestoreStrategy::SaveCurrentVersionFirst,
            Some("恢复前保存"),
        )
        .expect("safe restore should first protect current changes");
        assert!(!safely_restored.already_equivalent);
        assert_eq!(
            std::fs::read_to_string(&document).expect("document should read"),
            "# Second\n"
        );
        assert!(current_assets.join("figure02.emf").exists());
        let messages: Vec<_> = history_for_context(&context, 30)
            .expect("history should read")
            .into_iter()
            .map(|version| version.message)
            .collect();
        assert!(messages.iter().any(|message| message == "恢复前保存"));
        assert!(messages.iter().any(|message| message == "恢复至：第二版"));
        let _ = std::fs::remove_dir_all(root);
    }

    #[test]
    fn existing_parent_repository_is_reused_for_unicode_and_space_paths() {
        if !inspect_git().available {
            return;
        }
        let root = test_directory("repository-中文 path");
        let document_dir = root.join("papers with space");
        let document = document_dir.join("paper.md");
        std::fs::create_dir_all(&document_dir).expect("document directory should be created");
        std::fs::write(&document, "# Paper").expect("document should be written");

        let initialized = init_version_repository(document.to_string_lossy().to_string(), None)
            .expect("repository should be initialised");
        assert!(initialized.is_repository);
        assert!(!initialized.has_commits);
        assert_eq!(
            initialized
                .repository_root
                .as_deref()
                .map(|path| normalized(Path::new(path))),
            Some(normalized(&document_dir))
        );

        let project_root = root.join("parent project");
        let nested_document_dir = project_root.join("papers");
        let nested_document = nested_document_dir.join("nested.md");
        std::fs::create_dir_all(&nested_document_dir)
            .expect("nested document directory should be created");
        std::fs::write(&nested_document, "# Nested").expect("nested document should be written");
        let output = git_output_in(&project_root, &["init"]).expect("Git should run");
        assert!(output.status.success());

        let detected = init_version_repository(nested_document.to_string_lossy().to_string(), None)
            .expect("parent repository should be reused");
        assert_eq!(
            detected
                .repository_root
                .as_deref()
                .map(|path| normalized(Path::new(path))),
            Some(normalized(&project_root))
        );
        assert!(!nested_document_dir.join(".git").exists());
        let _ = std::fs::remove_dir_all(root);
    }
}
