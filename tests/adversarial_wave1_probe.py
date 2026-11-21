#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Adversarial stress-testing suite for Wave 1 module identity, singletons, and shims.

Executes tests across fresh Python subprocesses to ensure import cache (sys.modules)
does not mask ordering dependencies, identity divergence, or split-brain defects.
"""
import subprocess
import sys
import os
import json
import unittest

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)

PYTHON_EXE = sys.executable

def run_in_subprocess(code: str) -> tuple[int, str, str]:
    """Execute Python code snippet in a clean subprocess with PYTHONPATH=ROOT."""
    env = os.environ.copy()
    env["PYTHONPATH"] = f"{ROOT};{os.path.join(ROOT, 'backend')}"
    env["MONGODB_URI"] = "mongodb://127.0.0.1:27017/medicalbot"
    env["ADMIN_ID"] = "1"
    env["TELEGRAM_TOKEN"] = "123:TEST"
    env["TZ"] = "Asia/Tehran"
    
    res = subprocess.run(
        [PYTHON_EXE, "-X", "utf8", "-c", code],
        cwd=ROOT,
        env=env,
        capture_output=True,
        text=True,
        encoding="utf-8",
        errors="replace"
    )
    return res.returncode, res.stdout, res.stderr


class AdversarialShimTests(unittest.TestCase):
    """Adversarial test cases executing in isolated subprocesses."""

    def assertSubprocessSuccess(self, code: str, msg: str = ""):
        ret, stdout, stderr = run_in_subprocess(code)
        if ret != 0:
            self.fail(f"Subprocess failed with code {ret}!\nMessage: {msg}\nSTDOUT:\n{stdout}\nSTDERR:\n{stderr}\nCODE EXECUTED:\n{code}")

    # =========================================================================
    # CHALLENGE 1 & 2: Reverse import orderings & Singleton Identity
    # =========================================================================

    def test_database_singleton_root_first(self):
        """Import database (shim) first, then backend.database.database (target)."""
        code = """
import sys
import database
import backend.database.database as backend_db

assert sys.modules['database'] is sys.modules['backend.database.database'], "sys.modules split-brain!"
assert database.db is backend_db.db, "database.db is not backend_db.db!"
assert database.DB is backend_db.DB, "database.DB class is not backend_db.DB!"
"""
        self.assertSubprocessSuccess(code, "Root-first database import failed")

    def test_database_singleton_target_first(self):
        """Import backend.database.database (target) first, then database (shim)."""
        code = """
import sys
import backend.database.database as backend_db
import database

assert sys.modules['database'] is sys.modules['backend.database.database'], "sys.modules split-brain!"
assert database.db is backend_db.db, "database.db is not backend_db.db!"
assert database.DB is backend_db.DB, "database.DB class is not backend_db.DB!"
"""
        self.assertSubprocessSuccess(code, "Target-first database import failed")

    def test_from_database_import_db_root_first(self):
        """from database import db first, then from backend.database.database import db."""
        code = """
from database import db as db1
from backend.database.database import db as db2

assert db1 is db2, "from ... import db instances diverged!"
"""
        self.assertSubprocessSuccess(code, "from database import db root-first failed")

    def test_from_database_import_db_target_first(self):
        """from backend.database.database import db first, then from database import db."""
        code = """
from backend.database.database import db as db1
from database import db as db2

assert db1 is db2, "from ... import db instances diverged (target-first)!"
"""
        self.assertSubprocessSuccess(code, "from database import db target-first failed")

    # =========================================================================
    # CHALLENGE 3: Class Identity and isinstance() checks
    # =========================================================================

    def test_class_identity_and_isinstance_database(self):
        """Verify DB class instance is recognized across import namespaces."""
        code = """
import database
import backend.database.database as b_db

# Create instance via root class
inst1 = database.DB()
assert isinstance(inst1, b_db.DB), "inst1 not recognized as instance of backend DB!"
assert isinstance(inst1, database.DB), "inst1 not recognized as instance of root DB!"

# Create instance via backend class
inst2 = b_db.DB()
assert isinstance(inst2, database.DB), "inst2 not recognized as instance of root DB!"
assert isinstance(inst2, b_db.DB), "inst2 not recognized as instance of backend DB!"

# Verify issubclass
assert issubclass(database.DB, b_db.DB)
assert issubclass(b_db.DB, database.DB)
"""
        self.assertSubprocessSuccess(code, "Class identity / isinstance check failed on DB")

    def test_class_identity_and_isinstance_core_rbac(self):
        """Verify RBAC / Access classes maintain identity across imports."""
        code = """
import core.rbac as root_rbac
import backend.core.rbac as b_rbac

assert root_rbac is b_rbac, "core.rbac is not backend.core.rbac!"
"""
        self.assertSubprocessSuccess(code, "Class identity check failed on core.rbac")

    # =========================================================================
    # CHALLENGE 4: Mutable attribute mutation propagation
    # =========================================================================

    def test_mutation_propagation_root_to_backend(self):
        """Mutating module variable on root shim is visible on backend target."""
        code = """
import database
import backend.database.database as b_db

# Mutate attribute on root
database._ADVERSARIAL_ROOT_MUTATION = "FLAG_XYZ_123"

# Check on backend
assert hasattr(b_db, "_ADVERSARIAL_ROOT_MUTATION"), "Backend module did not see root mutation!"
assert b_db._ADVERSARIAL_ROOT_MUTATION == "FLAG_XYZ_123", "Backend module saw incorrect value!"

# Mutate property on singleton db
database.db._adversarial_prop = 999
assert hasattr(b_db.db, "_adversarial_prop"), "Backend db singleton did not see property!"
assert b_db.db._adversarial_prop == 999
"""
        self.assertSubprocessSuccess(code, "Mutation propagation from root to backend failed")

    def test_mutation_propagation_backend_to_root(self):
        """Mutating module variable on backend target is visible on root shim."""
        code = """
import backend.database.database as b_db
import database

# Mutate attribute on backend
b_db._ADVERSARIAL_BACKEND_MUTATION = "FLAG_ABC_789"

# Check on root
assert hasattr(database, "_ADVERSARIAL_BACKEND_MUTATION"), "Root module did not see backend mutation!"
assert database._ADVERSARIAL_BACKEND_MUTATION == "FLAG_ABC_789", "Root module saw incorrect value!"

# Mutate property on singleton db
b_db.db._adversarial_prop2 = 777
assert hasattr(database.db, "_adversarial_prop2"), "Root db singleton did not see property!"
assert database.db._adversarial_prop2 == 777
"""
        self.assertSubprocessSuccess(code, "Mutation propagation from backend to root failed")

    # =========================================================================
    # CHALLENGE 5: Submodule import chains & circular dependencies
    # =========================================================================

    def test_circular_chain_core_access_first(self):
        """Import core.access first, which triggers database.db -> time_utils -> core."""
        code = """
import core.access
import database
import time_utils

assert core.access.db is database.db
"""
        self.assertSubprocessSuccess(code, "Circular chain: core.access first failed")

    def test_circular_chain_database_first(self):
        """Import database first, then core.access, then time_utils."""
        code = """
import database
import core.access
import time_utils

assert core.access.db is database.db
"""
        self.assertSubprocessSuccess(code, "Circular chain: database first failed")

    def test_circular_chain_backend_core_access_first(self):
        """Import backend.core.access first, then database."""
        code = """
import backend.core.access
import database

assert backend.core.access.db is database.db
"""
        self.assertSubprocessSuccess(code, "Circular chain: backend.core.access first failed")

    def test_api_main_clean_import(self):
        """Import api.main cleanly from fresh process."""
        code = """
import api.main
import backend.api.main as b_main

assert api.main is b_main, "api.main is not backend.api.main!"
assert hasattr(api.main, "app"), "api.main does not expose app!"
"""
        self.assertSubprocessSuccess(code, "api.main clean import failed")

    def test_bot_clean_import(self):
        """Import bot cleanly from fresh process."""
        code = """
import bot
import backend.bot.bot as b_bot

assert bot is b_bot, "bot is not backend.bot.bot!"
"""
        self.assertSubprocessSuccess(code, "bot clean import failed")

    def test_bot_py_executes_as_main_entrypoint(self):
        """Verify that running python bot.py invokes backend.bot.bot.main()."""
        # bot.py is the primary entrypoint in supervisord.conf (command=/usr/local/bin/python -u bot.py).
        # When run as __main__, it must NOT immediately exit with code 0 without executing main().
        ret, stdout, stderr = run_in_subprocess("""
import subprocess, sys, os
env = os.environ.copy()
env['MONGODB_URI'] = 'mongodb://127.0.0.1:27017/medicalbot'
env['TELEGRAM_TOKEN'] = '123:TEST'
env['ADMIN_ID'] = '1'
env['TZ'] = 'Asia/Tehran'

res = subprocess.run([sys.executable, '-u', 'bot.py'], env=env, capture_output=True, text=True)
# If main() was invoked with a fake token, python-telegram-bot rejects InvalidToken with exit code 1.
# If it exited with code 0 in 1 second, main() was completely skipped by the shim!
assert res.returncode != 0, f"bot.py exited with code 0 without calling main()! STDOUT: {res.stdout}, STDERR: {res.stderr}"
""")
        self.assertEqual(ret, 0, "bot.py facade shim failed to delegate __main__ execution to backend.bot.bot.main()")

    def test_time_audit_executes_as_cli(self):
        """Verify that running python time_audit.py --help displays argparse help."""
        ret, stdout, stderr = run_in_subprocess("""
import subprocess, sys
res = subprocess.run([sys.executable, 'time_audit.py', '--help'], capture_output=True, text=True)
assert "Read-only HUMSYAR timestamp audit" in res.stdout, f"time_audit.py --help failed! STDOUT: {res.stdout}"
""")
        self.assertEqual(ret, 0, "time_audit.py facade shim failed to delegate CLI arguments to backend.services.time_audit")

    # =========================================================================
    # CHALLENGE 6: Mock Patching Interception across Root and Backend
    # =========================================================================

    def test_unittest_mock_patch_root_intercepts_backend(self):
        """Patching root database.db intercepts calls through backend.database.database.db."""
        code = """
from unittest.mock import patch, MagicMock
import database
import backend.database.database as b_db

with patch.object(database.db, 'get_user', new=MagicMock(return_value={'mocked': True})) as mock_method:
    res = b_db.db.get_user(12345)
    assert res == {'mocked': True}, f"Expected mocked return, got {res}"
    assert mock_method.called, "Mock method was not called via b_db.db!"
"""
        self.assertSubprocessSuccess(code, "Mock patching root failed to intercept backend")

    def test_unittest_mock_patch_backend_intercepts_root(self):
        """Patching backend.database.database.db intercepts calls through root database.db."""
        code = """
from unittest.mock import patch, MagicMock
import database
import backend.database.database as b_db

with patch.object(b_db.db, 'get_user', new=MagicMock(return_value={'mocked_backend': True})) as mock_method:
    res = database.db.get_user(98765)
    assert res == {'mocked_backend': True}, f"Expected mocked return, got {res}"
    assert mock_method.called, "Mock method was not called via database.db!"
"""
        self.assertSubprocessSuccess(code, "Mock patching backend failed to intercept root")

    # =========================================================================
    # CHALLENGE 7: Exhaustive bidirectional test on ALL 51 root module pairs
    # =========================================================================

    def test_exhaustive_all_pairs_both_orderings(self):
        """Test all 51 module pairs for both root-first and target-first import orders."""
        code = """
import importlib
import sys

PAIRS = [
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
    ("build_single", "scripts.build_single"),
    ("migrate_round1", "scripts.migrate_round1"),
    ("qbank_import_cli", "scripts.qbank_import_cli"),
    ("qbank_legacy_archive", "scripts.qbank_legacy_archive"),
    ("qbank_migrate", "scripts.qbank_migrate"),
]

# Test root-first
for shim_name, target_name in PAIRS:
    shim_mod = importlib.import_module(shim_name)
    target_mod = importlib.import_module(target_name)
    assert shim_mod is target_mod, f"Root-first mismatch: {shim_name} is not {target_name}"
    assert sys.modules[shim_name] is sys.modules[target_name], f"sys.modules mismatch: {shim_name}"

print(f"Verified {len(PAIRS)} pairs root-first.")
"""
        self.assertSubprocessSuccess(code, "Exhaustive root-first test failed")

    def test_exhaustive_all_pairs_target_first(self):
        """Test all 51 module pairs target-first in a fresh subprocess."""
        code = """
import importlib
import sys

PAIRS = [
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
    ("build_single", "scripts.build_single"),
    ("migrate_round1", "scripts.migrate_round1"),
    ("qbank_import_cli", "scripts.qbank_import_cli"),
    ("qbank_legacy_archive", "scripts.qbank_legacy_archive"),
    ("qbank_migrate", "scripts.qbank_migrate"),
]

# Test target-first
for shim_name, target_name in PAIRS:
    target_mod = importlib.import_module(target_name)
    shim_mod = importlib.import_module(shim_name)
    assert shim_mod is target_mod, f"Target-first mismatch: {shim_name} is not {target_name}"
    assert sys.modules[shim_name] is sys.modules[target_name], f"sys.modules mismatch: {shim_name}"

print(f"Verified {len(PAIRS)} pairs target-first.")
"""
        self.assertSubprocessSuccess(code, "Exhaustive target-first test failed")

    # =========================================================================
    # CHALLENGE 8: Directory Package Submodules (db, core, api, payments, etc.)
    # =========================================================================

    def test_directory_package_submodules_identity(self):
        """Test package submodules across both import directions."""
        code = """
import importlib
import sys

SUBMODULE_PAIRS = [
    ("db.core", "backend.database.core"),
    ("db.content", "backend.database.content"),
    ("db.finance", "backend.database.finance"),
    ("db.wallet", "backend.database.wallet"),
    ("db.rbac", "backend.database.rbac"),
    ("db.prestige", "backend.database.prestige"),
    ("core.access", "backend.core.access"),
    ("core.features", "backend.core.features"),
    ("core.errors", "backend.core.errors"),
    ("core.rbac", "backend.core.rbac"),
    ("api.main", "backend.api.main"),
    ("api.auth", "backend.api.auth"),
    ("api.rate_limit", "backend.api.rate_limit"),
    ("api.routers.web_auth", "backend.api.routers.web_auth"),
    ("api.routers.web_library", "backend.api.routers.web_library"),
    ("api.routers.web_reader", "backend.api.routers.web_reader"),
    ("api.routers.web_ink", "backend.api.routers.web_ink"),
    ("payments.zarinpal", "backend.integrations.zarinpal"),
]

for shim_name, target_name in SUBMODULE_PAIRS:
    # 1. Root first
    s_mod = importlib.import_module(shim_name)
    t_mod = importlib.import_module(target_name)
    assert s_mod is t_mod, f"Submodule identity mismatch: {shim_name} != {target_name}"
    assert sys.modules[shim_name] is sys.modules[target_name], f"sys.modules mismatch: {shim_name}"

print(f"Verified {len(SUBMODULE_PAIRS)} package submodules root-first.")
"""
        self.assertSubprocessSuccess(code, "Directory package submodules test failed")

    def test_directory_package_submodules_target_first(self):
        """Test package submodules target-first in clean subprocess."""
        code = """
import importlib
import sys

SUBMODULE_PAIRS = [
    ("db.core", "backend.database.core"),
    ("db.content", "backend.database.content"),
    ("db.finance", "backend.database.finance"),
    ("db.wallet", "backend.database.wallet"),
    ("db.rbac", "backend.database.rbac"),
    ("db.prestige", "backend.database.prestige"),
    ("core.access", "backend.core.access"),
    ("core.features", "backend.core.features"),
    ("core.errors", "backend.core.errors"),
    ("core.rbac", "backend.core.rbac"),
    ("api.main", "backend.api.main"),
    ("api.auth", "backend.api.auth"),
    ("api.rate_limit", "backend.api.rate_limit"),
    ("api.routers.web_auth", "backend.api.routers.web_auth"),
    ("api.routers.web_library", "backend.api.routers.web_library"),
    ("api.routers.web_reader", "backend.api.routers.web_reader"),
    ("api.routers.web_ink", "backend.api.routers.web_ink"),
    ("payments.zarinpal", "backend.integrations.zarinpal"),
]

for shim_name, target_name in SUBMODULE_PAIRS:
    # 2. Target first
    t_mod = importlib.import_module(target_name)
    s_mod = importlib.import_module(shim_name)
    assert s_mod is t_mod, f"Submodule identity mismatch: {shim_name} != {target_name}"
    assert sys.modules[shim_name] is sys.modules[target_name], f"sys.modules mismatch: {shim_name}"

print(f"Verified {len(SUBMODULE_PAIRS)} package submodules target-first.")
"""
        self.assertSubprocessSuccess(code, "Directory package submodules target-first test failed")

    # =========================================================================
    # CHALLENGE 9: What if reload() is called on a shim?
    # =========================================================================

    def test_importlib_reload_shim_behavior(self):
        """Verify behavior when importlib.reload() is invoked on a shim module."""
        code = """
import importlib
import database
import backend.database.database as b_db

assert database is b_db
# Reload database
reloaded = importlib.reload(database)
assert reloaded is b_db, "Reloaded module diverged from backend target!"
assert database.db is b_db.db, "db singleton diverged after reload!"
"""
        self.assertSubprocessSuccess(code, "importlib.reload() on shim failed")


if __name__ == "__main__":
    unittest.main()
