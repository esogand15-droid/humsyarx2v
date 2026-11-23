# -*- coding: utf-8 -*-
"""
🧪 tests/test_telegram_downloader.py — Unit Tests for 3-Tier Media Downloader
HamsYar Medical Platform — Milestone 1 (M1)
"""

import asyncio
import os
import sys
import tempfile
from unittest.mock import AsyncMock, MagicMock, patch

_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if _ROOT not in sys.path:
    sys.path.insert(0, _ROOT)

import pytest
import telegram.error

from backend.services.telegram_downloader import (
    get_telegram_credentials,
    get_mtproto_downloader_client,
    stop_mtproto_downloader_client,
    download_telegram_media,
    _download_tier1_local_api,
    _download_tier2_ptb,
    _download_tier3_mtproto,
)


@pytest.fixture(autouse=True)
def reset_mtproto_singleton():
    """Resets singleton state before and after each test."""
    import backend.services.telegram_downloader as td
    td._mtproto_client = None
    yield
    td._mtproto_client = None


def test_get_telegram_credentials():
    """Tests loading and parsing of Telegram credentials from env."""
    with patch.dict(os.environ, {
        "TELEGRAM_API_ID": "34514776",
        "TELEGRAM_API_HASH": "7f1426930f421bc5bcbeef4e33184027",
        "TELEGRAM_TOKEN": "123456:ABC-DEF1234ghIkl-zyx57W2v1u123ew11",
        "TELEGRAM_LOCAL_API_URL": "http://127.0.0.1:8081/",
    }):
        creds = get_telegram_credentials()
        assert creds["api_id"] == 34514776
        assert creds["api_hash"] == "7f1426930f421bc5bcbeef4e33184027"
        assert creds["token"] == "123456:ABC-DEF1234ghIkl-zyx57W2v1u123ew11"
        assert creds["local_api_url"] == "http://127.0.0.1:8081"


def test_download_missing_file_id_raises():
    """Missing file_id must immediately raise ValueError."""
    mock_bot = MagicMock()
    with pytest.raises(ValueError, match="file_id is required"):
        asyncio.run(download_telegram_media(
            bot=mock_bot,
            chat_id=123,
            message_id=456,
            file_id="",
        ))


def test_tier1_local_api_direct_file_copy():
    """Tier 1: if file_path is on local filesystem, copy directly."""
    with tempfile.NamedTemporaryFile(suffix=".m4a", delete=False) as src_file, \
         tempfile.NamedTemporaryFile(suffix=".m4a", delete=False) as dst_file:
        src_file.write(b"SAMPLE AUDIO CONTENT" * 100)
        src_file.flush()
        src_path = src_file.name
        dst_path = dst_file.name

    try:
        mock_resp = MagicMock()
        mock_resp.status_code = 200
        mock_resp.json.return_value = {"ok": True, "result": {"file_path": src_path}}

        mock_http_client = AsyncMock()
        mock_http_client.get = AsyncMock(return_value=mock_resp)
        mock_http_client.__aenter__ = AsyncMock(return_value=mock_http_client)
        mock_http_client.__aexit__ = AsyncMock(return_value=None)

        with patch("httpx.AsyncClient", return_value=mock_http_client):
            res = asyncio.run(_download_tier1_local_api(
                local_url="http://127.0.0.1:8081",
                token="123:TOKEN",
                file_id="local_file_123",
                dest_path=dst_path,
            ))
            assert res == os.path.abspath(dst_path)
            assert os.path.getsize(dst_path) > 0
    finally:
        for p in (src_path, dst_path):
            if os.path.exists(p):
                os.remove(p)


def test_tier2_ptb_small_file_download():
    """Tier 2: files <= 20MB are downloaded via PTB Bot API."""
    with tempfile.NamedTemporaryFile(suffix=".mp3", delete=False) as dst_file:
        dst_file.write(b"AUDIO BYTES")
        dst_path = dst_file.name

    try:
        mock_bot = MagicMock()
        mock_tg_file = AsyncMock()
        mock_tg_file.download_to_drive = AsyncMock(return_value=dst_path)
        mock_bot.get_file = AsyncMock(return_value=mock_tg_file)

        res = asyncio.run(_download_tier2_ptb(
            bot=mock_bot,
            file_id="small_file_id",
            dest_path=dst_path,
        ))
        assert res == os.path.abspath(dst_path)
        mock_bot.get_file.assert_called_once_with("small_file_id")
        mock_tg_file.download_to_drive.assert_called_once_with(custom_path=dst_path)
    finally:
        if os.path.exists(dst_path):
            os.remove(dst_path)


def test_tier2_ptb_escalation_to_tier3_on_bad_request():
    """Tier 2 BadRequest ('File is too big') triggers seamless escalation to Tier 3 MTProto."""
    with tempfile.NamedTemporaryFile(suffix=".m4a", delete=False) as dst_file:
        dst_path = dst_file.name

    try:
        mock_bot = MagicMock()
        mock_bot.get_file = AsyncMock(side_effect=telegram.error.BadRequest("File is too big"))

        # In download_telegram_media, file_size <= 20MB (e.g. 19MB), but Telegram raises BadRequest
        with patch("backend.services.telegram_downloader._download_tier3_mtproto", new_callable=AsyncMock) as mock_tier3:
            mock_tier3.return_value = os.path.abspath(dst_path)
            with patch.dict(os.environ, {"TELEGRAM_LOCAL_API_URL": ""}):
                result = asyncio.run(download_telegram_media(
                    bot=mock_bot,
                    chat_id=111,
                    message_id=222,
                    file_id="large_ptb_rejected_id",
                    file_size=19 * 1024 * 1024,
                    dest_path=dst_path,
                ))
                assert result == os.path.abspath(dst_path)
                mock_tier3.assert_called_once()
    finally:
        if os.path.exists(dst_path):
            os.remove(dst_path)


def test_tier3_mtproto_large_file_direct():
    """Files > 20MB bypass Tier 2 entirely and invoke Tier 3 MTProto."""
    with tempfile.NamedTemporaryFile(suffix=".m4a", delete=False) as dst_file:
        dst_path = dst_file.name

    try:
        mock_bot = MagicMock()
        mock_bot.get_file = AsyncMock()

        with patch("backend.services.telegram_downloader._download_tier3_mtproto", new_callable=AsyncMock) as mock_tier3:
            mock_tier3.return_value = os.path.abspath(dst_path)
            with patch.dict(os.environ, {"TELEGRAM_LOCAL_API_URL": ""}):
                result = asyncio.run(download_telegram_media(
                    bot=mock_bot,
                    chat_id=333,
                    message_id=444,
                    file_id="fifty_megabyte_audio_id",
                    file_size=55 * 1024 * 1024,  # 55 MB
                    dest_path=dst_path,
                ))
                assert result == os.path.abspath(dst_path)
                # Bypassed Tier 2!
                mock_bot.get_file.assert_not_called()
                mock_tier3.assert_called_once()
    finally:
        if os.path.exists(dst_path):
            os.remove(dst_path)


def test_tier3_mtproto_message_context_and_fallback():
    """Tier 3 tries Strategy 3A (get_messages), then falls back to 3B (file_id) if needed."""
    with tempfile.NamedTemporaryFile(suffix=".m4a", delete=False) as dst_file:
        dst_file.write(b"AUDIO 50MB STREAMED TO DISK")
        dst_path = dst_file.name

    try:
        mock_client = MagicMock()
        mock_client.is_connected = True
        mock_msg = MagicMock()
        mock_msg.media = True
        mock_client.get_messages = AsyncMock(return_value=mock_msg)
        mock_client.download_media = AsyncMock(return_value=dst_path)

        with patch("backend.services.telegram_downloader.get_mtproto_downloader_client", new_callable=AsyncMock) as mock_get_client:
            mock_get_client.return_value = mock_client
            res = asyncio.run(_download_tier3_mtproto(
                chat_id=999,
                message_id=888,
                file_id="mtproto_file_id",
                dest_path=dst_path,
                bot_token="test_token",
            ))
            assert res == os.path.abspath(dst_path)
            mock_client.get_messages.assert_called_once_with(chat_id=999, message_ids=888)
            mock_client.download_media.assert_called_once_with(message=mock_msg, file_name=dst_path)
    finally:
        if os.path.exists(dst_path):
            os.remove(dst_path)


def test_mtproto_singleton_lifecycle():
    """MTProto client is initialized as a singleton and stopped cleanly."""
    mock_client = MagicMock()
    mock_client.is_connected = True
    mock_client.start = AsyncMock()
    mock_client.stop = AsyncMock()

    with patch.dict(os.environ, {
        "TELEGRAM_API_ID": "12345",
        "TELEGRAM_API_HASH": "hash123",
        "TELEGRAM_TOKEN": "token123",
    }), patch("backend.services.telegram_downloader.Client", return_value=mock_client):
        # 1. First call initializes and starts client
        c1 = asyncio.run(get_mtproto_downloader_client())
        assert c1 is mock_client
        mock_client.start.assert_called_once()

        # 2. Second call returns existing singleton without calling start again
        c2 = asyncio.run(get_mtproto_downloader_client())
        assert c2 is c1
        assert mock_client.start.call_count == 1

        # 3. Graceful stop stops client and clears state
        asyncio.run(stop_mtproto_downloader_client())
        mock_client.stop.assert_called_once()

        import backend.services.telegram_downloader as td
        assert td._mtproto_client is None
