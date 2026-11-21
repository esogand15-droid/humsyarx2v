# -*- coding: utf-8 -*-
"""Facade shim aliasing module to backend.services.ai_solver."""
import sys
import backend.services.ai_solver as _mod

sys.modules[__name__] = _mod

def __getattr__(name):
    return getattr(_mod, name)

def __dir__():
    return dir(_mod)
