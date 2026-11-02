//! Public account metadata lives locally; HTTPS secrets live only in the OS vault.
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::{
    collections::BTreeMap,
    fs,
    path::{Path, PathBuf},
    process::Command,
    sync::Mutex,
};
use tauri::{AppHandle, Manager};

static ACCOUNTS_LOCK: Mutex<()> = Mutex::new(());

#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GitAccount {
    pub id: String,
    pub host: String,
    pub login: String,
}

#[derive(Serialize, Deserialize)]
struct AccountStore {
    schema_version: u32,
    accounts: Vec<GitAccount>,
    bindings: BTreeMap<String, String>,
}
impl Default for AccountStore {
    fn default() -> Self {
        Self {
            schema_version: 1,
            accounts: vec![],
            bindings: BTreeMap::new(),
        }
    }
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AccountStatus {
    accounts: Vec<GitAccount>,
    credential_storage_available: bool,
}

pub(crate) fn hidden_command(program: &str) -> Command {
    let mut command = Command::new(program);
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        command.creation_flags(windows_sys::Win32::System::Threading::CREATE_NO_WINDOW);
    }
    command
}

fn store_root(app: &AppHandle) -> Result<PathBuf, String> {
    Ok(app
        .path()
        .app_local_data_dir()
        .map_err(|_| "无法定位本机账号目录。")?
        .join("git-accounts"))
}

fn read_store(root: &Path) -> Result<AccountStore, String> {
    // Separate from the unpublished OAuth prototype; never overwrite its records.
    let path = root.join("credentials.json");
    if !path.exists() {
        return Ok(AccountStore::default());
    }
    let store: AccountStore =
        serde_json::from_slice(&fs::read(path).map_err(|_| "无法读取本机账号。")?)
            .map_err(|_| "本机账号记录无法解析，请勿覆盖原记录。")?;
    if store.schema_version != 1 {
        return Err("本机账号记录版本不受支持。".into());
    }
    for account in &store.accounts {
        if account.id != account_metadata(&account.host, &account.login)?.id {
            return Err("本机账号记录无效，请勿覆盖原记录。".into());
        }
    }
    Ok(store)
}

fn write_store(root: &Path, store: &AccountStore) -> Result<(), String> {
    fs::create_dir_all(root).map_err(|_| "无法创建本机账号目录。")?;
    let temp = root.join("credentials.json.tmp");
    fs::write(
        &temp,
        serde_json::to_vec_pretty(store).map_err(|_| "无法保存账号。")?,
    )
    .map_err(|_| "无法保存账号。")?;
    fs::rename(temp, root.join("credentials.json")).map_err(|_| "无法保存账号记录。".into())
}

fn account_metadata(host: &str, login: &str) -> Result<GitAccount, String> {
    let host = host.trim().to_ascii_lowercase();
    let login = login.trim().to_ascii_lowercase();
    if !matches!(host.as_str(), "gitee.com" | "github.com") {
        return Err("暂只支持保存 Gitee 和 GitHub 的 HTTPS 凭据。".into());
    }
    if login.is_empty()
        || login.len() > 128
        || !login
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || "-_.".contains(c))
    {
        return Err("请填写账号个人主页中的用户名，不要填写昵称、邮箱或仓库地址。".into());
    }
    let id = format!(
        "{:x}",
        Sha256::digest(format!("{host}\0{login}").as_bytes())
    );
    Ok(GitAccount { id, host, login })
}

fn credential_target(account: &GitAccount) -> String {
    format!("HakurouPaper:git:https:{}", account.id)
}

#[cfg(windows)]
mod vault {
    use windows_sys::Win32::{
        Foundation::{GetLastError, ERROR_NOT_FOUND},
        Security::Credentials::*,
    };
    fn wide(value: &str) -> Vec<u16> {
        value.encode_utf16().chain(Some(0)).collect()
    }

    pub fn write(target: &str, login: &str, secret: &str) -> Result<(), String> {
        let mut target = wide(target);
        let mut login = wide(login);
        let mut bytes = secret.as_bytes().to_vec();
        let credential = CREDENTIALW {
            Type: CRED_TYPE_GENERIC,
            TargetName: target.as_mut_ptr(),
            UserName: login.as_mut_ptr(),
            CredentialBlobSize: bytes.len() as u32,
            CredentialBlob: bytes.as_mut_ptr(),
            Persist: CRED_PERSIST_LOCAL_MACHINE,
            ..unsafe { std::mem::zeroed() }
        };
        // All buffers outlive this synchronous call; no secret is passed to a process.
        let success = unsafe { CredWriteW(&credential, 0) } != 0;
        bytes.fill(0);
        if success {
            Ok(())
        } else {
            Err("无法保存到 Windows 凭据管理器，请检查当前用户会话。".into())
        }
    }

    pub fn read(target: &str) -> Result<Option<String>, String> {
        let target = wide(target);
        let mut credential: *mut CREDENTIALW = std::ptr::null_mut();
        if unsafe { CredReadW(target.as_ptr(), CRED_TYPE_GENERIC, 0, &mut credential) } == 0 {
            return if unsafe { GetLastError() } == ERROR_NOT_FOUND {
                Ok(None)
            } else {
                Err("无法读取 Windows 凭据管理器。".into())
            };
        }
        // CredReadW allocates the buffer. Copy its bounded blob before CredFree.
        let result = unsafe {
            let size = (*credential).CredentialBlobSize as usize;
            if size == 0 || size > 2560 || (*credential).CredentialBlob.is_null() {
                Err("保存的 Git 凭据无效，请重新填写。".into())
            } else {
                String::from_utf8(
                    std::slice::from_raw_parts((*credential).CredentialBlob, size).to_vec(),
                )
                .map(Some)
                .map_err(|_| "保存的 Git 凭据无效，请重新填写。".into())
            }
        };
        unsafe { CredFree(credential.cast()) };
        result
    }

    pub fn delete(target: &str) -> Result<(), String> {
        let target = wide(target);
        if unsafe { CredDeleteW(target.as_ptr(), CRED_TYPE_GENERIC, 0) } != 0
            || unsafe { GetLastError() } == ERROR_NOT_FOUND
        {
            Ok(())
        } else {
            Err("无法移除 Windows 中保存的 Git 凭据。".into())
        }
    }
}

#[cfg(not(windows))]
mod vault {
    const UNAVAILABLE: &str = "此平台暂未启用凭据保存，请使用系统 Git / SSH 身份。";
    pub fn write(_: &str, _: &str, _: &str) -> Result<(), String> {
        Err(UNAVAILABLE.into())
    }
    pub fn read(_: &str) -> Result<Option<String>, String> {
        Err(UNAVAILABLE.into())
    }
    pub fn delete(_: &str) -> Result<(), String> {
        Err(UNAVAILABLE.into())
    }
}

fn save(root: &Path, host: &str, login: &str, secret: &str) -> Result<GitAccount, String> {
    let account = account_metadata(host, login)?;
    if secret.is_empty() || secret.len() > 2560 || secret.chars().any(char::is_control) {
        return Err("请输入有效的 Git 密码或访问令牌。".into());
    }
    let mut store = read_store(root)?;
    let target = credential_target(&account);
    let previous = vault::read(&target)?;
    vault::write(&target, &account.login, secret)?;
    store.accounts.retain(|old| old.id != account.id);
    store.accounts.push(account.clone());
    if let Err(error) = write_store(root, &store) {
        let rollback = match previous {
            Some(old) => vault::write(&target, &account.login, &old),
            None => vault::delete(&target),
        };
        return Err(if rollback.is_ok() {
            error
        } else {
            "账号记录保存失败，凭据仍可能保留在 Windows 凭据管理器的 HakurouPaper 项下。".into()
        });
    }
    Ok(account)
}

fn binding_key(root: &Path, remote: &str, host: &str) -> String {
    format!(
        "{:x}",
        Sha256::digest(format!("{}\0{remote}\0{host}", root.to_string_lossy()).as_bytes())
    )
}

fn select(
    store: &AccountStore,
    root: &Path,
    remote: &str,
    host: &str,
) -> Result<Option<GitAccount>, String> {
    let binding = store.bindings.get(&binding_key(root, remote, host));
    if binding.is_some_and(|id| id == "system") {
        return Ok(None);
    }
    let candidates: Vec<_> = store.accounts.iter().filter(|a| a.host == host).collect();
    let selected = if let Some(id) = binding {
        candidates
            .iter()
            .find(|a| &a.id == id)
            .copied()
            .ok_or("所选账号已移除，请重新选择账号。")?
    } else if candidates.len() == 1 {
        candidates[0]
    } else if candidates.is_empty() {
        return Ok(None);
    } else {
        return Err("此平台有多个账号，请先为当前仓库选择账号。".into());
    };
    Ok(Some(selected.clone()))
}

pub(crate) fn selected_account(
    app: &AppHandle,
    root: &Path,
    remote: &str,
    host: &str,
) -> Result<Option<GitAccount>, String> {
    let _guard = ACCOUNTS_LOCK.lock().map_err(|_| "账号记录正在使用。")?;
    select(&read_store(&store_root(app)?)?, root, remote, host)
}

pub(crate) fn credential(account: &GitAccount) -> Result<String, String> {
    vault::read(&credential_target(account))?.ok_or("此账号的本机凭据已丢失，请更新凭据。".into())
}

pub(crate) fn bind(
    app: &AppHandle,
    root: &Path,
    remote: &str,
    host: &str,
    id: &str,
) -> Result<(), String> {
    let _guard = ACCOUNTS_LOCK.lock().map_err(|_| "账号记录正在使用。")?;
    let local = store_root(app)?;
    let mut store = read_store(&local)?;
    if id != "system" && !store.accounts.iter().any(|a| a.id == id && a.host == host) {
        return Err("账号与目标托管平台不匹配。".into());
    }
    store
        .bindings
        .insert(binding_key(root, remote, host), id.into());
    write_store(&local, &store)
}

#[tauri::command]
pub async fn inspect_git_accounts(app: AppHandle) -> Result<AccountStatus, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let _guard = ACCOUNTS_LOCK.lock().map_err(|_| "账号记录正在使用。")?;
        Ok(AccountStatus {
            accounts: read_store(&store_root(&app)?)?.accounts,
            credential_storage_available: cfg!(windows),
        })
    })
    .await
    .map_err(|_| "无法读取账号。")?
}

#[tauri::command]
pub async fn save_git_account(
    app: AppHandle,
    host: String,
    login: String,
    secret: String,
) -> Result<GitAccount, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let _guard = ACCOUNTS_LOCK.lock().map_err(|_| "账号记录正在使用。")?;
        save(&store_root(&app)?, &host, &login, &secret)
    })
    .await
    .map_err(|_| "无法保存 Git 凭据。")?
}

#[tauri::command]
pub async fn remove_git_account(app: AppHandle, account_id: String) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || {
        let _guard = ACCOUNTS_LOCK.lock().map_err(|_| "账号记录正在使用。")?;
        let root = store_root(&app)?;
        let mut store = read_store(&root)?;
        if let Some(account) = store.accounts.iter().find(|a| a.id == account_id) {
            vault::delete(&credential_target(account))?;
        }
        store.accounts.retain(|a| a.id != account_id);
        // Keep explicit bindings: removal must not silently switch a repository to another identity.
        write_store(&root, &store)
    })
    .await
    .map_err(|_| "无法移除账号。")?
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn accounts_are_host_scoped_and_bindings_fail_closed() {
        let first = account_metadata("gitee.com", "Alice").unwrap();
        let github = account_metadata("github.com", "alice").unwrap();
        assert_ne!(first.id, github.id);
        assert_eq!(first.id, account_metadata("GITEE.COM", "alice").unwrap().id);
        assert!(account_metadata("gitee.com.evil.example", "alice").is_err());
        assert!(account_metadata("gitee.com", "user:secret").is_err());
        let root = Path::new("paper");
        let mut store = AccountStore::default();
        store.accounts.extend([first.clone(), github]);
        assert_eq!(
            select(&store, root, "origin", "gitee.com")
                .unwrap()
                .unwrap()
                .id,
            first.id
        );
        store
            .accounts
            .push(account_metadata("gitee.com", "bob").unwrap());
        assert!(select(&store, root, "origin", "gitee.com").is_err());
        store
            .bindings
            .insert(binding_key(root, "origin", "gitee.com"), first.id.clone());
        assert_eq!(
            select(&store, root, "origin", "gitee.com")
                .unwrap()
                .unwrap()
                .id,
            first.id
        );
        assert!(select(&store, root, "other", "gitee.com").is_err());
        store.accounts.retain(|a| a.id != first.id);
        assert!(select(&store, root, "origin", "gitee.com").is_err());
        store
            .bindings
            .insert(binding_key(root, "origin", "gitee.com"), "system".into());
        assert!(select(&store, root, "origin", "gitee.com")
            .unwrap()
            .is_none());
    }

    #[cfg(windows)]
    #[test]
    fn windows_vault_roundtrip_and_metadata_never_store_secret() {
        let unique = uuid::Uuid::new_v4().simple().to_string();
        let root = std::env::temp_dir().join(format!("hakurou-credential-test-{unique}"));
        let account = account_metadata("gitee.com", &format!("test-{unique}")).unwrap();
        let target = credential_target(&account);
        // This target is unique to this test. Never enumerate or access user credentials.
        struct Cleanup(PathBuf, String);
        impl Drop for Cleanup {
            fn drop(&mut self) {
                let _ = vault::delete(&self.1);
                let _ = fs::remove_dir_all(&self.0);
            }
        }
        let _cleanup = Cleanup(root.clone(), target.clone());
        let secret = "test-only-password-密钥";
        save(&root, &account.host, &account.login, secret).unwrap();
        assert!(credential(&account).unwrap() == secret);
        let metadata = fs::read_to_string(root.join("credentials.json")).unwrap();
        assert!(!metadata.contains(secret));
        save(
            &root,
            &account.host,
            &account.login,
            "replacement-test-password",
        )
        .unwrap();
        assert_eq!(read_store(&root).unwrap().accounts.len(), 1);
        assert!(credential(&account).unwrap() == "replacement-test-password");
        vault::delete(&target).unwrap();
        assert!(credential(&account).is_err());
    }
}
