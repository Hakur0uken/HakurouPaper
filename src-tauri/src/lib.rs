use std::path::Path;
use tauri::{menu::{MenuBuilder, MenuItemBuilder, SubmenuBuilder}, Emitter};

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
        .menu(|app| {
            let new_document = MenuItemBuilder::with_id("new-document", "New")
                .accelerator("Ctrl+N")
                .build(app)?;
            let open_document = MenuItemBuilder::with_id("open-document", "Open…")
                .accelerator("Ctrl+O")
                .build(app)?;
            let save_document = MenuItemBuilder::with_id("save-document", "Save")
                .accelerator("Ctrl+S")
                .build(app)?;
            let close_document = MenuItemBuilder::with_id("close-document", "Close Document")
                .accelerator("Ctrl+W")
                .build(app)?;
            let toggle_sidebar = MenuItemBuilder::with_id("toggle-sidebar", "Document Panel")
                .accelerator("Ctrl+Shift+B")
                .build(app)?;

            let file_menu = SubmenuBuilder::new(app, "File")
                .items(&[&new_document, &open_document, &save_document])
                .separator()
                .item(&close_document)
                .build()?;
            let edit_menu = SubmenuBuilder::new(app, "Edit")
                .undo()
                .redo()
                .separator()
                .cut()
                .copy()
                .paste()
                .build()?;
            let view_menu = SubmenuBuilder::new(app, "View")
                .item(&toggle_sidebar)
                .build()?;
            let window_menu = SubmenuBuilder::new(app, "Window").build()?;
            let help_menu = SubmenuBuilder::new(app, "Help").build()?;

            MenuBuilder::new(app)
                .items(&[&file_menu, &edit_menu, &view_menu, &window_menu, &help_menu])
                .build()
        })
        .on_menu_event(|app, event| {
            let command = match event.id() {
                id if id == "new-document" => Some("new-document"),
                id if id == "open-document" => Some("open-document"),
                id if id == "save-document" => Some("save-document"),
                id if id == "close-document" => Some("close-document"),
                id if id == "toggle-sidebar" => Some("toggle-sidebar"),
                _ => None,
            };

            if let Some(command) = command {
                let _ = app.emit("hakurou://menu-command", command);
            }
        })
        .invoke_handler(tauri::generate_handler![read_markdown, write_markdown])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
