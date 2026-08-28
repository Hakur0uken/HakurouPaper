#[path = "../mathtype.rs"]
mod mathtype;

use std::{fs, path::PathBuf, time::Instant};

fn formula() -> mathtype::MathTypeFormula {
    mathtype::MathTypeFormula {
        mathml: "<math xmlns=\"http://www.w3.org/1998/Math/MathML\"><msubsup><mi>x</mi><mi>i</mi><mn>2</mn></msubsup></math>".into(),
        display: false,
    }
}

fn convert(
    input: &PathBuf,
    output: &PathBuf,
    cache_dir: &PathBuf,
) -> Result<f64, String> {
    fs::copy(input, output).map_err(|error| format!("无法创建缓存测试副本：{error}"))?;
    let start = Instant::now();
    mathtype::convert_docx_formulas_with_cache_and_progress(
        output,
        &[formula()],
        Some(cache_dir),
        |_| {},
    )?;
    Ok(start.elapsed().as_secs_f64())
}

fn main() -> Result<(), String> {
    let root = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("..\\.tmp-real-export");
    let input = root.join("cache-smoke-input.docx");
    let first = root.join("cache-smoke-first.docx");
    let second = root.join("cache-smoke-second.docx");
    let cache_dir = root
        .join("cache-smoke-assets")
        .join(".hakurou")
        .join("mathtype-native-cache");
    let result = root.join("cache-smoke-result.json");
    if first.exists() || second.exists() || result.exists() {
        return Err("MathType 缓存 smoke test 输出已存在；请使用新的测试目录。".into());
    }

    let first_seconds = convert(&input, &first, &cache_dir)?;
    let cache_documents = fs::read_dir(&cache_dir)
        .map_err(|error| format!("没有生成 MathType 缓存：{error}"))?
        .filter_map(Result::ok)
        .filter(|entry| entry.path().extension().is_some_and(|extension| extension == "docx"))
        .count();
    if cache_documents != 1 {
        return Err(format!("预期生成 1 个 MathType 缓存对象，实际为 {cache_documents} 个。"));
    }
    let second_seconds = convert(&input, &second, &cache_dir)?;
    fs::write(
        &result,
        serde_json::to_vec_pretty(&serde_json::json!({
            "status": "ok",
            "firstSeconds": first_seconds,
            "secondSeconds": second_seconds,
            "cacheDirectory": cache_dir,
            "cacheDocuments": cache_documents,
        }))
        .map_err(|error| format!("无法序列化缓存测试结果：{error}"))?,
    )
    .map_err(|error| format!("无法写入缓存测试结果：{error}"))?;
    println!("{}", result.display());
    Ok(())
}
