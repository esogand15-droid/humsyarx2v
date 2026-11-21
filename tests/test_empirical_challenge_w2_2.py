# -*- coding: utf-8 -*-
"""Empirical Challenger Suite for Wave 2: Storage Concurrency & Telegram Bot Outbox.

Empirically tests:
1. LocalStorageDriver Concurrency (50 concurrent writers/readers with checksum integrity, atomic swap verification).
2. LocalStorageDriver LRU eviction race conditions (single reader and multi-reader reference count eviction race).
3. LocalStorageDriver Path Traversal injection vectors (null bytes, directory traversal, special characters, Windows reserved names).
4. LocalStorageDriver File and directory permission mode verification.
5. Telegram Bot Outbox reply_markup deserialization resilience against malformed inputs.
"""
from __future__ import annotations

import asyncio
import hashlib
import os
import shutil
import stat
import sys
import tempfile
import time
import unittest
from pathlib import Path
from typing import Any, Dict, List, Optional

from telegram import InlineKeyboardButton, InlineKeyboardMarkup

# Add project root to sys.path
HERE = Path(__file__).resolve().parent
PROJECT_ROOT = HERE.parent
if str(PROJECT_ROOT) not in sys.path:
    sys.path.insert(0, str(PROJECT_ROOT))

from backend.services.storage import LocalStorageDriver


class TestLocalStorageConcurrencyStress(unittest.IsolatedAsyncioTestCase):
    """Empirical Stress Tests for LocalStorageDriver Concurrency."""

    async def asyncSetUp(self):
        self.temp_dir = tempfile.mkdtemp(prefix="storage_stress_")
        self.driver = LocalStorageDriver(root_dir=self.temp_dir)

    async def asyncTearDown(self):
        shutil.rmtree(self.temp_dir, ignore_errors=True)

    def _build_payload(self, tag: int, length: int = 16384) -> bytes:
        """Create payload with embedded SHA-256 checksum."""
        header = f"PAYLOAD:{tag:05d}:".encode("ascii")
        body = os.urandom(length - len(header) - 32)
        content = header + body
        checksum = hashlib.sha256(content).digest()
        return content + checksum

    def _verify_payload(self, data: bytes) -> tuple[bool, str]:
        """Verify checksum and integrity of payload."""
        if len(data) < 40:
            return False, f"Payload too short: {len(data)} bytes"
        content = data[:-32]
        expected_checksum = data[-32:]
        actual_checksum = hashlib.sha256(content).digest()
        if actual_checksum != expected_checksum:
            return False, "Checksum mismatch (torn or corrupt read detected)"
        return True, "OK"

    async def test_50_concurrent_writers_and_readers_no_corrupt_or_zero_byte_reads(self):
        """Stress test: 50 concurrent writers and 50 concurrent readers on the SAME file_id.

        Verifies:
        - Atomic replace (os.replace) prevents partial, torn, or 0-byte reads.
        - Every read payload passes SHA-256 integrity validation.
        """
        file_id = "concurrent_stress_doc_50"
        num_writers = 50
        num_readers = 50
        writes_per_worker = 10
        reads_per_worker = 20

        # Prime the file with an initial payload
        initial_payload = self._build_payload(0)
        await self.driver.save_original(file_id, initial_payload)

        torn_reads: list[str] = []
        zero_byte_reads: list[str] = []
        successful_reads = 0
        successful_writes = 0
        write_errors: list[str] = []
        read_errors: list[str] = []

        stop_event = asyncio.Event()

        async def writer(worker_id: int):
            nonlocal successful_writes
            for i in range(writes_per_worker):
                try:
                    payload = self._build_payload(worker_id * 1000 + i)
                    await self.driver.save_original(file_id, payload)
                    successful_writes += 1
                except Exception as e:
                    write_errors.append(f"Writer-{worker_id}-iter-{i}: {e}")
                await asyncio.sleep(0.001)

        async def reader(worker_id: int):
            nonlocal successful_reads
            for i in range(reads_per_worker):
                try:
                    data = await self.driver.get_original(file_id)
                    if data is None:
                        continue
                    if len(data) == 0:
                        zero_byte_reads.append(f"Reader-{worker_id}-iter-{i}: received 0 bytes")
                    else:
                        ok, reason = self._verify_payload(data)
                        if not ok:
                            torn_reads.append(f"Reader-{worker_id}-iter-{i}: {reason}")
                        else:
                            successful_reads += 1
                except Exception as e:
                    read_errors.append(f"Reader-{worker_id}-iter-{i}: {e}")
                await asyncio.sleep(0.001)

        # Launch all 50 writers and 50 readers concurrently
        tasks = [writer(w) for w in range(num_writers)] + [reader(r) for r in range(num_readers)]
        await asyncio.gather(*tasks)

        # Assert zero corrupt reads
        self.assertEqual(len(zero_byte_reads), 0, f"0-byte reads detected: {zero_byte_reads}")
        self.assertEqual(len(torn_reads), 0, f"Torn / corrupted reads detected: {torn_reads}")
        self.assertGreater(successful_reads, 100, "Should have successfully completed reads")
        self.assertGreater(successful_writes, 100, "Should have successfully completed writes")

    async def test_active_read_lock_prevents_lru_eviction_single_reader(self):
        """Active read lock prevents eviction of the file currently in-flight."""
        # Create 3 cached pages
        p1 = await self.driver.save_cached_page("doc_lru", 1, b"X" * 2000)
        p2 = await self.driver.save_cached_page("doc_lru", 2, b"Y" * 2000)
        p3 = await self.driver.save_cached_page("doc_lru", 3, b"Z" * 2000)

        # Set modification times: p1 is oldest, p2 is middle, p3 is newest
        os.utime(p1, (1000, 1000))
        os.utime(p2, (2000, 2000))
        os.utime(p3, (3000, 3000))

        path1 = Path(p1)
        path2 = Path(p2)
        path3 = Path(p3)

        # Reader 1 acquires active read on p1
        async with self.driver._read_lock:
            self.driver._active_reads.add(path1)

        try:
            # Evict cache with max_bytes = 2500 (needs to evict at least 3500 bytes)
            # p1 is oldest, but active -> MUST NOT be evicted. p2 must be evicted instead.
            evicted = await self.driver.evict_lru_cache(2500)
            self.assertGreater(evicted, 0)
            self.assertTrue(path1.exists(), "Active read file (p1) must NOT be evicted")
            self.assertFalse(path2.exists(), "Older inactive file (p2) SHOULD be evicted")
        finally:
            async with self.driver._read_lock:
                self.driver._active_reads.discard(path1)

    async def test_multi_reader_same_file_lru_eviction_race(self):
        """Adversarial check: what happens when TWO readers read the SAME file concurrently?

        If _active_reads is a set, when reader 1 exits, it discards the path from the set.
        If reader 2 is still reading, the file is no longer in _active_reads,
        so a concurrent evict_lru_cache() would evict the file out from under reader 2!
        """
        p1 = await self.driver.save_cached_page("doc_shared", 1, b"M" * 4000)
        os.utime(p1, (1000, 1000))
        path1 = Path(p1)

        # Reader 1 starts reading
        async with self.driver._read_lock:
            self.driver._active_reads.add(path1)

        # Reader 2 starts reading
        async with self.driver._read_lock:
            self.driver._active_reads.add(path1)

        # Reader 1 finishes reading
        async with self.driver._read_lock:
            self.driver._active_reads.discard(path1)

        # NOTE: Reader 2 is STILL READING!
        # Check if path1 is still tracked as active in self.driver._active_reads:
        async with self.driver._read_lock:
            is_still_active = path1 in self.driver._active_reads

        # Eviction runs while Reader 2 is still reading
        evicted = await self.driver.evict_lru_cache(0)
        file_still_exists = path1.exists()

        # EMPIRICAL CHALLENGE: Multi-reader eviction protection
        # Under a correct reference-counted implementation, path1 MUST NOT be evicted
        # while Reader 2 is active. Under the current set implementation, it is prematurely evicted.
        self.assertTrue(
            file_still_exists,
            f"VULNERABILITY REPRODUCED: File {path1.name} was evicted while Reader 2 was actively reading! "
            f"(is_still_active={is_still_active}, evicted_bytes={evicted})"
        )

    async def test_multi_reader_same_file_delete_cached_page_race(self):
        """Adversarial check: delete_cached_page() race during multi-reader concurrency.

        When two readers read the same cached page, after Reader 1 exits,
        delete_cached_page() should be blocked because Reader 2 is still reading.
        With a set, Reader 1's discard removes protection for Reader 2.
        """
        p = await self.driver.save_cached_page("doc_del_race", 5, b"DATA" * 500)
        target = Path(p)

        # Reader 1 and Reader 2 start reading
        async with self.driver._read_lock:
            self.driver._active_reads.add(target)
            self.driver._active_reads.add(target)

        # Reader 1 finishes reading
        async with self.driver._read_lock:
            self.driver._active_reads.discard(target)

        # Reader 2 is still reading! delete_cached_page() should return False
        deleted = await self.driver.delete_cached_page("doc_del_race", 5)

        self.assertFalse(
            deleted,
            "VULNERABILITY REPRODUCED: delete_cached_page deleted page while Reader 2 was actively reading!"
        )



class TestLocalStoragePathTraversalAndSecurity(unittest.IsolatedAsyncioTestCase):
    """Empirical Security Tests: Path Traversal, Null Bytes, and OS Sanitization."""

    async def asyncSetUp(self):
        self.temp_dir = tempfile.mkdtemp(prefix="storage_sec_")
        self.driver = LocalStorageDriver(root_dir=self.temp_dir)

    async def asyncTearDown(self):
        shutil.rmtree(self.temp_dir, ignore_errors=True)

    async def test_path_traversal_attack_matrix(self):
        """Matrix of path traversal, null-byte injection, and invalid file_ids."""
        attack_vectors = [
            "../../etc/passwd",
            "..\\..\\windows\\win.ini",
            "..\\..\\windows\\system32",
            "file\0.pdf",
            "test/sub/dir",
            "test\\sub\\dir",
            "../../../root/.ssh/id_rsa",
            "/etc/shadow",
            "\\absolute\\windows\\path",
            "C:\\boot.ini",
            "file name with spaces",
            "file;rm -rf /",
            "file|pipe",
            "file\nnewline",
            "file\r\ncr",
            "\x00",
            "",
            "   ",
            "file$weird*chars?",
            "file<tag>",
            "file:colon",
            "file\"quote\"",
            "file'single'",
        ]

        for bad_id in attack_vectors:
            with self.subTest(bad_id=bad_id):
                with self.assertRaises((ValueError, TypeError), msg=f"Should reject {bad_id!r}"):
                    await self.driver.save_original(bad_id, b"malicious")

                with self.assertRaises((ValueError, TypeError), msg=f"Should reject {bad_id!r}"):
                    await self.driver.get_original(bad_id)

                with self.assertRaises((ValueError, TypeError), msg=f"Should reject {bad_id!r}"):
                    await self.driver.has_original(bad_id)

                with self.assertRaises((ValueError, TypeError), msg=f"Should reject {bad_id!r}"):
                    await self.driver.save_cached_page(bad_id, 1, b"malicious")

                with self.assertRaises((ValueError, TypeError), msg=f"Should reject {bad_id!r}"):
                    await self.driver.get_cached_page(bad_id, 1)

                with self.assertRaises((ValueError, TypeError), msg=f"Should reject {bad_id!r}"):
                    await self.driver.delete_cached_page(bad_id, 1)

    async def test_non_string_file_id_rejection(self):
        """Non-string inputs must raise ValueError or TypeError."""
        for non_str in [None, 12345, [], {}, 3.14, True]:
            with self.subTest(non_str=non_str):
                with self.assertRaises(ValueError):
                    await self.driver.save_original(non_str, b"data")

    async def test_negative_or_non_int_page_num_rejection(self):
        """page_num must be a non-negative integer."""
        for bad_page in [-1, -100, "1", None, 3.14]:
            with self.subTest(bad_page=bad_page):
                with self.assertRaises(ValueError):
                    await self.driver.save_cached_page("valid_id", bad_page, b"data")
                with self.assertRaises(ValueError):
                    await self.driver.get_cached_page("valid_id", bad_page)

    async def test_file_and_directory_permissions(self):
        """Verify files are created with 0o600 and directories with 0o700."""
        file_path_str = await self.driver.save_original("perm_test_doc", b"secure content")
        file_path = Path(file_path_str)
        self.assertTrue(file_path.exists())

        # On POSIX systems, check actual mode bits
        if os.name == "posix":
            file_mode = stat.S_IMODE(file_path.stat().st_mode)
            self.assertEqual(file_mode, 0o600, f"File permission should be 0o600, got {oct(file_mode)}")

            dir_mode = stat.S_IMODE(self.driver.originals_dir.stat().st_mode)
            self.assertEqual(dir_mode, 0o700, f"Directory permission should be 0o700, got {oct(dir_mode)}")
        else:
            # On Windows, verify file is read/writable and accessible
            self.assertTrue(os.access(file_path, os.R_OK | os.W_OK))


class TestTelegramBotOutboxDeserializationStress(unittest.TestCase):
    """Empirical Stress Tests for Telegram Bot Outbox Inline Keyboard Deserialization."""

    def deserialize_outbox_markup(self, raw_rm: Any, default_markup: Any = None) -> Any:
        """Stand-alone reproduction of lines 784-809 in backend/bot/bot.py."""
        outbox_markup = default_markup
        if raw_rm:
            try:
                if isinstance(raw_rm, dict) and "inline_keyboard" in raw_rm:
                    kb_rows = []
                    for row in raw_rm["inline_keyboard"]:
                        btn_row = []
                        for btn in row:
                            if isinstance(btn, dict):
                                btn_row.append(InlineKeyboardButton(
                                    text=btn.get("text", ""),
                                    callback_data=btn.get("callback_data"),
                                    url=btn.get("url"),
                                ))
                            elif isinstance(btn, InlineKeyboardButton):
                                btn_row.append(btn)
                        if btn_row:
                            kb_rows.append(btn_row)
                    if kb_rows:
                        outbox_markup = InlineKeyboardMarkup(kb_rows)
                elif isinstance(raw_rm, InlineKeyboardMarkup):
                    outbox_markup = raw_rm
            except Exception as _rme:
                pass
        return outbox_markup

    def test_deserialization_matrix(self):
        """Test wide spectrum of valid, malformed, empty, and adversarial reply_markup objects."""
        test_cases = [
            # 1. Null / falsy inputs
            (None, None, "None returns default"),
            ("", None, "Empty string returns default"),
            ({}, None, "Empty dict returns default"),
            ([], None, "Empty list returns default"),

            # 2. Empty or empty rows
            ({"inline_keyboard": []}, None, "Empty inline_keyboard returns default"),
            ({"inline_keyboard": [[]]}, None, "List containing empty row returns default"),
            ({"inline_keyboard": [[], []]}, None, "Multiple empty rows returns default"),

            # 3. Malformed types
            ({"inline_keyboard": 12345}, None, "Int inline_keyboard caught safely"),
            ({"inline_keyboard": "not_a_list"}, None, "String inline_keyboard returns default"),
            ({"inline_keyboard": [None]}, None, "Row is None handled safely"),
            ({"inline_keyboard": [[None]]}, None, "Button is None ignored"),
            ({"inline_keyboard": [["invalid_button_string"]]}, None, "String button ignored"),
            ({"inline_keyboard": [[12345]]}, None, "Int button ignored"),

            # 4. Standard valid approval prompt
            (
                {
                    "inline_keyboard": [
                        [
                            {"text": "✅ تأیید ورود", "callback_data": "web_auth:approve:ch_1"},
                            {"text": "❌ رد درخواست", "callback_data": "web_auth:reject:ch_1"},
                        ]
                    ]
                },
                "VALID",
                "Standard web auth keyboard with 2 buttons in 1 row"
            ),

            # 5. Multiple rows with mixed buttons (callback and url)
            (
                {
                    "inline_keyboard": [
                        [{"text": "Row 1 Btn 1", "callback_data": "r1b1"}],
                        [
                            {"text": "Row 2 Btn 1", "callback_data": "r2b1"},
                            {"text": "Row 2 Link", "url": "https://sw2.pwker.ir"},
                        ],
                        [{"text": "Row 3 Btn 1", "callback_data": "r3b1"}]
                    ]
                },
                "VALID_MULTI",
                "Multiple rows with URL and callback"
            ),

            # 6. Non-string text types (e.g. integer or bool)
            (
                {
                    "inline_keyboard": [
                        [{"text": 12345, "callback_data": "int_text"}]
                    ]
                },
                "NON_STR_TEXT",
                "Integer text reconstructed safely"
            ),

            # 7. Pre-instantiated InlineKeyboardButton and InlineKeyboardMarkup objects
            (
                {
                    "inline_keyboard": [
                        [InlineKeyboardButton(text="Pre-instantiated", callback_data="pre_1")]
                    ]
                },
                "PRE_INSTANTIATED",
                "Handles InlineKeyboardButton objects directly"
            ),
            (
                InlineKeyboardMarkup([[InlineKeyboardButton(text="Direct KB", callback_data="dkb")]]),
                "DIRECT_KB",
                "Direct InlineKeyboardMarkup pass-through"
            ),
        ]

        default_sentinel = "DEFAULT_MARKUP"

        for raw_rm, expected_type, label in test_cases:
            with self.subTest(label=label):
                result = self.deserialize_outbox_markup(raw_rm, default_markup=default_sentinel)

                if expected_type is None:
                    self.assertEqual(result, default_sentinel, f"Failed on {label}: expected default sentinel")
                elif expected_type == "VALID":
                    self.assertIsInstance(result, InlineKeyboardMarkup)
                    self.assertEqual(len(result.inline_keyboard), 1)
                    self.assertEqual(len(result.inline_keyboard[0]), 2)
                    self.assertEqual(result.inline_keyboard[0][0].text, "✅ تأیید ورود")
                    self.assertEqual(result.inline_keyboard[0][1].text, "❌ رد درخواست")
                    # Verify PTB serialization
                    d = result.to_dict()
                    self.assertIn("inline_keyboard", d)
                elif expected_type == "VALID_MULTI":
                    self.assertIsInstance(result, InlineKeyboardMarkup)
                    self.assertEqual(len(result.inline_keyboard), 3)
                    self.assertEqual(len(result.inline_keyboard[1]), 2)
                    self.assertEqual(result.inline_keyboard[1][1].url, "https://sw2.pwker.ir")
                elif expected_type == "NON_STR_TEXT":
                    self.assertIsInstance(result, InlineKeyboardMarkup)
                    self.assertEqual(len(result.inline_keyboard), 1)
                    d = result.to_dict()
                    self.assertEqual(d["inline_keyboard"][0][0]["text"], 12345)
                elif expected_type == "PRE_INSTANTIATED":
                    self.assertIsInstance(result, InlineKeyboardMarkup)
                    self.assertEqual(result.inline_keyboard[0][0].callback_data, "pre_1")
                elif expected_type == "DIRECT_KB":
                    self.assertIsInstance(result, InlineKeyboardMarkup)
                    self.assertEqual(result.inline_keyboard[0][0].callback_data, "dkb")

    def test_outbox_web_app_button_dropped(self):
        """Edge case: web_app buttons queued in outbox.

        In backend/bot/bot.py line 794-798:
        btn_row.append(InlineKeyboardButton(text=btn.get('text', ''), callback_data=btn.get('callback_data'), url=btn.get('url')))
        The 'web_app' key is completely ignored, resulting in an InlineKeyboardButton without action.
        """
        raw_rm = {
            "inline_keyboard": [
                [{"text": "Launch App", "web_app": {"url": "https://sw2.pwker.ir/app"}}]
            ]
        }
        res = self.deserialize_outbox_markup(raw_rm)
        self.assertIsInstance(res, InlineKeyboardMarkup)
        btn = res.inline_keyboard[0][0]
        # In current bot.py, web_app is None because it was never extracted
        web_app_extracted = getattr(btn, "web_app", None) is not None
        # We assert that web_app is currently dropped:
        self.assertFalse(
            web_app_extracted,
            "Documenting that web_app is dropped by bot.py outbox deserializer"
        )


if __name__ == "__main__":

    unittest.main()
