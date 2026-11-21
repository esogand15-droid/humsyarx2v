# -*- coding: utf-8 -*-
"""Facade shim aliasing module to backend.api.api_counters."""
import sys
import backend.api.api_counters as _mod

sys.modules[__name__] = _mod

def __getattr__(name):
    return getattr(_mod, name)

def __dir__():
    return dir(_mod)
