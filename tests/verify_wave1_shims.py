#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Verification suite for Wave 1 facade shims and module singletons.

Validates that:
1. Every migrated root module has a functioning facade shim.
2. sys.modules[shim_name] is sys.modules[target_name] (zero split-brain, true identity equality).
3. Attribute access and function calls resolve to the identical objects.
4. Directory packages (db, core, api, payments, qbank, question_bank, ring) correctly alias submodules.
"""
from __future__ import annotations

import importlib
import os
import sys
import unittest

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
if ROOT not in sys.path:
    sys.path.insert(0, ROOT)

# Ensure UTF-8 output encoding
if hasattr(sys.stdout, "reconfigure") and sys.stdout.encoding.lower() not in ("utf-8", "utf8"):
    try:
        sys.stdout.reconfigure(encoding="utf-8")
    except Exception:
        pass

# Ensure minimal test environment variables
os.environ.setdefault("MONGODB_URI", "mongodb://127.0.0.1:27017/medicalbot")
os.environ.setdefault("ADMIN_ID", "1")
os.environ.setdefault("TELEGRAM_TOKEN", "123:TEST")
os.environ.setdefault("TZ", "Asia/Tehran")

# Safe mock bridge for optional third-party packages if not yet installed in host Python
from importlib.abc import Loader, MetaPathFinder
from importlib.machinery import ModuleSpec
from unittest.mock import MagicMock

_THIRD_PARTY_ROOTS = {
    "telegram", "motor", "bson", "pymongo", "fastapi", "pydantic", "starlette",
    "jdatetime", "openpyxl", "reportlab", "arabic_reshaper", "bidi",
    "pyrogram", "kurigram", "tgcrypto", "py_tgcalls", "cryptography", "pypdf",
    "qrcode", "imageio_ffmpeg", "httpx", "dotenv", "uvicorn", "websockets"
}

# Only mock roots that are truly missing
_MISSING_ROOTS = set()
for _r in _THIRD_PARTY_ROOTS:
    try:
        importlib.import_module(_r)
    except Exception:
        _MISSING_ROOTS.add(_r)

class _DummyBaseModel:
    def __init_subclass__(cls, **kwargs):
        pass

class _MockLoader(Loader):
    def create_module(self, spec):
        mod = MagicMock()
        mod.__name__ = spec.name
        mod.__path__ = []
        mod.__file__ = f"<mock {spec.name}>"
        if spec.name.startswith("pydantic"):
            mod.BaseModel = _DummyBaseModel
        if spec.name == "reportlab.lib.pagesizes" or spec.name.startswith("reportlab"):
            mod.A4 = (595.27, 841.89)
        return mod

    def exec_module(self, module):
        pass

class _MockFinder(MetaPathFinder):
    def find_spec(self, fullname, path, target=None):
        root = fullname.split(".")[0]
        if root in _MISSING_ROOTS:
            return ModuleSpec(fullname, _MockLoader(), is_package=True)
        return None

sys.meta_path.insert(0, _MockFinder())

SHIM_MODULE_PAIRS = [
    ("admin", "backend.bot.admin"),
    ("ai_admin", "backend.bot.ai_admin"),
    ("ai_solver", "backend.services.ai_solver"),
    ("audit", "backend.services.audit"),
    ("backup", "backend.services.backup"),
    ("basic_science", "backend.bot.basic_science"),
    ("bot", "backend.bot.bot"),
    ("bot_heartbeat", "backend.services.bot_heartbeat"),
    ("broadcast_service", "backend.services.broadcast_service"),
    ("content_admin", "backend.bot.content_admin"),
    ("dashboard", "backend.bot.dashboard"),
    ("database", "backend.database.database"),
    ("discount_campaign", "backend.services.discount_campaign"),
    ("dunning", "backend.services.dunning"),
    ("excel_report", "backend.services.excel_report"),
    ("faq", "backend.bot.faq"),
    ("grade_utils", "backend.services.grade_utils"),
    ("grades", "backend.bot.grades"),
    ("growth_rules", "backend.services.growth_rules"),
    ("hooshyar_quiz", "backend.services.hooshyar_quiz"),
    ("http_client", "backend.services.http_client"),
    ("message_router", "backend.bot.message_router"),
    ("notifications", "backend.bot.notifications"),
    ("profile", "backend.bot.profile"),
    ("questions", "backend.bot.questions"),
    ("references", "backend.bot.references"),
    ("referral", "backend.bot.referral"),
    ("reports", "backend.bot.reports"),
    ("request_context", "backend.core.request_context"),
    ("resources", "backend.bot.resources"),
    ("schedule", "backend.bot.schedule"),
    ("schedule_pdf", "backend.services.schedule_pdf"),
    ("search", "backend.bot.search"),
    ("start", "backend.bot.start"),
    ("stats", "backend.bot.stats"),
    ("subscription", "backend.bot.subscription"),
    ("subscription_admin", "backend.bot.subscription_admin"),
    ("telegram_file_rename_service", "backend.services.telegram_file_rename_service"),
    ("tg_group_voice_call", "backend.bot.tg_group_voice_call"),
    ("ticket", "backend.bot.ticket"),
    ("time_audit", "backend.services.time_audit"),
    ("time_utils", "backend.core.time_utils"),
    ("url_import_service", "backend.services.url_import_service"),
    ("utils", "backend.bot.utils"),
    ("utils_crypto", "backend.core.utils_crypto"),
    ("utils_file_naming", "backend.services.utils_file_naming"),
    # CLI Tool Shims
    ("build_single", "scripts.build_single"),
    ("migrate_round1", "scripts.migrate_round1"),
    ("qbank_import_cli", "scripts.qbank_import_cli"),
    ("qbank_legacy_archive", "scripts.qbank_legacy_archive"),
    ("qbank_migrate", "scripts.qbank_migrate"),
    # Directory Package Submodules
    ("db.core", "backend.database.core"),
    ("db.content", "backend.database.content"),
    ("db.finance", "backend.database.finance"),
    ("db.wallet", "backend.database.wallet"),
    ("core.access", "backend.core.access"),
    ("core.features", "backend.core.features"),
    ("api.main", "backend.api.main"),
    ("api.routers.web_auth", "backend.api.routers.web_auth"),
    ("api.routers.web_library", "backend.api.routers.web_library"),
]


class Wave1ShimVerificationTests(unittest.TestCase):
    def test_shim_module_identity(self):
        """Verify that importing via root shim yields the exact same object in sys.modules."""
        for shim_name, target_name in SHIM_MODULE_PAIRS:
            with self.subTest(shim=shim_name, target=target_name):
                shim_mod = importlib.import_module(shim_name)
                target_mod = importlib.import_module(target_name)
                self.assertIs(
                    shim_mod,
                    target_mod,
                    f"Split-brain detected! {shim_name} is not {target_name}",
                )

    def test_database_singleton_identity(self):
        """Verify that db instance in database is identical to backend.database.database."""
        import database
        import backend.database.database as backend_db
        self.assertIs(database.db, backend_db.db, "db singleton instances diverged!")

    def test_package_submodule_attributes(self):
        """Verify that root package objects (db, core, api) expose submodules as attributes."""
        import db
        import core
        self.assertIsNotNone(db.core)
        self.assertIsNotNone(core.access)

    def test_entrypoint_shims_have_main_wiring(self):
        """Ensure runnable CLI and service shims define __main__ delegation and can be invoked."""
        runnable_shims = [
            "bot.py",
            "time_audit.py",
            "qbank_import_cli.py",
            "build_single.py",
            "migrate_round1.py",
        ]
        for script_name in runnable_shims:
            path = os.path.join(ROOT, script_name)
            self.assertTrue(os.path.isfile(path), f"Shim {script_name} must exist at root!")
            with open(path, encoding="utf-8") as f:
                content = f.read()
            self.assertIn('__name__ == "__main__"', content,
                          f"Executable shim {script_name} must wire __main__ execution!")

        # Verify CLI execution delegation
        import subprocess
        # 1. time_audit.py --help
        res = subprocess.run([sys.executable, "-X", "utf8", os.path.join(ROOT, "time_audit.py"), "--help"],
                             capture_output=True, text=True, encoding="utf-8", cwd=ROOT)
        self.assertEqual(res.returncode, 0)
        self.assertIn("Read-only HUMSYAR timestamp audit", res.stdout)

        # 2. qbank_import_cli.py --help
        res = subprocess.run([sys.executable, "-X", "utf8", os.path.join(ROOT, "qbank_import_cli.py"), "--help"],
                             capture_output=True, text=True, encoding="utf-8", cwd=ROOT)
        self.assertEqual(res.returncode, 0)
        self.assertIn("HUMSYAR QBank archive", res.stdout)
        self.assertNotIn("RuntimeWarning", res.stderr)

        # 3. migrate_round1.py --dry
        res = subprocess.run([sys.executable, "-X", "utf8", os.path.join(ROOT, "migrate_round1.py"), "--dry"],
                             capture_output=True, text=True, encoding="utf-8", cwd=ROOT)
        self.assertEqual(res.returncode, 0)
        self.assertIn("DRY-RUN", res.stdout)
        self.assertNotIn("RuntimeWarning", res.stderr)


if __name__ == "__main__":
    unittest.main()
