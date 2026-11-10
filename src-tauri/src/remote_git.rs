//! Explicit, repository-wide remote operations. No auto-commit, force push,
//! stash, rebase, or implicit conflict resolution.
use crate::git_accounts;
use base64::{engine::general_purpose::STANDARD, Engine};
use serde::Serialize;
use sha2::{Digest, Sha256};
use std::{
    io::Read,
    path::{Path, PathBuf},
    process::{Command, Output, Stdio},
    sync::Mutex,
    thread,
    time::{Duration, Instant},
};
use tauri::AppHandle;

pub(crate) static REMOTE_OPERATION: Mutex<()> = Mutex::new(());

#[derive(Clone, Debug)]
struct Endpoint {
    url: String,
    host: String,
    path: String,
    provider: String,
}

fn parse_endpoint(value: &str) -> Result<Endpoint, String> {
    if value.is_empty() || value.chars().any(|c| c.is_control() || c.is_whitespace()) {
        return Err("仓库地址无效。".into());
    }
    let normalized = if value.starts_with("git@") && !value.contains("://") {
        let (host, path) = value[4..].split_once(':').ok_or("SSH 仓库地址无效。")?;
        format!("ssh://git@{host}/{path}")
    } else {
        value.to_string()
    };
    let parsed = tauri::Url::parse(&normalized).map_err(|_| "请输入 HTTPS 或 SSH 仓库地址。")?;
    if !matches!(parsed.scheme(), "https" | "ssh")
        || parsed.password().is_some()
        || parsed.query().is_some()
        || parsed.fragment().is_some()
        || (parsed.scheme() == "https" && !parsed.username().is_empty())
        || (parsed.scheme() == "ssh" && parsed.username() != "git")
    {
        return Err("只支持不含密码或令牌的 HTTPS / SSH Git 仓库地址。".into());
    }
    let host = parsed.host_str().ok_or("仓库域名无效。")?.to_lowercase();
    let path = parsed
        .path()
        .trim_start_matches('/')
        .trim_end_matches('/')
        .to_string();
    if path.split('/').count() < 2
        || path
            .split('/')
            .any(|v| v.is_empty() || v.starts_with('-') || v.contains('%') || v == "." || v == "..")
    {
        return Err("请填写包含所有者和仓库名的完整地址。".into());
    }
    // Provider identity requires the exact canonical host, never a substring.
    let provider = match host.as_str() {
        "gitee.com" => "gitee",
        "github.com" => "github",
        _ => "git",
    }
    .to_string();
    if provider != "git" && parsed.port().is_some() {
        return Err("GitHub / Gitee 地址不应使用自定义端口。".into());
    }
    Ok(Endpoint {
        url: parsed.to_string(),
        host,
        path,
        provider,
    })
}

pub(crate) fn command(root: &Path) -> Command {
    let mut cmd = git_accounts::hidden_command("git");
    cmd.arg("-C")
        .arg(root)
        .args([
            "-c",
            "core.quotepath=false",
            "-c",
            "credential.interactive=false",
            "-c",
            "core.askPass=",
            "-c",
            "http.followRedirects=false",
        ])
        .env("GIT_TERMINAL_PROMPT", "0")
        .env("GCM_INTERACTIVE", "never")
        .env("GIT_SSH_COMMAND", "ssh -o BatchMode=yes")
        .env_remove("GIT_ASKPASS")
        .env_remove("SSH_ASKPASS");
    for name in [
        "GIT_DIR",
        "GIT_WORK_TREE",
        "GIT_INDEX_FILE",
        "GIT_OBJECT_DIRECTORY",
        "GIT_ALTERNATE_OBJECT_DIRECTORIES",
        "GIT_COMMON_DIR",
        "GIT_CONFIG_PARAMETERS",
        "GIT_CONFIG_COUNT",
    ] {
        cmd.env_remove(name);
    }
    // Parent trace settings can write authorization/config values to log files.
    for (name, _) in std::env::vars_os() {
        let upper = name.to_string_lossy().to_ascii_uppercase();
        if upper.starts_with("GIT_TRACE")
            || upper == "GIT_CURL_VERBOSE"
            || upper.starts_with("GIT_CONFIG_KEY_")
            || upper.starts_with("GIT_CONFIG_VALUE_")
        {
            cmd.env_remove(name);
        }
    }
    cmd
}

/// Drains both pipes while waiting; large transfers cannot deadlock on stderr.
pub(crate) fn execute(mut cmd: Command) -> Result<Output, String> {
    let mut child = cmd
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|_| "无法启动 Git，请确认已安装 Git。")?;
    let stdout = child.stdout.take().ok_or("无法读取 Git 输出。")?;
    let stderr = child.stderr.take().ok_or("无法读取 Git 输出。")?;
    let read = |mut stream: Box<dyn Read + Send>| {
        let mut bytes = vec![];
        let mut overflow = false;
        let mut buffer = [0; 8192];
        while let Ok(n) = stream.read(&mut buffer) {
            if n == 0 {
                break;
            }
            if bytes.len() + n <= 1024 * 1024 { bytes.extend_from_slice(&buffer[..n]); }
            else { overflow = true; }
        }
        (bytes, overflow)
    };
    let out = thread::spawn(move || read(Box::new(stdout)));
    let err = thread::spawn(move || read(Box::new(stderr)));
    let start = Instant::now();
    let status = loop {
        if let Some(status) = child.try_wait().map_err(|_| "无法读取 Git 运行状态。")? {
            break status;
        }
        if start.elapsed() > Duration::from_secs(120) {
            #[cfg(windows)]
            {
                let _ = git_accounts::hidden_command("taskkill")
                    .args(["/PID", &child.id().to_string(), "/T", "/F"])
                    .output();
            }
            let _ = child.kill();
            let _ = child.wait();
            return Err("Git 操作超时。请检查网络，再刷新仓库状态后重试。".into());
        }
        thread::sleep(Duration::from_millis(30));
    };
    let (stdout, out_overflow) = out.join().map_err(|_| "无法读取 Git 输出。")?;
    let (stderr, err_overflow) = err.join().map_err(|_| "无法读取 Git 输出。")?;
    if out_overflow || err_overflow { return Err("Git 输出超过预览上限，已停止操作，未截断处理。".into()); }
    Ok(Output {
        status,
        stdout,
        stderr,
    })
}

pub(crate) fn run(root: &Path, args: &[&str]) -> Result<Output, String> {
    let mut cmd = command(root);
    cmd.args(args);
    execute(cmd)
}
pub(crate) fn text(root: &Path, args: &[&str]) -> Result<String, String> {
    let output = run(root, args)?;
    if !output.status.success() {
        return Err("无法读取 Git 仓库信息，请检查仓库状态与访问权限。".into());
    }
    Ok(String::from_utf8_lossy(&output.stdout).trim().to_string())
}
fn optional(root: &Path, args: &[&str]) -> Option<String> {
    text(root, args).ok().filter(|s| !s.is_empty())
}

pub(crate) fn repository(document_path: &str) -> Result<PathBuf, String> {
    let document = Path::new(document_path);
    if !document.is_file() || !crate::is_markdown_path(document) {
        return Err("请先打开已保存的 Markdown 文稿。".into());
    }
    let directory = document.parent().ok_or("文稿路径无效。")?;
    let root = text(directory, &["rev-parse", "--show-toplevel"])
        .map_err(|_| "未找到 Git 仓库。请先 git clone 仓库，或在版本管理中启用 Git。")?;
    PathBuf::from(root)
        .canonicalize()
        .map_err(|_| "仓库目录不可用。".into())
}

fn check_name(root: &Path, remote: &str) -> Result<(), String> {
    if remote.is_empty()
        || remote.starts_with('-')
        || !remote
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || "-_./".contains(c))
        || !run(
            root,
            &["check-ref-format", &format!("refs/remotes/{remote}/probe")],
        )?
        .status
        .success()
    {
        return Err("远程名称无效。".into());
    }
    Ok(())
}

pub(crate) fn branch(root: &Path) -> Result<String, String> {
    optional(root, &["symbolic-ref", "--quiet", "--short", "HEAD"])
        .ok_or("当前处于游离 HEAD，请先在 Git 中切换到一个分支。".into())
}

pub(crate) fn target_branch(root: &Path, remote: &str, branch: &str) -> Result<String, String> {
    let upstream_remote = optional(
        root,
        &["config", "--get", &format!("branch.{branch}.remote")],
    );
    let target = if upstream_remote.as_deref() == Some(remote) {
        optional(
            root,
            &["config", "--get", &format!("branch.{branch}.merge")],
        )
        .and_then(|value| value.strip_prefix("refs/heads/").map(str::to_owned))
        .unwrap_or_else(|| branch.into())
    } else {
        branch.into()
    };
    if !run(root, &["check-ref-format", &format!("refs/heads/{target}")])?
        .status
        .success()
    {
        return Err("目标分支无效。".into());
    }
    Ok(target)
}

fn endpoints(root: &Path, remote: &str) -> Result<(Endpoint, Endpoint), String> {
    check_name(root, remote)?;
    let fetch = text(root, &["remote", "get-url", "--all", remote])?;
    let push = text(root, &["remote", "get-url", "--push", "--all", remote])?;
    if fetch.lines().count() != 1 || push.lines().count() != 1 {
        return Err("此远程配置了多个地址，请在 Git 中整理为每个远程一个地址后重试。".into());
    }
    let pair = (parse_endpoint(&fetch)?, parse_endpoint(&push)?);
    if pair.0.host != pair.1.host
        || pair.0.path != pair.1.path
        || pair.0.url.starts_with("https://") != pair.1.url.starts_with("https://")
    {
        return Err("此远程的下载与上传目标不同，请为不同仓库分别配置远程名称。".into());
    }
    Ok(pair)
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RemoteInfo {
    name: String,
    fetch_url: String,
    push_url: String,
    host: String,
    provider: String,
    target_branch: String,
    ahead: Option<u64>,
    behind: Option<u64>,
    account_id: Option<String>,
    account_issue: Option<String>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RemoteRepository {
    repository_root: String,
    branch: Option<String>,
    has_commits: bool,
    dirty: bool,
    remotes: Vec<RemoteInfo>,
    default_remote: Option<String>,
    pub(crate) state_token: String,
    pub(crate) changed_paths: Vec<String>,
}

fn counts(root: &Path, tracking: &str) -> (Option<u64>, Option<u64>) {
    let value = optional(
        root,
        &[
            "rev-list",
            "--left-right",
            "--count",
            &format!("HEAD...{tracking}"),
        ],
    );
    let values: Vec<u64> = value
        .as_deref()
        .unwrap_or("")
        .split_whitespace()
        .filter_map(|s| s.parse().ok())
        .collect();
    if values.len() == 2 {
        (Some(values[0]), Some(values[1]))
    } else {
        (None, None)
    }
}

fn default_remote(root: &Path, current: Option<&str>, names: &[&str]) -> Option<String> {
    let upstream = current.and_then(|branch| optional(root, &["config", "--get", &format!("branch.{branch}.remote")]));
    match upstream {
        Some(name) => names.contains(&name.as_str()).then_some(name),
        None if names.len() == 1 => Some(names[0].to_owned()),
        _ => None,
    }
}

pub(crate) fn inspect(app: &AppHandle, root: &Path) -> Result<RemoteRepository, String> {
    let current = branch(root).ok();
    let head = optional(root, &["rev-parse", "--verify", "HEAD"]);
    let dirty = !text(root, &["status", "--porcelain=v1", "--untracked-files=all", "--ignore-submodules=none"])?.is_empty();
    let mut remotes = vec![];
    let mut signature = format!("{}\0{current:?}\0{head:?}", root.display());
    for name in text(root, &["remote"])?.lines() {
        let (fetch, push) = endpoints(root, name)?;
        let target = current
            .as_ref()
            .map(|b| target_branch(root, name, b))
            .transpose()?
            .unwrap_or_default();
        let (ahead, behind) = counts(root, &format!("refs/remotes/{name}/{target}"));
        let account = if push.url.starts_with("https://") {
            git_accounts::selected_account(app, root, name, &push.host)
        } else {
            Ok(None)
        };
        let (account_id, account_issue) = match account {
            Ok(value) => (value.map(|a| a.id), None),
            Err(error) => (None, Some(error)),
        };
        signature.push_str(&format!("\0{name}\0{}\0{}\0{target}", fetch.url, push.url));
        signature.push_str(&format!("\0{account_id:?}\0{account_issue:?}"));
        remotes.push(RemoteInfo {
            name: name.into(),
            fetch_url: fetch.url,
            push_url: push.url,
            host: push.host,
            provider: push.provider,
            target_branch: target,
            ahead,
            behind,
            account_id,
            account_issue,
        });
    }
    let default_remote = default_remote(root, current.as_deref(), &remotes.iter().map(|remote| remote.name.as_str()).collect::<Vec<_>>());
    signature.push_str(&format!("\0{default_remote:?}"));
    Ok(RemoteRepository {
        repository_root: root.to_string_lossy().into(),
        branch: current,
        has_commits: head.is_some(),
        dirty,
        remotes,
        default_remote,
        state_token: format!("{:x}", Sha256::digest(signature.as_bytes())),
        changed_paths: vec![],
    })
}

/// Scope the ephemeral header to the exact HTTPS repository, including path.
/// Values go through the child environment, never argv, repository config or disk.
fn https_credential(cmd: &mut Command, url: &str, login: &str, secret: &str) {
    let key = format!("http.{url}.extraHeader");
    let header = format!(
        "Authorization: Basic {}",
        STANDARD.encode(format!("{login}:{secret}"))
    );
    cmd.args(["-c", "credential.helper=", "-c", "http.saveCookies=false"])
        .env_remove("GIT_SSL_NO_VERIFY")
        .env("GIT_CONFIG_COUNT", "5")
        .env("GIT_CONFIG_KEY_0", &key)
        .env("GIT_CONFIG_VALUE_0", "")
        .env("GIT_CONFIG_KEY_1", key)
        .env("GIT_CONFIG_VALUE_1", header)
        .env("GIT_CONFIG_KEY_2", format!("http.{url}.followRedirects"))
        .env("GIT_CONFIG_VALUE_2", "false")
        .env("GIT_CONFIG_KEY_3", format!("http.{url}.cookieFile"))
        .env("GIT_CONFIG_VALUE_3", "")
        .env("GIT_CONFIG_KEY_4", format!("http.{url}.sslVerify"))
        .env("GIT_CONFIG_VALUE_4", "true");
}

fn transport(
    app: &AppHandle,
    root: &Path,
    remote: &str,
    endpoint: &Endpoint,
) -> Result<(Command, String), String> {
    let mut cmd = command(root);
    if !endpoint.url.starts_with("https://") {
        return Ok((cmd, endpoint.url.clone()));
    }
    let selected = git_accounts::selected_account(app, root, remote, &endpoint.host)?;
    if let Some(account) = selected {
        if !matches!(account.host.as_str(), "gitee.com" | "github.com")
            || endpoint.host != account.host
        {
            return Err("账号与仓库平台不匹配。".into());
        }
        // get-url already expands the remote once. Refuse a second rewrite before
        // attaching credentials; it could change the host, protocol or repository.
        if text(root, &["ls-remote", "--get-url", "--", &endpoint.url])? != endpoint.url {
            return Err("仓库地址存在额外 Git 重写规则，请整理地址后再使用保存的凭据。".into());
        }
        let secret = git_accounts::credential(&account)?;
        https_credential(&mut cmd, &endpoint.url, &account.login, &secret);
    }
    Ok((cmd, endpoint.url.clone()))
}

fn transfer_error(output: &Output) -> String {
    let message = String::from_utf8_lossy(&output.stderr).to_lowercase()
        + &String::from_utf8_lossy(&output.stdout).to_lowercase();
    if message.contains("non-fast-forward")
        || message.contains("fetch first")
        || message.contains("rejected")
    {
        "远程分支包含未合入的修改，或拒绝了此次上传。请先检查更新；软件不会强制覆盖远程历史。"
    } else if message.contains("host key verification")
        || message.contains("remote host identification")
    {
        "SSH 主机身份校验失败，请检查系统 SSH 配置与托管平台公告。"
    } else if message.contains("authentication")
        || message.contains("permission denied")
        || message.contains("could not read username")
        || message.contains("403")
    {
        "仓库认证失败。请检查登录账号、仓库成员权限，或现有 Git 凭据。"
    } else if message.contains("couldn't find remote ref") {
        "远程尚无此目标分支。空仓库可先上传本地已创建的版本。"
    } else {
        "Git 远程操作失败。请检查网络、仓库地址和访问权限，再刷新状态重试。"
    }
    .into()
}

pub(crate) fn ensure_clean(root: &Path) -> Result<(), String> {
    if !text(root, &["status", "--porcelain=v1", "--untracked-files=all", "--ignore-submodules=none"])?.is_empty() {
        return Err("仓库内仍有未提交或未跟踪的文件。请先保存并创建版本，再获取更新。".into());
    }
    for name in [
        "MERGE_HEAD",
        "CHERRY_PICK_HEAD",
        "REVERT_HEAD",
        "rebase-merge",
        "rebase-apply",
    ] {
        if let Some(path) = optional(root, &["rev-parse", "--git-path", name]) {
            let path = PathBuf::from(path);
            let path = if path.is_absolute() {
                path
            } else {
                root.join(path)
            };
            if path.exists() {
                return Err("仓库有尚未完成的合并或变基，请先在 Git 中处理。".into());
            }
        }
    }
    Ok(())
}

fn fast_forward(root: &Path, tracking: &str) -> Result<(), String> {
    ensure_clean(root)?;
    let (ahead, behind) = counts(root, tracking);
    if ahead.unwrap_or(0) > 0 && behind.unwrap_or(0) > 0 {
        return Err(
            "本地与远程都有独立修改，历史已经分叉。请在版本管理中点击“比较与合并”，处理后再同步。"
                .into(),
        );
    }
    let output = run(
        root,
        &[
            "-c",
            "merge.autoStash=false",
            "merge",
            "--ff-only",
            "--no-edit",
            tracking,
        ],
    )?;
    if !output.status.success() {
        return Err("无法安全更新。未执行自动合并，请在 Git 中检查仓库状态。".into());
    }
    Ok(())
}

fn fetch_branch(mut cmd: Command, url: &str, target: &str, tracking: &str) -> Result<(), String> {
    cmd.args([
        "fetch",
        "--no-tags",
        "--no-recurse-submodules",
        "--no-write-fetch-head",
        "--",
        url,
        &format!("+refs/heads/{target}:{tracking}"),
    ]);
    let output = execute(cmd)?;
    if !output.status.success() {
        return Err(transfer_error(&output));
    }
    Ok(())
}

fn push_branch(mut cmd: Command, url: &str, head: &str, target: &str) -> Result<(), String> {
    cmd.args([
        "-c",
        "push.followTags=false",
        "push",
        "--porcelain",
        "--recurse-submodules=no",
        "--",
        url,
        &format!("{head}:refs/heads/{target}"),
    ]);
    let output = execute(cmd)?;
    if !output.status.success() {
        return Err(transfer_error(&output));
    }
    Ok(())
}

#[tauri::command]
pub async fn inspect_remote_repository(
    app: AppHandle,
    document_path: String,
) -> Result<RemoteRepository, String> {
    tauri::async_runtime::spawn_blocking(move || inspect(&app, &repository(&document_path)?))
        .await
        .map_err(|_| "无法检查远程仓库。")?
}

#[tauri::command]
pub async fn add_git_remote(
    app: AppHandle,
    document_path: String,
    name: String,
    url: String,
) -> Result<RemoteRepository, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let _guard = REMOTE_OPERATION
            .lock()
            .map_err(|_| "另一个 Git 操作正在进行。")?;
        let root = repository(&document_path)?;
        check_name(&root, &name)?;
        let endpoint = parse_endpoint(url.trim())?;
        // Deliberately add-only: never overwrite an existing fetch/push destination.
        let output = run(&root, &["remote", "add", &name, &endpoint.url])?;
        if !output.status.success() {
            return Err("无法添加远程仓库。名称可能已存在，请换一个名称。".into());
        }
        inspect(&app, &root)
    })
    .await
    .map_err(|_| "无法连接仓库。")?
}

#[tauri::command]
pub async fn bind_git_remote_account(
    app: AppHandle,
    document_path: String,
    remote: String,
    account_id: String,
) -> Result<RemoteRepository, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let _guard = REMOTE_OPERATION
            .lock()
            .map_err(|_| "另一个 Git 操作正在进行。")?;
        let root = repository(&document_path)?;
        let (_, endpoint) = endpoints(&root, &remote)?;
        if account_id != "system" && !endpoint.url.starts_with("https://") {
            return Err("SSH 仓库使用系统 SSH 身份。保存的账号凭据适用于 HTTPS 仓库。".into());
        }
        git_accounts::bind(&app, &root, &remote, &endpoint.host, &account_id)?;
        inspect(&app, &root)
    })
    .await
    .map_err(|_| "无法选择账号。")?
}

#[tauri::command]
pub async fn sync_git_remote(
    app: AppHandle,
    document_path: String,
    remote: String,
    action: String,
    state_token: String,
) -> Result<RemoteRepository, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let _guard = REMOTE_OPERATION
            .lock()
            .map_err(|_| "另一个 Git 操作正在进行。")?;
        let root = repository(&document_path)?;
        let before = inspect(&app, &root)?;
        if before.state_token != state_token {
            return Err("仓库或分支已改变，请刷新后重试。".into());
        }
        let current_branch = branch(&root)?;
        if !before.has_commits {
            return Err("请先创建一个本地版本。".into());
        }
        let starting_head = text(&root, &["rev-parse", "HEAD"])?;
        let target = target_branch(&root, &remote, &current_branch)?;
        let (fetch, push) = endpoints(&root, &remote)?;
        let tracking = format!("refs/remotes/{remote}/{target}");
        match action.as_str() {
            "fetch" | "pull" => {
                if action == "pull" {
                    ensure_clean(&root)?;
                }
                let (cmd, url) = transport(&app, &root, &remote, &fetch)?;
                fetch_branch(cmd, &url, &target, &tracking)?;
                if action == "pull" {
                    if inspect(&app, &root)?.state_token != before.state_token {
                        return Err("下载期间仓库或分支已改变，请刷新后重试。".into());
                    }
                    fast_forward(&root, &tracking)?;
                }
            }
            "push" => {
                let (cmd, url) = transport(&app, &root, &remote, &push)?;
                // Explicit one-branch refspec, no force/mirror/tags, irrespective of user defaults.
                push_branch(cmd, &url, &starting_head, &target)?;
                // Update this tracking ref only after the server confirms the push.
                let _ = run(&root, &["update-ref", &tracking, &starting_head]);
            }
            _ => return Err("不支持的同步操作。".into()),
        }
        let mut result = inspect(&app, &root)?;
        if action == "pull" {
            let output = run(
                &root,
                &["diff", "--name-only", "-z", &starting_head, "HEAD", "--"],
            )?;
            if output.status.success() {
                result.changed_paths = output
                    .stdout
                    .split(|byte| *byte == 0)
                    .filter(|path| !path.is_empty())
                    .map(|path| {
                        root.join(String::from_utf8_lossy(path).as_ref())
                            .to_string_lossy()
                            .into()
                    })
                    .collect();
            }
        }
        Ok(result)
    })
    .await
    .map_err(|_| "Git 同步任务失败。")?
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn credentials_only_match_the_selected_repository_and_never_enter_argv() {
        let root = std::env::temp_dir();
        let scope = "https://gitee.com/team/paper.git";
        let fake = "test-only-secret";
        for (url, expected) in [
            (scope, true),
            ("https://gitee.com/team/paper.git/info/refs", true),
            ("https://github.com/team/paper.git", false),
            ("https://gitee.com.evil.example/team/paper.git", false),
            ("https://gitee.com/team/paper.git-other", false),
            ("https://gitee.com/other/paper.git", false),
            ("http://gitee.com/team/paper.git", false),
        ] {
            let mut cmd = command(&root);
            https_credential(&mut cmd, scope, "alice", fake);
            assert!(cmd
                .get_args()
                .all(|arg| !arg.to_string_lossy().contains(fake)));
            cmd.args(["config", "--get-urlmatch", "http.extraHeader", url]);
            let output = execute(cmd).unwrap();
            assert_eq!(
                String::from_utf8_lossy(&output.stdout)
                    .contains(&STANDARD.encode(format!("alice:{fake}"))),
                expected
            );
        }
    }

    #[test]
    fn real_http_transfer_uses_selected_credential_and_refuses_redirects() {
        use std::io::Write;
        use std::net::TcpListener;
        // Loopback and fake credentials only; no external account is contacted.
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let redirected = TcpListener::bind("127.0.0.1:0").unwrap();
        listener.set_nonblocking(true).unwrap();
        redirected.set_nonblocking(true).unwrap();
        let url = format!("http://{}/team/paper.git", listener.local_addr().unwrap());
        let destination = format!("http://{}/other/repo.git", redirected.local_addr().unwrap());
        let server = thread::spawn(move || {
            let start = Instant::now();
            let mut stream = loop {
                if let Ok((stream, _)) = listener.accept() {
                    break stream;
                }
                assert!(
                    start.elapsed() < Duration::from_secs(10),
                    "Git did not reach loopback"
                );
                thread::sleep(Duration::from_millis(10));
            };
            stream
                .set_read_timeout(Some(Duration::from_secs(3)))
                .unwrap();
            let mut request = Vec::new();
            while !request.ends_with(b"\r\n\r\n") {
                let mut byte = [0];
                stream.read_exact(&mut byte).unwrap();
                request.push(byte[0]);
                assert!(request.len() < 16384);
            }
            write!(stream, "HTTP/1.1 302 Found\r\nLocation: {destination}\r\nContent-Length: 0\r\nConnection: close\r\n\r\n").unwrap();
            String::from_utf8(request).unwrap()
        });
        let mut cmd = command(&std::env::temp_dir());
        https_credential(&mut cmd, &url, "alice", "test-only-secret");
        // Ignore machine HTTP proxy configuration for this isolated loopback test.
        cmd.args(["-c", "http.proxy=", "ls-remote", "--", &url]);
        let output = execute(cmd).unwrap();
        let request = server.join().unwrap();
        assert!(request.contains(&format!(
            "Authorization: Basic {}",
            STANDARD.encode("alice:test-only-secret")
        )));
        assert!(!output.status.success());
        assert!(
            redirected.accept().is_err(),
            "Redirect must never receive the credential"
        );
        assert!(!transfer_error(&output).contains("test-only-secret"));
    }

    #[test]
    fn real_transfer_rejects_stale_push_and_finds_clones_and_worktrees() {
        let base =
            std::env::temp_dir().join(format!("hakurou-transfer-test-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&base).unwrap();
        let git = |root: &Path, args: &[&str]| {
            let output = run(root, args).unwrap();
            assert!(
                output.status.success(),
                "{}",
                String::from_utf8_lossy(&output.stderr)
            );
        };
        git(&base, &["init", "--bare", "-b", "main", "remote.git"]);
        git(&base, &["clone", "remote.git", "first"]);
        let first = base.join("first");
        let remote = base.join("remote.git").to_string_lossy().replace('\\', "/");
        for root in [&first] {
            git(root, &["config", "user.name", "Test"]);
            git(root, &["config", "user.email", "test@example.invalid"]);
        }
        std::fs::write(first.join("paper.md"), "base\n").unwrap();
        git(&first, &["add", "."]);
        git(&first, &["commit", "-m", "base"]);
        push_branch(
            command(&first),
            &remote,
            &text(&first, &["rev-parse", "HEAD"]).unwrap(),
            "main",
        )
        .unwrap();
        git(&base, &["clone", "remote.git", "second"]);
        let second = base.join("second");
        assert_eq!(
            repository(second.join("paper.md").to_str().unwrap()).unwrap(),
            second.canonicalize().unwrap()
        );
        std::fs::write(first.join("paper.md"), "first writer\n").unwrap();
        git(&first, &["commit", "-am", "first writer"]);
        let newest = text(&first, &["rev-parse", "HEAD"]).unwrap();
        push_branch(command(&first), &remote, &newest, "main").unwrap();
        fetch_branch(
            command(&second),
            &remote,
            "main",
            "refs/remotes/origin/main",
        )
        .unwrap();
        assert_eq!(
            std::fs::read_to_string(second.join("paper.md")).unwrap(),
            "base\n",
            "fetch is read-only for the manuscript"
        );
        fast_forward(&second, "refs/remotes/origin/main").unwrap();
        assert_eq!(
            std::fs::read_to_string(second.join("paper.md")).unwrap(),
            "first writer\n"
        );
        git(&second, &["config", "user.name", "Test"]);
        git(&second, &["config", "user.email", "test@example.invalid"]);
        std::fs::write(second.join("paper.md"), "second writer\n").unwrap();
        git(&second, &["commit", "-am", "second writer"]);
        std::fs::write(first.join("paper.md"), "new first writer\n").unwrap();
        git(&first, &["commit", "-am", "new first writer"]);
        let newest = text(&first, &["rev-parse", "HEAD"]).unwrap();
        push_branch(command(&first), &remote, &newest, "main").unwrap();
        assert!(push_branch(
            command(&second),
            &remote,
            &text(&second, &["rev-parse", "HEAD"]).unwrap(),
            "main"
        )
        .is_err());
        assert_eq!(
            text(&base.join("remote.git"), &["rev-parse", "main"]).unwrap(),
            newest
        );
        let worktree = base.join("review");
        git(
            &first,
            &[
                "worktree",
                "add",
                "-b",
                "review",
                worktree.to_str().unwrap(),
            ],
        );
        assert!(worktree.join(".git").is_file());
        assert_eq!(
            repository(worktree.join("paper.md").to_str().unwrap()).unwrap(),
            worktree.canonicalize().unwrap()
        );
        std::fs::remove_dir_all(base).unwrap();
    }
    #[test]
    fn addresses_are_provider_scoped_and_never_include_credentials() {
        assert_eq!(
            parse_endpoint("https://gitee.com/team/paper.git")
                .unwrap()
                .provider,
            "gitee"
        );
        assert_eq!(
            parse_endpoint("git@github.com:team/paper.git")
                .unwrap()
                .provider,
            "github"
        );
        assert_eq!(
            parse_endpoint("https://gitee.com.evil.example/team/paper")
                .unwrap()
                .provider,
            "git"
        );
        for value in [
            "https://user:secret@gitee.com/a/b",
            "https://gitee.com/a/b?token=x",
            "ext::sh -c command",
            "file:///tmp/repo",
            "-oProxyCommand=bad",
            "ssh://git@gitee.com/a/%2e%2e",
            "https://gitee.com/a/b\n",
        ] {
            assert!(parse_endpoint(value).is_err(), "{value}");
        }
    }

    #[test]
    fn menu_pull_selects_the_configured_upstream_without_guessing_between_remotes() {
        let root = std::env::temp_dir().join(format!("hakurou-upstream-test-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&root).unwrap();
        assert!(run(&root, &["init", "-b", "main"]).unwrap().status.success());
        assert_eq!(default_remote(&root, Some("main"), &["origin"]), Some("origin".into()));
        assert_eq!(default_remote(&root, Some("main"), &["origin", "team"]), None);
        assert!(run(&root, &["config", "branch.main.remote", "team"]).unwrap().status.success());
        assert!(run(&root, &["config", "branch.main.merge", "refs/heads/writing"]).unwrap().status.success());
        assert_eq!(default_remote(&root, Some("main"), &["origin", "team"]), Some("team".into()));
        assert_eq!(target_branch(&root, "team", "main").unwrap(), "writing");
        assert_eq!(default_remote(&root, Some("main"), &["origin"]), None);
        assert!(run(&root, &["config", "branch.main.remote", "."]).unwrap().status.success());
        assert_eq!(default_remote(&root, Some("main"), &["origin"]), None);
        std::fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn real_git_fast_forward_preserves_dirty_and_divergent_work() {
        let root =
            std::env::temp_dir().join(format!("hakurou-remote-test-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&root).unwrap();
        let git = |args: &[&str]| {
            let output = run(&root, args).unwrap();
            assert!(
                output.status.success(),
                "{}",
                String::from_utf8_lossy(&output.stderr)
            );
        };
        git(&["init", "-b", "main"]);
        git(&["config", "user.name", "Test"]);
        git(&["config", "user.email", "test@example.invalid"]);
        std::fs::write(root.join("paper.md"), "base\n").unwrap();
        git(&["add", "."]);
        git(&["commit", "-m", "base"]);
        git(&["checkout", "-b", "remote-work"]);
        std::fs::write(root.join("paper.md"), "remote\n").unwrap();
        git(&["commit", "-am", "remote"]);
        git(&["update-ref", "refs/remotes/origin/main", "HEAD"]);
        git(&["checkout", "main"]);
        std::fs::write(root.join("paper.md"), "unsaved local\n").unwrap();
        assert!(fast_forward(&root, "refs/remotes/origin/main").is_err());
        assert_eq!(
            std::fs::read_to_string(root.join("paper.md")).unwrap(),
            "unsaved local\n"
        );
        git(&["checkout", "--", "paper.md"]);
        fast_forward(&root, "refs/remotes/origin/main").unwrap();
        assert_eq!(
            std::fs::read_to_string(root.join("paper.md")).unwrap(),
            "remote\n"
        );
        git(&["checkout", "remote-work"]);
        std::fs::write(root.join("paper.md"), "remote again\n").unwrap();
        git(&["commit", "-am", "remote again"]);
        git(&["update-ref", "refs/remotes/origin/main", "HEAD"]);
        git(&["checkout", "main"]);
        std::fs::write(root.join("paper.md"), "local commit\n").unwrap();
        git(&["commit", "-am", "local"]);
        let head = text(&root, &["rev-parse", "HEAD"]).unwrap();
        assert!(fast_forward(&root, "refs/remotes/origin/main")
            .unwrap_err()
            .contains("分叉"));
        assert_eq!(text(&root, &["rev-parse", "HEAD"]).unwrap(), head);
        assert_eq!(
            std::fs::read_to_string(root.join("paper.md")).unwrap(),
            "local commit\n"
        );
        std::fs::remove_dir_all(root).unwrap();
    }
}
