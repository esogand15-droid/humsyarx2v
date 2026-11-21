# -*- coding: utf-8 -*-
"""Root facade shim for student_code module."""
import sys
import backend.core.student_code as _mod

sys.modules[__name__] = _mod

def __getattr__(name):
    return getattr(_mod, name)

def __dir__():
    return dir(_mod)
