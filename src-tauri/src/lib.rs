use std::path::Path;

fn is_markdown_path(path: &Path) -> bool {
    matches!(
        path.extension().and_then(|extension| extension.to_str()),
        Some("md" | "markdown" | "mdx")
    )
}

#[tauri::command]
fn read_markdown(path: String) -> Result<String, String> {
    let path = Path::new(&path);
    if !is_markdown_path(path) {
        return Err("只能打开 Markdown 文件。".into());
    }

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

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .invoke_handler(tauri::generate_handler![read_markdown, write_markdown])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
