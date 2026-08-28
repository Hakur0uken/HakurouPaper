use serde::Serialize;
use sha2::{Digest, Sha256};
use std::{
    fs,
    io::{BufRead, BufReader, Read},
    path::{Path, PathBuf},
    process::{Command, ExitStatus, Stdio},
    sync::{Mutex, OnceLock},
    thread,
    time::UNIX_EPOCH,
};

const LITERAL_DOLLAR_PLACEHOLDER: &str = "HAKUROU_LITERAL_DOLLAR_4D5A8C7E";

/// Only one export can be active in the desktop UI.  The signal gives a
/// deliberate hand-off point back to that export when a legacy MathType
/// dialog must be completed by the user.
static ACTIVE_MANUAL_MATHTYPE_SIGNAL: OnceLock<Mutex<Option<PathBuf>>> = OnceLock::new();

fn active_manual_mathtype_signal() -> &'static Mutex<Option<PathBuf>> {
    ACTIVE_MANUAL_MATHTYPE_SIGNAL.get_or_init(|| Mutex::new(None))
}

struct ManualMathTypeSignalGuard {
    path: PathBuf,
}

impl ManualMathTypeSignalGuard {
    fn activate(path: PathBuf) -> Result<Self, String> {
        let _ = fs::remove_file(&path);
        let mut active = active_manual_mathtype_signal()
            .lock()
            .map_err(|_| "无法设置 MathType 人工接管状态。")?;
        *active = Some(path.clone());
        Ok(Self { path })
    }
}

impl Drop for ManualMathTypeSignalGuard {
    fn drop(&mut self) {
        if let Ok(mut active) = active_manual_mathtype_signal().lock() {
            if active.as_deref() == Some(self.path.as_path()) {
                *active = None;
            }
        }
        let _ = fs::remove_file(&self.path);
    }
}

#[tauri::command]
pub fn confirm_manual_mathtype_step() -> Result<(), String> {
    let path = active_manual_mathtype_signal()
        .lock()
        .map_err(|_| "无法读取 MathType 人工接管状态。")?
        .clone()
        .ok_or("当前没有等待确认的 MathType 步骤。")?;
    fs::write(&path, b"continue")
        .map_err(|error| format!("无法确认 MathType 人工步骤：{error}"))
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MathTypeStatus {
    available: bool,
    message: Option<String>,
}

/// Presentation MathML prepared by the desktop renderer for an individual
/// Markdown equation.  MathType receives this data through its documented OLE
/// `IDataObject` interface, then generates both its editable MTEF payload and
/// the matching WMF presentation itself.
#[derive(Debug, Clone)]
pub struct MathTypeFormula {
    pub mathml: String,
    pub display: bool,
}

/// A best-effort progress signal for the native Word/MathType conversion.  It
/// deliberately reports completed objects rather than elapsed-time estimates:
/// MathType's per-formula latency varies too much for an ETA to be honest.
#[derive(Debug, Clone, Copy)]
pub struct MathTypeConversionProgress {
    pub completed: usize,
    pub total: usize,
    pub batch_index: usize,
    pub batch_count: usize,
    pub batch_started: bool,
}

const NATIVE_FORMULA_CACHE_VERSION: u8 = 1;

/// One cache entry is a tiny Word document containing exactly one native
/// MathType OLE object.  Keeping the object in Word's own container preserves
/// its editable MTEF payload, WMF appearance, extent and baseline together.
struct NativeFormulaCacheEntry {
    document_path: PathBuf,
    metadata_path: PathBuf,
    metadata: NativeFormulaCacheMetadata,
}

#[derive(Debug, PartialEq, Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
struct NativeFormulaCacheMetadata {
    version: u8,
    key: String,
    renderer_fingerprint: String,
    display: bool,
}

fn math_type_renderer_fingerprint() -> String {
    #[cfg(windows)]
    let executable = math_type_executable();
    #[cfg(not(windows))]
    let executable: Option<PathBuf> = None;

    let Some(executable) = executable else {
        return "mathtype-unavailable".into();
    };
    let metadata = fs::metadata(&executable).ok();
    let size = metadata.as_ref().map(|value| value.len()).unwrap_or(0);
    let modified = metadata
        .and_then(|value| value.modified().ok())
        .and_then(|value| value.duration_since(UNIX_EPOCH).ok())
        .map(|value| value.as_secs())
        .unwrap_or(0);
    format!("native-ole-v{NATIVE_FORMULA_CACHE_VERSION}:{size}:{modified}")
}

fn native_formula_cache_entry(
    cache_dir: &Path,
    formula: &MathTypeFormula,
) -> Result<NativeFormulaCacheEntry, String> {
    fs::create_dir_all(cache_dir)
        .map_err(|error| format!("无法创建 MathType 公式缓存目录：{error}"))?;
    let renderer_fingerprint = math_type_renderer_fingerprint();
    let mut hasher = Sha256::new();
    hasher.update(format!("hakurou-native-ole-cache-v{NATIVE_FORMULA_CACHE_VERSION}\0"));
    hasher.update(renderer_fingerprint.as_bytes());
    hasher.update([0]);
    hasher.update([u8::from(formula.display)]);
    hasher.update([0]);
    hasher.update(formula.mathml.as_bytes());
    let key = format!("{:x}", hasher.finalize());
    Ok(NativeFormulaCacheEntry {
        document_path: cache_dir.join(format!("{key}.docx")),
        metadata_path: cache_dir.join(format!("{key}.json")),
        metadata: NativeFormulaCacheMetadata {
            version: NATIVE_FORMULA_CACHE_VERSION,
            key,
            renderer_fingerprint,
            display: formula.display,
        },
    })
}

fn native_formula_cache_is_valid(entry: &NativeFormulaCacheEntry) -> bool {
    if !entry.document_path.is_file() || !entry.metadata_path.is_file() {
        return false;
    }
    fs::read(&entry.metadata_path)
        .ok()
        .and_then(|bytes| serde_json::from_slice::<NativeFormulaCacheMetadata>(&bytes).ok())
        .is_some_and(|metadata| metadata == entry.metadata)
}

fn write_native_formula_cache_metadata(entry: &NativeFormulaCacheEntry) -> Result<(), String> {
    fs::write(
        &entry.metadata_path,
        serde_json::to_vec_pretty(&entry.metadata)
            .map_err(|error| format!("无法序列化 MathType 公式缓存元数据：{error}"))?,
    )
    .map_err(|error| format!("无法写入 MathType 公式缓存元数据：{error}"))
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
struct MathSpan {
    start: usize,
    end: usize,
    delimiter_len: usize,
}

fn find_next_math_span(text: &[u16]) -> Option<MathSpan> {
    let dollar = '$' as u16;
    let mut start = 0;

    while start < text.len() {
        if text[start] != dollar {
            start += 1;
            continue;
        }

        let display = text.get(start + 1) == Some(&dollar);
        let delimiter_len = if display { 2 } else { 1 };
        let content_start = start + delimiter_len;
        if content_start >= text.len() {
            return None;
        }

        let mut cursor = content_start;
        while cursor < text.len() {
            let escaped = text[cursor] == dollar
                && text[..cursor]
                    .iter()
                    .rev()
                    .take_while(|character| **character == '\\' as u16)
                    .count()
                    % 2
                    == 1;
            if escaped {
                cursor += 1;
                continue;
            }
            if display {
                if text.get(cursor) == Some(&dollar) && text.get(cursor + 1) == Some(&dollar) {
                    if cursor > content_start {
                        return Some(MathSpan {
                            start,
                            end: cursor + delimiter_len,
                            delimiter_len,
                        });
                    }
                    break;
                }
                cursor += 1;
            } else {
                if text[cursor] == dollar {
                    if cursor > content_start {
                        return Some(MathSpan {
                            start,
                            end: cursor + delimiter_len,
                            delimiter_len,
                        });
                    }
                    break;
                }
                cursor += 1;
            }
        }

        start += delimiter_len;
    }

    None
}

fn wrap_plain_math_type_text(tex: &str) -> String {
    let trimmed = tex.trim();
    if !trimmed.is_empty()
        && trimmed
            .chars()
            .all(|character| character.is_ascii_alphanumeric())
    {
        format!(r"\mathit{{{trimmed}}}")
    } else {
        tex.to_owned()
    }
}

fn find_tex_group_end(text: &str, opening: usize) -> Option<usize> {
    let bytes = text.as_bytes();
    if bytes.get(opening) != Some(&b'{') {
        return None;
    }

    let mut depth = 0usize;
    for index in opening..bytes.len() {
        match bytes[index] {
            b'{' => depth += 1,
            b'}' => {
                depth = depth.checked_sub(1)?;
                if depth == 0 {
                    return Some(index);
                }
            }
            _ => {}
        }
    }
    None
}

fn replace_tex_tags(tex: &str, keep_number: bool) -> String {
    let mut output = String::with_capacity(tex.len());
    let mut cursor = 0usize;

    while let Some(relative_start) = tex[cursor..].find(r"\tag") {
        let start = cursor + relative_start;
        let mut opening = start + 4;
        if tex.as_bytes().get(opening) == Some(&b'*') {
            opening += 1;
        }
        let Some(end) = find_tex_group_end(tex, opening) else {
            output.push_str(&tex[cursor..]);
            return output;
        };

        output.push_str(&tex[cursor..start]);
        if keep_number {
            output.push_str(r"\quad\mathrm{(");
            output.push_str(&tex[opening + 1..end]);
            output.push_str(r")}");
        }
        cursor = end + 1;
    }

    output.push_str(&tex[cursor..]);
    output
}

fn normalize_math_type_tex(tex: &str, keep_tag: bool) -> String {
    let normalized = tex
        .replace(r"\begin{aligned}", r"\begin{array}{rl}")
        .replace(r"\end{aligned}", r"\end{array}");
    replace_tex_tags(&normalized, keep_tag)
}

fn math_type_literal_brace_variant(tex: &str) -> String {
    // Some Markdown producers double-escape literal braces. Normalize that
    // representation first, then express paired literal braces as scalable
    // delimiters, which MathType's TeX input accepts reliably.
    let normalized = tex.replace(r"\\{", r"\{").replace(r"\\}", r"\}");
    let mut output = String::with_capacity(normalized.len() + 12);
    let mut cursor = 0usize;

    while let Some(relative_opening) = normalized[cursor..].find(r"\{") {
        let opening = cursor + relative_opening;
        let delimiter_prefix = &normalized[..opening];
        if [r"\left", r"\right", r"\big", r"\Big", r"\bigg", r"\Bigg"]
            .iter()
            .any(|prefix| delimiter_prefix.ends_with(prefix))
        {
            output.push_str(&normalized[cursor..opening + 2]);
            cursor = opening + 2;
            continue;
        }

        let content_start = opening + 2;
        let Some(relative_closing) = normalized[content_start..].find(r"\}") else {
            output.push_str(&normalized[cursor..]);
            return output;
        };
        let closing = content_start + relative_closing;
        output.push_str(&normalized[cursor..opening]);
        output.push_str(r"\left\{");
        output.push_str(&normalized[content_start..closing]);
        output.push_str(r"\right\}");
        cursor = closing + 2;
    }

    output.push_str(&normalized[cursor..]);
    output
}

fn math_type_tex_variants(tex: &str) -> Vec<String> {
    let original = wrap_plain_math_type_text(tex);
    let compatible = normalize_math_type_tex(&original, true);
    let without_tag = normalize_math_type_tex(&original, false);
    let brace_compatible = math_type_literal_brace_variant(&without_tag);
    let mut variants = vec![original.clone()];
    if compatible != original {
        variants.push(compatible);
    }
    if without_tag != original && !variants.contains(&without_tag) {
        variants.push(without_tag);
    }
    if brace_compatible != original && !variants.contains(&brace_compatible) {
        variants.push(brace_compatible);
    }
    variants
}

#[cfg(windows)]
fn math_type_executable() -> Option<PathBuf> {
    let mut candidates = Vec::new();
    for variable in ["ProgramFiles(x86)", "ProgramFiles"] {
        if let Some(root) = std::env::var_os(variable) {
            candidates.push(PathBuf::from(root).join("MathType").join("MathType.exe"));
        }
    }
    candidates.into_iter().find(|candidate| candidate.is_file())
}

#[cfg(windows)]
fn word_executable() -> Option<PathBuf> {
    let mut candidates = Vec::new();
    for variable in ["ProgramFiles", "ProgramFiles(x86)"] {
        if let Some(root) = std::env::var_os(variable) {
            let office_root = PathBuf::from(root).join("Microsoft Office");
            for office_folder in ["root\\Office16", "Office16", "root\\Office15", "Office15"] {
                candidates.push(office_root.join(office_folder).join("WINWORD.EXE"));
            }
        }
    }
    candidates.into_iter().find(|candidate| candidate.is_file())
}

#[cfg(windows)]
fn math_type_root() -> Option<PathBuf> {
    math_type_executable()?.parent().map(PathBuf::from)
}

#[cfg(windows)]
fn math_type_wll() -> Option<PathBuf> {
    let root = math_type_root()?;
    let word = word_executable()?;
    let process_is_64_bit = cfg!(target_pointer_width = "64");

    let mut candidates = Vec::new();
    if process_is_64_bit {
        candidates.push(root.join("MathPage\\64\\MathPage.wll"));
        candidates.push(word.parent()?.join("MathPage.wll"));
        candidates.push(root.join("MathPage\\32\\MathPage.wll"));
    } else {
        candidates.push(root.join("MathPage\\32\\MathPage.wll"));
        candidates.push(word.parent()?.join("MathPage.wll"));
        candidates.push(root.join("MathPage\\64\\MathPage.wll"));
    }
    candidates.into_iter().find(|candidate| candidate.is_file())
}

#[cfg(windows)]
fn blank_equation_document() -> Option<PathBuf> {
    let path = math_type_root()?.join("Office Support\\BlankEqn.doc");
    path.is_file().then_some(path)
}

#[cfg(windows)]
fn available_status() -> MathTypeStatus {
    if math_type_executable().is_none() {
        return MathTypeStatus {
            available: false,
            message: Some("未检测到 MathType。请安装 MathType 7 后重新检测。".into()),
        };
    }
    if word_executable().is_none() {
        return MathTypeStatus {
            available: false,
            message: Some(
                "已检测到 MathType，但未检测到 Microsoft Word。MathType 导出需要 Word。".into(),
            ),
        };
    }
    if blank_equation_document().is_none() {
        return MathTypeStatus {
            available: false,
            message: Some(
                "已检测到 MathType 和 Word，但未检测到 Office Support\\BlankEqn.doc。请修复 MathType 的 Office 支持组件。".into(),
            ),
        };
    }
    MathTypeStatus {
        available: true,
        message: None,
    }
}

#[cfg(not(windows))]
fn available_status() -> MathTypeStatus {
    MathTypeStatus {
        available: false,
        message: Some("MathType 交付仅支持 Windows、Microsoft Word 与 MathType 7。".into()),
    }
}

#[tauri::command]
pub fn inspect_math_type() -> MathTypeStatus {
    available_status()
}

const OFFICIAL_BATCH_SCRIPT: &str = include_str!("../tools/mathtype_official_batch.py");

fn summarize_process_output(status: ExitStatus, stdout: &str, stderr: &str) -> String {
    let stderr = stderr.trim();
    let stdout = stdout.trim();
    let detail = if stderr.is_empty() { stdout } else { stderr };
    if detail.is_empty() {
        format!(
            "批量 MathType 转换以状态码 {:?} 退出。",
            status.code()
        )
    } else {
        detail.chars().take(3000).collect()
    }
}

/// Runs the MathType Word add-in's own batch conversion over an OMML DOCX.
/// The helper is extracted from Piperange/word-mathtype-mcp (MIT) and must be
/// started by the interactive desktop app, not a Windows service.
pub fn convert_docx_formulas_official_batch<F>(
    document_path: &Path,
    work_dir: &Path,
    mut on_progress: F,
) -> Result<(), String>
where
    F: FnMut(&str),
{
    let status = available_status();
    if !status.available {
        return Err(status
            .message
            .unwrap_or_else(|| "MathType 当前不可用。".into()));
    }

    let script_path = work_dir.join("mathtype_official_batch.py");
    std::fs::write(&script_path, OFFICIAL_BATCH_SCRIPT)
        .map_err(|error| format!("无法准备 MathType 批量转换脚本：{error}"))?;
    let cache_dir = work_dir.join("comtypes-cache");
    std::fs::create_dir_all(&cache_dir)
        .map_err(|error| format!("无法准备 MathType COM 缓存目录：{error}"))?;
    let manual_continue_path = work_dir.join("mathtype-manual-continue.signal");
    let _manual_continue_guard = ManualMathTypeSignalGuard::activate(manual_continue_path.clone())?;

    let mut child = Command::new("py")
        .arg("-3")
        // The Python helper emits line-delimited status JSON while Word and
        // MathType own the UI.  Keep stdout unbuffered so the React progress
        // message changes at the moment the dialog state changes.
        .arg("-u")
        .arg(&script_path)
        .arg(document_path)
        .arg("--comtypes-cache")
        .arg(&cache_dir)
        .arg("--manual-continue-file")
        .arg(&manual_continue_path)
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|error| {
            format!(
                "无法启动 Python 批量转换器：{error}。请安装 Python 3.10+、pywin32 与 pywinauto。"
            )
        })?;

    let stdout = child
        .stdout
        .take()
        .ok_or("无法读取 MathType 批量转换器的状态输出。")?;
    let mut stderr = child
        .stderr
        .take()
        .ok_or("无法读取 MathType 批量转换器的错误输出。")?;
    let stderr_reader = thread::spawn(move || {
        let mut output = String::new();
        let _ = stderr.read_to_string(&mut output);
        output
    });

    let mut stdout_log = String::new();
    for line in BufReader::new(stdout).lines() {
        let line = line.map_err(|error| format!("读取 MathType 批量转换状态失败：{error}"))?;
        let progress_phase = serde_json::from_str::<serde_json::Value>(&line)
            .ok()
            .filter(|event| event.get("event").and_then(|value| value.as_str()) == Some("status"))
            .and_then(|event| event.get("phase").and_then(|value| value.as_str()).map(str::to_owned));
        if let Some(phase) = progress_phase {
            on_progress(&phase);
        } else if !line.trim().is_empty() {
            stdout_log.push_str(&line);
            stdout_log.push('\n');
        }
    }
    let status = child
        .wait()
        .map_err(|error| format!("等待 MathType 批量转换器结束失败：{error}"))?;
    let stderr = stderr_reader
        .join()
        .unwrap_or_else(|_| "无法读取 MathType 批量转换器的错误输出。".into());
    if status.success() {
        Ok(())
    } else {
        Err(summarize_process_output(status, &stdout_log, &stderr))
    }
}

#[cfg(windows)]
mod windows_bridge {
    use super::{
        blank_equation_document, native_formula_cache_entry, native_formula_cache_is_valid,
        write_native_formula_cache_metadata, MathTypeConversionProgress, MathTypeFormula,
        NativeFormulaCacheEntry, LITERAL_DOLLAR_PLACEHOLDER,
    };
    use serde::Serialize;
    use std::{
        ffi::c_void,
        fs::OpenOptions,
        io::Write,
        mem::transmute_copy,
        path::Path,
        ptr::{copy_nonoverlapping, null, null_mut},
        slice, thread,
        time::Duration,
    };
    use windows_sys::{
        core::{BOOL, BSTR, GUID, HRESULT, PCSTR},
        Win32::{
            Foundation::{
                CloseHandle, FreeLibrary, GlobalFree, SysAllocStringLen, SysFreeString,
                SysStringLen, HMODULE, INVALID_HANDLE_VALUE,
            },
            System::{
                Com::{
                    CLSIDFromProgID, CoCreateInstance, CoInitializeEx, CoUninitialize,
                    CLSCTX_LOCAL_SERVER, COINIT_APARTMENTTHREADED, DISPATCH_METHOD,
                    DISPATCH_PROPERTYGET, DISPATCH_PROPERTYPUT, DISPPARAMS, EXCEPINFO,
                },
                DataExchange::RegisterClipboardFormatW,
                Diagnostics::ToolHelp::{
                    CreateToolhelp32Snapshot, Process32FirstW, Process32NextW, PROCESSENTRY32W,
                    TH32CS_SNAPPROCESS,
                },
                LibraryLoader::{GetProcAddress, LoadLibraryW},
                Memory::{GlobalAlloc, GlobalLock, GlobalUnlock, GMEM_MOVEABLE},
                ProcessStatus::{GetProcessMemoryInfo, PROCESS_MEMORY_COUNTERS, PROCESS_MEMORY_COUNTERS_EX},
                Threading::{
                    GetGuiResources, OpenProcess, GR_GDIOBJECTS, GR_USEROBJECTS,
                    PROCESS_QUERY_INFORMATION, PROCESS_VM_READ,
                },
                Variant::{
                    VariantClear, VARIANT, VT_BOOL, VT_BSTR, VT_DISPATCH, VT_I2, VT_I4, VT_INT,
                    VT_UI4,
                },
            },
        },
    };

    const IID_NULL: GUID = GUID::from_u128(0);
    const IID_IDISPATCH: GUID = GUID::from_u128(0x00020400_0000_0000_c000_000000000046);
    const DISPID_PROPERTYPUT: i32 = -3;
    const S_FALSE: HRESULT = 1;

    #[repr(C)]
    struct DispatchVtable {
        query_interface:
            unsafe extern "system" fn(*mut c_void, *const GUID, *mut *mut c_void) -> HRESULT,
        add_ref: unsafe extern "system" fn(*mut c_void) -> u32,
        release: unsafe extern "system" fn(*mut c_void) -> u32,
        get_type_info_count: unsafe extern "system" fn(*mut c_void, *mut u32) -> HRESULT,
        get_type_info:
            unsafe extern "system" fn(*mut c_void, u32, u32, *mut *mut c_void) -> HRESULT,
        get_ids_of_names: unsafe extern "system" fn(
            *mut c_void,
            *const GUID,
            *mut *mut u16,
            u32,
            u32,
            *mut i32,
        ) -> HRESULT,
        invoke: unsafe extern "system" fn(
            *mut c_void,
            i32,
            *const GUID,
            u32,
            u16,
            *mut DISPPARAMS,
            *mut VARIANT,
            *mut EXCEPINFO,
            *mut u32,
        ) -> HRESULT,
    }

    #[repr(C)]
    struct DispatchObject {
        vtable: *const DispatchVtable,
    }

    // Minimal COM definitions needed for MathType's documented OLE conversion
    // path.  `FORMATETC` and `STGMEDIUM` are ABI structures, so keep them
    // local rather than depending on a projection that hides the union.
    #[repr(C)]
    struct FormatEtc {
        cf_format: u16,
        ptd: *mut c_void,
        dw_aspect: u32,
        lindex: i32,
        tymed: u32,
    }

    #[repr(C)]
    struct StgMedium {
        tymed: u32,
        union_member: *mut c_void,
        unk_for_release: *mut c_void,
    }

    #[repr(C)]
    struct DataObjectVtable {
        query_interface:
            unsafe extern "system" fn(*mut c_void, *const GUID, *mut *mut c_void) -> HRESULT,
        add_ref: unsafe extern "system" fn(*mut c_void) -> u32,
        release: unsafe extern "system" fn(*mut c_void) -> u32,
        get_data: unsafe extern "system" fn(*mut c_void, *const FormatEtc, *mut StgMedium) -> HRESULT,
        get_data_here:
            unsafe extern "system" fn(*mut c_void, *const FormatEtc, *mut StgMedium) -> HRESULT,
        query_get_data: unsafe extern "system" fn(*mut c_void, *const FormatEtc) -> HRESULT,
        get_canonical_format_etc:
            unsafe extern "system" fn(*mut c_void, *const FormatEtc, *mut FormatEtc) -> HRESULT,
        set_data:
            unsafe extern "system" fn(*mut c_void, *const FormatEtc, *mut StgMedium, BOOL) -> HRESULT,
    }

    #[repr(C)]
    struct DataObject {
        vtable: *const DataObjectVtable,
    }

    const IID_IDATAOBJECT: GUID = GUID::from_u128(0x0000010e_0000_0000_c000_000000000046);
    const DVASPECT_CONTENT: u32 = 1;
    const TYMED_HGLOBAL: u32 = 1;
    // A fresh Word process after every batch keeps MathType's conversion state
    // bounded.  The default is deliberately conservative until the worker's
    // resource profile has been characterized.  An interactive test build can
    // opt into a larger value without changing the shipping safety default.
    // `OLE Hide` is deliberately not used because it triggers a legacy-
    // equation conversion path in current Office builds.
    const DEFAULT_FORMULAS_PER_WORD_SESSION: usize = 10;
    const MAX_FORMULAS_PER_WORD_SESSION: usize = 96;

    #[derive(Serialize)]
    struct MathTypeProcessResources {
        process_id: u32,
        working_set_bytes: usize,
        private_bytes: usize,
        gdi_objects: u32,
        user_objects: u32,
    }

    #[derive(Serialize)]
    struct MathTypeResourceSample {
        formula_number: usize,
        processes: Vec<MathTypeProcessResources>,
    }

    fn formulas_per_word_session() -> usize {
        std::env::var("HAKUROU_MATHTYPE_FORMULAS_PER_WORD_SESSION")
            .ok()
            .and_then(|value| value.parse::<usize>().ok())
            .filter(|value| (1..=MAX_FORMULAS_PER_WORD_SESSION).contains(value))
            .unwrap_or(DEFAULT_FORMULAS_PER_WORD_SESSION)
    }

    /// Optional diagnostics for tuning the Word/MathType worker recycle point.
    /// This stays completely dormant in production unless a test harness
    /// provides a JSONL output path.  We record the real MathType server
    /// process, rather than the caller, because its GDI/USER resource leak is
    /// the failure mode we need to characterize.
    fn record_resource_sample(formula_number: usize) {
        let Ok(path) = std::env::var("HAKUROU_MATHTYPE_TELEMETRY_PATH") else {
            return;
        };
        let sample = MathTypeResourceSample {
            formula_number,
            processes: unsafe { math_type_process_resources() },
        };
        let Ok(line) = serde_json::to_string(&sample) else {
            return;
        };
        if let Ok(mut file) = OpenOptions::new().create(true).append(true).open(path) {
            let _ = writeln!(file, "{line}");
        }
    }

    unsafe fn math_type_process_resources() -> Vec<MathTypeProcessResources> {
        let snapshot = CreateToolhelp32Snapshot(TH32CS_SNAPPROCESS, 0);
        if snapshot.is_null() || snapshot == INVALID_HANDLE_VALUE {
            return Vec::new();
        }
        let mut entry = PROCESSENTRY32W {
            dwSize: std::mem::size_of::<PROCESSENTRY32W>() as u32,
            ..Default::default()
        };
        let mut resources = Vec::new();
        let mut has_entry = Process32FirstW(snapshot, &mut entry) != 0;
        while has_entry {
            let name_len = entry
                .szExeFile
                .iter()
                .position(|character| *character == 0)
                .unwrap_or(entry.szExeFile.len());
            let name = String::from_utf16_lossy(&entry.szExeFile[..name_len]);
            if name.eq_ignore_ascii_case("MathType.exe") {
                let process = OpenProcess(
                    PROCESS_QUERY_INFORMATION | PROCESS_VM_READ,
                    0,
                    entry.th32ProcessID,
                );
                if !process.is_null() {
                    let mut memory = PROCESS_MEMORY_COUNTERS_EX {
                        cb: std::mem::size_of::<PROCESS_MEMORY_COUNTERS_EX>() as u32,
                        ..Default::default()
                    };
                    let memory_ok = GetProcessMemoryInfo(
                        process,
                        (&mut memory as *mut PROCESS_MEMORY_COUNTERS_EX).cast::<PROCESS_MEMORY_COUNTERS>(),
                        memory.cb,
                    ) != 0;
                    resources.push(MathTypeProcessResources {
                        process_id: entry.th32ProcessID,
                        working_set_bytes: memory_ok.then_some(memory.WorkingSetSize).unwrap_or(0),
                        private_bytes: memory_ok.then_some(memory.PrivateUsage).unwrap_or(0),
                        gdi_objects: GetGuiResources(process, GR_GDIOBJECTS),
                        user_objects: GetGuiResources(process, GR_USEROBJECTS),
                    });
                    let _ = CloseHandle(process);
                }
            }
            has_entry = Process32NextW(snapshot, &mut entry) != 0;
        }
        let _ = CloseHandle(snapshot);
        resources
    }

    struct ComPtr(*mut DispatchObject);

    impl ComPtr {
        unsafe fn from_raw(raw: *mut c_void) -> Result<Self, String> {
            if raw.is_null() {
                Err("Word 返回了空的 COM 对象。".into())
            } else {
                Ok(Self(raw.cast()))
            }
        }

        fn raw(&self) -> *mut c_void {
            self.0.cast()
        }

        unsafe fn query_interface(&self, iid: &GUID) -> Result<*mut c_void, String> {
            let mut interface = null_mut();
            let hr = ((*(*self.0).vtable).query_interface)(self.raw(), iid, &mut interface);
            if hr < 0 || interface.is_null() {
                return Err(format!(
                    "MathType OLE 对象不支持所需接口（HRESULT 0x{:08X}）。",
                    hr as u32
                ));
            }
            Ok(interface)
        }

        /// Feed presentation MathML to a *Word-hosted* MathType OLE object.
        /// A bare MathType COM server rejects `SetData`; the hosting InlineShape
        /// and conversion verb are both required by MathType's OLE contract.
        unsafe fn set_mathml(&self, mathml: &str) -> Result<(), String> {
            let data_object = self.query_interface(&IID_IDATAOBJECT)?;
            let format_name = wide_null("MathML");
            let clip_format = RegisterClipboardFormatW(format_name.as_ptr());
            if clip_format == 0 {
                ((*(*(data_object as *mut DataObject)).vtable).release)(data_object);
                return Err("无法注册 MathType MathML 剪贴板格式。".into());
            }

            let mathml_wide = wide_null(mathml);
            let byte_len = mathml_wide
                .len()
                .checked_mul(std::mem::size_of::<u16>())
                .ok_or_else(|| "MathML 数据过大。".to_owned())?;
            let memory = GlobalAlloc(GMEM_MOVEABLE, byte_len);
            if memory.is_null() {
                ((*(*(data_object as *mut DataObject)).vtable).release)(data_object);
                return Err("无法为 MathType MathML 分配全局内存。".into());
            }
            let write = GlobalLock(memory).cast::<u16>();
            if write.is_null() {
                let _ = GlobalFree(memory);
                ((*(*(data_object as *mut DataObject)).vtable).release)(data_object);
                return Err("无法锁定 MathType MathML 全局内存。".into());
            }
            copy_nonoverlapping(mathml_wide.as_ptr(), write, mathml_wide.len());
            let _ = GlobalUnlock(memory);

            let format = FormatEtc {
                cf_format: clip_format as u16,
                ptd: null_mut(),
                dw_aspect: DVASPECT_CONTENT,
                lindex: -1,
                tymed: TYMED_HGLOBAL,
            };
            let mut medium = StgMedium {
                tymed: TYMED_HGLOBAL,
                union_member: memory,
                unk_for_release: null_mut(),
            };
            let hr = ((*(*(data_object as *mut DataObject)).vtable).set_data)(
                data_object,
                &format,
                &mut medium,
                0,
            );
            // `fRelease = FALSE`: MathType consumes the MathML synchronously;
            // ownership remains here and must be released exactly once.
            let _ = GlobalFree(memory);
            ((*(*(data_object as *mut DataObject)).vtable).release)(data_object);
            if hr < 0 {
                return Err(format!(
                    "MathType 未接受 MathML 公式数据（HRESULT 0x{:08X}）。",
                    hr as u32
                ));
            }
            Ok(())
        }

        unsafe fn invoke(
            &self,
            dispid: i32,
            flags: u16,
            args: &mut [VARIANT],
            named_arg: Option<&mut i32>,
        ) -> Result<VARIANT, String> {
            let c_named_args = named_arg.is_some() as u32;
            let named_ptr = named_arg
                .map(|value| value as *mut i32)
                .unwrap_or(null_mut());
            let mut params = DISPPARAMS {
                rgvarg: if args.is_empty() {
                    null_mut()
                } else {
                    args.as_mut_ptr()
                },
                rgdispidNamedArgs: named_ptr,
                cArgs: args.len() as u32,
                cNamedArgs: c_named_args,
            };
            let mut result = VARIANT::default();
            let mut exception = EXCEPINFO::default();
            let mut argument_error = 0u32;
            let hr = ((*(*self.0).vtable).invoke)(
                self.raw(),
                dispid,
                &IID_NULL,
                0,
                flags,
                &mut params,
                &mut result,
                &mut exception,
                &mut argument_error,
            );
            clear_variants(args);

            if hr < 0 {
                let description = bstr_to_string(exception.bstrDescription);
                if !exception.bstrDescription.is_null() {
                    SysFreeString(exception.bstrDescription);
                }
                if !exception.bstrSource.is_null() {
                    SysFreeString(exception.bstrSource);
                }
                if !exception.bstrHelpFile.is_null() {
                    SysFreeString(exception.bstrHelpFile);
                }
                VariantClear(&mut result);
                let suffix = description
                    .filter(|value| !value.is_empty())
                    .map(|value| format!(": {value}"))
                    .unwrap_or_default();
                return Err(format!(
                    "Word COM 调用失败（HRESULT 0x{:08X}{suffix}）。",
                    hr as u32
                ));
            }
            Ok(result)
        }

        unsafe fn dispid(&self, name: &str) -> Result<i32, String> {
            let mut name_wide = wide_null(name);
            let mut name_ptr = name_wide.as_mut_ptr();
            let mut dispid = 0i32;
            let hr = ((*(*self.0).vtable).get_ids_of_names)(
                self.raw(),
                &IID_NULL,
                &mut name_ptr,
                1,
                0,
                &mut dispid,
            );
            if hr < 0 {
                return Err(format!(
                    "无法取得 Word 属性或方法 {name} 的 DISPID（HRESULT 0x{:08X}）。",
                    hr as u32
                ));
            }
            Ok(dispid)
        }

        unsafe fn get(&self, name: &str) -> Result<VARIANT, String> {
            let dispid = self.dispid(name)?;
            self.invoke(dispid, DISPATCH_PROPERTYGET, &mut [], None)
        }

        unsafe fn get_dispatch(&self, name: &str) -> Result<ComPtr, String> {
            let value = self.get(name)?;
            take_dispatch(value)
        }

        unsafe fn method(&self, name: &str, mut args: Vec<VARIANT>) -> Result<VARIANT, String> {
            let dispid = self.dispid(name)?;
            args.reverse();
            self.invoke(dispid, DISPATCH_METHOD, &mut args, None)
        }

        unsafe fn method_no_result(&self, name: &str, args: Vec<VARIANT>) -> Result<(), String> {
            let mut result = self.method(name, args)?;
            VariantClear(&mut result);
            Ok(())
        }

        unsafe fn put(&self, name: &str, value: VARIANT) -> Result<(), String> {
            let dispid = self.dispid(name)?;
            let mut args = [value];
            let mut named = DISPID_PROPERTYPUT;
            let mut result =
                self.invoke(dispid, DISPATCH_PROPERTYPUT, &mut args, Some(&mut named))?;
            VariantClear(&mut result);
            Ok(())
        }
    }

    impl Clone for ComPtr {
        fn clone(&self) -> Self {
            unsafe {
                ((*(*self.0).vtable).add_ref)(self.raw());
            }
            Self(self.0)
        }
    }

    impl Drop for ComPtr {
        fn drop(&mut self) {
            if !self.0.is_null() {
                unsafe {
                    ((*(*self.0).vtable).release)(self.raw());
                }
            }
        }
    }

    struct MathTypeApi {
        module: HMODULE,
        term: MtTermApi,
        set_equation: MtSetEquationApi,
        close_object: MtCloseObjectApi,
    }

    type MtInitApi = unsafe extern "system" fn(i16, i16) -> i32;
    type MtTermApi = unsafe extern "system" fn() -> i32;
    type MtSetEquationApi = unsafe extern "system" fn(*mut c_void, i32, *mut u16, i32) -> i32;
    type MtCloseObjectApi = unsafe extern "system" fn(i32, *mut c_void) -> i32;

    impl MathTypeApi {
        unsafe fn load(path: &Path) -> Result<Self, String> {
            let path_wide = wide_null(&path.to_string_lossy());
            let module = LoadLibraryW(path_wide.as_ptr());
            if module.is_null() {
                return Err(format!("无法加载 MathPage.wll：{}。", path.display()));
            }

            let init = match load_proc::<MtInitApi>(module, b"MTInitAPI\0") {
                Some(value) => value,
                None => {
                    FreeLibrary(module);
                    return Err("MathPage.wll 缺少 MTInitAPI。".into());
                }
            };
            let term = match load_proc::<MtTermApi>(module, b"MTTermAPI\0") {
                Some(value) => value,
                None => {
                    FreeLibrary(module);
                    return Err("MathPage.wll 缺少 MTTermAPI。".into());
                }
            };
            let set_equation = match load_proc::<MtSetEquationApi>(module, b"MTSetEqnFromLangStr\0")
            {
                Some(value) => value,
                None => {
                    FreeLibrary(module);
                    return Err("MathPage.wll 缺少 MTSetEqnFromLangStr。".into());
                }
            };
            let close_object = match load_proc::<MtCloseObjectApi>(module, b"MTCloseOleObject\0") {
                Some(value) => value,
                None => {
                    FreeLibrary(module);
                    return Err("MathPage.wll 缺少 MTCloseOleObject。".into());
                }
            };

            let result = init(0, 30);
            if result <= 0 {
                FreeLibrary(module);
                return Err(format!("MathType API 初始化失败（返回值 {result}）。"));
            }

            Ok(Self {
                module,
                term,
                set_equation,
                close_object,
            })
        }

        unsafe fn write_equation(&self, object: *mut c_void, tex: &str) -> Result<(), String> {
            let mut tex_wide: Vec<u16> = tex.encode_utf16().chain(std::iter::once(0)).collect();
            let set_result = (self.set_equation)(
                object,
                1,
                tex_wide.as_mut_ptr(),
                (tex_wide.len() - 1) as i32,
            );
            let close_result = (self.close_object)(1, object);
            if set_result != 0 || close_result != 0 {
                return Err(format!(
                    "MathType 写入公式失败（MTSetEqnFromLangStr={set_result}, MTCloseOleObject={close_result}）。"
                ));
            }
            Ok(())
        }
    }

    impl Drop for MathTypeApi {
        fn drop(&mut self) {
            unsafe {
                (self.term)();
                FreeLibrary(self.module);
            }
        }
    }

    unsafe fn load_proc<T: Copy>(module: HMODULE, name: &'static [u8]) -> Option<T> {
        let function = GetProcAddress(module, name.as_ptr() as PCSTR)?;
        let address = function as *const ();
        Some(transmute_copy::<*const (), T>(&address))
    }

    fn wide_null(value: &str) -> Vec<u16> {
        value.encode_utf16().chain(std::iter::once(0)).collect()
    }

    unsafe fn clear_variants(values: &mut [VARIANT]) {
        for value in values {
            VariantClear(value);
        }
    }

    unsafe fn variant_bstr(value: &str) -> Result<VARIANT, String> {
        let wide: Vec<u16> = value.encode_utf16().collect();
        let bstr = SysAllocStringLen(wide.as_ptr(), wide.len() as u32);
        if bstr.is_null() {
            return Err("无法为 Word COM 参数分配 BSTR。".into());
        }
        let mut variant = VARIANT::default();
        variant.Anonymous.Anonymous.vt = VT_BSTR;
        variant.Anonymous.Anonymous.Anonymous.bstrVal = bstr;
        Ok(variant)
    }

    fn variant_i4(value: i32) -> VARIANT {
        let mut variant = VARIANT::default();
        variant.Anonymous.Anonymous.vt = VT_I4;
        variant.Anonymous.Anonymous.Anonymous.lVal = value;
        variant
    }

    fn variant_bool(value: bool) -> VARIANT {
        let mut variant = VARIANT::default();
        variant.Anonymous.Anonymous.vt = VT_BOOL;
        variant.Anonymous.Anonymous.Anonymous.boolVal = if value { -1 } else { 0 };
        variant
    }

    unsafe fn take_dispatch(mut value: VARIANT) -> Result<ComPtr, String> {
        let variant_type = value.Anonymous.Anonymous.vt;
        let pointer = if variant_type == VT_DISPATCH {
            value.Anonymous.Anonymous.Anonymous.pdispVal
        } else {
            null_mut()
        };
        if pointer.is_null() {
            VariantClear(&mut value);
            return Err(format!(
                "Word COM 返回的不是可用对象（VARIANT 类型 {variant_type}）。"
            ));
        }
        let dispatch = pointer.cast::<DispatchObject>();
        ((*(*dispatch).vtable).add_ref)(pointer);
        VariantClear(&mut value);
        Ok(ComPtr(pointer.cast()))
    }

    unsafe fn variant_i32(mut value: VARIANT) -> Result<i32, String> {
        let variant_type = value.Anonymous.Anonymous.vt;
        let result = match variant_type {
            VT_I4 | VT_INT => value.Anonymous.Anonymous.Anonymous.lVal,
            VT_I2 => value.Anonymous.Anonymous.Anonymous.iVal as i32,
            VT_UI4 => value.Anonymous.Anonymous.Anonymous.ulVal as i32,
            _ => {
                VariantClear(&mut value);
                return Err(format!(
                    "Word COM 返回的不是整数（VARIANT 类型 {variant_type}）。"
                ));
            }
        };
        VariantClear(&mut value);
        Ok(result)
    }

    unsafe fn bstr_to_string(value: BSTR) -> Option<String> {
        if value.is_null() {
            return None;
        }
        let length = SysStringLen(value) as usize;
        Some(String::from_utf16_lossy(slice::from_raw_parts(
            value, length,
        )))
    }

    unsafe fn variant_string(mut value: VARIANT) -> Result<String, String> {
        let variant_type = value.Anonymous.Anonymous.vt;
        let result = if variant_type == VT_BSTR {
            bstr_to_string(value.Anonymous.Anonymous.Anonymous.bstrVal).unwrap_or_default()
        } else {
            VariantClear(&mut value);
            return Err(format!(
                "Word 文档正文不是 BSTR（VARIANT 类型 {variant_type}）。"
            ));
        };
        VariantClear(&mut value);
        Ok(result)
    }

    unsafe fn document_text(document: &ComPtr) -> Result<Vec<u16>, String> {
        let content = document.get_dispatch("Content")?;
        let text = variant_string(content.get("Text")?)?;
        Ok(text.encode_utf16().collect())
    }

    unsafe fn inline_shape_count(collection: &ComPtr) -> Result<i32, String> {
        variant_i32(collection.get("Count")?)
    }

    unsafe fn shape_range_start(shape: &ComPtr) -> Option<i32> {
        let range = shape.get_dispatch("Range").ok()?;
        variant_i32(range.get("Start").ok()?).ok()
    }

    unsafe fn find_inserted_shape(
        document: &ComPtr,
        range: &ComPtr,
        formula_start: i32,
        count_before: i32,
    ) -> Result<ComPtr, String> {
        if let Ok(range_shapes) = range.get_dispatch("InlineShapes") {
            if inline_shape_count(&range_shapes).unwrap_or(0) > 0 {
                let item = range_shapes.method("Item", vec![variant_i4(1)])?;
                return take_dispatch(item);
            }
        }

        let shapes = document.get_dispatch("InlineShapes")?;
        let count_after = inline_shape_count(&shapes)?;
        if count_after <= count_before {
            return Err(format!(
                "插入 BlankEqn.doc 后没有发现 MathType InlineShape（InlineShapes: {count_before} -> {count_after}）。"
            ));
        }

        let mut nearest: Option<(i32, ComPtr)> = None;
        for index in 1..=count_after {
            let item = shapes.method("Item", vec![variant_i4(index)])?;
            let shape = take_dispatch(item)?;
            if let Some(start) = shape_range_start(&shape) {
                let distance = (start - formula_start).abs();
                let should_replace = nearest
                    .as_ref()
                    .map(|(nearest_distance, _)| distance < *nearest_distance)
                    .unwrap_or(true);
                if should_replace {
                    nearest = Some((distance, shape));
                }
            }
        }
        nearest
            .map(|(_, shape)| shape)
            .or_else(|| {
                shapes
                    .method("Item", vec![variant_i4(count_after)])
                    .ok()
                    .and_then(|item| take_dispatch(item).ok())
            })
            .ok_or_else(|| "无法定位刚插入的 MathType InlineShape。".into())
    }

    unsafe fn replace_placeholders(document: &ComPtr) -> Result<(), String> {
        let placeholder: Vec<u16> = LITERAL_DOLLAR_PLACEHOLDER.encode_utf16().collect();
        loop {
            let text = document_text(document)?;
            let Some(start) = text
                .windows(placeholder.len())
                .position(|window| window == placeholder.as_slice())
            else {
                return Ok(());
            };
            let item = document.method(
                "Range",
                vec![
                    variant_i4(start as i32),
                    variant_i4((start + placeholder.len()) as i32),
                ],
            )?;
            let range = take_dispatch(item)?;
            range.put("Text", variant_bstr("$")?)?;
        }
    }

    unsafe fn insert_formula(
        document: &ComPtr,
        range: &ComPtr,
        formula_start: i32,
        placeholder: &str,
        formula: &MathTypeFormula,
        blank_equation: &Path,
    ) -> Result<ComPtr, String> {
        let selected = variant_string(range.get("Text")?)?;
        if selected != placeholder {
            return Err(format!(
                "Word 定位到的公式占位符文本不一致：期望 {placeholder:?}，实际 {selected:?}。"
            ));
        }
        let shapes = document.get_dispatch("InlineShapes")?;
        let count_before = inline_shape_count(&shapes)?;
        range.method_no_result(
            "InsertFile",
            vec![
                variant_bstr(&blank_equation.to_string_lossy())?,
                variant_bstr("MTBlankEqn")?,
            ],
        )?;
        let shape = find_inserted_shape(document, range, formula_start, count_before)?;
        let ole_format = shape.get_dispatch("OLEFormat")?;
        // Registry verb 2 is MathType's `RunForConversion`.  It creates the
        // server-side conversion context without opening the formula editor.
        ole_format.method_no_result("DoVerb", vec![variant_i4(2)])?;
        let ole_object = wait_for_math_type_ole_object(&ole_format)?;
        ole_object.set_mathml(&formula.mathml)?;
        if formula.display {
            center_display_formula(&shape)?;
        }
        Ok(shape)
    }

    unsafe fn center_display_formula(shape: &ComPtr) -> Result<(), String> {
        let object_range = shape.get_dispatch("Range")?;
        let paragraph = object_range.get_dispatch("ParagraphFormat")?;
        // `wdAlignParagraphCenter`; display placeholders live in their own
        // paragraph after the Pandoc filter has run.
        paragraph.put("Alignment", variant_i4(1))
    }

    unsafe fn insert_cached_formula(
        document: &ComPtr,
        range: &ComPtr,
        formula_start: i32,
        placeholder: &str,
        formula: &MathTypeFormula,
        cache_entry: &NativeFormulaCacheEntry,
    ) -> Result<ComPtr, String> {
        let selected = variant_string(range.get("Text")?)?;
        if selected != placeholder {
            return Err(format!(
                "Word 定位到的公式占位符文本不一致：期望 {placeholder:?}，实际 {selected:?}。"
            ));
        }
        let app = document.get_dispatch("Application")?;
        let documents = app.get_dispatch("Documents")?;
        let cached_document = take_dispatch(documents.method(
            "Open",
            vec![variant_bstr(&cache_entry.document_path.to_string_lossy())?],
        )?)?;
        let result: Result<ComPtr, String> = (|| {
            let cached_shapes = cached_document.get_dispatch("InlineShapes")?;
            if inline_shape_count(&cached_shapes)? != 1 {
                return Err("MathType 公式缓存文件不包含唯一的 InlineShape。".into());
            }
            let cached_shape = take_dispatch(cached_shapes.method("Item", vec![variant_i4(1)])?)?;
            let cached_range = cached_shape.get_dispatch("Range")?;
            cached_range.method_no_result("Copy", vec![])?;

            let shapes = document.get_dispatch("InlineShapes")?;
            let count_before = inline_shape_count(&shapes)?;
            range.method_no_result("Paste", vec![])?;
            let shape = find_inserted_shape(document, range, formula_start, count_before)?;
            if formula.display {
                center_display_formula(&shape)?;
            }
            Ok(shape)
        })();
        let _ = cached_document.method_no_result("Close", vec![variant_bool(false)]);
        result
    }

    unsafe fn write_native_formula_cache(
        document: &ComPtr,
        shape: &ComPtr,
        cache_entry: &NativeFormulaCacheEntry,
    ) -> Result<(), String> {
        if native_formula_cache_is_valid(cache_entry) {
            return Ok(());
        }
        let source_range = shape.get_dispatch("Range")?;
        source_range.method_no_result("Copy", vec![])?;
        let app = document.get_dispatch("Application")?;
        let documents = app.get_dispatch("Documents")?;
        let cache_document = take_dispatch(documents.method("Add", vec![])?)?;
        let pending_path = cache_entry.document_path.with_extension("pending.docx");
        let result: Result<(), String> = (|| {
            let destination_range = cache_document.get_dispatch("Content")?;
            // The empty document's content range includes its final paragraph
            // mark.  Collapse its end before Paste so the cache holds only the
            // equation's own range, not an extra empty paragraph.
            destination_range.put("End", variant_i4(0))?;
            destination_range.method_no_result("Paste", vec![])?;
            let _ = std::fs::remove_file(&pending_path);
            cache_document.method_no_result(
                "SaveAs2",
                vec![
                    variant_bstr(&pending_path.to_string_lossy())?,
                    // wdFormatDocumentDefault: save the cache as a DOCX.
                    variant_i4(16),
                ],
            )?;
            Ok(())
        })();
        let _ = cache_document.method_no_result("Close", vec![variant_bool(false)]);
        result?;

        let _ = std::fs::remove_file(&cache_entry.document_path);
        std::fs::rename(&pending_path, &cache_entry.document_path)
            .map_err(|error| format!("无法完成 MathType 公式缓存写入：{error}"))?;
        write_native_formula_cache_metadata(cache_entry)
    }

    /// MathType's OLE server is usually ready immediately, but Word can expose
    /// the InlineShape slightly before its Object dispatch is available. Poll
    /// only in that exceptional window instead of sleeping for every formula.
    unsafe fn wait_for_math_type_ole_object(ole_format: &ComPtr) -> Result<ComPtr, String> {
        let mut last_error = None;
        for _ in 0..40 {
            match ole_format.get_dispatch("Object") {
                Ok(object) => return Ok(object),
                Err(error) => last_error = Some(error),
            }
            thread::sleep(Duration::from_millis(50));
        }
        Err(last_error.unwrap_or_else(|| "MathType OLE 对象未及时就绪。".into()))
    }

    unsafe fn convert_document(
        document: &ComPtr,
        blank_equation: &Path,
        formulas: &[MathTypeFormula],
        formula_range: std::ops::Range<usize>,
        is_final_batch: bool,
        cache_dir: Option<&Path>,
        on_formula_converted: &mut dyn FnMut(),
    ) -> Result<usize, String> {
        const MAX_FORMULAS: usize = 10_000;
        if formulas.len() > MAX_FORMULAS {
            return Err("文档中的 MathType 公式数量超过安全上限，已停止转换。".into());
        }
        // Word ranges count story characters differently from the UTF-16 text
        // returned by `Content.Text` around some table and field boundaries.
        // Find each unique placeholder through Word itself instead of deriving
        // a Range position from that text. Work from the end so inserting an
        // OLE object cannot affect a later formula's document position.
        let formula_count = formula_range.len();
        for index in formula_range.rev() {
            let placeholder = format!("HAKUROU_MTEF_FORMULA_{:04}", index + 1);
            let range = document.get_dispatch("Content")?.get_dispatch("Duplicate")?;
            let finder = range.get_dispatch("Find")?;
            finder.method_no_result("ClearFormatting", vec![])?;
            finder.put("Text", variant_bstr(&placeholder)?)?;
            finder.put("Forward", variant_bool(true))?;
            // wdFindStop: never continue from the end back to the start.
            finder.put("Wrap", variant_i4(0))?;
            finder.method_no_result("Execute", vec![])?;
            let selected = variant_string(range.get("Text")?)?;
            if selected != placeholder {
                return Err(format!(
                    "没有在 Word 文档中找到第 {} 个 MathType 公式占位符。",
                    index + 1
                ));
            }
            let start = variant_i32(range.get("Start")?)?;
            let formula = &formulas[index];
            let cache_entry = cache_dir
                .and_then(|directory| native_formula_cache_entry(directory, formula).ok());
            if let Some(entry) = cache_entry.as_ref().filter(|entry| native_formula_cache_is_valid(entry)) {
                insert_cached_formula(document, &range, start, &placeholder, formula, entry)
                    .map_err(|error| format!("第 {} 个 MathType 公式缓存复用失败：{error}", index + 1))?;
            } else {
                let shape = insert_formula(
                    document,
                    &range,
                    start,
                    &placeholder,
                    formula,
                    blank_equation,
                )
                .map_err(|error| format!("第 {} 个 MathType 公式转换失败：{error}", index + 1))?;
                if let Some(entry) = cache_entry.as_ref() {
                    // Cache persistence is an optimization; a read-only or
                    // temporarily unavailable asset folder must never make a
                    // Word export fail after MathType has rendered correctly.
                    let _ = write_native_formula_cache(document, &shape, entry);
                }
            }
            record_resource_sample(index + 1);
            on_formula_converted();
        }
        if is_final_batch {
            let after = document_text(document)?;
            let marker: Vec<u16> = "HAKUROU_MTEF_FORMULA_".encode_utf16().collect();
            if after
                .windows(marker.len())
                .any(|window| window == marker.as_slice())
            {
                return Err("Word 没有替换全部 MathType 公式占位符，已停止转换。".into());
            }
        }
        replace_placeholders(document)?;
        Ok(formula_count)
    }

    unsafe fn convert_with_word(
        document_path: &Path,
        blank_equation: &Path,
        formulas: &[MathTypeFormula],
        formula_range: std::ops::Range<usize>,
        is_final_batch: bool,
        cache_dir: Option<&Path>,
        on_formula_converted: &mut dyn FnMut(),
    ) -> Result<usize, String> {
        let mut clsid = GUID::default();
        let word_progid = wide_null("Word.Application");
        let hr = CLSIDFromProgID(word_progid.as_ptr(), &mut clsid);
        if hr < 0 {
            return Err(format!(
                "无法定位 Word.Application（HRESULT 0x{:08X}）。",
                hr as u32
            ));
        }

        let mut raw_app: *mut c_void = null_mut();
        let hr = CoCreateInstance(
            &clsid,
            null_mut(),
            CLSCTX_LOCAL_SERVER,
            &IID_IDISPATCH,
            &mut raw_app,
        );
        if hr < 0 {
            return Err(format!(
                "无法启动 Microsoft Word（HRESULT 0x{:08X}）。请确认 Word 未被系统阻止自动化。",
                hr as u32
            ));
        }
        let app = ComPtr::from_raw(raw_app)?;
        let mut document: Option<ComPtr> = None;
        let result = (|| {
            app.put("Visible", variant_bool(true))?;
            app.put("DisplayAlerts", variant_i4(0))?;
            let documents = app.get_dispatch("Documents")?;
            let item = documents.method(
                "Open",
                vec![variant_bstr(&document_path.to_string_lossy())?],
            )?;
            let opened = take_dispatch(item)?;
            document = Some(opened);
            let opened = document.as_ref().expect("document was just assigned");
            let converted = convert_document(
                opened,
                blank_equation,
                formulas,
                formula_range,
                is_final_batch,
                cache_dir,
                on_formula_converted,
            )?;
            opened.method_no_result("Save", Vec::new())?;
            Ok(converted)
        })();

        if let Some(opened) = document.as_ref() {
            let _ = opened.method_no_result("Close", vec![variant_bool(false)]);
        }
        let _ = app.method_no_result("Quit", vec![variant_bool(false)]);
        result
    }

    pub fn convert_docx_formulas_with_progress(
        document_path: &Path,
        formulas: &[MathTypeFormula],
        cache_dir: Option<&Path>,
        on_progress: &mut dyn FnMut(MathTypeConversionProgress),
    ) -> Result<usize, String> {
        let blank_equation = blank_equation_document()
            .ok_or_else(|| "未找到 MathType Office Support\\BlankEqn.doc。".to_owned())?;
        let initialized = unsafe { CoInitializeEx(null(), COINIT_APARTMENTTHREADED as u32) };
        if initialized < 0 {
            return Err(format!(
                "无法初始化 Word COM 线程（HRESULT 0x{:08X}）。",
                initialized as u32
            ));
        }

        let mut converted = 0usize;
        let mut start = 0usize;
        let formulas_per_session = formulas_per_word_session();
        let batch_count = formulas.len().div_ceil(formulas_per_session);
        while start < formulas.len() {
            let end = (start + formulas_per_session).min(formulas.len());
            let is_final_batch = end == formulas.len();
            let batch_index = start / formulas_per_session + 1;
            on_progress(MathTypeConversionProgress {
                completed: start,
                total: formulas.len(),
                batch_index,
                batch_count,
                batch_started: true,
            });
            let mut batch_completed = 0usize;
            let mut on_formula_converted = || {
                batch_completed += 1;
                on_progress(MathTypeConversionProgress {
                    completed: start + batch_completed,
                    total: formulas.len(),
                    batch_index,
                    batch_count,
                    batch_started: false,
                });
            };
            let current = unsafe {
                convert_with_word(
                    document_path,
                    &blank_equation,
                    formulas,
                    start..end,
                    is_final_batch,
                    cache_dir,
                    &mut on_formula_converted,
                )
            }
            .map_err(|error| {
                format!(
                    "MathType 第 {}–{} 个公式批次转换失败：{error}",
                    start + 1,
                    end
                )
            });
            match current {
                Ok(count) => converted += count,
                Err(error) => {
                    if initialized == 0 || initialized == S_FALSE {
                        unsafe { CoUninitialize() };
                    }
                    return Err(error);
                }
            }
            start = end;
        }
        if initialized == 0 || initialized == S_FALSE {
            unsafe { CoUninitialize() };
        }
        Ok(converted)
    }
}

#[cfg(windows)]
pub fn convert_docx_formulas(
    document_path: &std::path::Path,
    formulas: &[MathTypeFormula],
) -> Result<(), String> {
    convert_docx_formulas_with_progress(document_path, formulas, |_| {})
}

#[cfg(windows)]
pub fn convert_docx_formulas_with_progress<F>(
    document_path: &std::path::Path,
    formulas: &[MathTypeFormula],
    mut on_progress: F,
) -> Result<(), String>
where
    F: FnMut(MathTypeConversionProgress),
{
    convert_docx_formulas_with_cache_and_progress(document_path, formulas, None, &mut on_progress)
}

#[cfg(windows)]
pub fn convert_docx_formulas_with_cache_and_progress<F>(
    document_path: &std::path::Path,
    formulas: &[MathTypeFormula],
    cache_dir: Option<&std::path::Path>,
    mut on_progress: F,
) -> Result<(), String>
where
    F: FnMut(MathTypeConversionProgress),
{
    let status = available_status();
    if !status.available {
        return Err(status
            .message
            .unwrap_or_else(|| "MathType 当前不可用。".into()));
    }
    windows_bridge::convert_docx_formulas_with_progress(
        document_path,
        formulas,
        cache_dir,
        &mut on_progress,
    )
    .map(|_| ())
}

#[cfg(not(windows))]
pub fn convert_docx_formulas(
    _document_path: &std::path::Path,
    _formulas: &[MathTypeFormula],
) -> Result<(), String> {
    Err("MathType 交付仅支持 Windows、Microsoft Word 与 MathType 7。".into())
}

#[cfg(not(windows))]
pub fn convert_docx_formulas_with_progress<F>(
    _document_path: &std::path::Path,
    _formulas: &[MathTypeFormula],
    _on_progress: F,
) -> Result<(), String>
where
    F: FnMut(MathTypeConversionProgress),
{
    Err("MathType 交付仅支持 Windows、Microsoft Word 与 MathType 7。".into())
}

#[cfg(not(windows))]
pub fn convert_docx_formulas_with_cache_and_progress<F>(
    _document_path: &std::path::Path,
    _formulas: &[MathTypeFormula],
    _cache_dir: Option<&std::path::Path>,
    _on_progress: F,
) -> Result<(), String>
where
    F: FnMut(MathTypeConversionProgress),
{
    Err("MathType 交付仅支持 Windows、Microsoft Word 与 MathType 7。".into())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn native_formula_cache_uses_a_stable_renderer_scoped_key() {
        let nonce = std::time::SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("system time should be after Unix epoch")
            .as_nanos();
        let root = std::env::temp_dir().join(format!(
            "hakurou-native-formula-cache-{}-{nonce}",
            std::process::id()
        ));
        let formula = MathTypeFormula {
            mathml: "<math><mi>x</mi></math>".into(),
            display: false,
        };
        let first = native_formula_cache_entry(&root, &formula).expect("cache entry");
        let second = native_formula_cache_entry(&root, &formula).expect("same cache entry");
        assert_eq!(first.document_path, second.document_path);
        assert!(first.document_path.ends_with(format!("{}.docx", first.metadata.key)));

        fs::write(&first.document_path, b"native OLE cache fixture").expect("cache document");
        write_native_formula_cache_metadata(&first).expect("cache metadata");
        assert!(native_formula_cache_is_valid(&first));

        let display_formula = MathTypeFormula {
            mathml: formula.mathml.clone(),
            display: true,
        };
        let display_entry =
            native_formula_cache_entry(&root, &display_formula).expect("display cache entry");
        assert_ne!(first.document_path, display_entry.document_path);
        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn finds_inline_and_display_math_spans() {
        let text: Vec<u16> = "前 $x_i$ 中 $$E=mc^2$$ 后".encode_utf16().collect();
        let first = find_next_math_span(&text).expect("inline span");
        assert_eq!(
            &String::from_utf16(&text[first.start..first.end]).unwrap(),
            "$x_i$"
        );
        let second_text = &text[first.end..];
        let second = find_next_math_span(second_text).expect("display span");
        assert_eq!(second.delimiter_len, 2);
        assert_eq!(
            &String::from_utf16(&second_text[second.start..second.end]).unwrap(),
            "$$E=mc^2$$"
        );
    }

    #[test]
    fn wraps_plain_text_for_mathtype_parser() {
        assert_eq!(wrap_plain_math_type_text("E"), r"\mathit{E}");
        assert_eq!(wrap_plain_math_type_text("123"), r"\mathit{123}");
        assert_eq!(wrap_plain_math_type_text(r"x^2"), r"x^2");
        assert_eq!(wrap_plain_math_type_text(r"\alpha"), r"\alpha");
    }

    #[test]
    fn creates_mathtype_compatible_variants_for_tags_and_aligned() {
        let variants = math_type_tex_variants(r"\begin{aligned}x&=1\\y&=2\end{aligned}\tag{3}");
        assert!(variants
            .iter()
            .any(|variant| variant.contains(r"\begin{array}{rl}")
                && variant.contains(r"\quad\mathrm{(3)}")
                && !variant.contains(r"\tag")));
        assert!(variants.iter().any(|variant| {
            variant.contains(r"\begin{array}{rl}") && !variant.contains(r"\tag")
        }));
    }

    #[test]
    fn creates_a_mathtype_safe_variant_for_literal_braces() {
        let variants = math_type_tex_variants(r"\\{W\\}");
        assert!(variants
            .iter()
            .any(|variant| variant == r"\left\{W\right\}"));
        assert_eq!(
            math_type_literal_brace_variant(r"\left\{W\right\}"),
            r"\left\{W\right\}"
        );
    }

    #[test]
    fn placeholder_does_not_look_like_a_formula() {
        let text: Vec<u16> = LITERAL_DOLLAR_PLACEHOLDER.encode_utf16().collect();
        assert!(find_next_math_span(&text).is_none());
    }

    #[test]
    fn escaped_dollar_inside_tex_is_not_a_closing_delimiter() {
        let text: Vec<u16> = r"$\text{\$}$".encode_utf16().collect();
        let span = find_next_math_span(&text).expect("escaped dollar formula");
        assert_eq!(
            &String::from_utf16(&text[span.start..span.end]).unwrap(),
            r"$\text{\$}$"
        );
    }

    #[test]
    fn unsupported_platform_reports_a_clear_requirement() {
        #[cfg(not(windows))]
        assert!(!available_status().available);
    }
}
