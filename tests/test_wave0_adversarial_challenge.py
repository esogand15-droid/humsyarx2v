# -*- coding: utf-8 -*-
"""Empirical Adversarial Stress Test Harness for Wave 0 Architecture.

Vectors challenged:
1. Concurrency & Contention (PyMuPDF rendering + Pillow dynamic watermarking CPU and RAM latency)
2. Web Auth & Challenge Security (Entropy, Brute-force space, Timing & Replay attacks, Stalled Bot)
3. Digital Ink & Annotation Sync (Payload size, BSON 16MB boundary, NaN/Inf coordinate edge cases)
4. Storage & Cache Eviction (WebP 150 DPI size, 5GB cache saturation calculations)
5. Database Consistency & Legacy Import Dependencies (Root imports vs backend/)
"""

import io
import math
import os
import sys
import time
from datetime import datetime, timezone
from PIL import Image, ImageDraw, ImageFont
import fitz  # PyMuPDF

def test_vector_1_watermark_and_render_stress():
    print("\n" + "=" * 60)
    print("VECTOR 1: Concurrency, Rendering & Dynamic Watermarking Stress")
    print("=" * 60)

    # 1. Create a synthetic realistic medical booklet PDF page (A4, 150 DPI)
    doc = fitz.open()
    page = doc.new_page(width=595, height=842) # A4 points
    # Insert medical text & shapes
    page.insert_text((50, 50), "HumsYarX Medical Study Platform - Anatomy & Neurophysiology", fontsize=14)
    page.insert_text((50, 80), "Chapter 4: The Autonomic Nervous System and Parasympathetic Outflow", fontsize=11)
    for i in range(30):
        page.insert_text((50, 110 + i * 20), f"Line {i+1}: Action potential conduction velocity in preganglionic B-fibers varies with myelination.", fontsize=9)
    # Add a vector diagram
    page.draw_rect(fitz.Rect(50, 720, 545, 800), color=(0.1, 0.2, 0.6), fill=(0.95, 0.95, 0.98))
    page.insert_text((60, 750), "Diagram: Postganglionic sympathetic innervation of thoracic viscera", fontsize=10)

    # Measure PyMuPDF rendering time to RGB pixmap + PIL WebP conversion
    t0 = time.perf_counter()
    zoom = 150.0 / 72.0  # 150 DPI
    mat = fitz.Matrix(zoom, zoom)
    pix = page.get_pixmap(matrix=mat, alpha=False)
    t_pix = time.perf_counter() - t0
    
    # PyMuPDF does not directly support webp in tobytes(); must use PIL
    t_webp0 = time.perf_counter()
    pil_base = Image.frombytes("RGB", [pix.width, pix.height], pix.samples)
    buf_webp = io.BytesIO()
    pil_base.save(buf_webp, format="WEBP", quality=80)
    raw_webp = buf_webp.getvalue()
    t_webp_enc = time.perf_counter() - t_webp0
    t_render = t_pix + t_webp_enc

    render_size_kb = len(raw_webp) / 1024.0
    print(f"1. PyMuPDF Pixmap: {t_pix*1000:.2f} ms | PIL WebP Encode: {t_webp_enc*1000:.2f} ms | Total Render: {t_render*1000:.2f} ms | Size: {render_size_kb:.1f} KB")

    # 2. Dynamic Watermark Stamping via Pillow
    t1 = time.perf_counter()
    base_img = Image.open(io.BytesIO(raw_webp)).convert("RGBA")
    txt_layer = Image.new("RGBA", base_img.size, (255, 255, 255, 0))
    draw = ImageDraw.Draw(txt_layer)
    watermark_text = "هامزیار | علی رضایی (123456789) | 5.234.12.89 | 2026-11-05 16:30"
    
    # Draw repeating diagonal text at 45 degrees
    # Simulate diagonal pattern across image dimensions
    W, H = base_img.size
    for y_step in range(0, H + W, 250):
        for x_step in range(-W, W, 350):
            # 14% opacity text
            draw.text((x_step + y_step * 0.3, y_step), watermark_text, fill=(20, 20, 20, 36))
    
    watermarked = Image.alpha_composite(base_img, txt_layer).convert("RGB")
    out_buf = io.BytesIO()
    watermarked.save(out_buf, format="WEBP", quality=80)
    final_webp = out_buf.getvalue()
    t_watermark = time.perf_counter() - t1

    final_size_kb = len(final_webp) / 1024.0
    print(f"2. Pillow Dynamic Watermark Stamp & Re-encode: {t_watermark*1000:.2f} ms | Size: {final_size_kb:.1f} KB")
    
    total_page_time = t_render + t_watermark
    print(f"3. Total Latency for Uncached Page Request: {total_page_time*1000:.2f} ms")
    print(f"4. Total Latency for Cached Base Page (Watermark only): {t_watermark*1000:.2f} ms")

    # Contention Math on 2 vCPU (Worker capped at 0.6 vCPU, FastAPI at 1.2 vCPU)
    print("\nContention Simulation:")
    # 5 students opening a 200-page booklet
    # If worker is concurrency=1:
    first_page_concurrency_1 = t_render * 5
    print(f"-> 5 concurrent requests for 5 different uncached pages: Worker queue delay for 5th user = {first_page_concurrency_1*1000:.1f} ms")
    
    # If 5 students scroll 20 pages each (100 uncached pages):
    total_queue_delay = t_render * 100
    print(f"-> 100 uncached page requests across 5 students: Total serial worker time = {total_queue_delay:.2f} seconds!")


def test_vector_2_web_auth_security():
    print("\n" + "=" * 60)
    print("VECTOR 2: Web Auth & Challenge Security Analysis")
    print("=" * 60)

    # 1. Alphabet and Entropy of 8-character code
    # Unambiguous alphabet: exclude 0, O, I, 1, L, 8/B (Crockford or Base32)
    # Crockford Base32 has 32 chars: 0123456789ABCDEFGHJKMNPQRSTVWXYZ (excluding I, L, O, U)
    # Or if strictly avoiding ambiguity: 30 characters
    charset_len = 32
    combinations = charset_len ** 8
    bits_entropy = math.log2(combinations)
    print(f"1. 8-character code (alphabet={charset_len}): {combinations:,} total combinations ({bits_entropy:.1f} bits entropy)")

    # Brute force probability
    rate_limit_per_ip = 5 # req per 10 min
    requests_per_day_single_ip = (5 * 6) * 24 # 720 requests/day
    p_single_user_single_ip_per_day = requests_per_day_single_ip / combinations
    print(f"2. Attacker targeting specific user from 1 IP: {p_single_user_single_ip_per_day:.2e} probability/day")

    # Multi-target / account enumeration (spraying against 10,000 active students)
    num_students = 10000
    botnet_ips = 500
    botnet_attempts_per_hour = botnet_ips * 30 # 15,000 req/hr
    p_hit_any_user_per_hour = 1 - (1 - (num_students / combinations)) ** botnet_attempts_per_hour
    print(f"3. Distributed spraying (500 IPs, 10,000 active students): {p_hit_any_user_per_hour*100:.4f}% probability per hour of hitting ANY valid code")

    print("4. CRITICAL VULNERABILITY: If Telegram Bot is stalled/down:")
    print("   - In PROJECT.md: Web login REQUIRES Telegram Bot push notification with Inline Keyboard.")
    print("   - If bot polling is disconnected (Iran national network filter, Telegram API block), the user NEVER receives callback query.")
    print("   - Fallback OTP mechanism: Missing from API_CONTRACTS.md and PROJECT.md!")


def test_vector_3_digital_ink_payload_and_bson():
    print("\n" + "=" * 60)
    print("VECTOR 3: Digital Ink & Annotation Sync Stress")
    print("=" * 60)

    # Test coordinate floats: NaN, Infinity, Negative
    invalid_coords = [float('nan'), float('inf'), float('-inf'), -100.0, 5000.0]
    print(f"1. Checking IEEE 754 float behavior in Python:")
    for c in invalid_coords:
        is_finite = math.isfinite(c)
        print(f"   Value: {c} | isfinite: {is_finite}")

    # Test document size limits: 400 strokes with points
    # Let's calculate size of 400 strokes * 500 points with {x, y, pressure, time}
    # Each point: 4 floats (~32 bytes in memory, ~50 bytes JSON/BSON)
    # 400 strokes * 500 points = 200,000 points
    # 200,000 * 50 bytes = 10,000,000 bytes (10 MB!)
    # If 400 strokes * 1,000 points = 400,000 points = 20 MB -> EXCEEDS 16MB MongoDB limit!
    print("2. MongoDB BSON Document 16MB Hard Boundary Check:")
    stroke_count = 400
    points_per_stroke = 800
    total_points = stroke_count * points_per_stroke
    est_bson_bytes = total_points * 45 + (stroke_count * 200)
    est_bson_mb = est_bson_bytes / (1024 * 1024)
    print(f"   {stroke_count} strokes * {points_per_stroke} points = {total_points:,} points")
    print(f"   Estimated BSON document size: {est_bson_mb:.2f} MB (MongoDB limit is 16.0 MB)")
    if est_bson_mb > 16.0:
        print("   [CRITICAL RISK]: Document exceeds MongoDB 16MB BSON limit! Will crash with DocumentTooLarge error!")
    else:
        print(f"   Safety headroom: {16.0 - est_bson_mb:.2f} MB")


def test_vector_4_storage_cache_saturation():
    print("\n" + "=" * 60)
    print("VECTOR 4: Storage & Cache Eviction Math")
    print("=" * 60)

    # 5 GB WebP Cache
    cache_limit_mb = 5 * 1024.0 # 5120 MB
    avg_page_webp_kb = 250.0 # 250 KB
    total_pages_capacity = (cache_limit_mb * 1024.0) / avg_page_webp_kb
    print(f"1. 5 GB WebP Cache Capacity: ~{int(total_pages_capacity):,} pages (at {avg_page_webp_kb} KB/page)")

    # 20 new pamphlets * 150 pages = 3000 pages
    new_pages = 20 * 150
    new_pages_mb = (new_pages * avg_page_webp_kb) / 1024.0
    print(f"2. 20 pamphlets * 150 pages = {new_pages:,} pages = {new_pages_mb:.1f} MB ({new_pages_mb/cache_limit_mb*100:.1f}% of entire cache)")

    # Existing library: 200 reference books/pamphlets * 200 pages = 40,000 pages
    full_library_pages = 200 * 200
    full_library_mb = (full_library_pages * avg_page_webp_kb) / 1024.0
    print(f"3. 200 reference books * 200 pages = {full_library_pages:,} pages = {full_library_mb:.1f} MB ({full_library_mb/1024.0:.2f} GB)")
    print(f"   Full library requires {full_library_mb/1024.0:.2f} GB WebP cache, but limit is 5 GB ({cache_limit_mb/full_library_mb*100:.1f}% coverage)")
    print("   [FINDING]: Cache eviction is GUARANTEED to trigger continuously under normal student browsing. LRU mechanism MUST be rigorously defined.")


def test_vector_5_legacy_imports_and_jobqueue():
    print("\n" + "=" * 60)
    print("VECTOR 5: Database Consistency & Legacy Import Dependencies")
    print("=" * 60)

    # Check bot.py imports and job queue definitions
    bot_path = "D:\\humsyarx project\\humsyarx-main\\bot.py"
    if os.path.exists(bot_path):
        with open(bot_path, "r", encoding="utf-8", errors="ignore") as f:
            bot_src = f.read()
        
        # Check for root module imports
        suspect_imports = ["from database import", "import database", "from backup import", "import backup", 
                           "from admin import", "from message_router import", "from start import",
                           "from subscription import", "from questions import"]
        found_imports = [imp for imp in suspect_imports if imp in bot_src]
        print(f"1. Root module imports detected in bot.py: {len(found_imports)} found:")
        for imp in found_imports:
            print(f"   - {imp}")

        # Check job queue registration
        job_lines = [line.strip() for line in bot_src.splitlines() if "job_queue.run_" in line]
        print(f"2. JobQueue registrations in bot.py: {len(job_lines)} jobs scheduled:")
        for jl in job_lines[:6]:
            print(f"   - {jl[:80]}")
    else:
        print(f"bot.py not found at {bot_path}")


if __name__ == "__main__":
    test_vector_1_watermark_and_render_stress()
    test_vector_2_web_auth_security()
    test_vector_3_digital_ink_payload_and_bson()
    test_vector_4_storage_cache_saturation()
    test_vector_5_legacy_imports_and_jobqueue()
