# -*- coding: utf-8 -*-
"""Facade shim aliasing module to backend.bot.bot."""
import sys
import backend.bot.bot as _mod

sys.modules[__name__] = _mod

def __getattr__(name):
    return getattr(_mod, name)

def __dir__():
    return dir(_mod)

if __name__ == "__main__":
    if hasattr(_mod, "main"):
        _mod.main()
