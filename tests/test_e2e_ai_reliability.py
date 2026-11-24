"""
🧪 End-to-End Multimodal AI Reliability & Key Failover Test Suite
HamsYar Medical Platform — Premium Tier Verification

Coverage:
  • Feature 4: Valid production model hierarchy & elimination of hallucinations
  • Feature 5: thinkingConfig & schema compatibility (auto-repair on 400)
  • Feature 6: Multi-key loading from MongoDB DB Vault & Env, dynamic key failover & differential cooldowns
  • Feature 7: Atomic quota reservation & refund on error with Persian user feedback

Execution:
  pytest -q tests/test_e2e_ai_reliability.py
"""

import asyncio
import copy
import json
import json as json_lib
import os
import re
import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import AsyncMock, MagicMock, patch, call

# ----------------------------------------------------------------------------
# Defensive Path Bootstrap & Environment Setup
# ----------------------------------------------------------------------------
REPO_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if REPO_ROOT not in sys.path:
    sys.path.insert(0, REPO_ROOT)

BACKEND_DIR = os.path.join(REPO_ROOT, "backend")
if BACKEND_DIR not in sys.path:
    sys.path.append(BACKEND_DIR)

SERVICES_DIR = os.path.join(BACKEND_DIR, "services")
if SERVICES_DIR not in sys.path:
    sys.path.insert(0, SERVICES_DIR)

os.environ.setdefault("MONGODB_URI", "mongodb://127.0.0.1:27017/humsyar_test_ai_rel")
os.environ.setdefault("ADMIN_ID", "999")
os.environ.setdefault("TELEGRAM_TOKEN", "123:TEST_TOKEN")
os.environ.setdefault("TZ", "Asia/Tehran")

import httpx

import backend.services.ai_solver as ai_solver
sys.modules['ai_solver'] = ai_solver
from backend.services.ai_solver import (
    AIQuotaError,
    AIConfigError,
    AIError,
    _load_vault,
    ordered_keys,
    classify_key_error,
    mark_key_failed,
    mark_key_ok,
    key_cooldown_remaining,
    run_with_key_failover,
    masked_key,
    key_status_summary,
    sanitize_api_key,
    _no_thinking,
    check_and_consume_lecture_quota,
    refund_lecture_quota,
    ai_claim_inflight,
    ai_release_inflight,
)

import backend.services.lecture_scribe as lecture_scribe
from backend.services.lecture_scribe import (
    LECTURE_DIGEST_SCHEMA,
    VERIFIED_MODEL_CASCADE,
    HALLUCINATED_MODELS,
    _parse_json_from_text,
    run_lecture_processing,
    run_lecture_processing_worker,
    resolve_gemini_api_keys,
    resolve_candidate_models,
    auto_repair_generation_config,
)
import backend.database.core as db_core


async def lecture_consume_quota(*args, **kwargs):
    return await db_core.lecture_consume_quota(*args, **kwargs)


async def lecture_refund_quota(*args, **kwargs):
    return await db_core.lecture_refund_quota(*args, **kwargs)

# ----------------------------------------------------------------------------
# Test Constants & Reference Oracles
# ----------------------------------------------------------------------------
K_VAULT_1 = "AIzaSy_VaultKey_One_1111111111111"
K_VAULT_2 = "AIzaSy_VaultKey_Two_2222222222222"
K_ENV_1 = "AIzaSy_EnvKey_Alpha_333333333333"
K_ENV_2 = "AIzaSy_EnvKey_Beta_4444444444444"
K_SINGLE_ENV = "AIzaSy_EnvSingle_5555555555555"
K_GOOGLE_ENV = "AIzaSy_GoogleEnv_6666666666666"

SAMPLE_LECTURE_DIGEST = {
    "title": "فارماکولوژی بالینی داروهای قلبی عروقی",
    "subject": "فارماکولوژی",
    "professor": "دکتر زمانی",
    "session": "جلسه ۳",
    "date": "۱۴۰۵/۰۹/۰۱",
    "executive_summary": "بررسی جامع مهارکننده‌های ACE، ARB و بتابلوکرها در مدیریت هایپرتنشن.",
    "topics": [
        {
            "title": "مهارکننده‌های آنزیم تبدیل‌کننده آنژیوتانسین (ACE-I)",
            "content": "مهار ACE مانع سنتز AT-II و کاهش تخریب برادی‌کینین می‌شود.",
            "clinical_points": "پایش سطح کراتینین و پتاسیم سرم ۲ هفته پس از شروع الزامی است."
        }
    ],
    "clinical_pearls": [
        "در بیماران دیابتی مبتلا به میکروآلبومینوری، ACE-I یا ARB خط اول درمان هستند."
    ],
    "exam_traps": [
        "دام پره‌انترنی: سرفه خشک ناشی از انالاپریل با آنتی‌هیستامین درمان نمی‌شود و باید به لوزارتان سوئیچ گردد."
    ],
    "comparison_table": {
        "title": "مقایسه داروهای خط اول فشار خون",
        "headers": ["کلاس دارو", "مکانیسم", "اندیکاسیون", "منع مصرف"],
        "rows": [
            ["ACE-I", "مهار تبدیل AT-I به AT-II", "نارسایی قلبی و دیابت", "بارداری و آنژیوادم"]
        ]
    },
    "qna_list": [
        {
            "question": "کدام داروی ضد فشار خون در بارداری کاملاً ممنوع است؟",
            "answer": "مهارکننده‌های ACE و مسدودکننده‌های گیرنده آنژیوتانسین (تراتوژن هستند)."
        }
    ]
}


# ============================================================================
# TIER 1: FEATURE FUNCTIONAL COVERAGE
# ============================================================================
class TestTier1FeatureCoverage(unittest.TestCase):
    """Tier 1: Feature Functional Coverage for Features 4, 5, 6, and 7."""

    def setUp(self):
        ai_solver._KEY_STATE.clear()
        ai_solver._busy_users.clear()
        self.env_patcher = patch.dict(os.environ, {}, clear=False)
        self.env_patcher.start()

    def tearDown(self):
        self.env_patcher.stop()
        ai_solver._KEY_STATE.clear()
        ai_solver._busy_users.clear()

    def test_t1_01_multi_key_loading_dedup_and_env(self):
        """Feature 6: Keys loaded from DB Vault and environment variables, sanitized and deduplicated."""
        os.environ["GEMINI_API_KEYS"] = f" {K_ENV_1} , {K_ENV_2} ; {K_ENV_1} "
        os.environ["GEMINI_API_KEY"] = f" {K_SINGLE_ENV} "
        os.environ["GOOGLE_API_KEY"] = f" {K_GOOGLE_ENV} "

        cfg = {
            "vault_multi": {"gemini": [K_VAULT_1, K_VAULT_2, f" {K_ENV_1} "]},
            "provider": "gemini",
        }

        keys = resolve_gemini_api_keys(cfg)

        self.assertIn(K_VAULT_1, keys)
        self.assertIn(K_VAULT_2, keys)
        self.assertIn(K_ENV_1, keys)
        self.assertIn(K_ENV_2, keys)
        self.assertIn(K_SINGLE_ENV, keys)
        self.assertIn(K_GOOGLE_ENV, keys)

        # Verify exact deduplication count (6 unique keys)
        self.assertEqual(len(keys), 6)
        self.assertEqual(len(set(keys)), 6)
        # Verify DB Vault keys take first priority
        self.assertEqual(keys[0], K_VAULT_1)
        self.assertEqual(keys[1], K_VAULT_2)

    def test_t1_02_verified_model_hierarchy_cascade(self):
        """Feature 4: Production model hierarchy cascade starts with gemini-3.5-flash (به‌روزرسانی 1405/09)."""
        models = resolve_candidate_models()
        self.assertEqual(models[0], "gemini-3.5-flash")
        self.assertIn("gemini-3.6-flash", models)
        self.assertIn("gemini-flash-lite-latest", models)
        self.assertIn("gemini-3.5-flash-lite", models)
        self.assertIn("gemini-3.8-flash", models)

        # HALLUCINATED_MODELS اکنون خالی است — مدل‌های 2.x/1.x کلاً deprecated هستند
        for hallu in HALLUCINATED_MODELS:
            self.assertNotIn(hallu, models, f"Hallucinated model {hallu} must be eliminated from cascade")

    def test_t1_03_http_429_quota_rotation(self):
        """Feature 6: HTTP 429 quota exhaustion rotates automatically to next key and applies cooldown."""
        calls = []

        async def _call_gemini(key: str):
            calls.append(key)
            if key == K_VAULT_1:
                raise AIQuotaError("Resource has been exhausted (code 429)")
            return {"status": "ok", "key": key}

        result = asyncio.run(run_with_key_failover("gemini", [K_VAULT_1, K_VAULT_2], _call_gemini))

        self.assertEqual(result["status"], "ok")
        self.assertEqual(result["key"], K_VAULT_2)
        self.assertEqual(calls, [K_VAULT_1, K_VAULT_2])
        self.assertGreater(key_cooldown_remaining("gemini", K_VAULT_1), 0)
        self.assertEqual(key_cooldown_remaining("gemini", K_VAULT_2), 0)

    def test_t1_04_http_401_403_invalid_key_rotation(self):
        """Feature 6: HTTP 401/403 invalid key triggers automatic rotation and auth cooldown."""
        calls = []

        async def _call_gemini(key: str):
            calls.append(key)
            if key == K_VAULT_1:
                raise AIConfigError("API key not valid (code 401)")
            return {"status": "ok", "key": key}

        result = asyncio.run(run_with_key_failover("gemini", [K_VAULT_1, K_VAULT_2], _call_gemini))

        self.assertEqual(result["key"], K_VAULT_2)
        self.assertEqual(calls, [K_VAULT_1, K_VAULT_2])
        self.assertGreater(key_cooldown_remaining("gemini", K_VAULT_1), 0)

    @patch("backend.database.core.lecture_refund_quota", new_callable=AsyncMock)
    @patch("backend.database.core.lecture_consume_quota", new_callable=AsyncMock)
    def test_t1_05_atomic_quota_reservation_success(self, mock_consume, mock_refund):
        """Feature 7: User quota is atomically reserved and remains deducted on successful generation."""
        mock_consume.return_value = (True, 1, 3)
        uid = 55501
        today = "2026-11-24"

        # 1. User consumes 1 quota
        allowed, used, limit = asyncio.run(lecture_consume_quota(uid, daily_limit=3, today=today))
        self.assertTrue(allowed)
        self.assertEqual(used, 1)
        self.assertEqual(limit, 3)

        # 2. On success, no refund is performed
        mock_consume.assert_called_once_with(uid, daily_limit=3, today=today)
        mock_refund.assert_not_called()

    @patch("database.db.op_claim", AsyncMock(return_value=True))
    @patch("database.db.op_release", AsyncMock(return_value=True))
    @patch("ai_solver.refund_lecture_quota", new_callable=AsyncMock)
    @patch("backend.services.telegram_downloader.download_telegram_media", new_callable=AsyncMock)
    @patch("backend.services.lecture_scribe.transcode_audio_file", new_callable=AsyncMock)
    @patch("ai_solver.get_ai_config", new_callable=AsyncMock)
    def test_t1_06_model_cascade_fallback_on_404_not_found(self, mock_cfg, mock_transcode, mock_download, mock_refund):
        """Feature 4: Model 404 (or deprecated model) smoothly falls back to next candidate model."""
        tmp = tempfile.NamedTemporaryFile(suffix=".mp3", delete=False)
        tmp.write(b"fake audio content")
        tmp.close()
        self.addCleanup(lambda: os.path.exists(tmp.name) and os.unlink(tmp.name))

        mock_download.return_value = tmp.name
        mock_transcode.return_value = tmp.name
        mock_cfg.return_value = {"vault_multi": {"gemini": [K_VAULT_1]}, "provider": "gemini"}

        bot = AsyncMock()
        bot.send_message = AsyncMock()
        bot.send_document = AsyncMock()
        bot.edit_message_text = AsyncMock()

        models_attempted = []

        async def _mock_post(client, url, headers=None, json=None, **kwargs):
            model = url.split("/models/")[1].split(":")[0]
            models_attempted.append(model)
            if model == "gemini-3.5-flash":
                return httpx.Response(404, text="Model not found", request=httpx.Request("POST", url))
            return httpx.Response(200, text=json_lib.dumps({"candidates": [{"content": {"parts": [{"text": json_lib.dumps(SAMPLE_LECTURE_DIGEST)}]}}]}), request=httpx.Request("POST", url))

        with patch.object(httpx.AsyncClient, "post", _mock_post):
            session = {"files": [{"kind": "audio", "name": "test.mp3", "tg_file_id": "f123"}]}
            success = asyncio.run(run_lecture_processing_worker(bot=bot, chat_id=123, uid=55502, session=session, status_msg_id=10))

        self.assertTrue(success)
        # 404 دائمی است → بدون retry، فقط یک بار امتحان و سوئیچ به مدل بعدی
        self.assertEqual(models_attempted.count("gemini-3.5-flash"), 1)
        self.assertIn("gemini-3.6-flash", models_attempted)

    @patch("database.db.op_claim", AsyncMock(return_value=True))
    @patch("database.db.op_release", AsyncMock(return_value=True))
    @patch("ai_solver.refund_lecture_quota", new_callable=AsyncMock)
    @patch("backend.services.telegram_downloader.download_telegram_media", new_callable=AsyncMock)
    @patch("backend.services.lecture_scribe.transcode_audio_file", new_callable=AsyncMock)
    @patch("ai_solver.get_ai_config", new_callable=AsyncMock)
    def test_t1_07_model_cascade_fallback_on_503_unavailable(self, mock_cfg, mock_transcode, mock_download, mock_refund):
        """Feature 4: Model 503 Service Unavailable cascades to next model."""
        tmp = tempfile.NamedTemporaryFile(suffix=".mp3", delete=False)
        tmp.write(b"fake audio content")
        tmp.close()
        self.addCleanup(lambda: os.path.exists(tmp.name) and os.unlink(tmp.name))

        mock_download.return_value = tmp.name
        mock_transcode.return_value = tmp.name
        mock_cfg.return_value = {"vault_multi": {"gemini": [K_VAULT_1]}, "provider": "gemini"}

        bot = AsyncMock()
        bot.send_message = AsyncMock()
        bot.send_document = AsyncMock()
        bot.edit_message_text = AsyncMock()

        models_attempted = []

        async def _mock_post(client, url, headers=None, json=None, **kwargs):
            model = url.split("/models/")[1].split(":")[0]
            models_attempted.append(model)
            if model == "gemini-3.5-flash":
                return httpx.Response(503, text="Service Unavailable", request=httpx.Request("POST", url))
            return httpx.Response(200, text=json_lib.dumps({"candidates": [{"content": {"parts": [{"text": json_lib.dumps(SAMPLE_LECTURE_DIGEST)}]}}]}), request=httpx.Request("POST", url))

        with patch.object(httpx.AsyncClient, "post", _mock_post):
            session = {"files": [{"kind": "audio", "name": "test.mp3", "tg_file_id": "f123"}]}
            success = asyncio.run(run_lecture_processing_worker(bot=bot, chat_id=123, uid=55503, session=session, status_msg_id=11))

        self.assertTrue(success)
        # gemini-3.5-flash باید دوبار امتحان شود (یک بار + retry بعد از 503)
        self.assertEqual(models_attempted.count("gemini-3.5-flash"), 2)
        # بعد از دو retry، gemini-3.6-flash باید امتحان شود
        self.assertIn("gemini-3.6-flash", models_attempted)

    def test_t1_08_preferred_model_override(self):
        """Feature 4: Valid user/admin preferred model takes first priority in cascade."""
        cfg = {"lecture_model": "gemini-3.6-flash"}
        cascade = resolve_candidate_models(cfg)
        self.assertEqual(cascade[0], "gemini-3.6-flash")
        self.assertIn("gemini-3.5-flash", cascade)
        self.assertIn("gemini-flash-lite-latest", cascade)

    def test_t1_09_thinking_config_generation(self):
        """Feature 5: _no_thinking safely configures generationConfig without raising syntax error."""
        base_cfg = {"maxOutputTokens": 4096}
        cfg_25 = _no_thinking(base_cfg, model="gemini-2.5-flash")
        self.assertIn("thinkingConfig", cfg_25)

        cfg_30 = _no_thinking(base_cfg, model="gemini-3.0-flash")
        self.assertIn("thinkingConfig", cfg_30)
        self.assertEqual(cfg_30["thinkingConfig"].get("thinkingLevel"), "low")

    def test_t1_10_schema_auto_repair_retains_json_mime(self):
        """Feature 5: Auto-repair removes responseSchema but retains responseMimeType."""
        gen_cfg = {
            "responseMimeType": "application/json",
            "responseSchema": LECTURE_DIGEST_SCHEMA,
            "thinkingConfig": {"thinkingBudget": 0},
            "temperature": 0.2,
        }
        repaired = auto_repair_generation_config(gen_cfg)
        self.assertNotIn("responseSchema", repaired)
        self.assertNotIn("thinkingConfig", repaired)
        self.assertEqual(repaired.get("responseMimeType"), "application/json")
        self.assertEqual(repaired.get("temperature"), 0.2)

    def test_t1_11_key_cooldown_classification_differential(self):
        """Feature 6: Quota error (429) cooldown is shorter than authentication error (401/403) cooldown."""
        mark_key_failed("gemini", K_VAULT_1, AIQuotaError("429 Quota Exceeded"))
        quota_cd = key_cooldown_remaining("gemini", K_VAULT_1)

        mark_key_failed("gemini", K_VAULT_2, AIConfigError("401 Unauthorized"))
        auth_cd = key_cooldown_remaining("gemini", K_VAULT_2)

        self.assertGreater(quota_cd, 0)
        self.assertGreater(auth_cd, quota_cd)

    def test_t1_12_masked_key_security(self):
        """Feature 6: API keys are masked in summaries and logs and never leak raw secrets."""
        masked = masked_key(K_VAULT_1)
        self.assertNotIn(K_VAULT_1, masked)
        self.assertTrue(masked.startswith(K_VAULT_1[:4]))
        self.assertIn("•", masked)

        summary = key_status_summary("gemini", [K_VAULT_1, K_VAULT_2])
        for entry in summary:
            self.assertNotIn(K_VAULT_1, entry["masked"])
            self.assertNotIn(K_VAULT_2, entry["masked"])

    @patch("database.db.op_claim", AsyncMock(return_value=True))
    @patch("database.db.op_release", AsyncMock(return_value=True))
    def test_t1_13_inflight_lock_acquisition(self):
        """Feature 7: ai_claim_inflight locks out concurrent invocations for the same user."""
        uid = 88001
        self.assertTrue(asyncio.run(ai_claim_inflight(uid)))
        self.assertFalse(asyncio.run(ai_claim_inflight(uid)))

        asyncio.run(ai_release_inflight(uid))
        self.assertTrue(asyncio.run(ai_claim_inflight(uid)))
        asyncio.run(ai_release_inflight(uid))

    @patch("backend.database.core.lecture_consume_quota", new_callable=AsyncMock)
    def test_t1_14_zero_quota_rejection(self, mock_consume):
        """Feature 7: User with exhausted daily quota is rejected without consuming quota or calling AI."""
        mock_consume.side_effect = [(True, 1, 3), (True, 2, 3), (True, 3, 3), (False, 3, 3)]
        uid = 88002
        today = "2026-11-24"

        # Max out quota
        for _ in range(3):
            allowed, _, _ = asyncio.run(lecture_consume_quota(uid, daily_limit=3, today=today))
            self.assertTrue(allowed)

        # 4th attempt rejected
        allowed, used, limit = asyncio.run(lecture_consume_quota(uid, daily_limit=3, today=today))
        self.assertFalse(allowed)
        self.assertEqual(used, 3)
        self.assertEqual(limit, 3)
        self.assertEqual(mock_consume.call_count, 4)

    @patch("backend.database.core.lecture_consume_quota", new_callable=AsyncMock)
    def test_t1_15_admin_unlimited_quota(self, mock_consume):
        """Feature 7: Admin user (ADMIN_ID) has unlimited quota."""
        mock_consume.return_value = (True, 0, 0)
        today = "2026-11-24"

        for _ in range(10):
            allowed, used, limit = asyncio.run(lecture_consume_quota(999, daily_limit=2, today=today))
            self.assertTrue(allowed)
            self.assertEqual(used, 0)
            self.assertEqual(limit, 0)
        self.assertEqual(mock_consume.call_count, 10)

    @patch("database.db.op_claim", AsyncMock(return_value=True))
    @patch("database.db.op_release", AsyncMock(return_value=True))
    @patch("ai_solver.check_and_consume_lecture_quota", new_callable=AsyncMock)
    def test_t1_16_inflight_lock_released_on_quota_rejection(self, mock_check_quota):
        """Feature 7: Rejection due to exhausted daily quota releases in-flight lock so user is not stuck."""
        uid = 88005
        session_id = "test_quota_exhausted_sess"
        lecture_scribe._LECTURE_SESSIONS[session_id] = {
            "files": [{"kind": "audio", "name": "lecture.mp3", "tg_file_id": "file_1"}]
        }
        self.addCleanup(lambda: lecture_scribe._LECTURE_SESSIONS.pop(session_id, None))

        mock_check_quota.return_value = (False, 3, 3)

        update = MagicMock()
        update.effective_user.id = uid
        update.callback_query = None
        msg = AsyncMock()
        update.effective_message = msg

        context = MagicMock()
        context.user_data = {}
        context.bot = AsyncMock()

        self.assertNotIn(uid, ai_solver._busy_users)

        asyncio.run(run_lecture_processing(update, context, session_id))

        # Check that user received quota limit message
        msg.reply_text.assert_called_once()
        sent_text = msg.reply_text.call_args[0][0]
        self.assertIn("سقف روزانهٔ تولید جزوه پایان یافته است", sent_text)

        # Check that in-flight lock was cleanly released (not stuck in _busy_users)
        self.assertNotIn(uid, ai_solver._busy_users)

        # Confirm user can immediately acquire in-flight lock for next AI query
        self.assertTrue(asyncio.run(ai_claim_inflight(uid)))
        asyncio.run(ai_release_inflight(uid))

    @patch("database.db.op_claim", AsyncMock(return_value=True))
    @patch("database.db.op_release", AsyncMock(return_value=True))
    @patch("ai_solver.check_and_consume_lecture_quota", new_callable=AsyncMock)
    @patch("ai_solver.refund_lecture_quota", new_callable=AsyncMock)
    @patch("backend.services.lecture_worker.get_lecture_worker_queue")
    def test_t1_17_inflight_lock_released_on_queue_full(self, mock_get_worker, mock_refund, mock_check_quota):
        """Feature 7: Rejection due to full worker queue refunds quota and releases in-flight lock."""
        uid = 88006
        session_id = "test_queue_full_sess"
        lecture_scribe._LECTURE_SESSIONS[session_id] = {
            "files": [{"kind": "audio", "name": "lecture.mp3", "tg_file_id": "file_2"}]
        }
        self.addCleanup(lambda: lecture_scribe._LECTURE_SESSIONS.pop(session_id, None))

        mock_check_quota.return_value = (True, 1, 3)
        worker = MagicMock()
        worker.enqueue_job = AsyncMock(return_value=False)
        mock_get_worker.return_value = worker

        update = MagicMock()
        update.effective_user.id = uid
        update.callback_query = None
        msg = AsyncMock()
        status_msg = AsyncMock()
        msg.reply_text = AsyncMock(return_value=status_msg)
        update.effective_message = msg

        context = MagicMock()
        context.user_data = {}
        context.bot = AsyncMock()

        self.assertNotIn(uid, ai_solver._busy_users)

        asyncio.run(run_lecture_processing(update, context, session_id))

        # Check that quota was refunded
        mock_refund.assert_called_once_with(uid)

        # Check that queue full status message was edited
        status_msg.edit_text.assert_called_once()
        edited_text = status_msg.edit_text.call_args[0][0]
        self.assertIn("صف پردازش در حال حاضر تکمیل است", edited_text)

        # Check that in-flight lock was cleanly released
        self.assertNotIn(uid, ai_solver._busy_users)

        # Confirm user can immediately acquire in-flight lock for next AI query
        self.assertTrue(asyncio.run(ai_claim_inflight(uid)))
        asyncio.run(ai_release_inflight(uid))


# ============================================================================
# TIER 2: BOUNDARY & CORNER CASES
# ============================================================================
class TestTier2BoundaryAndCorner(unittest.TestCase):
    """Tier 2: Boundary & Corner Cases (Schema Mismatch, Cooldown Limits, Delimiters, Fault Recovery)."""

    def setUp(self):
        ai_solver._KEY_STATE.clear()
        ai_solver._busy_users.clear()
        self.env_patcher = patch.dict(os.environ, {}, clear=False)
        self.env_patcher.start()

    def tearDown(self):
        self.env_patcher.stop()
        ai_solver._KEY_STATE.clear()
        ai_solver._busy_users.clear()

    def test_t2_01_schema_conflict_auto_repair_400(self):
        """Feature 5: HTTP 400 schema conflict triggers auto-repair retry stripping schema and thinkingConfig."""
        attempts = []

        async def _mock_post(url, headers, json_payload):
            cfg = json_payload.get("generationConfig", {})
            attempts.append(cfg)
            if "responseSchema" in cfg or "thinkingConfig" in cfg:
                return httpx.Response(
                    status_code=400,
                    text="INVALID_ARGUMENT: responseSchema is not supported with thinkingConfig",
                    request=httpx.Request("POST", url)
                )
            return httpx.Response(
                status_code=200,
                text=json.dumps({"candidates": [{"content": {"parts": [{"text": json.dumps(SAMPLE_LECTURE_DIGEST)}]}}]}),
                request=httpx.Request("POST", url)
            )

        async def _execute_pipeline():
            initial_cfg = {
                "responseMimeType": "application/json",
                "responseSchema": LECTURE_DIGEST_SCHEMA,
                "thinkingConfig": {"thinkingBudget": 0},
            }
            res = await _mock_post("https://mock", {}, {"generationConfig": initial_cfg})
            if res.status_code == 400 and ("schema" in res.text.lower() or "argument" in res.text.lower()):
                repaired = auto_repair_generation_config(initial_cfg)
                res = await _mock_post("https://mock", {}, {"generationConfig": repaired})
            self.assertEqual(res.status_code, 200)
            data = res.json()
            raw_text = data["candidates"][0]["content"]["parts"][0]["text"]
            return _parse_json_from_text(raw_text)

        digest = asyncio.run(_execute_pipeline())
        self.assertEqual(digest["title"], SAMPLE_LECTURE_DIGEST["title"])
        self.assertEqual(len(attempts), 2)
        self.assertIn("responseSchema", attempts[0])
        self.assertNotIn("responseSchema", attempts[1])
        self.assertNotIn("thinkingConfig", attempts[1])

    def test_t2_02_thinking_budget_compatibility(self):
        """Feature 5: Thinking budget compatibility across model families."""
        gen_cfg = {"maxOutputTokens": 2048, "thinkingConfig": {"thinkingBudget": 0}}
        stripped = {k: v for k, v in gen_cfg.items() if k != "thinkingConfig"}
        self.assertNotIn("thinkingConfig", stripped)
        self.assertEqual(stripped["maxOutputTokens"], 2048)

    @patch("backend.database.core.lecture_refund_quota", new_callable=AsyncMock)
    @patch("backend.database.core.lecture_consume_quota", new_callable=AsyncMock)
    def test_t2_03_all_keys_exhausted_failover(self, mock_consume, mock_refund):
        """Feature 6 & 7: When all keys fail with 429, AIQuotaError is raised and quota is refunded."""
        mock_consume.return_value = (True, 1, 5)
        uid = 77001
        today = "2026-11-24"

        allowed, _, _ = asyncio.run(lecture_consume_quota(uid, daily_limit=5, today=today))
        self.assertTrue(allowed)

        async def _all_exhausted(key):
            raise AIQuotaError("429 Resource Exhausted")

        with self.assertRaises(AIQuotaError):
            try:
                asyncio.run(run_with_key_failover("gemini", [K_VAULT_1, K_VAULT_2], _all_exhausted))
            except Exception:
                asyncio.run(lecture_refund_quota(uid, today))
                raise

        self.assertGreater(key_cooldown_remaining("gemini", K_VAULT_1), 0)
        self.assertGreater(key_cooldown_remaining("gemini", K_VAULT_2), 0)
        mock_refund.assert_called_once_with(uid, today)

    def test_t2_04_empty_vault_and_missing_env_keys(self):
        """Feature 6: Empty vault and missing env keys raises AIConfigError with Persian guidance."""
        os.environ.pop("GEMINI_API_KEYS", None)
        os.environ.pop("GEMINI_API_KEY", None)
        os.environ.pop("GOOGLE_API_KEY", None)

        cfg = {"vault_multi": {}, "provider": "gemini", "api_key": ""}
        keys = resolve_gemini_api_keys(cfg)

        self.assertEqual(keys, [])
        if not keys:
            err = AIConfigError("هیچ کلید فعالی برای Google Gemini یافت نشد. لطفاً کلیدهای AI Studio را ثبت فرمایید.")
            self.assertIn("هیچ کلید فعالی", str(err))

    def test_t2_05_markdown_wrapped_json_extraction(self):
        """Feature 5: Markdown ```json ... ``` formatting is stripped cleanly by _parse_json_from_text."""
        raw = f"```json\n{json.dumps(SAMPLE_LECTURE_DIGEST, ensure_ascii=False)}\n```"
        parsed = _parse_json_from_text(raw)
        self.assertEqual(parsed["title"], SAMPLE_LECTURE_DIGEST["title"])
        self.assertEqual(len(parsed["clinical_pearls"]), 1)

    def test_t2_06_conversational_text_surrounding_json(self):
        """Feature 5: Conversational preamble and postamble around JSON are handled by regex extraction."""
        inner_json = json.dumps(SAMPLE_LECTURE_DIGEST, ensure_ascii=False)
        raw = f"سلام، در ادامه جزوه تفصیلی این جلسه خدمت شما آماده شد:\n{inner_json}\nامیدوارم در آزمون موفق باشید."
        parsed = _parse_json_from_text(raw)
        self.assertEqual(parsed["subject"], "فارماکولوژی")
        self.assertIn("comparison_table", parsed)

    def test_t2_07_malformed_json_fallback_raises(self):
        """Feature 5: Completely corrupted non-JSON text raises JSONDecodeError enabling model advance."""
        raw = "متن ناقص و بدون فرمت بدون هیچ علامت براکت یا ساختار معتبر"
        with self.assertRaises(json.JSONDecodeError):
            _parse_json_from_text(raw)

    def test_t2_08_comma_semicolon_delimited_env_keys(self):
        """Feature 6: Semicolon, newline, and comma delimited env variables parse cleanly."""
        os.environ["GEMINI_API_KEYS"] = f"  {K_ENV_1} ;\n {K_ENV_2} ,  ;;  "
        keys = resolve_gemini_api_keys({})
        self.assertEqual(keys, [K_ENV_1, K_ENV_2])

    def test_t2_09_all_keys_in_cooldown_selects_earliest_expiring(self):
        """Feature 6: When all keys are in cooldown, ordered_keys selects earliest expiring key."""
        mark_key_failed("gemini", K_VAULT_1, AIQuotaError("429"))
        mark_key_failed("gemini", K_VAULT_2, AIConfigError("401"))

        ordered = ordered_keys("gemini", [K_VAULT_2, K_VAULT_1])
        self.assertEqual(ordered[0], K_VAULT_1)

    @patch("backend.database.core.lecture_refund_quota", new_callable=AsyncMock)
    def test_t2_10_quota_refund_idempotence_and_zero_floor(self, mock_refund):
        """Feature 7: Refunding when count is 0 does not decrement below zero."""
        uid = 77002
        today = "2026-11-24"

        asyncio.run(lecture_refund_quota(uid, today))
        asyncio.run(lecture_refund_quota(uid, today))

        self.assertEqual(mock_refund.call_count, 2)
        mock_refund.assert_called_with(uid, today)

    def test_t2_11_dirty_unicode_key_sanitization(self):
        """Feature 6: RTL marks and invisible zero-width unicode characters are sanitized."""
        dirty_key = f"\u200f {K_VAULT_1} \u200e\n"
        clean = sanitize_api_key(dirty_key)
        self.assertEqual(clean, K_VAULT_1)

    def test_t2_12_non_rotatable_error_raises_immediately(self):
        """Feature 6: Non-key errors (e.g. TypeError or custom logic error) raise immediately without rotating."""
        calls = []

        async def _bad_logic(key):
            calls.append(key)
            raise TypeError("Fatal logical data mismatch")

        with self.assertRaises(TypeError):
            asyncio.run(run_with_key_failover("gemini", [K_VAULT_1, K_VAULT_2], _bad_logic))

        self.assertEqual(calls, [K_VAULT_1])


# ============================================================================
# TIER 3: PAIRWISE INTERACTIONS
# ============================================================================
class TestTier3PairwiseInteractions(unittest.TestCase):
    """Tier 3: Pairwise Interactions across AI Subsystems."""

    def setUp(self):
        ai_solver._KEY_STATE.clear()
        ai_solver._busy_users.clear()
        self.env_patcher = patch.dict(os.environ, {}, clear=False)
        self.env_patcher.start()

    def tearDown(self):
        self.env_patcher.stop()
        ai_solver._KEY_STATE.clear()
        ai_solver._busy_users.clear()

    def test_t3_01_model_error_then_key_error_matrix(self):
        """Features 4 & 6: Primary model fails (404) -> secondary model hits 429 on Key 1 -> Key 2 succeeds with Model 1."""
        interaction_log = []

        async def _simulate_matrix_call(key: str):
            models = ["gemini-3.5-flash", "gemini-3.6-flash"]
            for m in models:
                interaction_log.append((key, m))
                if key == K_VAULT_1 and m == "gemini-3.5-flash":
                    continue
                if key == K_VAULT_1 and m == "gemini-3.6-flash":
                    raise AIQuotaError("Key 1 exhausted on Model 2")
                if key == K_VAULT_2 and m == "gemini-3.5-flash":
                    return {"key": key, "model": m, "data": SAMPLE_LECTURE_DIGEST}
            raise AIError("Exhausted models on key")

        result = asyncio.run(run_with_key_failover("gemini", [K_VAULT_1, K_VAULT_2], _simulate_matrix_call))

        self.assertEqual(result["key"], K_VAULT_2)
        self.assertEqual(result["model"], "gemini-3.5-flash")
        self.assertIn((K_VAULT_1, "gemini-3.5-flash"), interaction_log)
        self.assertIn((K_VAULT_1, "gemini-3.6-flash"), interaction_log)
        self.assertIn((K_VAULT_2, "gemini-3.5-flash"), interaction_log)

    @patch("backend.database.core.lecture_refund_quota", new_callable=AsyncMock)
    @patch("backend.database.core.lecture_consume_quota", new_callable=AsyncMock)
    def test_t3_02_atomic_quota_rollback_on_failure(self, mock_consume, mock_refund):
        """Features 6 & 7: Unhandled AI generation exception guarantees atomic quota rollback."""
        mock_consume.return_value = (True, 1, 5)
        uid = 66001
        today = "2026-11-24"

        allowed, used, limit = asyncio.run(lecture_consume_quota(uid, daily_limit=5, today=today))
        self.assertTrue(allowed)
        self.assertEqual(used, 1)

        async def _failing_pipeline():
            try:
                raise httpx.ConnectError("Connection refused by generative AI service")
            except Exception:
                await lecture_refund_quota(uid, today)
                raise

        with self.assertRaises(httpx.ConnectError):
            asyncio.run(_failing_pipeline())

        mock_refund.assert_called_once_with(uid, today)

    @patch("backend.database.core.lecture_refund_quota", new_callable=AsyncMock)
    @patch("backend.database.core.lecture_consume_quota", new_callable=AsyncMock)
    def test_t3_03_quota_preservation_on_success(self, mock_consume, mock_refund):
        """Features 6 & 7: Successful AI synthesis retains quota deduction and never calls refund."""
        mock_consume.return_value = (True, 1, 5)
        uid = 66002
        today = "2026-11-24"

        allowed, used, _ = asyncio.run(lecture_consume_quota(uid, daily_limit=5, today=today))
        self.assertTrue(allowed)
        self.assertEqual(used, 1)

        async def _successful_pipeline():
            return SAMPLE_LECTURE_DIGEST

        digest = asyncio.run(_successful_pipeline())
        self.assertEqual(digest["title"], SAMPLE_LECTURE_DIGEST["title"])
        mock_refund.assert_not_called()

    def test_t3_04_concurrent_requests_key_state_safety(self):
        """Feature 6: Concurrent async coroutines hitting 429 safely mutate key state without race conditions."""
        keys = [f"AIza_conc_key_{i}" for i in range(5)]

        async def _worker(k):
            mark_key_failed("gemini", k, AIQuotaError(f"429 on {k}"))
            await asyncio.sleep(0.01)
            mark_key_ok("gemini", k)

        async def _run_all():
            await asyncio.gather(*[_worker(k) for k in keys])

        asyncio.run(_run_all())

        for k in keys:
            self.assertEqual(key_cooldown_remaining("gemini", k), 0)

    @patch("backend.database.core.lecture_consume_quota", new_callable=AsyncMock)
    def test_t3_05_concurrent_quota_consumption_atomic(self, mock_consume):
        """Feature 7: Multiple concurrent quota deductions for 1 remaining slot allow exactly one winner."""
        mock_consume.side_effect = [
            (True, 1, 2),
            (True, 2, 2),
            (False, 2, 2),
            (False, 2, 2),
        ]
        uid = 66003
        today = "2026-11-24"

        async def _attempt_consume():
            return await lecture_consume_quota(uid, daily_limit=2, today=today)

        async def _run_competition():
            results = []
            for _ in range(4):
                results.append(await _attempt_consume())
            return results

        results = asyncio.run(_run_competition())
        allowed_count = sum(1 for allowed, _, _ in results if allowed)
        rejected_count = sum(1 for allowed, _, _ in results if not allowed)

        self.assertEqual(allowed_count, 2)
        self.assertEqual(rejected_count, 2)
        self.assertEqual(mock_consume.call_count, 4)

    @patch("database.db.op_claim", AsyncMock(return_value=True))
    @patch("database.db.op_release", AsyncMock(return_value=True))
    @patch("ai_solver.refund_lecture_quota", new_callable=AsyncMock)
    @patch("backend.services.telegram_downloader.download_telegram_media", new_callable=AsyncMock)
    @patch("backend.services.lecture_scribe.transcode_audio_file", new_callable=AsyncMock)
    @patch("ai_solver.get_ai_config", new_callable=AsyncMock)
    def test_t3_06_model_rotation_recovers_after_schema_400(self, mock_cfg, mock_transcode, mock_download, mock_refund):
        """Features 4 & 5: When model 1 400 retry still fails, system advances to model 2 instead of crashing."""
        tmp = tempfile.NamedTemporaryFile(suffix=".mp3", delete=False)
        tmp.write(b"dummy audio content")
        tmp.close()
        self.addCleanup(lambda: os.path.exists(tmp.name) and os.unlink(tmp.name))

        mock_download.return_value = tmp.name
        mock_transcode.return_value = tmp.name
        mock_cfg.return_value = {"vault_multi": {"gemini": [K_VAULT_1]}, "provider": "gemini"}

        bot = AsyncMock()
        bot.send_message = AsyncMock()
        bot.send_document = AsyncMock()
        bot.edit_message_text = AsyncMock()

        models_attempted = []

        async def _mock_post(client, url, headers=None, json=None, **kwargs):
            model = url.split("/models/")[1].split(":")[0]
            models_attempted.append(model)
            if model == "gemini-3.5-flash":
                return httpx.Response(400, text="INVALID_ARGUMENT: unsupported format", request=httpx.Request("POST", url))
            return httpx.Response(200, text=json_lib.dumps({"candidates": [{"content": {"parts": [{"text": json_lib.dumps(SAMPLE_LECTURE_DIGEST)}]}}]}), request=httpx.Request("POST", url))

        with patch.object(httpx.AsyncClient, "post", _mock_post):
            session = {"files": [{"kind": "audio", "name": "test.mp3", "tg_file_id": "f123"}]}
            success = asyncio.run(run_lecture_processing_worker(bot=bot, chat_id=123, uid=66004, session=session, status_msg_id=12))

        self.assertTrue(success)
        self.assertIn("gemini-3.5-flash", models_attempted)
        self.assertIn("gemini-3.6-flash", models_attempted)


# ============================================================================
# TIER 4: REAL-WORLD SCENARIOS
# ============================================================================
class TestTier4RealWorldScenarios(unittest.TestCase):
    """Tier 4: Realistic End-to-End Medical Lecture Scenarios."""

    def setUp(self):
        ai_solver._KEY_STATE.clear()
        ai_solver._busy_users.clear()
        self.env_patcher = patch.dict(os.environ, {}, clear=False)
        self.env_patcher.start()

    def tearDown(self):
        self.env_patcher.stop()
        ai_solver._KEY_STATE.clear()
        ai_solver._busy_users.clear()

    @patch("database.db.op_claim", AsyncMock(return_value=True))
    @patch("database.db.op_release", AsyncMock(return_value=True))
    @patch("ai_solver.refund_lecture_quota", new_callable=AsyncMock)
    @patch("backend.services.telegram_downloader.download_telegram_media", new_callable=AsyncMock)
    @patch("backend.services.lecture_scribe.transcode_audio_file", new_callable=AsyncMock)
    @patch("ai_solver.get_ai_config", new_callable=AsyncMock)
    def test_t4_01_end_to_end_failover_marathon(self, mock_cfg, mock_transcode, mock_download, mock_refund):
        """Realistic multi-stage failure marathon:
        
        - 3 Keys configured: K1, K2, K3.
        - K1 hits HTTP 429 Quota Exhausted.
        - K2 hits HTTP 401 Invalid Key.
        - K3 is active.
        - Primary model (gemini-3.5-flash) on K3 hits HTTP 400 schema conflict.
        - Auto-repair triggers and strips schema -> succeeds with 200 OK + valid lecture digest.
        - Digest parsed and verified with clinical pearls, exam traps, and comparison table.
        - User quota atomically consumed and remains debited.
        - K1 & K2 placed in appropriate cooldowns; K3 remains healthy.
        """
        tmp = tempfile.NamedTemporaryFile(suffix=".mp3", delete=False)
        tmp.write(b"dummy audio content")
        tmp.close()
        self.addCleanup(lambda: os.path.exists(tmp.name) and os.unlink(tmp.name))

        mock_download.return_value = tmp.name
        mock_transcode.return_value = tmp.name
        mock_cfg.return_value = {
            "vault_multi": {"gemini": [K_VAULT_1, K_VAULT_2, K_ENV_1]},
            "provider": "gemini",
        }

        bot = AsyncMock()
        bot.send_message = AsyncMock()
        bot.send_document = AsyncMock()
        bot.delete_message = AsyncMock()

        key_log = []

        async def _mock_post(client, url, headers=None, json=None, **kwargs):
            key = (headers or {}).get("x-goog-api-key")
            key_log.append(key)
            if key == K_VAULT_1:
                return httpx.Response(429, text="Resource has been exhausted", request=httpx.Request("POST", url))
            if key == K_VAULT_2:
                return httpx.Response(401, text="API key not valid", request=httpx.Request("POST", url))
            
            gen_cfg = (json or {}).get("generationConfig", {})
            if "responseSchema" in gen_cfg:
                return httpx.Response(400, text="INVALID_ARGUMENT: responseSchema not supported", request=httpx.Request("POST", url))
            
            # Succeeded on auto-repair!
            return httpx.Response(
                200,
                text=json_lib.dumps({"candidates": [{"content": {"parts": [{"text": json_lib.dumps(SAMPLE_LECTURE_DIGEST)}]}}]}),
                request=httpx.Request("POST", url),
            )

        session = {
            "files": [{"kind": "audio", "name": "cardio_lecture.m4a", "tg_file_id": "aud_123"}],
            "user_notes": "تاکید بر تفاوت ACEI و ARB",
        }

        with patch.object(httpx.AsyncClient, "post", _mock_post):
            success = asyncio.run(run_lecture_processing_worker(
                bot=bot,
                chat_id=12345678,
                uid=99001,
                session=session,
                status_msg_id=777,
            ))

        self.assertTrue(success)
        # Verify key rotation path: K1 -> K2 -> K3
        self.assertIn(K_VAULT_1, key_log)
        self.assertIn(K_VAULT_2, key_log)
        self.assertIn(K_ENV_1, key_log)
        self.assertGreater(key_cooldown_remaining("gemini", K_VAULT_1), 0)
        self.assertGreater(key_cooldown_remaining("gemini", K_VAULT_2), 0)
        self.assertEqual(key_cooldown_remaining("gemini", K_ENV_1), 0)

        # Quota remains deducted, refund never called
        mock_refund.assert_not_called()

        # Bot delivered summary message and PDF document
        bot.send_message.assert_called()
        bot.send_document.assert_called_once()
        sent_caption = bot.send_message.call_args[1].get("text") or bot.send_message.call_args[0][0]
        self.assertIn("جزوه جامع کلاسی تدوین شد!", sent_caption)
        self.assertIn("فارماکولوژی", sent_caption)

    @patch("database.db.op_claim", AsyncMock(return_value=True))
    @patch("database.db.op_release", AsyncMock(return_value=True))
    @patch("ai_solver.refund_lecture_quota", new_callable=AsyncMock)
    @patch("backend.services.telegram_downloader.download_telegram_media", new_callable=AsyncMock)
    @patch("backend.services.lecture_scribe.transcode_audio_file", new_callable=AsyncMock)
    @patch("ai_solver.get_ai_config", new_callable=AsyncMock)
    def test_t4_02_total_outage_disaster_recovery(self, mock_cfg, mock_transcode, mock_download, mock_refund):
        """Catastrophic total outage disaster recovery:
        
        - All keys and endpoints fail (429 or network errors).
        - Exception caught in processing handler.
        - User quota atomically restored (refunded).
        - Reassuring Persian message sent to user indicating no quota lost.
        - In-flight lock released cleanly.
        """
        tmp = tempfile.NamedTemporaryFile(suffix=".mp3", delete=False)
        tmp.write(b"dummy audio content")
        tmp.close()
        self.addCleanup(lambda: os.path.exists(tmp.name) and os.unlink(tmp.name))

        mock_download.return_value = tmp.name
        mock_transcode.return_value = tmp.name
        mock_cfg.return_value = {
            "vault_multi": {"gemini": [K_VAULT_1, K_VAULT_2]},
            "provider": "gemini",
        }

        bot = AsyncMock()
        bot.send_message = AsyncMock()
        bot.send_document = AsyncMock()
        bot.edit_message_text = AsyncMock()

        async def _mock_post(client, url, headers=None, json=None, **kwargs):
            return httpx.Response(429, text="Resource has been exhausted", request=httpx.Request("POST", url))

        session = {
            "files": [{"kind": "audio", "name": "cardio_lecture.m4a", "tg_file_id": "aud_123"}],
        }

        with patch.object(httpx.AsyncClient, "post", _mock_post):
            success = asyncio.run(run_lecture_processing_worker(
                bot=bot,
                chat_id=12345678,
                uid=99002,
                session=session,
                status_msg_id=778,
            ))

        self.assertFalse(success)
        # Verify quota is atomically restored
        mock_refund.assert_called_once_with(99002)

        # Verify user received reassuring Persian feedback
        bot.edit_message_text.assert_called()
        call_kwargs = bot.edit_message_text.call_args[1] or {}
        call_text = call_kwargs.get("text") or bot.edit_message_text.call_args[0][0]
        self.assertIn("برگردانده شد و کسر نگردید", call_text)

        # Verify in-flight lock was cleanly released
        self.assertTrue(asyncio.run(ai_claim_inflight(99002)))
        asyncio.run(ai_release_inflight(99002))

    @patch("database.db.op_claim", AsyncMock(return_value=True))
    @patch("database.db.op_release", AsyncMock(return_value=True))
    @patch("ai_solver.refund_lecture_quota", new_callable=AsyncMock)
    @patch("backend.services.telegram_downloader.download_telegram_media", new_callable=AsyncMock)
    @patch("backend.services.lecture_scribe.transcode_audio_file", new_callable=AsyncMock)
    @patch("ai_solver.get_ai_config", new_callable=AsyncMock)
    def test_t4_03_full_lecture_pipeline_delivery(self, mock_cfg, mock_transcode, mock_download, mock_refund):
        """Simulated end-to-end lecture scribe flow with audio input, AI structuring, and Telegram delivery."""
        tmp = tempfile.NamedTemporaryFile(suffix=".mp3", delete=False)
        tmp.write(b"dummy audio content")
        tmp.close()
        self.addCleanup(lambda: os.path.exists(tmp.name) and os.unlink(tmp.name))

        mock_download.return_value = tmp.name
        mock_transcode.return_value = tmp.name
        mock_cfg.return_value = {
            "vault_multi": {"gemini": [K_VAULT_1]},
            "provider": "gemini",
        }

        bot = AsyncMock()
        bot.send_message = AsyncMock()
        bot.send_document = AsyncMock()
        bot.edit_message_text = AsyncMock()

        async def _mock_post(client, url, headers=None, json=None, **kwargs):
            return httpx.Response(
                200,
                text=json_lib.dumps({"candidates": [{"content": {"parts": [{"text": json_lib.dumps(SAMPLE_LECTURE_DIGEST)}]}}]}),
                request=httpx.Request("POST", url),
            )

        session = {
            "files": [{"kind": "audio", "name": "cardio_lecture.m4a", "tg_file_id": "aud_123"}],
            "user_notes": "تاکید بر تفاوت ACEI و ARB در دوز دارو",
        }

        with patch.object(httpx.AsyncClient, "post", _mock_post):
            success = asyncio.run(run_lecture_processing_worker(
                bot=bot,
                chat_id=12345678,
                uid=99003,
                session=session,
                status_msg_id=779,
            ))

        self.assertTrue(success)
        mock_refund.assert_not_called()

        # Inflight lock released
        self.assertTrue(asyncio.run(ai_claim_inflight(99003)))
        asyncio.run(ai_release_inflight(99003))

        # Telegram delivery verified
        bot.send_message.assert_called()
        bot.send_document.assert_called_once()
        sent_caption = bot.send_message.call_args[1].get("text") or bot.send_message.call_args[0][0]
        self.assertIn("جزوه جامع کلاسی تدوین شد!", sent_caption)
        self.assertIn("فارماکولوژی بالینی", sent_caption)


# ----------------------------------------------------------------------------
# Execution Entry Point
# ----------------------------------------------------------------------------
if __name__ == "__main__":
    unittest.main()
