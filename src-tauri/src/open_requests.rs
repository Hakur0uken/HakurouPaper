use std::{ffi::OsString, path::Path, sync::Mutex};
use tauri::{Emitter, Manager, State};

// Keep paths until the renderer subscribes: a startup event alone can be lost
// while the WebView and editor are still loading.
#[derive(Default)]
pub(crate) struct OpenRequests(Mutex<Vec<String>>);

impl OpenRequests {
    pub(crate) fn from_process() -> Self {
        let cwd = std::env::current_dir().unwrap_or_default();
        Self(Mutex::new(markdown_paths(
            std::env::args_os().skip(1),
            &cwd,
        )))
    }
}

fn markdown_paths(args: impl IntoIterator<Item = impl Into<OsString>>, cwd: &Path) -> Vec<String> {
    let mut paths = Vec::new();
    for arg in args {
        let arg = arg.into();
        let path = Path::new(&arg);
        if !crate::is_markdown_path(path) {
            continue;
        }
        let path = if path.is_absolute() {
            path.to_path_buf()
        } else {
            cwd.join(path)
        };
        // Do not require existence here: the normal open flow reports unreadable
        // or missing documents to the user instead of silently dropping them.
        let path = path.to_string_lossy().into_owned();
        if !paths.contains(&path) {
            paths.push(path);
        }
    }
    paths
}

pub(crate) fn enqueue(app: &tauri::AppHandle, args: impl IntoIterator<Item = String>, cwd: &Path) {
    let state = app.state::<OpenRequests>();
    let mut pending = state.0.lock().unwrap_or_else(|error| error.into_inner());
    pending.extend(markdown_paths(args, cwd));
    drop(pending);
    let _ = app.emit("open-markdown-requested", ());
}

#[tauri::command]
pub(crate) fn take_open_markdown_requests(state: State<'_, OpenRequests>) -> Vec<String> {
    std::mem::take(&mut *state.0.lock().unwrap_or_else(|error| error.into_inner()))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn shell_paths_preserve_spaces_unicode_and_resolve_against_sender_directory() {
        let cwd = std::env::temp_dir().join("启动目录");
        let absolute = cwd.join("英文 paper.MD").to_string_lossy().into_owned();
        let paths = markdown_paths(
            [
                absolute.clone(),
                "子目录/论文.markdown".into(),
                "notes.mdx".into(),
            ],
            &cwd,
        );
        assert_eq!(
            paths,
            vec![
                absolute,
                cwd.join("子目录/论文.markdown")
                    .to_string_lossy()
                    .into_owned(),
                cwd.join("notes.mdx").to_string_lossy().into_owned()
            ]
        );
    }

    #[test]
    fn ignores_unrelated_arguments_and_deduplicates_without_requiring_existing_files() {
        let cwd = std::env::temp_dir();
        let paths = markdown_paths(
            [
                "--flag",
                "image.png",
                "missing.md",
                "missing.md",
                "UPPER.MARKDOWN",
            ],
            &cwd,
        );
        assert_eq!(paths.len(), 2);
        assert_eq!(paths[0], cwd.join("missing.md").to_string_lossy());
        assert_eq!(paths[1], cwd.join("UPPER.MARKDOWN").to_string_lossy());
    }
}
