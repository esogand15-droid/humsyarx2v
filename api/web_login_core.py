# -*- coding: utf-8 -*-
"""Facade shim aliasing module to backend.api.web_login_core."""
import sys
import backend.api.web_login_core as _mod

sys.modules[__name__] = _mod

def __getattr__(name):
    return getattr(_mod, name)

def __dir__():
    return dir(_mod)
