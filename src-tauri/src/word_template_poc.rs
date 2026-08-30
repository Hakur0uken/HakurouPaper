use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::{
    ffi::OsStr,
    io::Write,
    path::{Path, PathBuf},
    process::Stdio,
};

use crate::{hidden_process_command, pandoc};

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WordTemplatePocExportInput {
    template_path: String,
    output_path: String,
    document_path: String,
    content: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WordTemplatePocInspection {
    inspection: Value,
    report_path: String,
}

fn resolve_helper() -> Result<PathBuf, String> {
    if let Ok(configured) = std::env::var("HAKUROU_WORD_TEMPLATE_POC") {
        let configured = PathBuf::from(configured);
        if configured.is_file() {
            return Ok(configured);
        }
        return Err(format!(
            "HAKUROU_WORD_TEMPLATE_POC 指向的 helper 不存在：{}",
            configured.display()
        ));
    }

    let binary = if cfg!(windows) {
        "Hakurou.WordTemplatePoc.exe"
    } else {
        "Hakurou.WordTemplatePoc"
    };
    if let Ok(executable) = std::env::current_exe() {
        if let Some(directory) = executable.parent() {
            let candidates = [
                directory.join("word-template-poc").join(binary),
                directory
                    .join("..")
                    .join("..")
                    .join("..")
                    .join("tools")
                    .join("word-template-poc")
                    .join("bin")
                    .join("Debug")
                    .join("net8.0")
                    .join(binary),
                directory
                    .join("..")
                    .join("..")
                    .join("..")
                    .join("tools")
                    .join("word-template-poc")
                    .join("bin")
                    .join("Release")
                    .join("net8.0")
                    .join(binary),
            ];
            for candidate in candidates {
                if candidate.is_file() {
                    return Ok(candidate);
                }
            }
        }
    }

    Err("未找到 Word 模板实验 helper。请先在 tools/word-template-poc 中执行 dotnet build。".into())
}

fn run_helper(arguments: &[String], standard_input: Option<String>) -> Result<Value, String> {
    let helper = resolve_helper()?;
    let mut command = hidden_process_command(helper.as_os_str());
    command
        .args(arguments)
        .stdin(if standard_input.is_some() {
            Stdio::piped()
        } else {
            Stdio::null()
        })
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    let mut child = command
        .spawn()
        .map_err(|error| format!("无法启动 Word 模板实验 helper：{error}"))?;
    if let Some(input) = standard_input {
        let mut stdin = child
            .stdin
            .take()
            .ok_or_else(|| "无法打开 helper 的标准输入。".to_string())?;
        stdin
            .write_all(input.as_bytes())
            .map_err(|error| format!("无法向 helper 发送请求：{error}"))?;
    }
    let output = child
        .wait_with_output()
        .map_err(|error| format!("Word 模板实验 helper 未能完成：{error}"))?;
    let parsed: Value = serde_json::from_slice(&output.stdout).map_err(|error| {
        format!(
            "Word 模板实验 helper 没有返回 JSON：{error}。stderr: {}",
            String::from_utf8_lossy(&output.stderr).trim()
        )
    })?;
    if output.status.success() {
        Ok(parsed)
    } else {
        Err(parsed
            .get("error")
            .and_then(Value::as_str)
            .map(str::to_owned)
            .unwrap_or_else(|| {
                format!(
                    "Word 模板实验 helper 失败：{}",
                    String::from_utf8_lossy(&output.stderr).trim()
                )
            }))
    }
}

fn analysis_report_path(template_path: &str) -> Result<PathBuf, String> {
    let template = Path::new(template_path);
    let file_name = template
        .file_name()
        .and_then(OsStr::to_str)
        .ok_or("Word 模板路径无效。")?;
    Ok(template.with_file_name(format!("{file_name}.hakurou-template-analysis.json")))
}

#[tauri::command]
pub async fn inspect_word_template(
    template_path: String,
) -> Result<WordTemplatePocInspection, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let report_path = analysis_report_path(&template_path)?;
        let inspection = run_helper(
            &[
                "inspect-template".into(),
                template_path,
                "--report".into(),
                report_path.to_string_lossy().to_string(),
            ],
            None,
        )?;
        Ok(WordTemplatePocInspection {
            inspection,
            report_path: report_path.to_string_lossy().to_string(),
        })
    })
    .await
    .map_err(|error| format!("Word 模板分析任务中断：{error}"))?
}

#[tauri::command]
pub async fn export_word_template_poc(input: WordTemplatePocExportInput) -> Result<Value, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let working_directory = Path::new(&input.document_path)
            .parent()
            .ok_or_else(|| "当前文稿路径无效，无法定位图片资源。".to_string())?;
        let request = json!({
            "templatePath": input.template_path,
            "outputPath": input.output_path,
            "markdown": input.content,
            "pandocPath": pandoc::resolve_pandoc(),
            "workingDirectory": working_directory,
        });
        run_helper(&["render-template".into()], Some(request.to_string()))
    })
    .await
    .map_err(|error| format!("Word 模板导出任务中断：{error}"))?
}
