# -*- coding: utf-8 -*-
"""Facade shim aliasing module to backend.bot.tg_group_voice_call."""
import sys
import backend.bot.tg_group_voice_call as _mod

sys.modules[__name__] = _mod

def __getattr__(name):
    return getattr(_mod, name)

def __dir__():
    return dir(_mod)
