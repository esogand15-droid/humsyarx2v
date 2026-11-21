# -*- coding: utf-8 -*-
"""Facade shim aliasing module to backend.services.telegram_file_rename_service."""
import sys
import backend.services.telegram_file_rename_service as _mod

sys.modules[__name__] = _mod

def __getattr__(name):
    return getattr(_mod, name)

def __dir__():
    return dir(_mod)
