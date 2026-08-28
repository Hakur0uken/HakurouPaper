#!/usr/bin/env python3
"""Frozen experimental direct-MTEF/OLE writer.

This is not the current export route. It embeds KaTeX-previewed MathML as
``Equation.DSMT4`` objects through the separately installed ``docx-equation``
package; Hakurou supplies the preview PNGs itself, so no browser renderer is
started by this process. Its historical status and licensing boundary are
documented in ``docs/archive/mathtype-experiments.md``.
"""

from __future__ import annotations

import base64
import ctypes
import dataclasses
import io
import json
import shutil
import subprocess
import sys
from pathlib import Path
from zipfile import ZIP_DEFLATED, ZipFile

try:
    from lxml import etree
    from docx_equation import EquationSpec, ExportOptions, MathTypeOptions, embed_mathml_placeholders
    from docx_equation.mathtype import embed as mathtype_embed
    from docx_equation.shared.ooxml import NS, find_placeholder_run
    import olefile
except ImportError as error:
    raise SystemExit(
        "缺少 MTEF 直写器依赖。请运行：py -3 -m pip install docx-equation==0.3.0"
    ) from error


# ---------------------------------------------------------------------------
# MTEF 编码补丁（针对 docx-equation 0.3.0）
#
# 用真实 MathType 5/6 输出（jure/mathtype 的 fixture 逐字节验证）对照后确认
# docx-equation 的 mtef.py 在脚本类模板上有两处字节错误，会导致 MathType 7
# 无法打开含上标/下标/上下标的 OLE 对象（分式等不含空槽的模板不受影响）：
#
#   1. `_empty_line()` 返回 b"\x01\x01\x00"（3 字节）。MTEF v5 中 options=0x01
#      的 LINE 是 null 行，没有 object_list（见 jure/mathtype lib/records5/line.rb），
#      记录本身只有 b"\x01\x01"（2 字节）。多出的 0x00 会被 MathType 当作 END
#      提前终止 TMPL 的子对象列表，把脚本内容挤出模板槽。
#   2. Subscript / Superscript / Subsup 的 encode() 在模板的终止 END 之后还
#      追加了 FULL(0x0A) 记录；真实 MathType 输出中模板在单个 END 后即结束。
#
# 修复方式与本文件已有的 `_render_previews` 替换一致：只在运行时替换编码
# 函数，不修改 site-packages 里的包文件；依赖版本锁定 ==0.3.0。
# ---------------------------------------------------------------------------
import docx_equation.mathtype.mtef as _mtef


def _fixed_empty_line() -> bytes:
    """MTEF v5 null 行：只有 tag + options（01 01），没有 object_list。"""
    return b"\x01\x01"


def _fixed_subscript_encode(self) -> bytes:
    return (
        self.base.encode()
        + b"\x03\x00\x1b\x00\x00\x0b"          # TMPL tmSUB + SUB
        + _mtef._line(self.subscript)           # 槽1：下标
        + _fixed_empty_line()                   # 槽2：null（上标位置）
        + b"\x00"                               # TMPL 子对象列表终止 END
    )


def _fixed_superscript_encode(self) -> bytes:
    return (
        self.base.encode()
        + b"\x03\x00\x1c\x00\x00\x0b"          # TMPL tmSUP + SUB
        + _fixed_empty_line()                   # 槽1：null（下标位置）
        + _mtef._line(self.superscript)         # 槽2：上标
        + b"\x00"                               # TMPL 子对象列表终止 END
    )


def _fixed_subsup_encode(self) -> bytes:
    return (
        self.base.encode()
        + _mtef._template(0x1D, 0, 0)           # TMPL tmSUBSUP
        + b"\x0b"                               # SUB
        + _mtef._line(self.subscript)           # 槽1：下标
        + _mtef._line(self.superscript)         # 槽2：上标
        + b"\x00"                               # TMPL 子对象列表终止 END
    )


# ---------------------------------------------------------------------------
# Hat（装饰符模板）修复
#
# 真实 MathType 的 tmTILDE/tmHAT/tmVEC 模板在主体 LINE 之外还带一个
# "装饰符号" CHAR 子对象（typeface 0x96 + combining 字符），docx-equation
# 只写了主体，缺该符号会导致 MathType 无法正确打开。字节对照真实输出：
#   tilde: 03 00 20 00 00 01 00 <u> 00 02 00 96 03 03 00
#   hat  : 03 00 21 00 00 01 00 <p> 00 02 00 96 02 03 00
# vector 装饰符号按 MathML \vec 的 combining right arrow (U+20D7) 生成，
# 待真实 MathType 样本复核。
# ---------------------------------------------------------------------------
_HAT_DECORATION = {
    "vector": (0x1F, 0x20D7),
    "tilde": (0x20, 0x0303),
    "hat": (0x21, 0x0302),
}


def _fixed_hat_encode(self) -> bytes:
    selector, decoration = _HAT_DECORATION.get(self.kind, (0x21, 0x0302))
    variation = 0x02 if self.kind == "vector" else 0x00
    return (
        _mtef._template(selector, variation, 0)
        + _mtef._line(self.body)
        + bytes([0x02, 0x00, 0x96])
        + decoration.to_bytes(2, "little")
        + b"\x00"
    )


_mtef._empty_line = _fixed_empty_line
_mtef.Subscript.encode = _fixed_subscript_encode
_mtef.Superscript.encode = _fixed_superscript_encode
_mtef.Subsup.encode = _fixed_subsup_encode
_mtef.Hat.encode = _fixed_hat_encode

# ---------------------------------------------------------------------------
# 粗体（mathvariant）支持
#
# MathML 的 mathvariant 属性（KaTeX 的 \mathbf / \boldsymbol 等）在
# docx-equation 0.3.0 的解析器中被忽略，粗体在 MathType 中显示为普通字体。
# 真实 MathType 输出中粗体变量与粗体希腊字母统一使用 typeface 0x87
# （vector，含 \boldsymbol{\eta} 的 η），故 mathvariant 含 "bold" 的文本
# 直接以 typeface 0x87 编码；非粗体保持原默认逻辑不变。
# ---------------------------------------------------------------------------
_MATHVARIANT_TYPEFACE = {
    "bold": 0x87,
    "bold-italic": 0x87,
    "bold-script": 0x87,
}


@dataclasses.dataclass(frozen=True)
class _FixedText:
    value: str
    typeface: int | None = None

    def encode(self) -> bytes:
        if self.typeface is None:
            return b"".join(_mtef._encode_char(char) for char in self.value)
        chunks: list[bytes] = []
        for char in self.value:
            code_point = ord(char)
            if code_point > 0xFFFF:
                raise ValueError(f"Character outside BMP is not supported yet: {char!r}")
            chunks.append(
                bytes([0x02, 0x00, self.typeface]) + code_point.to_bytes(2, "little")
            )
        return b"".join(chunks)


import docx_equation.shared.mathml as _mathml  # noqa: E402

_mathml_text_parser = _mathml._parse_element


def _fixed_parse_element(element: object) -> object:
    from lxml import etree as _etree

    local = _etree.QName(element).localname
    if local in {"mi", "mn", "mo", "mtext"}:
        variant = element.get("mathvariant")
        typeface = _MATHVARIANT_TYPEFACE.get(variant)
        text = _mathml._normalize_text("".join(element.itertext()))
        return _FixedText(text, typeface)
    return _mathml_text_parser(element)


_mathml._parse_element = _fixed_parse_element

# ---------------------------------------------------------------------------
# 公式字号：按 Word 模板正文匹配
#
# docx-equation 生成的 MTEF 不写显式字号，MathType 打开时使用其默认全尺寸，
# 与模板正文相比往往偏小。真实 MathType 5 输出会在 LINE 内开头写显式 SIZE
# 记录（0x09, select=101，点大小单位 1/32 pt，如 `09 65 80 01` = 12pt）。
# 这里读取 manifest 中可选 templateDocx 的 docDefaults / Normal 字号
# （w:sz 半磅），在 MTEF 主 LINE 内开头插入对应 SIZE 记录；无模板或读不到
# 字号时默认按 12pt（与 Pandoc 默认正文一致）。
# ---------------------------------------------------------------------------
_DEFAULT_FULL_SIZE_PT = 12.0

_W_NS = "http://schemas.openxmlformats.org/wordprocessingml/2006/main"


def read_template_full_size_pt(template_path: str | None) -> float | None:
    if not template_path:
        return None
    try:
        from zipfile import ZipFile as _ZipFile

        with _ZipFile(template_path) as archive:
            styles_root = etree.fromstring(archive.read("word/styles.xml"))
    except Exception:
        return None
    half_points: int | None = None
    for path in (
        f'.//{{{_W_NS}}}style[@{{{_W_NS}}}styleId="Normal"]/{{{_W_NS}}}rPr/{{{_W_NS}}}sz',
        f".//{{{_W_NS}}}docDefaults/{{{_W_NS}}}rPrDefault/{{{_W_NS}}}rPr/{{{_W_NS}}}sz",
    ):
        element = styles_root.find(path)
        if element is None:
            continue
        raw = element.get(f"{{{_W_NS}}}val")
        try:
            half_points = int(raw) if raw else None
        except ValueError:
            half_points = None
        if half_points:
            break
    return half_points / 2.0 if half_points else None


_orig_encode_mtef = _mtef.encode_mtef


def _fixed_encode_mtef(expr, mathtype_version: str = "DSMT4") -> bytes:
    full_size_pt = getattr(_mtef, "_FULL_SIZE_PT", None)
    if full_size_pt is None:
        return _orig_encode_mtef(expr, mathtype_version)
    point_value = int(round(full_size_pt * 32)) & 0xFFFF
    size_record = bytes([0x09, 0x65, point_value & 0xFF, point_value >> 8])
    return (
        _mtef._preamble(mathtype_version)
        + b"\x0a"
        + b"\x01\x00"
        + size_record
        + expr.encode()
        + b"\x00"
        + b"\x00"
    )


_mtef.encode_mtef = _fixed_encode_mtef
# embed.py 通过 `from docx_equation.mathtype.mtef import encode_mtef` 绑定
# 了模块名，须同时替换它内部的引用，否则字号 SIZE 记录不会写入。
mathtype_embed.encode_mtef = _fixed_encode_mtef

# ---------------------------------------------------------------------------
# OOXML 修补：禁用 docx-equation 的 _ensure_mc
#
# docx-equation 0.3.0 的 `_ensure_mc` 会把 "dxeq" 追加到根元素的
# mc:Ignorable 属性。Pandoc 生成的基础 DOCX 没有声明 mc 前缀，lxml 序列化
# 时自动生成 ns0 前缀（ns0:Ignorable="dxeq"），且 "dxeq" 前缀从未声明；
# Word 要求 Ignorable 中列出的前缀必须已声明，因此会直接判定文档损坏。
# 我们使用 png-preview 嵌入模式，不产生 mc:AlternateContent，根本不需要
# Ignorable，这里把它置为空操作，保持 Pandoc 基础文档的原样。
# ---------------------------------------------------------------------------
def _noop_ensure_mc(_root: object) -> None:
    return None


mathtype_embed._ensure_mc = _noop_ensure_mc


def main() -> int:
    if len(sys.argv) != 2:
        raise SystemExit("Usage: mathtype_mtef_embed.py <manifest.json>")
    manifest_path = Path(sys.argv[1]).resolve()
    manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    source = Path(manifest["sourceDocx"]).resolve()
    output = Path(manifest["outputDocx"]).resolve()
    stream_manifest = Path(manifest["streamManifest"]).resolve()
    items = manifest["equations"]

    if not source.is_file():
        raise SystemExit("MTEF 临时 Word 文档不存在。")
    if output.parent != manifest_path.parent:
        raise SystemExit("MTEF 输出路径必须位于临时导出目录。")

    template_docx = manifest.get("templateDocx")
    template_full_size_pt = read_template_full_size_pt(template_docx)
    _mtef._FULL_SIZE_PT = template_full_size_pt or _DEFAULT_FULL_SIZE_PT

    parser = etree.XMLParser(resolve_entities=False, recover=True, remove_blank_text=False)
    with ZipFile(source) as archive:
        document_root = etree.fromstring(archive.read("word/document.xml"), parser)

    # The app's Markdown scanner intentionally errs on the side of retaining
    # a preview. Pandoc can reject a final candidate for stricter inline-math
    # rules. Ignore only a contiguous tail of those candidates: a gap followed
    # by another placeholder would shift formula-to-preview pairing and remains
    # a hard error.
    active_items: list[dict[str, object]] = []
    skipped_tail = 0
    for index, item in enumerate(items, 1):
        placeholder = str(item["placeholder"])
        try:
            find_placeholder_run(document_root, placeholder)
        except ValueError:
            skipped_tail += 1
            continue
        if skipped_tail:
            raise SystemExit(
                f"公式预览与 Pandoc 公式顺序不一致：第 {index} 个公式前存在缺失占位符。"
            )
        active_items.append(item)

    previews: dict[int, Path] = {}
    equations: list[EquationSpec] = []
    for index, item in enumerate(active_items, 1):
        preview = Path(item["previewPath"]).resolve()
        if not preview.is_file() or preview.suffix.lower() != ".png":
            raise SystemExit(f"第 {index} 个 KaTeX 预览不存在。")
        mathml = str(item["mathml"])
        if not mathml.lstrip().startswith("<math"):
            raise SystemExit(f"第 {index} 个 KaTeX MathML 无效。")
        previews[index] = preview
        equations.append(EquationSpec(
            placeholder=str(item["placeholder"]),
            mathml=mathml,
            display=bool(item["display"]),
        ))

    def copy_supplied_previews(_mathml_dir: Path, preview_dir: Path, _options: object) -> None:
        for index, preview in previews.items():
            shutil.copyfile(preview, preview_dir / f"equation_{index:03d}.png")

    # docx-equation normally launches Chrome to render MathML. Replace only
    # that private rendering hook with the KaTeX PNGs Hakurou already made.
    mathtype_embed._render_previews = copy_supplied_previews
    options = ExportOptions(
        target="mathtype",
        display_layout="preserve",
        mathtype=MathTypeOptions(
            embed_mode="png-preview",
            mathtype_version="DSMT4",
            inline_height_pt=12.5,
            display_height_pt=21.0,
            max_width_pt=360.0,
            # 预览 PNG 由前端 KaTeX 以 pixelRatio=2 生成（物理像素 = CSS px × 2），
            # 1 CSS px = 0.75 pt（96dpi），故物理像素换算为 0.75 / 2 = 0.375 pt/px。
            # docx-equation 0.3.0 默认 0.15 会把公式缩到约 1/5 大小，导致 Word
            # 里公式对象明显偏小。
            preview_pt_per_px=0.375,
        ),
    )
    summary = embed_mathml_placeholders(source, output, equations, options, source.parent / "mtef-work")
    if summary.converted != len(equations):
        errors = "; ".join(error.message for error in summary.errors)
        raise SystemExit(f"MTEF 直写未完成（{summary.converted}/{len(equations)}）：{errors}")
    extracted_ole_objects = write_ole_stream_manifest(output, stream_manifest)
    # Keep the KaTeX PNG supplied above as the visible OLE presentation.
    #
    # MTXFormEqn's mtxfmTEXT input accepts plain text or MathType's private
    # MTEF-text, not arbitrary LaTeX. Feeding it our Markdown LaTeX produced
    # WMFs that expose commands such as "\\frac" and have incompatible bounds.
    # The direct MTEF -> PICT route was separately verified to return blank
    # WMFs, so neither route is a safe presentation generator. The OLE's MTEF
    # payload remains the authoritative editable formula; PNG is deliberately
    # retained until a visually verified vector route is available.
    print(json.dumps({
        "ok": True,
        "converted": summary.converted,
        "skippedTrailingPreviews": skipped_tail,
        "extractedOleObjects": extracted_ole_objects,
    }, ensure_ascii=False))
    return 0


# ---------------------------------------------------------------------------
# 已冻结的 WMF 实验（当前主流程不调用）
#
# 此段保留仅用于复现实验结论，不能重新接入导出流程：
#   - mtxfmTEXT 接受普通文本或 MathType 私有 MTEF-text，不接受任意 LaTeX；
#     传入 Markdown LaTeX 会生成含原始 \\frac 等命令、边界也不正确的 WMF。
#   - mtxfmMTEF -> mtxfmPICT 对已验证的 Equation Native/MTEF 样本会生成
#     空白 WMF。
#   - 两条路径均没有通过实际 Word 视觉验收。
#
# 若将来重启矢量预览研究，应另建经过 Word 渲染验证的方案，而非解除这里的冻结。
# ---------------------------------------------------------------------------
_CT_NS = "http://schemas.openxmlformats.org/package/2006/content-types"

# MathType SDK 常量（官方文档）
MTXFM_LOCAL = -3
MTXFM_FILE = -4
MTXFM_MTEF = 4
MTXFM_PICT = 6
MTXFM_TEXT = 7


# ---------------------------------------------------------------------------
# WMF 批量转换子进程
#
# MTXFormEqn 在 docx-equation 嵌入后的同一进程里连续转换约 100 个公式时会
# 偶发 access violation（读 0x0，进程级崩溃，Python 无法捕获）。因此批量
# 转换放到独立子进程分批执行：每批连接一次 MathType 引擎，子进程崩溃只
# 丢该批剩余公式（保留 PNG 预览），不影响整个导出。
# ---------------------------------------------------------------------------
_WMF_BATCH_SIZE = 20

_WMF_BATCH_SCRIPT = r'''# -*- coding: utf-8 -*-
import ctypes
import json
import os
import sys
from pathlib import Path


def _mt6_dll_path():
    bits = 8 * ctypes.sizeof(ctypes.c_void_p)
    root = Path(r"C:\Program Files (x86)\MathType")
    relative = Path("System") / ("64" if bits == 64 else "") / "MT6.dll"
    return root / relative


def main():
    batch_path = Path(sys.argv[1])
    work_dir = Path(sys.argv[2])
    batch = json.loads(batch_path.read_text(encoding="utf-8"))

    dll = _mt6_dll_path()
    if not dll.is_file():
        print("MathType MT6.dll 未找到", file=sys.stderr, flush=True)
        sys.exit(3)
    lib = ctypes.WinDLL(str(dll))
    lib.MTAPIConnect.argtypes = [ctypes.c_int16, ctypes.c_int16]
    lib.MTAPIConnect.restype = ctypes.c_int32
    lib.MTAPIDisconnect.argtypes = []
    lib.MTAPIDisconnect.restype = ctypes.c_int32
    lib.MTXFormEqn.argtypes = [
        ctypes.c_int32, ctypes.c_int32, ctypes.c_void_p, ctypes.c_int32,
        ctypes.c_int32, ctypes.c_int32, ctypes.c_void_p, ctypes.c_int32,
        ctypes.c_char_p, ctypes.c_void_p,
    ]
    lib.MTXFormEqn.restype = ctypes.c_int32

    ole32 = ctypes.WinDLL("ole32")
    ole32.CoInitializeEx(None, 2)
    connected = lib.MTAPIConnect(1, 30) == 0
    if not connected:
        # 残留 MathType 进程会使 MTAPIConnect 失败：清理后重试一次。
        import subprocess as _sp

        for name in ("MathType.exe", "MathTypeLib.exe", "MT6Lancher.exe"):
            _sp.run(["taskkill", "/F", "/IM", name], capture_output=True, check=False)
        connected = lib.MTAPIConnect(1, 30) == 0
    if not connected:
        print("MathType 连接失败", file=sys.stderr, flush=True)
        sys.exit(3)
    dims = ctypes.create_string_buffer(512)
    try:
        for item in batch:
            latex = str(item.get("latex") or "")
            out = work_dir / ("mathtype_preview_%03d.wmf" % item["index"])
            data = latex.encode("mbcs", errors="replace")
            source = ctypes.create_string_buffer(data)
            if out.exists():
                out.unlink()
            result = lib.MTXFormEqn(
                -3, 7, ctypes.addressof(source), len(data),
                -4, 6, None, 0, str(out).encode("mbcs"), dims,
            )
            if result != 0 or not out.is_file():
                print(
                    "skip %d: MTXFormEqn=%d" % (item["index"], result),
                    file=sys.stderr,
                    flush=True,
                )
    finally:
        try:
            lib.MTAPIDisconnect()
        except Exception:
            pass
    sys.exit(0)


if __name__ == "__main__":
    main()
'''


def generate_wmf_previews(items: list[dict[str, object]], work_dir: Path) -> list[Path]:
    """Render every formula's LaTeX to a WMF via MathType (batched subprocesses).

    ``items`` are the active manifest equations in formula order; each maps 1:1
    to a docx-equation preview (mathtype_preview_<index>.png). Formulas whose
    conversion fails or whose subprocess crashes keep their PNG preview.
    """
    latex_list = [str(item.get("latex") or "") for item in items]
    script_path = work_dir / "mathtype_wmf_batch.py"
    script_path.write_text(_WMF_BATCH_SCRIPT, encoding="utf-8")
    wmf_paths: list[Path] = []
    for start in range(0, len(latex_list), _WMF_BATCH_SIZE):
        batch = [
            {"index": index, "latex": latex_list[index]}
            for index in range(start, min(start + _WMF_BATCH_SIZE, len(latex_list)))
        ]
        batch_path = work_dir / f"wmf-batch-{start}.json"
        batch_path.write_text(json.dumps(batch, ensure_ascii=False), encoding="utf-8")
        try:
            subprocess.run(
                [sys.executable, "-X", "utf8", str(script_path), str(batch_path), str(work_dir)],
                capture_output=True,
                timeout=300,
                check=False,
            )
        except (subprocess.TimeoutExpired, OSError):
            pass  # 子进程崩溃/超时：该批剩余公式保留 PNG 预览
        for item in batch:
            wmf_paths.append(work_dir / f"mathtype_preview_{item['index']:03d}.wmf")
    return wmf_paths


def replace_previews_with_wmf(docx_path: Path, wmf_paths: list[Path]) -> None:
    """Replace the PNG preview bytes in word/media with MathType WMF bytes.

    File names stay .png (docx-equation references them); an image/x-wmf
    Override is added so Word renders them as vector WMF.
    """
    if not wmf_paths:
        return
    parser = etree.XMLParser(resolve_entities=False, recover=True)
    with ZipFile(docx_path) as archive:
        document_root = etree.fromstring(archive.read("word/document.xml"), parser)
        content_types_root = etree.fromstring(archive.read("[Content_Types].xml"), parser)
        entries: dict[str, bytes] = {}
        for name in archive.namelist():
            entries[name] = archive.read(name)

    image_rel_by_id: dict[str, str] = {}
    rels_root = etree.fromstring(entries["word/_rels/document.xml.rels"], parser)
    rel_ns = "http://schemas.openxmlformats.org/package/2006/relationships"
    image_rel_type = "http://schemas.openxmlformats.org/officeDocument/2006/relationships/image"
    for rel in rels_root.findall(f"{{{rel_ns}}}Relationship"):
        if rel.get("Type") == image_rel_type:
            image_rel_by_id[rel.get("Id")] = rel.get("Target")

    used_wmf: dict[str, bytes] = {}
    r_ns = "http://schemas.openxmlformats.org/officeDocument/2006/relationships"
    v_ns = "urn:schemas-microsoft-com:vml"
    for imagedata in document_root.iter(f"{{{v_ns}}}imagedata"):
        rid = imagedata.get(f"{{{r_ns}}}id")
        if not rid or rid not in image_rel_by_id:
            continue
        target = image_rel_by_id[rid]
        if not target.startswith("media/"):
            continue
        import re as _re

        match = _re.search(r"mathtype_preview_(\d+)\.png$", target)
        if not match:
            continue
        index = int(match.group(1))
        if index - 1 >= len(wmf_paths):
            continue
        wmf = wmf_paths[index - 1]
        if not wmf.is_file():
            continue  # 该公式 MathType 转换失败，保留 PNG 预览
        part = "word/" + target
        if part in entries:
            used_wmf[part] = wmf.read_bytes()

    for part_name, wmf_bytes in used_wmf.items():
        entries[part_name] = wmf_bytes
        etree.SubElement(
            content_types_root,
            f"{{{_CT_NS}}}Override",
            {"PartName": f"/{part_name}", "ContentType": "image/x-wmf"},
        )

    with ZipFile(docx_path, "w", ZIP_DEFLATED) as target:
        for name, data in entries.items():
            if name == "[Content_Types].xml":
                data = etree.tostring(content_types_root, encoding="utf-8", xml_declaration=True, standalone=True)
            target.writestr(name, data)


def write_ole_stream_manifest(docx_path: Path, manifest_path: Path) -> int:
    """Extract raw streams before the temporary docx-equation CFB is discarded.

    docx-equation's hand-written Compound File has a malformed directory tree,
    but olefile can still read its four payload streams.  Rust then rebuilds a
    compliant CFB container from precisely these bytes; it does not reuse this
    temporary container in the final DOCX.
    """
    stream_names = (chr(1) + "CompObj", chr(1) + "Ole", chr(3) + "ObjInfo", "Equation Native")
    objects: list[dict[str, object]] = []
    with ZipFile(docx_path) as archive:
        for entry in archive.namelist():
            if not entry.startswith("word/embeddings/") or not entry.endswith(".bin"):
                continue
            ole = olefile.OleFileIO(io.BytesIO(archive.read(entry)))
            streams = {
                name: base64.b64encode(ole.openstream(name).read()).decode("ascii")
                for name in stream_names
            }
            objects.append({"entry": entry, "streams": streams})
    if not objects:
        raise SystemExit("MTEF 临时 Word 文档中没有 MathType OLE 对象。")
    manifest_path.write_text(json.dumps({"objects": objects}), encoding="utf-8")
    return len(objects)




if __name__ == "__main__":
    raise SystemExit(main())
