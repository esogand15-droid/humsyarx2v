# -*- coding: utf-8 -*-
"""Facade shim aliasing module to backend.api.user_metrics."""
import sys
import backend.api.user_metrics as _mod

sys.modules[__name__] = _mod

def __getattr__(name):
    return getattr(_mod, name)

def __dir__():
    return dir(_mod)
