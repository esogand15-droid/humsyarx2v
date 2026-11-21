# -*- coding: utf-8 -*-
"""CLI facade shim delegating execution to scripts.qbank_import_cli."""
import sys
import scripts.qbank_import_cli as _mod

sys.modules[__name__] = _mod

def __getattr__(name):
    return getattr(_mod, name)

def __dir__():
    return dir(_mod)

if __name__ == "__main__":
    if hasattr(sys.stdout, "reconfigure"):
        try:
            sys.stdout.reconfigure(encoding="utf-8")
        except Exception:
            pass
    if hasattr(_mod, "main"):
        sys.exit(_mod.main())
