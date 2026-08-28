#!/usr/bin/env python3
"""Build one OLE-shell/MTEF hybrid DOCX for the MathType activation test.

This is deliberately a local diagnostic, not an export-path dependency.  It
keeps all OLE streams from a document created by the installed MathType, then
replaces only one ``Equation Native`` stream with the stream emitted by
docx-equation.  The generated stream must fit the template allocation.
"""

from __future__ import annotations

import io
import json
import sys
from pathlib import Path
from zipfile import ZIP_DEFLATED, ZipFile

import olefile


FREE_OR_END = {0xFFFFFFFC, 0xFFFFFFFD, 0xFFFFFFFE, 0xFFFFFFFF}
END_OF_CHAIN = 0xFFFFFFFE


def _sector_offset(cfb: bytes, index: int, sector_size: int) -> int:
    offset = 512 + index * sector_size
    if index in FREE_OR_END or offset + sector_size > len(cfb):
        raise ValueError("Compound File 扇区链无效。")
    return offset


def _follow_chain(start: int, table: list[int]) -> list[int]:
    result: list[int] = []
    visited: set[int] = set()
    index = start
    while index not in FREE_OR_END:
        if index >= len(table) or index in visited:
            raise ValueError("Compound File 扇区链无效。")
        result.append(index)
        visited.add(index)
        index = table[index]
    if index != END_OF_CHAIN:
        raise ValueError("Compound File 扇区链意外结束。")
    return result


def replace_equation_native(template: bytes, generated_native: bytes) -> bytes:
    """Replace one small Equation Native stream without changing OLE shell."""
    if not template.startswith(bytes.fromhex("d0 cf 11 e0 a1 b1 1a e1")):
        raise ValueError("MathType 模板不是 Compound File。")

    sector_size = 1 << int.from_bytes(template[30:32], "little")
    mini_sector_size = 1 << int.from_bytes(template[32:34], "little")
    fat_sectors = [
        int.from_bytes(template[position:position + 4], "little")
        for position in range(76, 512, 4)
    ]
    fat_sectors = [index for index in fat_sectors if index not in FREE_OR_END]
    fat: list[int] = []
    for sector in fat_sectors:
        offset = _sector_offset(template, sector, sector_size)
        fat.extend(
            int.from_bytes(template[position:position + 4], "little")
            for position in range(offset, offset + sector_size, 4)
        )

    directory_chain = _follow_chain(int.from_bytes(template[48:52], "little"), fat)
    root_entry: bytes | None = None
    native_entry_offset: int | None = None
    native_start: int | None = None
    native_size: int | None = None
    for sector in directory_chain:
        offset = _sector_offset(template, sector, sector_size)
        for position in range(offset, offset + sector_size, 128):
            entry = template[position:position + 128]
            name_size = int.from_bytes(entry[64:66], "little")
            if entry[66] not in {2, 5} or not 2 <= name_size <= 64:
                continue
            name = entry[:name_size - 2].decode("utf-16le", errors="strict")
            if entry[66] == 5 and name == "Root Entry":
                root_entry = entry
            elif entry[66] == 2 and name == "Equation Native":
                native_entry_offset = position
                native_start = int.from_bytes(entry[116:120], "little")
                native_size = int.from_bytes(entry[120:128], "little")
    if root_entry is None or native_entry_offset is None or native_start is None or native_size is None:
        raise ValueError("MathType 模板缺少 Equation Native 流。")

    mini_fat_start = int.from_bytes(template[60:64], "little")
    mini_fat_count = int.from_bytes(template[64:68], "little")
    mini_fat_chain = _follow_chain(mini_fat_start, fat)
    if len(mini_fat_chain) < mini_fat_count:
        raise ValueError("MathType 模板的 MiniFAT 不完整。")
    mini_fat: list[int] = []
    for sector in mini_fat_chain[:mini_fat_count]:
        offset = _sector_offset(template, sector, sector_size)
        mini_fat.extend(
            int.from_bytes(template[position:position + 4], "little")
            for position in range(offset, offset + sector_size, 4)
        )

    native_chain = _follow_chain(native_start, mini_fat)
    capacity = len(native_chain) * mini_sector_size
    if len(generated_native) > capacity:
        raise ValueError(
            f"生成的 Equation Native 为 {len(generated_native)} 字节，超过真实 MathType 模板的 {capacity} 字节容量。"
        )

    root_start = int.from_bytes(root_entry[116:120], "little")
    root_size = int.from_bytes(root_entry[120:128], "little")
    root_chain = _follow_chain(root_start, fat)
    root_stream = bytearray().join(
        template[_sector_offset(template, sector, sector_size):_sector_offset(template, sector, sector_size) + sector_size]
        for sector in root_chain
    )[:root_size]

    payload = generated_native + bytes(capacity - len(generated_native))
    for index, mini_sector in enumerate(native_chain):
        start = mini_sector * mini_sector_size
        end = start + mini_sector_size
        if end > len(root_stream):
            raise ValueError("MathType 模板的 mini stream 偏移无效。")
        payload_start = index * mini_sector_size
        root_stream[start:end] = payload[payload_start:payload_start + mini_sector_size]

    patched = bytearray(template)
    patched[native_entry_offset + 120:native_entry_offset + 128] = len(generated_native).to_bytes(8, "little")
    for index, sector in enumerate(root_chain):
        start = index * sector_size
        end = min(start + sector_size, len(root_stream))
        if start >= end:
            break
        offset = _sector_offset(template, sector, sector_size)
        patched[offset:offset + (end - start)] = root_stream[start:end]
    return bytes(patched)


def main() -> int:
    if len(sys.argv) != 4:
        raise SystemExit(
            "Usage: build_hybrid_ole_poc.py <real-mathtype.docx> <generated-ole.bin> <output.docx>"
        )
    real_docx = Path(sys.argv[1]).resolve()
    generated_bin = Path(sys.argv[2]).resolve()
    output_docx = Path(sys.argv[3]).resolve()
    if not real_docx.is_file() or not generated_bin.is_file():
        raise SystemExit("缺少真实 MathType DOCX 或生成的 OLE 样本。")

    with ZipFile(real_docx) as archive:
        embedding_names = [
            name for name in archive.namelist()
            if name.startswith("word/embeddings/") and name.endswith(".bin")
        ]
        if not embedding_names:
            raise SystemExit("真实 MathType DOCX 中没有 OLE 公式。")
        template_name = embedding_names[0]
        template = archive.read(template_name)

    generated = generated_bin.read_bytes()
    generated_ole = olefile.OleFileIO(io.BytesIO(generated))
    generated_native = generated_ole.openstream("Equation Native").read()
    hybrid = replace_equation_native(template, generated_native)

    # Assert that exactly the intended stream changed before creating a DOCX.
    template_ole = olefile.OleFileIO(io.BytesIO(template))
    hybrid_ole = olefile.OleFileIO(io.BytesIO(hybrid))
    for stream_name in (chr(1) + "Ole", chr(1) + "CompObj", chr(3) + "ObjInfo"):
        if hybrid_ole.openstream(stream_name).read() != template_ole.openstream(stream_name).read():
            raise AssertionError(f"测试错误：{stream_name!r} 被意外修改。")
    if hybrid_ole.openstream("Equation Native").read() != generated_native:
        raise AssertionError("测试错误：Equation Native 替换未生效。")
    if hybrid_ole.root.clsid != template_ole.root.clsid:
        raise AssertionError("测试错误：Root CLSID 被意外修改。")

    with ZipFile(real_docx) as source, ZipFile(output_docx, "w", ZIP_DEFLATED) as target:
        for info in source.infolist():
            target.writestr(info, hybrid if info.filename == template_name else source.read(info.filename))

    print(json.dumps({
        "ok": True,
        "output": str(output_docx),
        "replacedEmbedding": template_name,
        "nativeBytes": len(generated_native),
        "templateRootClsid": str(template_ole.root.clsid),
        "oleShellPreserved": True,
    }, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
