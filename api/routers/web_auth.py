# -*- coding: utf-8 -*-
"""Router facade shim aliasing api.routers.web_auth to backend.api.routers.web_auth."""
import sys
import backend.api.routers.web_auth as _mod

sys.modules[__name__] = _mod

def __getattr__(name):
    return getattr(_mod, name)

def __dir__():
    return dir(_mod)
