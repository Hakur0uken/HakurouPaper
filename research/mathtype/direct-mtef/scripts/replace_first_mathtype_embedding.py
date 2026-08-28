#!/usr/bin/env python3
"""Build a DOCX whose first MathType OLE object is replaced byte-for-byte."""

from __future__ import annotations

import sys
from pathlib import Path
from zipfile import ZIP_DEFLATED, ZipFile


def main() -> int:
    if len(sys.argv) != 4:
        raise SystemExit(
            "Usage: replace_first_mathtype_embedding.py <template.docx> <replacement.bin> <output.docx>"
        )
    template = Path(sys.argv[1]).resolve()
    replacement = Path(sys.argv[2]).resolve()
    output = Path(sys.argv[3]).resolve()
    replacement_bytes = replacement.read_bytes()
    with ZipFile(template) as source:
        embedding = next(
            (name for name in source.namelist() if name.startswith("word/embeddings/") and name.endswith(".bin")),
            None,
        )
        if embedding is None:
            raise SystemExit("模板 DOCX 中没有 MathType OLE 对象。")
        with ZipFile(output, "w", ZIP_DEFLATED) as target:
            for info in source.infolist():
                target.writestr(
                    info,
                    replacement_bytes if info.filename == embedding else source.read(info.filename),
                )
    print(embedding)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
