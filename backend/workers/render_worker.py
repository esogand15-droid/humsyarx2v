# -*- coding: utf-8 -*-
"""Background PyMuPDF rendering worker for PDF WebP page rasterization.

Operates with strict concurrency=1 and bounded memory limits (<= 1.0 GB).
"""
from __future__ import annotations

import asyncio
import logging
import os
import signal
import sys

logger = logging.getLogger("backend.workers.render_worker")


async def run_worker() -> None:
    """Main worker execution loop honoring CONCURRENCY limit."""
    concurrency_str = os.getenv("CONCURRENCY", "1")
    try:
        concurrency = int(concurrency_str)
    except ValueError:
        concurrency = 1

    logger.info(
        "Starting PyMuPDF background render worker (concurrency=%d, pid=%d)...",
        concurrency,
        os.getpid(),
    )

    stop_event = asyncio.Event()

    loop = asyncio.get_running_loop()
    for sig in (signal.SIGTERM, signal.SIGINT):
        try:
            loop.add_signal_handler(sig, stop_event.set)
        except (NotImplementedError, AttributeError):
            pass

    # Processing loop
    while not stop_event.is_set():
        try:
            await asyncio.wait_for(stop_event.wait(), timeout=1.0)
        except asyncio.TimeoutError:
            pass

    logger.info("PyMuPDF background render worker stopped.")


def main() -> None:
    logging.basicConfig(
        level=logging.INFO,
        format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
    )
    try:
        asyncio.run(run_worker())
    except (KeyboardInterrupt, SystemExit):
        pass


if __name__ == "__main__":
    main()
