# -*- coding: utf-8 -*-
"""Facade shim aliasing module to backend.core.time_utils."""
import sys
import backend.core.time_utils as _mod

sys.modules[__name__] = _mod

def __getattr__(name):
    return getattr(_mod, name)

def __dir__():
    return dir(_mod)
