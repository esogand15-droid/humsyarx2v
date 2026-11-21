# -*- coding: utf-8 -*-
"""CLI facade shim delegating execution to scripts.build_single."""
import sys
import scripts.build_single as _mod

sys.modules[__name__] = _mod

def __getattr__(name):
    return getattr(_mod, name)

def __dir__():
    return dir(_mod)

if __name__ == "__main__":
    if hasattr(_mod, "main"):
        sys.exit(_mod.main())
