# -*- coding: utf-8 -*-
"""Empirical Stress Test Harness & Adversarial Challenge for Dev Servers.

Authored by challenger_dev_1 for Milestone M-DevServers to empirically verify:
1. TCP Socket Connectivity on 127.0.0.1:5173 (Vite) and 127.0.0.1:8000 (FastAPI).
2. HTTP 200 baseline status, headers, and payload schemas for:
   - http://127.0.0.1:5173/student/
   - http://127.0.0.1:8000/api/health
   - http://127.0.0.1:5173/api/health (Vite reverse-proxy)
3. Edge Routing:
   - http://127.0.0.1:5173/ -> HTTP 302 Found, Location: /student/
   - http://127.0.0.1:8000/api/nonexistent -> HTTP 404 Not Found, JSON error schema
   - http://127.0.0.1:5173/api/nonexistent -> HTTP 404 Not Found via Vite proxy
   - http://127.0.0.1:8000/unmapped_route -> HTTP 404 Not Found
4. Protocol variations & Edge cases:
   - HEAD requests: Vite returns 200 OK; FastAPI returns 404 (GET-only route)
   - OPTIONS requests: FastAPI returns 404 (no CORS preflight)
   - Extreme query strings (4KB), query parameters
5. Concurrency & Burst Stress:
   - 100 concurrent requests across distinct client IPs against FastAPI /api/health
   - 100 concurrent requests against Vite /student/ (unlimited)
   - Measuring RPS, P50, P95, P99, Max latency, and payload consistency
6. Adversarial Rate Limit Challenge:
   - Flooding a single IP (140 reqs in burst) to empirically verify the 120 req/min W1 rate limiter
   - Verifying HTTP 429 response, 'rate_limited' body, and Retry-After header
7. Post-stress daemon stability & listening persistence
"""

import concurrent.futures
import http.client
import json
import socket
import sys
import time
import unittest
import urllib.parse
import urllib.request
from typing import Any, Dict, List, Optional, Tuple


VITE_HOST = "127.0.0.1"
VITE_PORT = 5173
FASTAPI_HOST = "127.0.0.1"
FASTAPI_PORT = 8000


def raw_http_request(host: str, port: int, method: str, path: str, headers: Optional[Dict[str, str]] = None, timeout: float = 5.0) -> Tuple[int, Dict[str, str], bytes]:
    conn = http.client.HTTPConnection(host, port, timeout=timeout)
    try:
        conn.request(method, path, headers=headers or {})
        resp = conn.getresponse()
        resp_headers = {k.lower(): v for k, v in resp.getheaders()}
        body = resp.read()
        return resp.status, resp_headers, body
    finally:
        conn.close()


def measure_single_get(url: str, headers: Optional[Dict[str, str]] = None, timeout: float = 5.0) -> Dict[str, Any]:
    start = time.perf_counter()
    status = None
    resp_headers = {}
    body = b""
    error = None
    h = {"User-Agent": "ChallengerHarness/1.0"}
    if headers:
        h.update(headers)
    try:
        req = urllib.request.Request(url, headers=h)
        with urllib.request.urlopen(req, timeout=timeout) as response:
            status = response.status
            resp_headers = {k.lower(): v for k, v in response.headers.items()}
            body = response.read()
    except urllib.error.HTTPError as e:
        status = e.code
        resp_headers = {k.lower(): v for k, v in e.headers.items()}
        body = e.read()
    except Exception as e:
        error = str(e)
    elapsed_ms = (time.perf_counter() - start) * 1000.0
    return {
        "status": status,
        "elapsed_ms": elapsed_ms,
        "headers": resp_headers,
        "body": body,
        "error": error,
    }


def compute_latency_percentiles(latencies: List[float]) -> Dict[str, float]:
    if not latencies:
        return {"min": 0.0, "mean": 0.0, "p50": 0.0, "p95": 0.0, "p99": 0.0, "max": 0.0}
    sorted_l = sorted(latencies)
    n = len(sorted_l)
    p50_idx = min(int(n * 0.50), n - 1)
    p95_idx = min(int(n * 0.95), n - 1)
    p99_idx = min(int(n * 0.99), n - 1)
    return {
        "min": round(sorted_l[0], 2),
        "mean": round(sum(sorted_l) / n, 2),
        "p50": round(sorted_l[p50_idx], 2),
        "p95": round(sorted_l[p95_idx], 2),
        "p99": round(sorted_l[p99_idx], 2),
        "max": round(sorted_l[-1], 2),
    }


class TestSuite01SocketAndBaselines(unittest.TestCase):
    """Direct TCP socket and baseline HTTP 200 payload verification."""

    def test_01_fastapi_socket_connectivity(self):
        s = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
        s.settimeout(2.0)
        try:
            res = s.connect_ex((FASTAPI_HOST, FASTAPI_PORT))
            self.assertEqual(res, 0, f"Cannot connect to FastAPI TCP socket at {FASTAPI_HOST}:{FASTAPI_PORT}")
        finally:
            s.close()

    def test_02_vite_socket_connectivity(self):
        s = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
        s.settimeout(2.0)
        try:
            res = s.connect_ex((VITE_HOST, VITE_PORT))
            self.assertEqual(res, 0, f"Cannot connect to Vite TCP socket at {VITE_HOST}:{VITE_PORT}")
        finally:
            s.close()

    def test_03_fastapi_health_baseline(self):
        # Use an independent client IP to ensure baseline test is never affected by prior rate limits
        status, headers, body = raw_http_request(FASTAPI_HOST, FASTAPI_PORT, "GET", "/api/health", headers={"X-Forwarded-For": "198.51.100.1"})
        self.assertEqual(status, 200, f"Expected HTTP 200 from FastAPI /api/health, got {status}")
        self.assertIn("application/json", headers.get("content-type", ""))
        self.assertIn("x-request-id", headers)
        self.assertTrue(headers["x-request-id"].startswith("HY-"))
        self.assertEqual(headers.get("server", "").lower(), "uvicorn")

        data = json.loads(body.decode("utf-8"))
        self.assertEqual(data.get("status"), "ok")
        self.assertEqual(data.get("version"), "2.0.0")
        self.assertIn("uptime_s", data)
        self.assertIsInstance(data["uptime_s"], (int, float))
        self.assertGreater(data["uptime_s"], 0)
        self.assertIn("miniapp", data)
        self.assertIn("pwa", data)
        self.assertIn("landing", data)

    def test_04_vite_student_baseline(self):
        status, headers, body = raw_http_request(VITE_HOST, VITE_PORT, "GET", "/student/")
        self.assertEqual(status, 200, f"Expected HTTP 200 from Vite /student/, got {status}")
        self.assertIn("text/html", headers.get("content-type", ""))
        body_str = body.decode("utf-8", errors="replace")
        self.assertIn("<!doctype html>", body_str.lower())
        self.assertIn("هامزیار", body_str)
        self.assertIn('id="root"', body_str)
        self.assertIn('/student/src/main.tsx', body_str)
        self.assertGreater(len(body), 1000)

    def test_05_vite_proxy_to_fastapi(self):
        status, headers, body = raw_http_request(VITE_HOST, VITE_PORT, "GET", "/api/health", headers={"X-Forwarded-For": "198.51.100.2"})
        self.assertEqual(status, 200, f"Expected HTTP 200 from Vite proxy /api/health, got {status}")
        self.assertIn("application/json", headers.get("content-type", ""))
        data = json.loads(body.decode("utf-8"))
        self.assertEqual(data.get("status"), "ok")
        self.assertEqual(data.get("version"), "2.0.0")


class TestSuite02EdgeRouting(unittest.TestCase):
    """Edge routing validation: Root redirect (302) and non-existent route (404)."""

    def test_06_vite_root_redirect_302(self):
        status, headers, _ = raw_http_request(VITE_HOST, VITE_PORT, "GET", "/")
        self.assertEqual(status, 302, f"Expected HTTP 302 redirect for root /, got {status}")
        self.assertEqual(headers.get("location"), "/student/", "Expected Location header to be '/student/'")

    def test_07_vite_root_follow_redirect(self):
        req = urllib.request.Request(f"http://{VITE_HOST}:{VITE_PORT}/")
        with urllib.request.urlopen(req, timeout=5.0) as resp:
            self.assertEqual(resp.status, 200)
            self.assertTrue(resp.url.endswith("/student/"))
            body = resp.read().decode("utf-8", errors="replace")
            self.assertIn("هامزیار", body)

    def test_08_fastapi_nonexistent_route_404(self):
        status, headers, body = raw_http_request(FASTAPI_HOST, FASTAPI_PORT, "GET", "/api/nonexistent", headers={"X-Forwarded-For": "198.51.100.3"})
        self.assertEqual(status, 404, f"Expected HTTP 404 for /api/nonexistent, got {status}")
        self.assertIn("application/json", headers.get("content-type", ""))
        data = json.loads(body.decode("utf-8"))
        self.assertEqual(data.get("detail"), "not_found")
        self.assertEqual(data.get("path"), "/api/nonexistent")

    def test_09_vite_proxy_nonexistent_route_404(self):
        status, headers, body = raw_http_request(VITE_HOST, VITE_PORT, "GET", "/api/nonexistent", headers={"X-Forwarded-For": "198.51.100.4"})
        self.assertEqual(status, 404, f"Expected HTTP 404 for proxy /api/nonexistent, got {status}")
        self.assertIn("application/json", headers.get("content-type", ""))
        data = json.loads(body.decode("utf-8"))
        self.assertEqual(data.get("detail"), "not_found")

    def test_10_fastapi_arbitrary_unmapped_route_404(self):
        status, _, body = raw_http_request(FASTAPI_HOST, FASTAPI_PORT, "GET", "/random_unmapped_route_xyz", headers={"X-Forwarded-For": "198.51.100.5"})
        self.assertEqual(status, 404)
        data = json.loads(body.decode("utf-8"))
        self.assertIn(data.get("detail", "").lower(), ["not found", "not_found"])


class TestSuite03HttpMethodsAndEdgeCases(unittest.TestCase):
    """Protocol variations: HEAD, OPTIONS, query parameters, URL limits."""

    def test_11_fastapi_head_request_behavior(self):
        # /api/health is registered strictly with @router.get; HEAD returns 404 not_found
        status, headers, body = raw_http_request(FASTAPI_HOST, FASTAPI_PORT, "HEAD", "/api/health", headers={"X-Forwarded-For": "198.51.100.6"})
        self.assertEqual(status, 404, "FastAPI router is GET-only, HEAD returns 404")
        self.assertIn("application/json", headers.get("content-type", ""))

    def test_12_vite_head_request(self):
        # Vite dev server natively supports HEAD and serves headers with empty body
        status, headers, body = raw_http_request(VITE_HOST, VITE_PORT, "HEAD", "/student/")
        self.assertEqual(status, 200)
        self.assertIn("text/html", headers.get("content-type", ""))
        self.assertEqual(len(body), 0, "HEAD response must have an empty body")

    def test_13_fastapi_options_request_behavior(self):
        # OPTIONS returns 404 when route does not register an OPTIONS handler
        status, _, _ = raw_http_request(FASTAPI_HOST, FASTAPI_PORT, "OPTIONS", "/api/health", headers={"X-Forwarded-For": "198.51.100.7"})
        self.assertEqual(status, 404)

    def test_14_fastapi_query_parameters(self):
        status, _, body = raw_http_request(FASTAPI_HOST, FASTAPI_PORT, "GET", "/api/health?test=123&foo=bar&mode=dev", headers={"X-Forwarded-For": "198.51.100.8"})
        self.assertEqual(status, 200)
        data = json.loads(body.decode("utf-8"))
        self.assertEqual(data.get("status"), "ok")

    def test_15_fastapi_extreme_query_length(self):
        extreme_query = "q=" + ("x" * 4000)
        status, _, body = raw_http_request(FASTAPI_HOST, FASTAPI_PORT, "GET", f"/api/health?{extreme_query}", headers={"X-Forwarded-For": "198.51.100.9"})
        self.assertEqual(status, 200, f"Expected 200 for 4KB query string, got {status}")
        data = json.loads(body.decode("utf-8"))
        self.assertEqual(data.get("status"), "ok")


class TestSuite04BurstAndConcurrency(unittest.TestCase):
    """Burst and concurrent stress harnesses."""

    def test_16_fastapi_health_concurrency_burst_multi_client(self):
        # 100 concurrent requests across 10 client IP streams to avoid hitting the 120/min single-IP limit
        total_requests = 100
        concurrency = 10
        url = f"http://{FASTAPI_HOST}:{FASTAPI_PORT}/api/health"

        def _do_req(i: int):
            client_ip = f"198.51.100.{(i % 10) + 10}"
            return measure_single_get(url, headers={"X-Forwarded-For": client_ip})

        start_time = time.perf_counter()
        with concurrent.futures.ThreadPoolExecutor(max_workers=concurrency) as executor:
            futures = [executor.submit(_do_req, i) for i in range(total_requests)]
            results = [f.result() for f in futures]
        total_duration = time.perf_counter() - start_time

        latencies = [r["elapsed_ms"] for r in results]
        percentiles = compute_latency_percentiles(latencies)
        status_codes = [r["status"] for r in results]
        success_count = status_codes.count(200)

        # Assert 100% success rate
        self.assertEqual(success_count, total_requests, f"Only {success_count}/{total_requests} returned 200")

        # Payload consistency check & Unique Request ID
        request_ids = set()
        for r in results:
            data = json.loads(r["body"].decode("utf-8"))
            self.assertEqual(data.get("status"), "ok")
            self.assertEqual(data.get("version"), "2.0.0")
            req_id = r["headers"].get("x-request-id")
            if req_id:
                request_ids.add(req_id)

        self.assertEqual(len(request_ids), total_requests, "Request IDs must be unique per request")
        self.assertLess(percentiles["p95"], 200.0, f"P95 latency exceeded 200ms: {percentiles['p95']}ms")

    def test_17_vite_student_concurrency_burst(self):
        # 100 requests with 10 concurrent threads on Vite dev server
        total_requests = 100
        concurrency = 10
        url = f"http://{VITE_HOST}:{VITE_PORT}/student/"

        start_time = time.perf_counter()
        with concurrent.futures.ThreadPoolExecutor(max_workers=concurrency) as executor:
            futures = [executor.submit(measure_single_get, url) for _ in range(total_requests)]
            results = [f.result() for f in futures]
        total_duration = time.perf_counter() - start_time

        latencies = [r["elapsed_ms"] for r in results]
        percentiles = compute_latency_percentiles(latencies)
        status_codes = [r["status"] for r in results]
        success_count = status_codes.count(200)

        # Assert 100% success rate
        self.assertEqual(success_count, total_requests, f"Only {success_count}/{total_requests} returned 200")

        # Body consistency check
        for r in results:
            body_str = r["body"].decode("utf-8", errors="replace")
            self.assertIn("هامزیار", body_str)
            self.assertIn('id="root"', body_str)

        self.assertLess(percentiles["p95"], 200.0, f"P95 latency exceeded 200ms: {percentiles['p95']}ms")


class TestSuite05AdversarialRateLimiting(unittest.TestCase):
    """Empirically test and verify FastAPI W1 rate-limiting behavior when threshold (120/min) is exceeded."""

    def test_18_rate_limit_defense_and_headers(self):
        # Dedicated client IP to test exact rate limit boundary: 140 rapid sequential/concurrent requests
        target_ip = "198.51.100.99"
        url = f"http://{FASTAPI_HOST}:{FASTAPI_PORT}/api/health"

        statuses = []
        retry_afters = []

        for i in range(135):
            res = measure_single_get(url, headers={"X-Forwarded-For": target_ip})
            statuses.append(res["status"])
            if res["status"] == 429:
                retry_afters.append(res["headers"].get("retry-after"))
                data = json.loads(res["body"].decode("utf-8"))
                self.assertEqual(data.get("detail"), "rate_limited")

        ok_count = statuses.count(200)
        rate_limited_count = statuses.count(429)

        # Exactly 120 must succeed, and the remaining 15 must be rate-limited
        self.assertEqual(ok_count, 120, f"Expected exactly 120 OK responses before rate limit, got {ok_count}")
        self.assertEqual(rate_limited_count, 15, f"Expected 15 rate-limited responses, got {rate_limited_count}")
        self.assertTrue(len(retry_afters) > 0, "Missing Retry-After headers")
        self.assertTrue(int(retry_afters[0]) > 0, "Retry-After value must be positive integer")


class TestSuite06PostStressStability(unittest.TestCase):
    """Verify that under load, neither process crashed or died, and sockets remain listening."""

    def test_19_post_stress_process_and_socket_integrity(self):
        # 1. FastAPI TCP socket is still accepting connections
        s = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
        s.settimeout(2.0)
        try:
            res = s.connect_ex((FASTAPI_HOST, FASTAPI_PORT))
            self.assertEqual(res, 0, "FastAPI crashed or refused connections after stress!")
        finally:
            s.close()

        # 2. Vite TCP socket is still accepting connections
        s = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
        s.settimeout(2.0)
        try:
            res = s.connect_ex((VITE_HOST, VITE_PORT))
            self.assertEqual(res, 0, "Vite crashed or refused connections after stress!")
        finally:
            s.close()

        # 3. Vite is serving student app cleanly
        status, _, body = raw_http_request(VITE_HOST, VITE_PORT, "GET", "/student/")
        self.assertEqual(status, 200)
        self.assertIn("هامزیار", body.decode("utf-8", errors="replace"))

        # 4. FastAPI is serving health cleanly for a fresh IP
        status, _, body = raw_http_request(FASTAPI_HOST, FASTAPI_PORT, "GET", "/api/health", headers={"X-Forwarded-For": "198.51.100.200"})
        self.assertEqual(status, 200)
        data = json.loads(body.decode("utf-8"))
        self.assertEqual(data.get("status"), "ok")


if __name__ == "__main__":
    loader = unittest.TestLoader()
    suite = unittest.TestSuite()
    suite.addTests(loader.loadTestsFromTestCase(TestSuite01SocketAndBaselines))
    suite.addTests(loader.loadTestsFromTestCase(TestSuite02EdgeRouting))
    suite.addTests(loader.loadTestsFromTestCase(TestSuite03HttpMethodsAndEdgeCases))
    suite.addTests(loader.loadTestsFromTestCase(TestSuite04BurstAndConcurrency))
    suite.addTests(loader.loadTestsFromTestCase(TestSuite05AdversarialRateLimiting))
    suite.addTests(loader.loadTestsFromTestCase(TestSuite06PostStressStability))

    runner = unittest.TextTestRunner(verbosity=2)
    result = runner.run(suite)
    if not result.wasSuccessful():
        sys.exit(1)
