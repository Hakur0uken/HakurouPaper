#!/usr/bin/env python3
"""Extract the four MathType OLE streams without rewriting their bytes."""

from __future__ import annotations

import sys
from pathlib import Path

import olefile


STREAMS = {
    "CompObj.bin": chr(1) + "CompObj",
    "Ole.bin": chr(1) + "Ole",
    "ObjInfo.bin": chr(3) + "ObjInfo",
    "EquationNative.bin": "Equation Native",
}


def main() -> int:
    if len(sys.argv) != 3:
        raise SystemExit("Usage: extract_mathtype_streams.py <input.bin> <output-dir>")
    source = Path(sys.argv[1]).resolve()
    output_dir = Path(sys.argv[2]).resolve()
    output_dir.mkdir(parents=True, exist_ok=True)
    ole = olefile.OleFileIO(str(source))
    for filename, stream_name in STREAMS.items():
        (output_dir / filename).write_bytes(ole.openstream(stream_name).read())
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
