# -*- coding: utf-8 -*-
"""Directory package facade shim aliasing question_bank to backend.services.question_bank."""
import importlib
import sys
import backend.services.question_bank as _mod

for _k, _v in _mod.__dict__.items():
    if not _k.startswith('__'):
        globals()[_k] = _v

def __getattr__(name):
    try:
        return importlib.import_module(f"{__name__}.{name}")
    except Exception:
        return getattr(_mod, name)

def __dir__():
    return sorted(set(list(globals().keys()) + dir(_mod)))
