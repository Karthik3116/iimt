import concurrent.futures
import statistics
import threading
import time
import requests

# --- CONFIGURATION ---
BASE_URL = "https://iimt-7iy6.onrender.com"
SECTION = "A"
NUM_USERS = 10

# Replace this with the token retrieved from your browser's console
AUTH_TOKEN = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpZCI6IjZhNGJmOTBlYjg1ZjNlZmE4OGZmZTA2MyIsImVtYWlsIjoia2FydGhlZWsucDI2MDMwQGlpbXRyaWNoeS5hYy5pbiIsIm5hbWUiOiJLZXRoYXZhdGggS2FydGhlZWsiLCJpYXQiOjE3OTAzNjA5MTMsImV4cCI6MTc5NTU0NDkxM30.yWtnFg6sVPcp3Q0syx1OCvChugoTToCuSOiYqNsnpwU"

ENDPOINT = f"{BASE_URL}/api/timetable/{SECTION}"
HEADERS = {
    "Authorization": f"Bearer {AUTH_TOKEN}",
    "Content-Type": "application/json",
    "User-Agent": "BenchmarkClient/1.0",
}

# Synchronization barrier to ensure all threads hit the server at the exact same time
barrier = threading.Barrier(NUM_USERS)


def simulate_user(user_id: int):
    # Wait until all 10 threads are initialized and ready
    barrier.wait()

    start_time = time.perf_counter()
    try:
        response = requests.get(ENDPOINT, headers=HEADERS, timeout=30)
        elapsed_ms = (time.perf_counter() - start_time) * 1000

        # Check for Cloudflare / Server cache headers (useful before vs after setup)
        cf_cache = response.headers.get("cf-cache-status", "NO_CDN")
        cache_control = response.headers.get("cache-control", "None")
        print(response)

        return {
            "user_id": user_id,
            "status_code": response.status_code,
            "elapsed_ms": elapsed_ms,
            "cf_cache": cf_cache,
            "cache_control": cache_control,
            "success": response.status_code == 200,
        }
    except Exception as e:
        elapsed_ms = (time.perf_counter() - start_time) * 1000
        return {
            "user_id": user_id,
            "status_code": "ERROR",
            "elapsed_ms": elapsed_ms,
            "cf_cache": "N/A",
            "cache_control": "N/A",
            "success": False,
            "error": str(e),
        }


def run_benchmark():
    print(f"Target: {ENDPOINT}")
    print(f"Simulating {NUM_USERS} concurrent requests fired simultaneously...\n")

    overall_start = time.perf_counter()

    results = []
    with concurrent.futures.ThreadPoolExecutor(max_workers=NUM_USERS) as executor:
        futures = [
            executor.submit(simulate_user, i + 1) for i in range(NUM_USERS)
        ]
        for f in concurrent.futures.as_completed(futures):
            results.append(f.result())

    total_batch_time = (time.perf_counter() - overall_start) * 1000

    # Sort results by user_id
    results.sort(key=lambda x: x["user_id"])

    print(
        f"{'User':<8} | {'Status':<8} | {'Time (ms)':<12} | {'CF-Cache':<10} | {'Cache-Control'}"
    )
    print("-" * 75)

    times = []
    success_count = 0

    for r in results:
        status_display = str(r["status_code"])
        time_display = f"{r['elapsed_ms']:.2f} ms"
        cf_display = r["cf_cache"]
        cc_display = (
            r["cache_control"][:25] + "..."
            if len(r["cache_control"]) > 25
            else r["cache_control"]
        )

        print(
            f"User {r['user_id']:<3} | {status_display:<8} | {time_display:<12} | {cf_display:<10} | {cc_display}"
        )

        if r["success"]:
            success_count += 1
            times.append(r["elapsed_ms"])

    print("-" * 75)
    print(
        f"Completed: {success_count}/{NUM_USERS} successful requests in {total_batch_time:.2f} ms total."
    )

    if times:
        print(f"Fastest Request : {min(times):.2f} ms")
        print(f"Slowest Request : {max(times):.2f} ms")
        print(f"Average Latency : {statistics.mean(times):.2f} ms")
        print(f"Median Latency  : {statistics.median(times):.2f} ms")


if __name__ == "__main__":
    run_benchmark()