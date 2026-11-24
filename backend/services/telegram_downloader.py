# -*- coding: utf-8 -*-
"""
📥 backend/services/telegram_downloader.py — Multi-Tier Resilient Telegram Media Downloader
HamsYar Medical Platform — Milestone 1 (M1)

Provides direct-to-disk streaming for audio, video, and documents of any size (up to 2GB):
- Tier 1: Local Telegram Bot API (if TELEGRAM_LOCAL_API_URL is configured; supports local fs bypass)
- Tier 2: Cloud Telegram Bot API via PTB (for files <= 20MB)
- Tier 3: MTProto via singleton Kurigram Client (for files > 20MB or Tier 2 fallback)
"""

import asyncio
import logging
import os
import shutil
import tempfile
import uuid
from typing import Optional, Any

import httpx
import telegram
import telegram.error
from pyrogram import Client
from pyrogram.errors import FloodWait

logger = logging.getLogger(__name__)

# Singleton MTProto Client state
_mtproto_client: Optional[Client] = None
_mtproto_lock: asyncio.Lock = asyncio.Lock()


def get_telegram_credentials(bot: Optional[Any] = None) -> dict:
    """Retrieves and normalizes Telegram API and Bot credentials from env or bot instance."""
    api_id_raw = (os.getenv("TELEGRAM_API_ID") or "").strip()
    api_hash = (os.getenv("TELEGRAM_API_HASH") or "").strip()
    token = (
        (os.getenv("TELEGRAM_TOKEN") or "").strip()
        or (os.getenv("BOT_TOKEN") or "").strip()
        or (getattr(bot, "token", None) or "").strip()
    )
    local_api_url = (os.getenv("TELEGRAM_LOCAL_API_URL") or "").strip().rstrip("/")

    api_id: Optional[int] = None
    if api_id_raw:
        try:
            api_id = int(api_id_raw)
        except ValueError:
            logger.warning("Invalid TELEGRAM_API_ID: %r (must be integer)", api_id_raw)

    # Fallback to default application MTProto credentials (.env.example) if omitted
    api_id = api_id or 34514776
    api_hash = api_hash or "7f1426930f421bc5bcbeef4e33184027"

    return {
        "api_id": api_id,
        "api_hash": api_hash,
        "token": token,
        "local_api_url": local_api_url,
    }


async def get_mtproto_downloader_client(bot_token: Optional[str] = None) -> Client:
    """
    Returns an initialized, connected singleton Kurigram Client configured for MTProto downloads.
    Runs alongside python-telegram-bot 21.x without conflicts:
    - no_updates=True: Disables MTProto update polling (no conflict with PTB getUpdates).
    - in_memory=True: Uses MemoryStorage to avoid SQLite .session file locks on disk.
    - max_concurrent_transmissions=4: Allows concurrent downloads without serialization.
    """
    global _mtproto_client, _mtproto_lock

    async with _mtproto_lock:
        if _mtproto_client is not None and getattr(_mtproto_client, "is_connected", False):
            return _mtproto_client

        creds = get_telegram_credentials()
        api_id = creds["api_id"] or 34514776
        api_hash = creds["api_hash"] or "7f1426930f421bc5bcbeef4e33184027"
        token = bot_token or creds["token"]

        if not api_id or not api_hash or not token:
            raise RuntimeError(
                "Missing MTProto credentials (TELEGRAM_API_ID, TELEGRAM_API_HASH, TELEGRAM_TOKEN). "
                "Cannot perform MTProto downloads for files > 20MB."
            )

        client = Client(
            name="humsyar_media_downloader",
            api_id=api_id,
            api_hash=api_hash,
            bot_token=token,
            in_memory=True,
            no_updates=True,
            max_concurrent_transmissions=4,
            workdir=tempfile.gettempdir(),
        )

        try:
            await client.start()
            _mtproto_client = client
            logger.info("MTProto Kurigram downloader client started successfully (in_memory=True, no_updates=True)")
            return _mtproto_client
        except Exception as exc:
            try:
                await client.stop()
            except Exception:
                pass
            logger.error("Failed to start MTProto Kurigram client: %s", exc)
            raise RuntimeError(f"Failed to start MTProto Kurigram client: {exc}") from exc


async def stop_mtproto_downloader_client() -> None:
    """Gracefully stops the singleton MTProto downloader client during application shutdown."""
    global _mtproto_client, _mtproto_lock

    async with _mtproto_lock:
        if _mtproto_client is not None:
            try:
                if getattr(_mtproto_client, "is_connected", False):
                    await _mtproto_client.stop()
                    logger.info("MTProto Kurigram downloader client stopped cleanly.")
            except Exception as exc:
                logger.warning("Error stopping MTProto downloader client: %s", exc)
            finally:
                _mtproto_client = None


# Alias for backward-compatible lifecycle calls
close_mtproto_client = stop_mtproto_downloader_client


async def _download_tier1_local_api(
    local_url: str,
    token: str,
    file_id: str,
    dest_path: str,
) -> Optional[str]:
    """Tier 1: Downloads media via Local Telegram Bot API server if configured."""
    try:
        base_api = f"{local_url}/bot{token}"
        async with httpx.AsyncClient(timeout=httpx.Timeout(15.0, read=30.0)) as client:
            resp = await client.get(f"{base_api}/getFile", params={"file_id": file_id})
            if resp.status_code != 200:
                logger.warning("Local Bot API getFile failed (status %s) for file_id=%s", resp.status_code, file_id[:12])
                return None
            js = resp.json()
            if not js.get("ok"):
                return None
            file_path = js.get("result", {}).get("file_path")
            if not file_path:
                return None

        # Check if file_path is accessible directly on local disk
        if os.path.isabs(file_path) and os.path.exists(file_path):
            shutil.copyfile(file_path, dest_path)
            logger.info("Tier 1 Local API: Copied file directly from local filesystem: %s", file_path)
            return os.path.abspath(dest_path)

        # Otherwise, stream via Local Bot API HTTP endpoint
        file_url = f"{local_url}/file/bot{token}/{file_path}"
        async with httpx.AsyncClient(timeout=httpx.Timeout(15.0, read=600.0), follow_redirects=True) as client:
            async with client.stream("GET", file_url) as stream_resp:
                if stream_resp.status_code != 200:
                    return None
                with open(dest_path, "wb") as f_out:
                    async for chunk in stream_resp.aiter_bytes(chunk_size=1024 * 1024):
                        f_out.write(chunk)

        if os.path.exists(dest_path) and os.path.getsize(dest_path) > 0:
            logger.info("Tier 1 Local API: Successfully streamed file to %s (%d bytes)", dest_path, os.path.getsize(dest_path))
            return os.path.abspath(dest_path)
    except Exception as exc:
        logger.warning("Tier 1 Local Bot API download failed for file_id=%s: %s", file_id[:12], exc)

    return None


async def _download_tier2_ptb(
    bot: Any,
    file_id: str,
    dest_path: str,
) -> Optional[str]:
    """Tier 2: Downloads media via PTB Cloud Bot API (for files <= 20MB)."""
    if bot is None or not hasattr(bot, "get_file"):
        return None
    try:
        tg_file = await bot.get_file(file_id)
        saved = await tg_file.download_to_drive(custom_path=dest_path)
        saved_str = str(os.path.abspath(saved))
        if os.path.exists(saved_str) and os.path.getsize(saved_str) > 0:
            logger.info("Tier 2 PTB: Successfully downloaded media to %s (%d bytes)", saved_str, os.path.getsize(saved_str))
            return saved_str
    except telegram.error.BadRequest as exc:
        logger.warning("Tier 2 PTB get_file rejected (likely >20MB): %s. Escalating to Tier 3 MTProto.", exc)
    except telegram.error.TelegramError as exc:
        logger.warning("Tier 2 PTB download failed: %s. Escalating to Tier 3 MTProto.", exc)
    except Exception as exc:
        logger.warning("Tier 2 PTB unexpected error: %s. Escalating to Tier 3 MTProto.", exc)

    return None


async def _download_tier3_mtproto(
    chat_id: int,
    message_id: int,
    file_id: str,
    dest_path: str,
    bot_token: Optional[str] = None,
) -> str:
    """Tier 3: Downloads media directly to disk via MTProto Kurigram Client (up to 2GB)."""
    client = await get_mtproto_downloader_client(bot_token=bot_token)

    # Strategy 3A: Attempt downloading with Message context (ensures fresh file_reference)
    if chat_id and message_id:
        try:
            msg = await client.get_messages(chat_id=chat_id, message_ids=message_id)
            if msg and getattr(msg, "media", None):
                logger.info("Tier 3 MTProto: Downloading media from Message(chat_id=%s, msg_id=%s)", chat_id, message_id)
                res = await client.download_media(message=msg, file_name=dest_path)
                if res and os.path.exists(str(res)) and os.path.getsize(str(res)) > 0:
                    if str(res) != dest_path:
                        shutil.move(str(res), dest_path)
                    logger.info("Tier 3 MTProto (3A): Downloaded successfully to %s (%d bytes)", dest_path, os.path.getsize(dest_path))
                    return os.path.abspath(dest_path)
        except FloodWait as fw:
            logger.warning("MTProto FloodWait encountered: sleeping %s seconds", fw.value)
            await asyncio.sleep(fw.value)
        except Exception as exc:
            logger.warning("Tier 3 MTProto (3A Message) attempt failed: %s. Falling back to 3B (file_id).", exc)

    # Strategy 3B: Fallback downloading directly by file_id string
    logger.info("Tier 3 MTProto (3B): Downloading media directly by file_id=%s", file_id[:12])
    res = await client.download_media(message=file_id, file_name=dest_path)
    if res and os.path.exists(str(res)) and os.path.getsize(str(res)) > 0:
        if str(res) != dest_path:
            shutil.move(str(res), dest_path)
        logger.info("Tier 3 MTProto (3B): Downloaded successfully to %s (%d bytes)", dest_path, os.path.getsize(dest_path))
        return os.path.abspath(dest_path)

    raise RuntimeError(f"Tier 3 MTProto failed to download media for file_id={file_id}")


async def download_telegram_media(
    bot: Any,
    chat_id: int,
    message_id: int,
    file_id: str,
    file_size: int = 0,
    dest_path: Optional[str] = None,
) -> str:
    """
    Downloads Telegram media safely directly to dest_path on disk using 3-tier hierarchy.

    Args:
        bot: Active python-telegram-bot instance.
        chat_id: Telegram chat identifier.
        message_id: Telegram message identifier where the media was sent.
        file_id: Telegram Bot API file_id string.
        file_size: Size in bytes if known from message metadata, or 0.
        dest_path: Optional target file path. If omitted, a temporary file path is generated.

    Returns:
        str: Absolute path to the downloaded media file on disk.

    Raises:
        ValueError: If file_id is missing.
        RuntimeError: If media cannot be downloaded via any available tier.
    """
    if not file_id:
        raise ValueError("file_id is required to download Telegram media")

    if not dest_path:
        dest_path = os.path.join(tempfile.gettempdir(), f"humsyar_media_{uuid.uuid4().hex[:8]}.bin")

    dest_path = os.path.abspath(dest_path)
    os.makedirs(os.path.dirname(dest_path), exist_ok=True)

    creds = get_telegram_credentials(bot=bot)

    # Tier 1: Local Telegram Bot API (if configured)
    if creds["local_api_url"]:
        tier1_result = await _download_tier1_local_api(
            local_url=creds["local_api_url"],
            token=creds["token"],
            file_id=file_id,
            dest_path=dest_path,
        )
        if tier1_result:
            return tier1_result

    # Tier 2: Cloud Bot API via PTB (if file_size <= 20MB and file_size > 0)
    max_ptb_bytes = 20 * 1024 * 1024
    if 0 < file_size <= max_ptb_bytes:
        tier2_result = await _download_tier2_ptb(bot=bot, file_id=file_id, dest_path=dest_path)
        if tier2_result:
            return tier2_result

    # Tier 3: MTProto via Kurigram (for file_size > 20MB, file_size == 0, or Tier 2 fallback)
    return await _download_tier3_mtproto(
        chat_id=chat_id,
        message_id=message_id,
        file_id=file_id,
        dest_path=dest_path,
        bot_token=creds["token"],
    )
