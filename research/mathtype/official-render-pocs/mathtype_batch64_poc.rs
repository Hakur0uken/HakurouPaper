#[path = "../mathtype.rs"]
mod mathtype;

use serde::Deserialize;
use std::{fs, path::PathBuf, time::Instant};

#[derive(Deserialize)]
struct FormulaManifest {
    formulas: Vec<FormulaEntry>,
}

#[derive(Deserialize)]
struct FormulaEntry {
    mathml: String,
    display: bool,
}

fn main() -> Result<(), String> {
    let root = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("..\\.tmp-real-export");
    let input = root.join("batch64-input.docx");
    let output = root.join("batch64-mathtype.docx");
    let result = root.join("batch64-result.json");
    let telemetry = root.join("batch64-resources.jsonl");
    if output.exists() || result.exists() || telemetry.exists() {
        return Err("批次 64 的测试输出已存在；请使用新的测试目录，避免覆盖先前记录。".into());
    }
    fs::copy(&input, &output).map_err(|error| format!("无法创建批次 64 测试副本：{error}"))?;
    let manifest: FormulaManifest = serde_json::from_slice(
        &fs::read(root.join("mathtype-formulas.json"))
            .map_err(|error| format!("无法读取公式清单：{error}"))?,
    )
    .map_err(|error| format!("无法解析公式清单：{error}"))?;
    let formulas = manifest
        .formulas
        .into_iter()
        .map(|formula| mathtype::MathTypeFormula {
            mathml: formula.mathml,
            display: formula.display,
        })
        .collect::<Vec<_>>();

    std::env::set_var("HAKUROU_MATHTYPE_FORMULAS_PER_WORD_SESSION", "64");
    std::env::set_var("HAKUROU_MATHTYPE_TELEMETRY_PATH", &telemetry);
    let start = Instant::now();
    mathtype::convert_docx_formulas(&output, &formulas)?;
    let elapsed_seconds = start.elapsed().as_secs_f64();
    fs::write(
        &result,
        serde_json::to_vec_pretty(&serde_json::json!({
            "status": "ok",
            "formulaCount": formulas.len(),
            "formulasPerWordSession": 64,
            "elapsedSeconds": elapsed_seconds,
            "outputPath": output,
            "telemetryPath": telemetry,
        }))
        .map_err(|error| format!("无法序列化测试结果：{error}"))?,
    )
    .map_err(|error| format!("无法写入测试结果：{error}"))?;
    println!("{}", result.display());
    Ok(())
}
