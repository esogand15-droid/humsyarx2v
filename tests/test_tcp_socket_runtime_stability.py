# -*- coding: utf-8 -*-
"""Empirical Socket & Runtime Stability Challenger Test Harness.

Role: challenger_dev_2
Milestone: M-DevServers
Objective: Empirically stress-test TCP socket listeners on ports 5173 (Vite)
           and 8000 (FastAPI), verify listener resilience under rapid connection
           cycling, abrupt RSTs, concurrency bursts, verify HTTP 200 responses
           pre- and post-stress, and audit log files for exceptions/tracebacks.
"""

import concurrent.futures
import json
import os
import re
import socket
import struct
import subprocess
import sys
import time
import urllib.error
import urllib.request
from typing import Any, Dict, List, Tuple


VITE_HOST = "127.0.0.1"
VITE_PORT = 5173
FASTAPI_HOST = "127.0.0.1"
FASTAPI_PORT = 8000

VITE_URL = f"http://{VITE_HOST}:{VITE_PORT}/student/"
FASTAPI_URL = f"http://{FASTAPI_HOST}:{FASTAPI_PORT}/api/health"

FASTAPI_LOG_PATH = r"d:\humsyarx project\logs\fastapi.log"
VITE_LOG_PATH = r"d:\humsyarx project\logs\vite-student.log"


def compute_stats(latencies_ms: List[float]) -> Dict[str, float]:
    if not latencies_ms:
        return {"count": 0, "min": 0.0, "mean": 0.0, "p50": 0.0, "p95": 0.0, "max": 0.0}
    s = sorted(latencies_ms)
    n = len(s)
    return {
        "count": n,
        "min": round(s[0], 2),
        "mean": round(sum(s) / n, 2),
        "p50": round(s[int(n * 0.50)], 2),
        "p95": round(s[min(int(n * 0.95), n - 1)], 2),
        "max": round(s[-1], 2),
    }


def http_get(url: str, timeout: float = 5.0, headers: Dict[str, str] = None) -> Tuple[int, bytes, float]:
    start = time.perf_counter()
    hdr = {"User-Agent": "Challenger2-Stability/1.0"}
    if headers:
        hdr.update(headers)
    req = urllib.request.Request(url, headers=hdr)
    status = 0
    body = b""
    try:
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            body = resp.read()
            status = resp.status
    except urllib.error.HTTPError as ex:
        status = ex.code
        body = ex.read()
    except Exception as ex:
        status = 0
        body = str(ex).encode("utf-8")
    elapsed_ms = (time.perf_counter() - start) * 1000.0
    return status, body, elapsed_ms


def check_port_listening(host: str, port: int) -> Tuple[bool, str]:
    # 1. Empirical raw socket probe
    s = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    s.settimeout(2.0)
    try:
        s.connect((host, port))
        can_connect = True
    except Exception as ex:
        can_connect = False
        return False, f"Connection failed: {ex}"
    finally:
        s.close()

    # 2. PowerShell Get-NetTCPConnection probe for listener socket (RemoteAddress 0.0.0.0:0)
    try:
        ps_cmd = (
            f'powershell -NoProfile -ExecutionPolicy Bypass -Command '
            f'"(Get-NetTCPConnection -LocalAddress {host} -LocalPort {port} -RemoteAddress 0.0.0.0 -RemotePort 0 -ErrorAction SilentlyContinue).OwningProcess"'
        )
        res = subprocess.run(ps_cmd, shell=True, capture_output=True, text=True)
        pid_str = res.stdout.strip()
        if pid_str and pid_str.isdigit():
            return True, f"Listening on {host}:{port} (OwningProcess PID {pid_str})"
    except Exception:
        pass

    return can_connect, f"Connected to {host}:{port}"


def test_rapid_connect_close(host: str, port: int, iterations: int = 100) -> Dict[str, Any]:
    latencies = []
    successes = 0
    failures = 0
    errors = []

    for _ in range(iterations):
        t0 = time.perf_counter()
        s = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
        s.settimeout(2.0)
        try:
            s.connect((host, port))
            latencies.append((time.perf_counter() - t0) * 1000.0)
            successes += 1
        except Exception as ex:
            failures += 1
            errors.append(str(ex))
        finally:
            s.close()
            time.sleep(0.003)

    return {
        "iterations": iterations,
        "successes": successes,
        "failures": failures,
        "stats_ms": compute_stats(latencies),
        "errors": errors[:5],
    }


def test_abrupt_rst(host: str, port: int, iterations: int = 50) -> Dict[str, Any]:
    latencies = []
    successes = 0
    failures = 0
    errors = []

    for _ in range(iterations):
        t0 = time.perf_counter()
        s = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
        s.settimeout(2.0)
        # Configure SO_LINGER with timeout 0 -> generates immediate TCP RST upon close
        s.setsockopt(socket.SOL_SOCKET, socket.SO_LINGER, struct.pack('ii', 1, 0))
        try:
            s.connect((host, port))
            latencies.append((time.perf_counter() - t0) * 1000.0)
            successes += 1
        except Exception as ex:
            failures += 1
            errors.append(str(ex))
        finally:
            s.close()
            time.sleep(0.005)

    return {
        "iterations": iterations,
        "successes": successes,
        "failures": failures,
        "stats_ms": compute_stats(latencies),
        "errors": errors[:5],
    }


def test_concurrent_socket_burst(host: str, port: int, total_connections: int = 100, workers: int = 20) -> Dict[str, Any]:
    latencies = []
    failures = 0
    errors = []

    def single_connect(_):
        t0 = time.perf_counter()
        s = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
        s.settimeout(3.0)
        try:
            s.connect((host, port))
            elapsed = (time.perf_counter() - t0) * 1000.0
            time.sleep(0.005)
            return True, elapsed, None
        except Exception as ex:
            return False, 0.0, str(ex)
        finally:
            s.close()

    t_burst_start = time.perf_counter()
    with concurrent.futures.ThreadPoolExecutor(max_workers=workers) as executor:
        results = list(executor.map(single_connect, range(total_connections)))
    total_time_ms = (time.perf_counter() - t_burst_start) * 1000.0

    successes = 0
    for ok, el, err in results:
        if ok:
            successes += 1
            latencies.append(el)
        else:
            failures += 1
            if err:
                errors.append(err)

    return {
        "total_connections": total_connections,
        "workers": workers,
        "successes": successes,
        "failures": failures,
        "total_time_ms": round(total_time_ms, 2),
        "stats_ms": compute_stats(latencies),
        "errors": errors[:5],
    }


def test_partial_payload_abort(host: str, port: int, iterations: int = 25) -> Dict[str, Any]:
    latencies = []
    successes = 0
    failures = 0
    errors = []

    for _ in range(iterations):
        t0 = time.perf_counter()
        s = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
        s.settimeout(2.0)
        try:
            s.connect((host, port))
            # Send fragmented / incomplete HTTP request header
            s.sendall(b"GET /stu")
            time.sleep(0.005)
            latencies.append((time.perf_counter() - t0) * 1000.0)
            successes += 1
        except Exception as ex:
            failures += 1
            errors.append(str(ex))
        finally:
            try:
                s.setsockopt(socket.SOL_SOCKET, socket.SO_LINGER, struct.pack('ii', 1, 0))
                s.close()
            except Exception:
                pass
            time.sleep(0.005)

    return {
        "iterations": iterations,
        "successes": successes,
        "failures": failures,
        "stats_ms": compute_stats(latencies),
        "errors": errors[:5],
    }


def read_log_file(path: str) -> str:
    if not os.path.exists(path):
        return f"<Log file not found: {path}>"
    for enc in ("utf-16le", "utf-8", "latin-1"):
        try:
            with open(path, "r", encoding=enc, errors="ignore") as f:
                return f.read()
        except Exception:
            pass
    return ""


def audit_logs_for_errors(content: str, name: str) -> Dict[str, Any]:
    lines = content.splitlines()
    traceback_lines = []
    exception_lines = []
    fatal_lines = []

    in_traceback = False
    for line in lines:
        if "Traceback (most recent call last):" in line:
            in_traceback = True
            traceback_lines.append(line)
            continue
        if in_traceback:
            traceback_lines.append(line)
            if re.match(r"^[A-Za-z0-9_]+Error:", line) or re.match(r"^[A-Za-z0-9_]+Exception:", line):
                in_traceback = False
            continue

        if re.search(r"\b(FATAL|CRITICAL|PANIC|MemoryError|Segmentation fault)\b", line, re.I):
            fatal_lines.append(line)
        elif re.search(r"\b(Unhandled exception|UnhandledPromiseRejection)\b", line, re.I):
            exception_lines.append(line)

    return {
        "log_name": name,
        "total_lines": len(lines),
        "has_tracebacks": len(traceback_lines) > 0,
        "traceback_snippets": traceback_lines[:10],
        "fatal_count": len(fatal_lines),
        "fatal_snippets": fatal_lines[:5],
        "unhandled_exceptions_count": len(exception_lines),
        "unhandled_snippets": exception_lines[:5],
    }


def run_full_stability_challenge() -> Dict[str, Any]:
    report = {
        "timestamp": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        "harness": "Socket & Runtime Stability Empirical Challenger",
        "verdict": "PENDING",
        "pre_stress_checks": {},
        "stress_results": {},
        "post_stress_checks": {},
        "log_integrity": {},
    }

    print("================================================================================")
    print("STARTING EMPIRICAL SOCKET & RUNTIME STABILITY CHALLENGE")
    print("================================================================================")

    # 1. Pre-stress baseline
    print("\n[PHASE 1] Pre-Stress Baseline Verification...")
    pre_vite_listen, pre_vite_desc = check_port_listening(VITE_HOST, VITE_PORT)
    pre_fastapi_listen, pre_fastapi_desc = check_port_listening(FASTAPI_HOST, FASTAPI_PORT)
    print(f" - Port {VITE_PORT} (Vite) Listener: {pre_vite_listen} ({pre_vite_desc})")
    print(f" - Port {FASTAPI_PORT} (FastAPI) Listener: {pre_fastapi_listen} ({pre_fastapi_desc})")

    pre_vite_status, pre_vite_body, pre_vite_ms = http_get(VITE_URL)
    pre_fastapi_status, pre_fastapi_body, pre_fastapi_ms = http_get(FASTAPI_URL, headers={"X-Forwarded-For": "127.0.0.10"})
    print(f" - GET {VITE_URL} -> HTTP {pre_vite_status} ({len(pre_vite_body)} bytes, {pre_vite_ms:.1f}ms)")
    print(f" - GET {FASTAPI_URL} -> HTTP {pre_fastapi_status} ({len(pre_fastapi_body)} bytes, {pre_fastapi_ms:.1f}ms)")

    # Read pre-stress logs
    pre_fastapi_log = read_log_file(FASTAPI_LOG_PATH)
    pre_vite_log = read_log_file(VITE_LOG_PATH)

    report["pre_stress_checks"] = {
        "vite_listening": pre_vite_listen,
        "vite_desc": pre_vite_desc,
        "fastapi_listening": pre_fastapi_listen,
        "fastapi_desc": pre_fastapi_desc,
        "vite_http_status": pre_vite_status,
        "vite_http_bytes": len(pre_vite_body),
        "vite_latency_ms": round(pre_vite_ms, 2),
        "fastapi_http_status": pre_fastapi_status,
        "fastapi_http_bytes": len(pre_fastapi_body),
        "fastapi_latency_ms": round(pre_fastapi_ms, 2),
        "fastapi_log_initial_lines": len(pre_fastapi_log.splitlines()),
        "vite_log_initial_lines": len(pre_vite_log.splitlines()),
    }

    # 2. Stress Phase: Rapid Connect & Close
    print("\n[PHASE 2] Rapid Connect & Immediate Close (100 cycles per port)...")
    vite_rapid = test_rapid_connect_close(VITE_HOST, VITE_PORT, iterations=100)
    print(f" - Vite (Port {VITE_PORT}): {vite_rapid['successes']}/100 ok, "
          f"mean={vite_rapid['stats_ms']['mean']}ms, max={vite_rapid['stats_ms']['max']}ms")
    fastapi_rapid = test_rapid_connect_close(FASTAPI_HOST, FASTAPI_PORT, iterations=100)
    print(f" - FastAPI (Port {FASTAPI_PORT}): {fastapi_rapid['successes']}/100 ok, "
          f"mean={fastapi_rapid['stats_ms']['mean']}ms, max={fastapi_rapid['stats_ms']['max']}ms")

    # 3. Stress Phase: Abrupt RST Injection
    print("\n[PHASE 3] Abrupt TCP RST Injection via SO_LINGER=0 (50 cycles per port)...")
    vite_rst = test_abrupt_rst(VITE_HOST, VITE_PORT, iterations=50)
    print(f" - Vite (Port {VITE_PORT}): {vite_rst['successes']}/50 ok, "
          f"mean={vite_rst['stats_ms']['mean']}ms, max={vite_rst['stats_ms']['max']}ms")
    fastapi_rst = test_abrupt_rst(FASTAPI_HOST, FASTAPI_PORT, iterations=50)
    print(f" - FastAPI (Port {FASTAPI_PORT}): {fastapi_rst['successes']}/50 ok, "
          f"mean={fastapi_rst['stats_ms']['mean']}ms, max={fastapi_rst['stats_ms']['max']}ms")

    # 4. Stress Phase: Concurrent Connection Flood
    print("\n[PHASE 4] Concurrent Socket Flood (100 connects across 20 threads)...")
    vite_burst = test_concurrent_socket_burst(VITE_HOST, VITE_PORT, total_connections=100, workers=20)
    print(f" - Vite (Port {VITE_PORT}): {vite_burst['successes']}/100 ok, "
          f"total time={vite_burst['total_time_ms']}ms, p95={vite_burst['stats_ms']['p95']}ms")
    fastapi_burst = test_concurrent_socket_burst(FASTAPI_HOST, FASTAPI_PORT, total_connections=100, workers=20)
    print(f" - FastAPI (Port {FASTAPI_PORT}): {fastapi_burst['successes']}/100 ok, "
          f"total time={fastapi_burst['total_time_ms']}ms, p95={fastapi_burst['stats_ms']['p95']}ms")

    # 5. Stress Phase: Incomplete / Partial Payload Abort
    print("\n[PHASE 5] Partial Payload & Abrupt Reset (25 cycles per port)...")
    vite_partial = test_partial_payload_abort(VITE_HOST, VITE_PORT, iterations=25)
    print(f" - Vite (Port {VITE_PORT}): {vite_partial['successes']}/25 ok")
    fastapi_partial = test_partial_payload_abort(FASTAPI_HOST, FASTAPI_PORT, iterations=25)
    print(f" - FastAPI (Port {FASTAPI_PORT}): {fastapi_partial['successes']}/25 ok")

    report["stress_results"] = {
        "vite": {
            "rapid_connect_close": vite_rapid,
            "abrupt_rst": vite_rst,
            "concurrent_burst": vite_burst,
            "partial_abort": vite_partial,
        },
        "fastapi": {
            "rapid_connect_close": fastapi_rapid,
            "abrupt_rst": fastapi_rst,
            "concurrent_burst": fastapi_burst,
            "partial_abort": fastapi_partial,
        },
    }

    # Yield briefly for socket recycling
    time.sleep(1.0)

    # 6. Post-stress listener checks
    print("\n[PHASE 6] Post-Stress Listener & Port State Verification...")
    post_vite_listen, post_vite_desc = check_port_listening(VITE_HOST, VITE_PORT)
    post_fastapi_listen, post_fastapi_desc = check_port_listening(FASTAPI_HOST, FASTAPI_PORT)
    print(f" - Port {VITE_PORT} (Vite) Listener: {post_vite_listen} ({post_vite_desc})")
    print(f" - Port {FASTAPI_PORT} (FastAPI) Listener: {post_fastapi_listen} ({post_fastapi_desc})")

    # 7. Post-stress HTTP resilience (10 consecutive requests each)
    print("\n[PHASE 7] Post-Stress HTTP 200 Verification (10 samples each)...")
    post_vite_statuses = []
    post_vite_latencies = []
    for _ in range(10):
        st, _, el = http_get(VITE_URL)
        post_vite_statuses.append(st)
        post_vite_latencies.append(el)
        time.sleep(0.05)

    post_fastapi_statuses = []
    post_fastapi_latencies = []
    for i in range(10):
        # Rotate X-Forwarded-For IP to avoid hitting per-IP rate limit window
        st, b, el = http_get(FASTAPI_URL, headers={"X-Forwarded-For": f"127.0.0.{20 + i}"})
        post_fastapi_statuses.append(st)
        post_fastapi_latencies.append(el)
        time.sleep(0.05)

    print(f" - Vite HTTP Statuses: {set(post_vite_statuses)}, "
          f"mean latency={compute_stats(post_vite_latencies)['mean']}ms")
    print(f" - FastAPI HTTP Statuses: {set(post_fastapi_statuses)}, "
          f"mean latency={compute_stats(post_fastapi_latencies)['mean']}ms")

    report["post_stress_checks"] = {
        "vite_listening": post_vite_listen,
        "vite_desc": post_vite_desc,
        "fastapi_listening": post_fastapi_listen,
        "fastapi_desc": post_fastapi_desc,
        "vite_statuses": post_vite_statuses,
        "vite_stats_ms": compute_stats(post_vite_latencies),
        "fastapi_statuses": post_fastapi_statuses,
        "fastapi_stats_ms": compute_stats(post_fastapi_latencies),
    }

    # 8. Log Integrity Audit
    print("\n[PHASE 8] Log Integrity & Exception Audit...")
    post_fastapi_log = read_log_file(FASTAPI_LOG_PATH)
    post_vite_log = read_log_file(VITE_LOG_PATH)

    fastapi_audit = audit_logs_for_errors(post_fastapi_log, "fastapi.log")
    vite_audit = audit_logs_for_errors(post_vite_log, "vite-student.log")

    print(f" - fastapi.log: {fastapi_audit['total_lines']} lines, "
          f"tracebacks={fastapi_audit['has_tracebacks']}, "
          f"fatal={fastapi_audit['fatal_count']}, "
          f"unhandled={fastapi_audit['unhandled_exceptions_count']}")
    print(f" - vite-student.log: {vite_audit['total_lines']} lines, "
          f"tracebacks={vite_audit['has_tracebacks']}, "
          f"fatal={vite_audit['fatal_count']}, "
          f"unhandled={vite_audit['unhandled_exceptions_count']}")

    report["log_integrity"] = {
        "fastapi": fastapi_audit,
        "vite": vite_audit,
    }

    # 9. Formulate Verdict
    passed = (
        pre_vite_listen and pre_fastapi_listen and
        pre_vite_status == 200 and pre_fastapi_status == 200 and
        post_vite_listen and post_fastapi_listen and
        all(s == 200 for s in post_vite_statuses) and
        all(s == 200 for s in post_fastapi_statuses) and
        not fastapi_audit["has_tracebacks"] and
        not vite_audit["has_tracebacks"] and
        fastapi_audit["fatal_count"] == 0 and
        vite_audit["fatal_count"] == 0 and
        vite_rapid["failures"] == 0 and
        fastapi_rapid["failures"] == 0 and
        vite_burst["failures"] == 0 and
        fastapi_burst["failures"] == 0
    )

    verdict = "APPROVE" if passed else "REQUEST_CHANGES"
    report["verdict"] = verdict

    print("\n================================================================================")
    print(f"FINAL CHALLENGE VERDICT: {verdict}")
    print("================================================================================")

    return report


if __name__ == "__main__":
    report = run_full_stability_challenge()
    output_json_path = os.path.join(os.path.dirname(__file__), "stability_challenge_metrics.json")
    with open(output_json_path, "w", encoding="utf-8") as f:
        json.dump(report, f, indent=2)
    print(f"\nExecution metrics saved to: {output_json_path}")
    if report["verdict"] != "APPROVE":
        sys.exit(1)
    sys.exit(0)
