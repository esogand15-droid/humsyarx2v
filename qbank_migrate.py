# -*- coding: utf-8 -*-
"""CLI facade shim delegating execution to scripts.qbank_migrate."""
import sys
import scripts.qbank_migrate as _mod

sys.modules[__name__] = _mod

def __getattr__(name):
    return getattr(_mod, name)

def __dir__():
    return dir(_mod)

if __name__ == "__main__":
    if hasattr(_mod, "main"):
        import asyncio
        import inspect
        if inspect.iscoroutinefunction(_mod.main):
            sys.exit(asyncio.run(_mod.main()))
        else:
            sys.exit(_mod.main())
