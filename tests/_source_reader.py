# -*- coding: utf-8 -*-
"""Helper for reading project source files across root and backend/ taxonomy.

Transparently resolves root facade shims to their underlying implementation files in backend/ or scripts/.
"""
import os
from pathlib import Path

HERE = Path(__file__).resolve().parent
ROOT = HERE.parent


def read_source(*parts: str | os.PathLike) -> str:
    path = ROOT.joinpath(*parts)
    if not path.is_file():
        # Check direct backend/ or scripts/ prefix
        bpath = ROOT.joinpath("backend", *parts)
        if bpath.is_file():
            return bpath.read_text(encoding="utf-8")
        spath = ROOT.joinpath("scripts", *parts)
        if spath.is_file():
            return spath.read_text(encoding="utf-8")
        # Check mapped directories like db -> backend/database
        parts_list = list(parts)
        if parts_list and parts_list[0] == "db":
            db_cand = ROOT.joinpath("backend", "database", *parts_list[1:])
            if db_cand.is_file():
                return db_cand.read_text(encoding="utf-8")
        raise FileNotFoundError(f"Cannot resolve source file: {parts}")

    text = path.read_text(encoding="utf-8")
    if "import backend." in text or "import scripts." in text:
        for line in text.splitlines():
            line = line.strip()
            if line.startswith("import backend.") or line.startswith("import scripts."):
                tokens = line.split()
                if len(tokens) >= 2:
                    target_mod = tokens[1]
                    parts_mod = target_mod.split(".")
                    # Check if file
                    cand_py = ROOT.joinpath(*parts_mod).with_suffix(".py")
                    if cand_py.is_file():
                        return cand_py.read_text(encoding="utf-8")
                    # Check if package init
                    cand_init = ROOT.joinpath(*parts_mod, "__init__.py")
                    if cand_init.is_file():
                        return cand_init.read_text(encoding="utf-8")
    return text

