//! Review a merge in Git objects and a private index; publish only after confirmation.
use crate::{git, remote_git as remote};
use base64::{engine::general_purpose::STANDARD, Engine};
use serde::{Deserialize, Serialize};
use std::{
    collections::{BTreeMap, BTreeSet, HashMap},
    fs,
    path::{Path, PathBuf},
    sync::{Arc, Mutex, OnceLock},
    time::{Duration, Instant},
};
use tauri::AppHandle;

const TEXT_LIMIT: usize = 900_000;
type Tree = BTreeMap<String, Entry>;
#[derive(Clone, Debug, PartialEq, Eq)]
struct Entry {
    mode: String,
    oid: String,
}
#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MergeFile {
    path: String,
    local_changed: bool,
    remote_changed: bool,
    conflict_id: Option<String>,
}
#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MergeConflict {
    id: String,
    paths: Vec<String>,
    editable: bool,
    reasons: Vec<String>,
}
#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MergeReview {
    id: String,
    repository_root: String,
    branch: String,
    remote_name: String,
    target_branch: String,
    state_token: String,
    relationship: String,
    base: git::VersionRecord,
    local: git::VersionRecord,
    remote: git::VersionRecord,
    local_commits: Vec<git::VersionRecord>,
    remote_commits: Vec<git::VersionRecord>,
    local_count: usize,
    remote_count: usize,
    files: Vec<MergeFile>,
    conflicts: Vec<MergeConflict>,
}
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MergeVersion {
    kind: String,
    content: Option<String>,
    hash: Option<String>,
    mode: Option<String>,
    size: usize,
    preview: Option<String>,
    metadata: Option<String>,
    assets: Vec<serde_json::Value>,
}
#[derive(Serialize)]
pub struct MergeFileVersions {
    base: MergeVersion,
    local: MergeVersion,
    remote: MergeVersion,
}
#[derive(Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Resolution {
    conflict_id: String,
    choice: String,
    text: Option<String>,
}
struct Plan {
    review: MergeReview,
    root: PathBuf,
    tracking: String,
    local: String,
    remote: String,
    base: String,
    base_tree: Tree,
    local_tree: Tree,
    remote_tree: Tree,
    merged_tree: Tree,
    result_tree: String,
    created: Instant,
}
static PLANS: OnceLock<Mutex<HashMap<String, Arc<Plan>>>> = OnceLock::new();
fn plans() -> &'static Mutex<HashMap<String, Arc<Plan>>> {
    PLANS.get_or_init(|| Mutex::new(HashMap::new()))
}
fn plan(id: &str) -> Result<Arc<Plan>, String> {
    let mut stored = plans().lock().map_err(|_| "合并预览不可用。")?;
    stored.retain(|_, p| p.created.elapsed() < Duration::from_secs(3600));
    stored
        .get(id)
        .cloned()
        .ok_or("合并预览已失效，请重新比较。".into())
}
fn keep(plan: Plan) -> Result<MergeReview, String> {
    let view = plan.review.clone();
    let mut stored = plans().lock().map_err(|_| "合并预览不可用。")?;
    if stored.len() >= 8 {
        if let Some(oldest) = stored
            .iter()
            .max_by_key(|(_, p)| p.created.elapsed())
            .map(|(key, _)| key.clone())
        {
            stored.remove(&oldest);
        }
    }
    stored.insert(view.id.clone(), Arc::new(plan));
    Ok(view)
}
fn oid(value: &str) -> Result<String, String> {
    if !matches!(value.len(), 40 | 64) || !value.bytes().all(|b| b.is_ascii_hexdigit()) {
        return Err("Git 返回了无效的对象标识。".into());
    }
    Ok(value.into())
}
fn valid_path(path: &str) -> Result<(), String> {
    if path.is_empty()
        || path.contains(['\0', '\\'])
        || path.split('/').any(|part| {
            part.is_empty() || matches!(part, "." | "..") || part.eq_ignore_ascii_case(".git")
        })
    {
        return Err("仓库包含无法安全处理的文件路径。".into());
    }
    Ok(())
}
fn utf8(bytes: &[u8]) -> Result<&str, String> {
    std::str::from_utf8(bytes).map_err(|_| "仓库路径不是有效的 UTF-8，未进行合并。".into())
}
fn checked(root: &Path, args: &[&str]) -> Result<Vec<u8>, String> {
    let out = remote::run(root, args)?;
    if !out.status.success() {
        return Err(format!(
            "Git 无法准备合并：{}",
            String::from_utf8_lossy(&out.stderr).trim()
        ));
    }
    Ok(out.stdout)
}
fn tree(root: &Path, revision: &str) -> Result<Tree, String> {
    let bytes = checked(root, &["ls-tree", "-rz", "--full-tree", revision])?;
    let mut result = Tree::new();
    for line in bytes.split(|b| *b == 0).filter(|line| !line.is_empty()) {
        let (head, path) = utf8(line)?
            .split_once('\t')
            .ok_or("无法读取 Git 文件清单。")?;
        valid_path(path)?;
        let fields: Vec<_> = head.split_whitespace().collect();
        if fields.len() != 3 || !matches!(fields[0], "100644" | "100755" | "120000" | "160000") {
            return Err("仓库包含尚不支持的 Git 文件类型。".into());
        }
        result.insert(
            path.into(),
            Entry {
                mode: fields[0].into(),
                oid: oid(fields[2])?,
            },
        );
    }
    if result.len() > 10_000 {
        return Err("仓库文件超过本次合并预览上限（10000），未改动工作目录。".into());
    }
    Ok(result)
}
#[derive(Debug)]
struct Notice {
    paths: Vec<String>,
    kind: String,
    message: String,
}
fn parse_merge(bytes: &[u8]) -> Result<(String, BTreeSet<String>, Vec<Notice>), String> {
    let parts: Vec<_> = bytes.split(|b| *b == 0).collect();
    let result = oid(utf8(parts.first().ok_or("Git 合并输出为空。")?)?.trim())?;
    let mut at = 1;
    let mut paths = BTreeSet::new();
    while at < parts.len() && !parts[at].is_empty() {
        let (header, path) = utf8(parts[at])?
            .split_once('\t')
            .ok_or("无法读取 Git 冲突清单。")?;
        let fields: Vec<_> = header.split_whitespace().collect();
        if fields.len() != 3 || !matches!(fields[2], "1" | "2" | "3") {
            return Err("无法读取 Git 冲突阶段。".into());
        }
        oid(fields[1])?;
        valid_path(path)?;
        paths.insert(path.to_owned());
        at += 1;
    }
    at += 1;
    let mut notices = Vec::new();
    while at < parts.len() && !parts[at].is_empty() {
        let count: usize = utf8(parts[at])?
            .parse()
            .map_err(|_| "无法读取 Git 冲突说明。")?;
        at += 1;
        if count > 10_000 || at + count + 2 > parts.len() {
            return Err("Git 冲突说明不完整。".into());
        }
        let paths = parts[at..at + count]
            .iter()
            .map(|p| utf8(p).map(str::to_owned))
            .collect::<Result<Vec<_>, _>>()?;
        at += count;
        let kind = utf8(parts[at])?.to_owned();
        let message = utf8(parts[at + 1])?.to_owned();
        at += 2;
        if kind.starts_with("CONFLICT") {
            notices.push(Notice {
                paths,
                kind,
                message,
            });
        }
    }
    Ok((result, paths, notices))
}
fn related(path: &str, selector: &str) -> bool {
    path == selector
        || path
            .strip_prefix(selector)
            .is_some_and(|tail| tail.starts_with('/'))
}
fn conflicts(
    staged: &BTreeSet<String>,
    notices: &[Notice],
    all: &BTreeSet<String>,
) -> Result<Vec<MergeConflict>, String> {
    // Git's informational records connect rename/delete/directory conflict paths.
    // Never infer those relationships from index stages alone.
    let mut groups: Vec<(BTreeSet<String>, BTreeSet<String>, bool)> = Vec::new();
    for notice in notices {
        let mut paths: BTreeSet<_> = all
            .iter()
            .filter(|path| notice.paths.iter().any(|selector| related(path, selector)))
            .cloned()
            .collect();
        paths.extend(
            staged
                .iter()
                .filter(|path| notice.paths.iter().any(|selector| related(path, selector)))
                .cloned(),
        );
        if paths.is_empty() {
            return Err(format!(
                "Git 返回了不能定位的冲突：{}",
                notice.message.trim()
            ));
        }
        let ordinary = matches!(
            notice.kind.as_str(),
            "CONFLICT (contents)" | "CONFLICT (add/add)" | "CONFLICT (modify/delete)"
        );
        groups.push((paths, BTreeSet::from([notice.kind.clone()]), ordinary));
    }
    // Fold overlapping structural groups, including directory/file conflicts.
    let mut index = 0;
    while index < groups.len() {
        let mut next = index + 1;
        while next < groups.len() {
            if groups[index].0.is_disjoint(&groups[next].0) {
                next += 1;
                continue;
            }
            let other = groups.remove(next);
            groups[index].0.extend(other.0);
            groups[index].1.extend(other.1);
            groups[index].2 &= other.2;
            next = index + 1;
        }
        index += 1;
    }
    if staged
        .iter()
        .any(|path| !groups.iter().any(|g| g.0.contains(path)))
    {
        return Err("Git 冲突信息不完整，未改动工作目录；请在 Git 中检查此仓库。".into());
    }
    Ok(groups
        .into_iter()
        .enumerate()
        .map(|(index, (paths, reasons, ordinary))| MergeConflict {
            id: format!("conflict-{index}"),
            editable: ordinary && paths.len() == 1,
            paths: paths.into_iter().collect(),
            reasons: reasons.into_iter().collect(),
        })
        .collect())
}
fn history(root: &Path, from: &str, to: &str) -> Result<(usize, Vec<git::VersionRecord>), String> {
    let range = format!("{from}..{to}");
    let count = remote::text(root, &["rev-list", "--count", &range])?
        .parse()
        .map_err(|_| "无法读取版本数量。")?;
    let out = checked(
        root,
        &[
            "log",
            "-n",
            "100",
            "--format=%H%x00%h%x00%s%x00%cI%x00%an%x00%ae%x00%P%x00",
            &range,
            "--",
        ],
    )?;
    Ok((count, git::version_records_from_output(&out)))
}
fn prepare(
    root: &Path,
    remote_name: &str,
    current: &str,
    target: &str,
    state_token: &str,
) -> Result<Plan, String> {
    let tracking = format!("refs/remotes/{remote_name}/{target}");
    let local = oid(&remote::text(root, &["rev-parse", "--verify", "HEAD"])?)?;
    let remote_id = oid(&remote::text(
        root,
        &["rev-parse", "--verify", &format!("{tracking}^{{commit}}")],
    )
    .map_err(|_| "尚无远程记录，请先点击检查更新。")?)?;
    let bases = remote::text(root, &["merge-base", "--all", &local, &remote_id])
        .map_err(|_| "双方没有共同版本，不能在此合并。")?;
    if bases.lines().count() != 1 {
        return Err("双方有多个共同祖先，请先在 Git 中整理交叉合并历史。".into());
    }
    let base = oid(&bases)?;
    let local_tree = tree(root, &local)?;
    let remote_tree = tree(root, &remote_id)?;
    let base_tree = tree(root, &base)?;
    let (local_count, local_commits) = history(root, &remote_id, &local)?;
    let (remote_count, remote_commits) = history(root, &local, &remote_id)?;
    let relation = if remote_count == 0 {
        if local_count == 0 {
            "equal"
        } else {
            "outgoing"
        }
    } else if local_count == 0 {
        "incoming"
    } else {
        "diverged"
    };
    let output = remote::run(
        root,
        &[
            "-c",
            "merge.conflictStyle=merge",
            "merge-tree",
            "--write-tree",
            "--messages",
            "-z",
            &local,
            &remote_id,
        ],
    )?;
    if !matches!(output.status.code(), Some(0 | 1)) {
        return Err("Git 无法计算合并预览。需要 Git 2.38+，且仓库历史必须完整。".into());
    }
    let (result_tree, staged, notices) = parse_merge(&output.stdout)?;
    let merged_tree = tree(root, &result_tree)?;
    let all: BTreeSet<_> = base_tree
        .keys()
        .chain(local_tree.keys())
        .chain(remote_tree.keys())
        .chain(merged_tree.keys())
        .cloned()
        .collect();
    let conflicts = conflicts(&staged, &notices, &all)?;
    if output.status.code() == Some(1) && conflicts.is_empty() {
        return Err("Git 报告了无法解释的合并冲突，未改动工作目录。".into());
    }
    let files = all
        .into_iter()
        .filter_map(|path| {
            let local_changed = base_tree.get(&path) != local_tree.get(&path);
            let remote_changed = base_tree.get(&path) != remote_tree.get(&path);
            let conflict_id = conflicts
                .iter()
                .find(|g| g.paths.contains(&path))
                .map(|g| g.id.clone());
            (local_changed || remote_changed || conflict_id.is_some()).then_some(MergeFile {
                path,
                local_changed,
                remote_changed,
                conflict_id,
            })
        })
        .collect();
    let review = MergeReview {
        id: uuid::Uuid::new_v4().to_string(),
        repository_root: root.to_string_lossy().into_owned(),
        branch: current.into(),
        remote_name: remote_name.into(),
        target_branch: target.into(),
        state_token: state_token.into(),
        relationship: relation.into(),
        base: git::version_record_for_id(root, &base)?,
        local: git::version_record_for_id(root, &local)?,
        remote: git::version_record_for_id(root, &remote_id)?,
        local_count,
        remote_count,
        local_commits,
        remote_commits,
        files,
        conflicts,
    };
    Ok(Plan {
        review,
        root: root.into(),
        tracking,
        local,
        remote: remote_id,
        base,
        base_tree,
        local_tree,
        remote_tree,
        merged_tree,
        result_tree,
        created: Instant::now(),
    })
}
fn blob(root: &Path, entry: &Entry) -> Result<Vec<u8>, String> {
    checked(root, &["cat-file", "blob", &entry.oid])
}
fn size(root: &Path, entry: &Entry) -> Result<usize, String> {
    remote::text(root, &["cat-file", "-s", &entry.oid])?
        .parse()
        .map_err(|_| "无法读取文件大小。".into())
}
fn image_mime(path: &str) -> Option<&'static str> {
    match Path::new(path)
        .extension()?
        .to_str()?
        .to_ascii_lowercase()
        .as_str()
    {
        "png" => Some("image/png"),
        "jpg" | "jpeg" => Some("image/jpeg"),
        "gif" => Some("image/gif"),
        "webp" => Some("image/webp"),
        "bmp" => Some("image/bmp"),
        _ => None,
    }
}
fn file_version(
    root: &Path,
    entries: &Tree,
    path: &str,
    include_snapshot: bool,
) -> Result<MergeVersion, String> {
    let mut result = MergeVersion {
        kind: "missing".into(),
        content: None,
        hash: None,
        mode: None,
        size: 0,
        preview: None,
        metadata: None,
        assets: vec![],
    };
    let Some(entry) = entries.get(path) else {
        return Ok(result);
    };
    result.hash = Some(entry.oid.clone());
    result.mode = Some(entry.mode.clone());
    if entry.mode == "160000" {
        result.kind = "submodule".into();
        return Ok(result);
    }
    result.size = size(root, entry)?;
    result.kind = if entry.mode == "120000" {
        "link"
    } else {
        "binary"
    }
    .into();
    if result.size <= TEXT_LIMIT {
        let bytes = blob(root, entry)?;
        if let Ok(content) = std::str::from_utf8(&bytes) {
            if !content.contains('\0') {
                result.kind = if entry.mode == "120000" {
                    "link"
                } else {
                    "text"
                }
                .into();
                result.content = Some(content.into());
            }
        }
        if let Some(mime) = image_mime(path) {
            result.preview = Some(format!("data:{mime};base64,{}", STANDARD.encode(bytes)));
        }
    }
    if include_snapshot && crate::is_markdown_path(Path::new(path)) {
        let directory = path
            .rsplit_once('/')
            .map(|(p, _)| format!("{p}/"))
            .unwrap_or_default();
        let asset_root = format!("{directory}assets/");
        let filename = Path::new(path)
            .file_stem()
            .and_then(|p| p.to_str())
            .unwrap_or_default();
        let metadata: Vec<_> = entries
            .keys()
            .filter(|p| p.starts_with(&asset_root) && p.ends_with("/hakurou.json"))
            .collect();
        let referenced = result.content.as_deref().unwrap_or("");
        let candidates: Vec<_> = metadata
            .into_iter()
            .filter(|p| {
                let folder = p[asset_root.len()..].trim_end_matches("/hakurou.json");
                referenced.contains(&format!("./assets/{folder}/"))
                    || folder.starts_with(&format!("{filename}-"))
            })
            .collect();
        if candidates.len() == 1 {
            let item = candidates[0];
            let e = &entries[item];
            if size(root, e)? <= TEXT_LIMIT {
                result.metadata = String::from_utf8(blob(root, e)?).ok();
            }
        }
        result.assets = entries.iter().filter(|(p, e)| p.starts_with(&asset_root) && e.mode.starts_with("100") && image_mime(p).is_some()).map(|(p, e)| serde_json::json!({"path":format!("./{}", &p[directory.len()..]),"mimeType":image_mime(p).unwrap(),"contentHash":e.oid})).collect();
    }
    Ok(result)
}
fn versions(plan: &Plan, path: &str) -> Result<MergeFileVersions, String> {
    if !plan.review.files.iter().any(|f| f.path == path) {
        return Err("只能查看此合并预览中的文件。".into());
    }
    Ok(MergeFileVersions {
        base: file_version(&plan.root, &plan.base_tree, path, true)?,
        local: file_version(&plan.root, &plan.local_tree, path, true)?,
        remote: file_version(&plan.root, &plan.remote_tree, path, true)?,
    })
}
struct Scratch(PathBuf);
impl Scratch {
    fn new() -> Result<Self, String> {
        let path = std::env::temp_dir().join(format!("hakurou-merge-{}", uuid::Uuid::new_v4()));
        fs::create_dir(&path).map_err(|_| "无法创建独立合并索引。")?;
        fs::create_dir(path.join("hooks")).map_err(|_| "无法创建合并目录。")?;
        Ok(Self(path))
    }
}
impl Drop for Scratch {
    fn drop(&mut self) {
        let _ = fs::remove_dir_all(&self.0);
    }
}
fn finish(
    plan: &Plan,
    resolutions: &[Resolution],
    message: &str,
    identity: impl FnOnce(&mut std::process::Command) -> Result<(), String>,
) -> Result<Vec<String>, String> {
    let root = &plan.root;
    let verify = || -> Result<(), String> {
        remote::ensure_clean(root)?;
        if remote::branch(root)? != plan.review.branch
            || remote::text(root, &["rev-parse", "HEAD"])? != plan.local
            || remote::text(root, &["rev-parse", &plan.tracking])? != plan.remote
            || remote::target_branch(root, &plan.review.remote_name, &plan.review.branch)?
                != plan.review.target_branch
        {
            return Err("仓库、分支或远程版本已变化，请关闭后重新比较。".into());
        }
        Ok(())
    };
    verify()?;
    if plan.review.remote_count == 0 {
        return Err("远程没有需要合入的版本。".into());
    }
    if message.trim().is_empty() || message.len() > 8192 || message.contains('\0') {
        return Err("请填写有效的合并说明（不超过 8192 字节）。".into());
    }
    if resolutions.len() != plan.review.conflicts.len() {
        return Err("请先处理所有冲突。".into());
    }
    let scratch = Scratch::new()?;
    let mut result = plan.merged_tree.clone();
    let mut seen = BTreeSet::new();
    for resolution in resolutions {
        if !seen.insert(&resolution.conflict_id) {
            return Err("冲突选择重复，请重新比较。".into());
        }
        let group = plan
            .review
            .conflicts
            .iter()
            .find(|g| g.id == resolution.conflict_id)
            .ok_or("冲突选择无效。")?;
        match resolution.choice.as_str() {
            "local" | "remote" => {
                let source = if resolution.choice == "local" {
                    &plan.local_tree
                } else {
                    &plan.remote_tree
                };
                for path in &group.paths {
                    result.remove(path);
                    if let Some(entry) = source.get(path) {
                        result.insert(path.clone(), entry.clone());
                    }
                }
            }
            "text" if group.editable => {
                let path = &group.paths[0];
                let sides = versions(plan, path)?;
                if [&sides.base, &sides.local, &sides.remote]
                    .iter()
                    .any(|v| !matches!(v.kind.as_str(), "text" | "missing"))
                {
                    return Err("二进制、链接或大文件冲突需要选择保留哪一边。".into());
                }
                let value = resolution
                    .text
                    .as_deref()
                    .ok_or("未提供冲突处理后的正文。")?;
                if value.len() > TEXT_LIMIT || value.contains('\0') {
                    return Err("冲突正文超过大小限制或包含无效字符。".into());
                }
                let source = plan
                    .local_tree
                    .get(path)
                    .or_else(|| plan.remote_tree.get(path))
                    .ok_or("冲突文件已失效。")?;
                // Executable-bit/type conflicts are whole-file choices, not text edits.
                if plan
                    .local_tree
                    .get(path)
                    .zip(plan.remote_tree.get(path))
                    .is_some_and(|(a, b)| a.mode != b.mode)
                {
                    return Err("文件类型也有变化，请选择保留本地或远程整个文件。".into());
                }
                let input = scratch.0.join("resolved-content");
                fs::write(&input, value.as_bytes()).map_err(|_| "无法准备冲突正文。")?;
                let hash = oid(&remote::text(
                    root,
                    &[
                        "hash-object",
                        "-w",
                        "--no-filters",
                        "--",
                        input.to_str().ok_or("临时路径无效。")?,
                    ],
                )?)?;
                result.insert(
                    path.clone(),
                    Entry {
                        mode: source.mode.clone(),
                        oid: hash,
                    },
                );
            }
            _ => return Err("请选择有效的冲突处理方式。".into()),
        }
    }
    // Validate the final tree has no file/directory ambiguity after group choices.
    for path in result.keys() {
        let mut parent = Path::new(path).parent();
        while let Some(p) = parent {
            if let Some(p) = p.to_str().filter(|p| !p.is_empty()) {
                if result.contains_key(p) {
                    return Err("冲突选择仍存在文件与文件夹重叠，请重新选择整个冲突组。".into());
                }
            }
            parent = p.parent();
        }
    }
    let index = scratch.0.join("index");
    let run_index = |args: &[&str]| -> Result<(), String> {
        let mut cmd = remote::command(root);
        cmd.env("GIT_INDEX_FILE", &index).args(args);
        let out = remote::execute(cmd)?;
        if out.status.success() {
            Ok(())
        } else {
            Err("无法在独立索引中准备合并，工作目录未改变。".into())
        }
    };
    run_index(&["read-tree", &plan.result_tree])?;
    for path in plan
        .merged_tree
        .keys()
        .filter(|path| !result.contains_key(*path))
    {
        run_index(&["update-index", "--force-remove", "--", path])?;
    }
    for (path, entry) in &result {
        if plan.merged_tree.get(path) != Some(entry) {
            let item = format!("{},{},{}", entry.mode, entry.oid, path);
            run_index(&["update-index", "--add", "--cacheinfo", &item])?;
        }
    }
    let mut cmd = remote::command(root);
    cmd.env("GIT_INDEX_FILE", &index).arg("write-tree");
    let out = remote::execute(cmd)?;
    if !out.status.success() {
        return Err("合并结果未能形成完整版本，工作目录未改变。".into());
    }
    let merged = oid(utf8(&out.stdout)?.trim())?;
    let destination = if plan.review.relationship == "incoming" {
        plan.remote.clone()
    } else {
        let file = scratch.0.join("message");
        fs::write(&file, message.trim()).map_err(|_| "无法准备合并说明。")?;
        let mut cmd = remote::command(root);
        cmd.args([
            "commit-tree",
            &merged,
            "-p",
            &plan.local,
            "-p",
            &plan.remote,
            "--no-gpg-sign",
            "-F",
        ])
        .arg(file);
        identity(&mut cmd)?;
        let out = remote::execute(cmd)?;
        if !out.status.success() {
            return Err("无法创建合并版本，请检查版本昵称设置。".into());
        }
        oid(utf8(&out.stdout)?.trim())?
    };
    verify()?;
    let changed = checked(
        root,
        &["diff", "--name-only", "-z", &plan.local, &destination, "--"],
    )?;
    // Git itself locks the real index/ref and refuses collisions, including ignored
    // files. No checkout/reset/stash or partially populated conflict index is used.
    let hooks = format!("core.hooksPath={}", scratch.0.join("hooks").display());
    let out = remote::run(
        root,
        &[
            "-c",
            "merge.autoStash=false",
            "-c",
            "submodule.recurse=false",
            "-c",
            &hooks,
            "merge",
            "--ff-only",
            "--no-edit",
            "--no-overwrite-ignore",
            &destination,
        ],
    )?;
    if !out.status.success() {
        return Err(format!(
            "未能应用合并。请检查工作目录后重新比较：{}",
            String::from_utf8_lossy(&out.stderr).trim()
        ));
    }
    changed
        .split(|b| *b == 0)
        .filter(|p| !p.is_empty())
        .map(|p| Ok(root.join(utf8(p)?).to_string_lossy().into_owned()))
        .collect()
}

#[tauri::command]
pub async fn prepare_remote_merge(
    app: AppHandle,
    document_path: String,
    remote: String,
    state_token: String,
) -> Result<MergeReview, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let _guard = remote::REMOTE_OPERATION
            .lock()
            .map_err(|_| "另一个 Git 操作正在进行。")?;
        let root = remote::repository(&document_path)?;
        let before = remote::inspect(&app, &root)?;
        if before.state_token != state_token {
            return Err("仓库或分支已改变，请刷新后重试。".into());
        }
        let current = remote::branch(&root)?;
        let target = remote::target_branch(&root, &remote, &current)?;
        keep(prepare(&root, &remote, &current, &target, &state_token)?)
    })
    .await
    .map_err(|_| "无法准备远程合并预览。")?
}
#[tauri::command]
pub async fn read_remote_merge_file(
    plan_id: String,
    path: String,
) -> Result<MergeFileVersions, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let plan = plan(&plan_id)?;
        versions(&plan, &path)
    })
    .await
    .map_err(|_| "无法读取合并文件。")?
}
#[tauri::command]
pub async fn read_remote_merge_asset(
    plan_id: String,
    revision_id: String,
    document_path: String,
    asset_path: String,
) -> Result<Option<serde_json::Value>, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let plan = plan(&plan_id)?;
        let tree = if revision_id == plan.local { &plan.local_tree } else if revision_id == plan.remote { &plan.remote_tree } else if revision_id == plan.base { &plan.base_tree } else { return Err("图片版本不属于本次比较。".into()); };
        if !plan.review.files.iter().any(|f| f.path == document_path) { return Err("文稿不属于本次比较。".into()); }
        let path = asset_path.strip_prefix("./").unwrap_or(&asset_path); valid_path(path)?;
        let directory = document_path.rsplit_once('/').map(|(p, _)| format!("{p}/")).unwrap_or_default(); let path = format!("{directory}{path}");
        let Some(entry) = tree.get(&path) else { return Ok(None); }; let Some(mime) = image_mime(&path) else { return Ok(None); };
        if !entry.mode.starts_with("100") || size(&plan.root, entry)? > TEXT_LIMIT { return Ok(None); }
        Ok(Some(serde_json::json!({"path":asset_path,"mimeType":mime,"dataBase64":STANDARD.encode(blob(&plan.root, entry)?)})))
    }).await.map_err(|_| "无法读取比较图片。")?
}
#[tauri::command]
pub async fn complete_remote_merge(
    app: AppHandle,
    plan_id: String,
    resolutions: Vec<Resolution>,
    message: String,
) -> Result<remote::RemoteRepository, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let _guard = remote::REMOTE_OPERATION
            .lock()
            .map_err(|_| "另一个 Git 操作正在进行。")?;
        let plan = plan(&plan_id)?;
        if remote::inspect(&app, &plan.root)?.state_token != plan.review.state_token {
            return Err("仓库或分支已改变，请重新比较。".into());
        }
        let changed = finish(&plan, &resolutions, &message, |command| {
            git::apply_version_identity(&app, command)
        })?;
        plans()
            .lock()
            .map_err(|_| "合并已完成，请刷新状态。")?
            .remove(&plan_id);
        let mut result = remote::inspect(&app, &plan.root)
            .map_err(|error| format!("合并已完成，但状态读取失败，请刷新仓库：{error}"))?;
        result.changed_paths = changed;
        Ok(result)
    })
    .await
    .map_err(|_| "远程合并任务失败，请刷新仓库状态。")?
}
#[tauri::command]
pub fn discard_remote_merge(plan_id: String) {
    if let Ok(mut plans) = plans().lock() {
        plans.remove(&plan_id);
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    struct Repo(Scratch);
    impl Repo {
        fn new() -> Self {
            let repo = Self(Scratch::new().unwrap());
            repo.git(&["init", "-b", "main"]);
            repo.git(&["config", "user.name", "Merge Test"]);
            repo.git(&["config", "user.email", "merge@example.invalid"]);
            repo.git(&[
                "remote",
                "add",
                "origin",
                "https://github.com/test/merge.git",
            ]);
            repo
        }
        fn root(&self) -> &Path {
            &self.0 .0
        }
        fn git(&self, args: &[&str]) -> String {
            let out = remote::run(self.root(), args).unwrap();
            assert!(
                out.status.success(),
                "git {args:?}: {}",
                String::from_utf8_lossy(&out.stderr)
            );
            String::from_utf8_lossy(&out.stdout).trim().into()
        }
        fn write(&self, path: &str, content: &[u8]) {
            let path = self.root().join(path);
            fs::create_dir_all(path.parent().unwrap()).unwrap();
            fs::write(path, content).unwrap();
        }
        fn read(&self, path: &str) -> Vec<u8> {
            fs::read(self.root().join(path)).unwrap()
        }
        fn commit(&self, message: &str) -> String {
            self.git(&["add", "-A"]);
            self.git(&["commit", "-m", message]);
            self.git(&["rev-parse", "HEAD"])
        }
        fn track(&self) {
            let head = self.git(&["rev-parse", "HEAD"]);
            self.git(&["update-ref", "refs/remotes/origin/main", &head]);
            self.git(&["checkout", "main"]);
        }
        fn prepare(&self) -> Plan {
            prepare(self.root(), "origin", "main", "main", "test-token").unwrap()
        }
    }
    fn apply(plan: &Plan, choices: Vec<Resolution>) -> Result<Vec<String>, String> {
        finish(plan, &choices, "合并协作修改", |_| Ok(()))
    }
    fn choose(group: &MergeConflict, choice: &str) -> Resolution {
        Resolution {
            conflict_id: group.id.clone(),
            choice: choice.into(),
            text: None,
        }
    }
    #[test]
    fn preview_preserves_dirty_worktree_and_real_index_then_independent_edits_merge() {
        let r = Repo::new();
        r.write("论文.md", b"first\n\nsecond\n\nlast\n");
        r.commit("base");
        r.git(&["branch", "other"]);
        r.write("论文.md", b"human first\n\nsecond\n\nlast\n");
        let local = r.commit("local");
        r.git(&["checkout", "other"]);
        r.write("论文.md", b"first\n\nsecond\n\nremote last\n");
        let incoming = r.commit("remote");
        r.track();
        r.write("staged.txt", b"keep staging");
        r.git(&["add", "staged.txt"]);
        r.write("untracked.txt", b"keep untracked");
        let index = r.git(&["ls-files", "--stage"]);
        let status = r.git(&["status", "--porcelain"]);
        let plan = r.prepare();
        assert!(plan.review.conflicts.is_empty());
        assert_eq!(r.git(&["ls-files", "--stage"]), index);
        assert_eq!(r.git(&["status", "--porcelain"]), status);
        assert_eq!(r.git(&["rev-parse", "HEAD"]), local);
        assert!(apply(&plan, vec![]).is_err());
        assert_eq!(r.read("untracked.txt"), b"keep untracked");
        r.git(&["reset", "--", "staged.txt"]);
        fs::remove_file(r.root().join("staged.txt")).unwrap();
        fs::remove_file(r.root().join("untracked.txt")).unwrap();
        apply(&plan, vec![]).unwrap();
        assert_eq!(r.read("论文.md"), b"human first\n\nsecond\n\nremote last\n");
        assert_eq!(
            r.git(&["show", "-s", "--format=%P", "HEAD"]),
            format!("{local} {incoming}")
        );
        assert!(r.git(&["status", "--porcelain"]).is_empty());
    }
    #[test]
    fn explicit_text_binary_metadata_and_delete_choices_form_a_two_parent_commit() {
        let r = Repo::new();
        for (path, content) in [
            ("paper.md", &b"base\n"[..]),
            ("figure.png", &b"\0base-image"[..]),
            ("old.txt", &b"old\n"[..]),
            ("hakurou.json", &b"{\"font\":1,\"table\":1}\n"[..]),
        ] {
            r.write(path, content);
        }
        r.commit("base");
        r.git(&["branch", "other"]);
        r.write("paper.md", b"ours\n");
        r.write("figure.png", b"\0ours-image");
        r.write("hakurou.json", b"{\"font\":2,\"table\":1}\n");
        fs::remove_file(r.root().join("old.txt")).unwrap();
        let local = r.commit("local");
        r.git(&["checkout", "other"]);
        r.write("paper.md", b"theirs\n");
        r.write("figure.png", b"\0their-image");
        r.write("old.txt", b"remote edit\n");
        r.write("hakurou.json", b"{\"font\":1,\"table\":2}\n");
        let incoming = r.commit("remote");
        r.track();
        let plan = r.prepare();
        assert_eq!(plan.review.conflicts.len(), 4);
        assert!(apply(&plan, vec![]).is_err());
        let choices = plan
            .review
            .conflicts
            .iter()
            .map(|g| {
                let mut choice = choose(
                    g,
                    if g.paths.contains(&"figure.png".into()) {
                        "remote"
                    } else {
                        "local"
                    },
                );
                if g.paths == ["paper.md"] {
                    choice.choice = "text".into();
                    choice.text = Some("human + collaborator\n".into());
                }
                if g.paths == ["hakurou.json"] {
                    choice.choice = "text".into();
                    choice.text = Some("{\"font\":2,\"table\":2}\n".into());
                }
                choice
            })
            .collect();
        apply(&plan, choices).unwrap();
        assert_eq!(r.read("paper.md"), b"human + collaborator\n");
        assert_eq!(r.read("figure.png"), b"\0their-image");
        assert!(!r.root().join("old.txt").exists());
        assert_eq!(r.read("hakurou.json"), b"{\"font\":2,\"table\":2}\n");
        assert_eq!(
            r.git(&["show", "-s", "--format=%P", "HEAD"]),
            format!("{local} {incoming}")
        );
        assert!(r.git(&["status", "--porcelain"]).is_empty());
        assert_eq!(
            r.git(&["rev-list", "--count", "HEAD..refs/remotes/origin/main"]),
            "0"
        );
    }
    #[test]
    fn rename_rename_conflicts_are_resolved_as_one_connected_group() {
        let r = Repo::new();
        r.write("paper.md", b"stable\n");
        r.write("chapter.md", b"chapter\n");
        r.commit("base");
        r.git(&["branch", "other"]);
        r.git(&["mv", "chapter.md", "local-name.md"]);
        r.commit("local rename");
        r.git(&["checkout", "other"]);
        r.git(&["mv", "chapter.md", "remote-name.md"]);
        r.commit("remote rename");
        r.track();
        let plan = r.prepare();
        assert_eq!(plan.review.conflicts.len(), 1);
        let group = &plan.review.conflicts[0];
        assert!(!group.editable);
        assert!(group.paths.contains(&"local-name.md".into()));
        assert!(group.paths.contains(&"remote-name.md".into()));
        apply(&plan, vec![choose(group, "remote")]).unwrap();
        assert!(r.root().join("remote-name.md").is_file());
        assert!(!r.root().join("local-name.md").exists());
        assert!(!r.root().join("chapter.md").exists());
        assert!(r.git(&["status", "--porcelain"]).is_empty());
    }
    #[test]
    fn directory_file_conflict_group_restores_the_selected_side_without_leftovers() {
        let r = Repo::new();
        r.write("paper.md", b"stable\n");
        r.commit("base");
        r.git(&["branch", "other"]);
        r.write("object", b"local file\n");
        r.commit("local file");
        r.git(&["checkout", "other"]);
        r.write("object/child.md", b"remote directory\n");
        r.commit("remote folder");
        r.track();
        let plan = r.prepare();
        assert!(!plan.review.conflicts.is_empty());
        apply(
            &plan,
            plan.review
                .conflicts
                .iter()
                .map(|g| choose(g, "local"))
                .collect(),
        )
        .unwrap();
        assert_eq!(r.read("object"), b"local file\n");
        assert!(!r.git(&["ls-files"]).contains("~"));
        assert!(r.git(&["status", "--porcelain"]).is_empty());
    }
    #[test]
    fn stale_branch_remote_and_ignored_file_collisions_refuse_without_overwriting() {
        let r = Repo::new();
        r.write("paper.md", b"base\n");
        r.write(".gitignore", b"private.txt\n");
        r.commit("base");
        r.git(&["branch", "other"]);
        r.write("paper.md", b"local\n");
        r.commit("local");
        r.git(&["checkout", "other"]);
        r.write("incoming.md", b"incoming\n");
        r.write("private.txt", b"remote content\n");
        r.git(&["add", "-f", "private.txt"]);
        r.commit("remote");
        r.track();
        let plan = r.prepare();
        let local = r.git(&["rev-parse", "HEAD"]);
        r.write("private.txt", b"precious ignored content\n");
        assert!(apply(&plan, vec![]).is_err());
        assert_eq!(r.read("private.txt"), b"precious ignored content\n");
        assert_eq!(r.git(&["rev-parse", "HEAD"]), local);
        assert!(!r.root().join("incoming.md").exists());
        fs::remove_file(r.root().join("private.txt")).unwrap();
        r.git(&["checkout", "other"]);
        assert!(apply(&plan, vec![]).is_err());
        r.git(&["checkout", "main"]);
        r.git(&["update-ref", "refs/remotes/origin/main", &local]);
        assert!(apply(&plan, vec![]).is_err());
        assert_eq!(r.git(&["rev-parse", "HEAD"]), local);
    }
    #[test]
    fn invalid_or_incomplete_choices_never_publish_or_change_files() {
        let r = Repo::new();
        r.write("paper.md", b"base\n");
        r.write("figure.png", b"\0base");
        r.commit("base");
        r.git(&["branch", "other"]);
        r.write("paper.md", b"local\n");
        r.write("figure.png", b"\0local");
        let local = r.commit("local");
        r.git(&["checkout", "other"]);
        r.write("paper.md", b"remote\n");
        r.write("figure.png", b"\0remote");
        r.commit("remote");
        r.track();
        let plan = r.prepare();
        let valid: Vec<_> = plan
            .review
            .conflicts
            .iter()
            .map(|g| choose(g, "local"))
            .collect();
        let mut duplicate = valid.clone();
        duplicate[1] = duplicate[0].clone();
        let mut unknown = valid.clone();
        unknown[0].conflict_id = "unknown".into();
        let mut binary_text = valid.clone();
        let at = plan
            .review
            .conflicts
            .iter()
            .position(|g| g.paths == ["figure.png"])
            .unwrap();
        binary_text[at].choice = "text".into();
        binary_text[at].text = Some("do not replace binary".into());
        let mut missing_text = valid.clone();
        let at = plan
            .review
            .conflicts
            .iter()
            .position(|g| g.paths == ["paper.md"])
            .unwrap();
        missing_text[at].choice = "text".into();
        for choices in [vec![], duplicate, unknown, binary_text, missing_text] {
            assert!(apply(&plan, choices).is_err());
            assert_eq!(r.git(&["rev-parse", "HEAD"]), local);
            assert_eq!(r.read("paper.md"), b"local\n");
            assert_eq!(r.read("figure.png"), b"\0local");
            assert!(r.git(&["status", "--porcelain"]).is_empty());
        }
    }
    #[test]
    fn incoming_only_is_a_fast_forward_and_unicode_paths_and_images_stay_read_only() {
        let r = Repo::new();
        r.write("文稿 甲.md", "# 原文\n".as_bytes());
        let base = r.commit("base");
        r.git(&["branch", "other"]);
        r.git(&["checkout", "other"]);
        r.write(
            "文稿 甲.md",
            "# 新文\n\n![图](./assets/paper/图.png)\n".as_bytes(),
        );
        r.write("assets/paper/图.png", b"\x89PNG\0data");
        let incoming = r.commit("remote");
        r.track();
        let plan = r.prepare();
        assert_eq!(plan.review.relationship, "incoming");
        let file = versions(&plan, "文稿 甲.md").unwrap();
        assert_eq!(file.local.content.as_deref(), Some("# 原文\n"));
        assert_eq!(file.remote.assets.len(), 1);
        assert_eq!(r.git(&["rev-parse", "HEAD"]), base);
        assert!(versions(&plan, "../outside.md").is_err());
        apply(&plan, vec![]).unwrap();
        assert_eq!(r.git(&["rev-parse", "HEAD"]), incoming);
        assert_eq!(r.read("assets/paper/图.png"), b"\x89PNG\0data");
    }
}
