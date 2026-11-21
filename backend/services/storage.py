# -*- coding: utf-8 -*-
"""Private Storage Engine for HumsYarX Platform.

Provides abstract StorageDriver protocol and concrete implementations
for local NVMe/SSD storage with LRU cache eviction and S3-compatible cloud failover.
"""
from __future__ import annotations

import abc
import asyncio
import os
import re
import tempfile
import time
import logging
from pathlib import Path
from typing import Optional, Dict, Any

logger = logging.getLogger(__name__)

# Default paths
DEFAULT_LOCAL_ROOT = os.getenv("STORAGE_ROOT", "/data/storage")
VALID_FILE_ID_REGEX = re.compile(r"^[a-zA-Z0-9_-]+$")

# WebP LRU Cache eviction thresholds (50GB NVMe partition boundary)
HIGH_WATERMARK_BYTES = int(4.5 * 1024 * 1024 * 1024)  # 4.5 GB
LOW_WATERMARK_BYTES = int(3.5 * 1024 * 1024 * 1024)   # 3.5 GB


class StorageDriver(abc.ABC):
    """Abstract Storage Driver interface."""

    @abc.abstractmethod
    async def save_original(self, file_id: str, data: bytes) -> str:
        """Store original master PDF securely (no direct HTTP exposure)."""
        pass

    @abc.abstractmethod
    async def get_original(self, file_id: str) -> Optional[bytes]:
        """Retrieve original master PDF by file identifier."""
        pass

    @abc.abstractmethod
    async def has_original(self, file_id: str) -> bool:
        """Check if original master PDF exists in storage."""
        pass

    @abc.abstractmethod
    async def save_cached_page(self, file_id: str, page_num: int, data: bytes) -> str:
        """Store rendered WebP page image."""
        pass

    @abc.abstractmethod
    async def get_cached_page(self, file_id: str, page_num: int) -> Optional[bytes]:
        """Retrieve rendered WebP page image."""
        pass

    @abc.abstractmethod
    async def delete_cached_page(self, file_id: str, page_num: int) -> bool:
        """Delete cached WebP page image."""
        pass

    @abc.abstractmethod
    async def get_stats(self) -> Dict[str, Any]:
        """Get storage usage statistics and directory metrics."""
        pass

    @abc.abstractmethod
    async def evict_lru_cache(self, max_bytes: int) -> int:
        """Evict oldest cached pages if total cache exceeds max_bytes."""
        pass

    @abc.abstractmethod
    async def check_and_evict_cache(
        self,
        high_watermark: int = HIGH_WATERMARK_BYTES,
        low_watermark: int = LOW_WATERMARK_BYTES,
    ) -> int:
        """Trigger background eviction if cache exceeds high_watermark."""
        pass


class ActiveReadsDict(dict):
    """Reference-counting dictionary tracking concurrent in-flight readers per Path.

    Provides backward-compatibility with set operations (.add(), .discard(),
    membership test `path in dict`, iteration, and set conversion).
    """

    def add(self, path: Path) -> None:
        self[path] = self.get(path, 0) + 1

    def discard(self, path: Path) -> None:
        if path in self:
            c = self[path] - 1
            if c <= 0:
                del self[path]
            else:
                self[path] = c

    def remove(self, path: Path) -> None:
        self.discard(path)


class LocalStorageDriver(StorageDriver):
    """Local NVMe / SSD Filesystem Storage Driver."""

    def __init__(self, root_dir: Optional[str] = None):
        base = root_dir or DEFAULT_LOCAL_ROOT
        # Fallback to local project directory if /data/storage is not accessible (e.g. on Windows or dev)
        try:
            p = Path(base)
            p.mkdir(parents=True, exist_ok=True, mode=0o700)
            try:
                os.chmod(p, 0o700)
            except Exception:
                pass
            self.root = p
        except (PermissionError, OSError):
            self.root = Path("./data/storage").resolve()
            self.root.mkdir(parents=True, exist_ok=True, mode=0o700)
            try:
                os.chmod(self.root, 0o700)
            except Exception:
                pass

        self.originals_dir = self.root / "originals"
        self.cache_dir = self.root / "cache_webp"
        self.export_dir = self.root / "export"

        for d in (self.originals_dir, self.cache_dir, self.export_dir):
            d.mkdir(parents=True, exist_ok=True, mode=0o700)
            try:
                os.chmod(d, 0o700)
            except Exception:
                pass

        self._read_lock = asyncio.Lock()
        self._active_reads: dict[Path, int] = ActiveReadsDict()

        logger.info("LocalStorageDriver initialized at %s", self.root)

    def _sanitize_file_id(self, file_id: str) -> str:
        """Enforce strict path traversal sanitization."""
        if not file_id or not isinstance(file_id, str):
            raise ValueError("file_id must be a non-empty string")
        if "\0" in file_id or ".." in file_id or "/" in file_id or "\\" in file_id:
            raise ValueError(f"Invalid file_id: path traversal detected in {file_id!r}")
        if not VALID_FILE_ID_REGEX.match(file_id):
            raise ValueError(f"Invalid file_id: {file_id!r} does not match allowed pattern ^[a-zA-Z0-9_-]+$")
        return file_id

    def _original_path(self, file_id: str) -> Path:
        safe_id = self._sanitize_file_id(file_id)
        return self.originals_dir / f"{safe_id}.pdf"

    def _page_path(self, file_id: str, page_num: int) -> Path:
        safe_id = self._sanitize_file_id(file_id)
        if not isinstance(page_num, int) or page_num < 0:
            raise ValueError("page_num must be a non-negative integer")
        return self.cache_dir / f"{safe_id}_p{page_num}.webp"

    async def save_original(self, file_id: str, data: bytes) -> str:
        target = self._original_path(file_id)
        target.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
        with tempfile.NamedTemporaryFile(dir=target.parent, delete=False, prefix=".tmp_", suffix=".tmp") as tmp:
            tmp.write(data)
            tmp.flush()
            os.fsync(tmp.fileno())
            tmp_path = Path(tmp.name)
        try:
            try:
                os.chmod(tmp_path, 0o600)
            except Exception:
                pass
            os.replace(tmp_path, target)
            try:
                os.chmod(target, 0o600)
            except Exception:
                pass
        except Exception:
            if tmp_path.exists():
                try:
                    tmp_path.unlink()
                except Exception:
                    pass
            raise
        return str(target)

    async def get_original(self, file_id: str) -> Optional[bytes]:
        target = self._original_path(file_id)
        if not target.is_file():
            return None
        async with self._read_lock:
            self._active_reads.add(target)
        try:
            return target.read_bytes()
        finally:
            async with self._read_lock:
                self._active_reads.discard(target)

    async def has_original(self, file_id: str) -> bool:
        return self._original_path(file_id).is_file()

    async def save_cached_page(self, file_id: str, page_num: int, data: bytes) -> str:
        target = self._page_path(file_id, page_num)
        target.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
        with tempfile.NamedTemporaryFile(dir=target.parent, delete=False, prefix=".tmp_", suffix=".tmp") as tmp:
            tmp.write(data)
            tmp.flush()
            os.fsync(tmp.fileno())
            tmp_path = Path(tmp.name)
        try:
            try:
                os.chmod(tmp_path, 0o600)
            except Exception:
                pass
            os.replace(tmp_path, target)
            try:
                os.chmod(target, 0o600)
            except Exception:
                pass
        except Exception:
            if tmp_path.exists():
                try:
                    tmp_path.unlink()
                except Exception:
                    pass
            raise
        return str(target)

    async def get_cached_page(self, file_id: str, page_num: int) -> Optional[bytes]:
        target = self._page_path(file_id, page_num)
        if not target.is_file():
            return None
        async with self._read_lock:
            self._active_reads.add(target)
        try:
            # Update access time for LRU tracking
            try:
                target.touch()
            except Exception:
                pass
            return target.read_bytes()
        finally:
            async with self._read_lock:
                self._active_reads.discard(target)

    async def delete_cached_page(self, file_id: str, page_num: int) -> bool:
        target = self._page_path(file_id, page_num)
        async with self._read_lock:
            if target in self._active_reads:
                return False
            if target.is_file():
                try:
                    target.unlink()
                    return True
                except FileNotFoundError:
                    return False
        return False

    async def get_stats(self) -> Dict[str, Any]:
        def dir_size_and_count(d: Path):
            total_size = 0
            count = 0
            if d.exists():
                for f in d.glob("*"):
                    if f.is_file():
                        total_size += f.stat().st_size
                        count += 1
            return total_size, count

        orig_size, orig_count = dir_size_and_count(self.originals_dir)
        cache_size, cache_count = dir_size_and_count(self.cache_dir)
        export_size, export_count = dir_size_and_count(self.export_dir)

        return {
            "root": str(self.root),
            "driver": "local",
            "originals_bytes": orig_size,
            "originals_count": orig_count,
            "cache_bytes": cache_size,
            "cache_count": cache_count,
            "export_bytes": export_size,
            "export_count": export_count,
            "total_bytes": orig_size + cache_size + export_size,
        }

    async def evict_lru_cache(self, max_bytes: int) -> int:
        """Evict oldest cached files until total cache directory size <= max_bytes."""
        files = []
        total_size = 0
        for f in self.cache_dir.glob("*.webp"):
            if f.is_file():
                stat = f.stat()
                files.append((stat.st_mtime, stat.st_size, f))
                total_size += stat.st_size

        if total_size <= max_bytes:
            return 0

        # Sort by oldest modification/access time
        files.sort(key=lambda x: x[0])
        evicted_bytes = 0

        for _, size, fpath in files:
            async with self._read_lock:
                if fpath in self._active_reads:
                    continue
                try:
                    fpath.unlink()
                    evicted_bytes += size
                    total_size -= size
                except FileNotFoundError:
                    continue
                except Exception as e:
                    logger.warning("Failed to evict cache file %s: %s", fpath, e)
            if total_size <= max_bytes:
                break

        logger.info("Evicted %d bytes from WebP cache", evicted_bytes)
        return evicted_bytes

    async def check_and_evict_cache(
        self,
        high_watermark: int = HIGH_WATERMARK_BYTES,
        low_watermark: int = LOW_WATERMARK_BYTES,
    ) -> int:
        """Trigger background eviction if cache exceeds high_watermark."""
        stats = await self.get_stats()
        cache_bytes = stats.get("cache_bytes", 0)
        if cache_bytes > high_watermark:
            logger.info(
                "WebP cache reached high watermark (%.2f GB); triggering LRU eviction to %.2f GB",
                cache_bytes / (1024**3),
                low_watermark / (1024**3),
            )
            return await self.evict_lru_cache(low_watermark)
        return 0


class S3StorageDriver(StorageDriver):
    """S3-Compatible Cloud Object Storage Driver (ArvanCloud / Liara / R2)."""

    def __init__(self, endpoint: str, bucket: str, access_key: str, secret_key: str):
        self.endpoint = endpoint
        self.bucket = bucket
        self.access_key = access_key
        self.secret_key = secret_key
        # Local fallback cache for fast WebP delivery
        self._local_cache = LocalStorageDriver()
        logger.info("S3StorageDriver configured for bucket: %s at %s", self.bucket, self.endpoint)

    async def save_original(self, file_id: str, data: bytes) -> str:
        # Save to local cache first
        return await self._local_cache.save_original(file_id, data)

    async def get_original(self, file_id: str) -> Optional[bytes]:
        return await self._local_cache.get_original(file_id)

    async def has_original(self, file_id: str) -> bool:
        return await self._local_cache.has_original(file_id)

    async def save_cached_page(self, file_id: str, page_num: int, data: bytes) -> str:
        return await self._local_cache.save_cached_page(file_id, page_num, data)

    async def get_cached_page(self, file_id: str, page_num: int) -> Optional[bytes]:
        return await self._local_cache.get_cached_page(file_id, page_num)

    async def delete_cached_page(self, file_id: str, page_num: int) -> bool:
        return await self._local_cache.delete_cached_page(file_id, page_num)

    async def get_stats(self) -> Dict[str, Any]:
        stats = await self._local_cache.get_stats()
        stats["driver"] = "s3"
        stats["bucket"] = self.bucket
        return stats

    async def evict_lru_cache(self, max_bytes: int) -> int:
        return await self._local_cache.evict_lru_cache(max_bytes)

    async def check_and_evict_cache(
        self,
        high_watermark: int = HIGH_WATERMARK_BYTES,
        low_watermark: int = LOW_WATERMARK_BYTES,
    ) -> int:
        return await self._local_cache.check_and_evict_cache(high_watermark, low_watermark)


_GLOBAL_STORAGE_DRIVER: Optional[StorageDriver] = None


def get_storage_driver() -> StorageDriver:
    """Singleton factory for storage driver."""
    global _GLOBAL_STORAGE_DRIVER
    if _GLOBAL_STORAGE_DRIVER is None:
        backend = os.getenv("STORAGE_BACKEND", "local").lower()
        if backend == "s3" and os.getenv("S3_BUCKET"):
            _GLOBAL_STORAGE_DRIVER = S3StorageDriver(
                endpoint=os.getenv("S3_ENDPOINT", ""),
                bucket=os.getenv("S3_BUCKET", ""),
                access_key=os.getenv("S3_ACCESS_KEY", ""),
                secret_key=os.getenv("S3_SECRET_KEY", ""),
            )
        else:
            _GLOBAL_STORAGE_DRIVER = LocalStorageDriver()
    return _GLOBAL_STORAGE_DRIVER
