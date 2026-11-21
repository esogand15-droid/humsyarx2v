# -*- coding: utf-8 -*-
"""Root facade shim for web_auth_bot module."""
import sys
import backend.bot.web_auth_bot as _mod

sys.modules[__name__] = _mod

def __getattr__(name):
    return getattr(_mod, name)

def __dir__():
    return dir(_mod)
