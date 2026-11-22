#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
🔀 port_forward.py — فورواردر سبک TCP برای پشتیبانی همزمان از پورت‌های 8000 و 3000
حل قطعی مشکل Health Check و Readiness Probe در پلتفرم‌های PaaS مانند Cloady.
اگر سرور اصلی روی 8000 گوش می‌دهد، پورت 3000 را به 8000 متصل می‌کند و بالعکس.
"""
import asyncio
import os
import sys

async def _pipe(reader: asyncio.StreamReader, writer: asyncio.StreamWriter):
    try:
        while not reader.at_eof():
            data = await reader.read(65536)
            if not data:
                break
            writer.write(data)
            await writer.drain()
    except Exception:
        pass
    finally:
        try:
            writer.close()
            await writer.wait_closed()
        except Exception:
            pass

async def _handle_connection(client_reader: asyncio.StreamReader, client_writer: asyncio.StreamWriter, target_port: int):
    try:
        target_reader, target_writer = await asyncio.open_connection('127.0.0.1', target_port)
    except Exception:
        try:
            client_writer.close()
            await client_writer.wait_closed()
        except Exception:
            pass
        return

    asyncio.create_task(_pipe(client_reader, target_writer))
    asyncio.create_task(_pipe(target_reader, client_writer))

async def main():
    try:
        port_env = int(os.getenv("PORT", "8000"))
    except ValueError:
        port_env = 8000

    # پورت مکمل برای فوروارد
    alt_port = 3000 if port_env != 3000 else 8000
    print(f"[port_forward] Starting TCP bridge on 0.0.0.0:{alt_port} -> 127.0.0.1:{port_env}", flush=True)

    try:
        server = await asyncio.start_server(
            lambda r, w: _handle_connection(r, w, port_env),
            '0.0.0.0', alt_port, reuse_address=True
        )
        async with server:
            await server.serve_forever()
    except Exception as e:
        print(f"[port_forward] Warning: Could not bind port {alt_port} ({e})", flush=True)

if __name__ == "__main__":
    asyncio.run(main())
