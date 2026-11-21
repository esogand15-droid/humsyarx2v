# -*- coding: utf-8 -*-
"""Facade shim aliasing module to backend.services.time_audit."""
import sys
import backend.services.time_audit as _mod

sys.modules[__name__] = _mod

def __getattr__(name):
    return getattr(_mod, name)

def __dir__():
    return dir(_mod)

if __name__ == "__main__":
    import argparse
    import asyncio
    parser = argparse.ArgumentParser(description="Read-only HUMSYAR timestamp audit")
    group = parser.add_mutually_exclusive_group(required=True)
    group.add_argument("--collection", choices=sorted({item.collection for item in _mod.FIELDS}))
    group.add_argument("--all", action="store_true")
    asyncio.run(_mod._main(parser.parse_args()))
