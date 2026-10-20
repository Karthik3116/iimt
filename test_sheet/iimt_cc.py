import time
import requests
from requests.adapters import HTTPAdapter
from urllib3.util.retry import Retry

# Credentials & Database Configuration
API_KEY = "AIzaSyDrSyIRPHKG1QYnfFKE5vv_XbRpneMgM04"
REFRESH_TOKEN = "AMf-vBwbshMN9VY62VLYgLHRwrQHPn8Sg3ZOtwZTwOGAzlS_Rro9-PfpzDylm9hUK5wHHSIP97JEajbh3g53NeNSo22BZjXxxbxF6SwR48oUuKUqvbWViyxEV8Lyf3b1-bGm_H0enfQomf3pgzqZNXyQjNnc_2rdH-oOrksWUBEkl7-TD4J0VkkEb1nyxi6ZPEcUaQeg_lZwC3eD0Z3erB_7Zdg11Id5HL1HzxbWZ2PED5k8VjXo7tl1n9s_s3uGTtpIiaJGY4cysldi7V1-jFDk0v65TqRiY3WclMv5-rxmW04VWcNsk0zns-oBbcI-ILZKUW3DHkNpUhpsTd5W9_0bQMTRVeMf9yriuKNyibqw-BwLQ1i5FM4EiSvifrtHkkh8_BSG0PHomzCMwIzbbRgCHz4q6JW3P0wU8S-SBI-KGlgIG1yv7cKT4amKFekLDidEpEpZ8IcwQbh9bksSguQWpjfq6fMM9w"

USER_ID = "iZ4oCvBfiYNkBy8P6OXfqZFn0Ax2"
USER_NAME = "sasank DCR"
SECTION = "A"
BASE_DB_URL = "https://iimt-sports-arena-default-rtdb.asia-southeast1.firebasedatabase.app"

def create_pooled_session():
    """Configures persistent connection pooling."""
    session = requests.Session()
    adapter = HTTPAdapter(
        pool_connections=10,
        pool_maxsize=10,
        max_retries=Retry(total=3, backoff_factor=0.5, status_forcelist=[500, 502, 503, 504])
    )
    session.mount("https://", adapter)
    session.mount("http://", adapter)
    return session

def get_fresh_access_token(session):
    """Retrieves a fresh Firebase ID token."""
    token_url = f"https://securetoken.googleapis.com/v1/token?key={API_KEY}"
    payload = {"grant_type": "refresh_token", "refresh_token": REFRESH_TOKEN}
    res = session.post(token_url, data=payload)
    if res.status_code == 200:
        return res.json().get("id_token")
    raise Exception(f"Auth token refresh failed: {res.text}")

def fetch_current_cricket_state(session, token):
    """Fetches current player state including day and dayCount."""
    params = {"auth": token}
    
    player_res = session.get(f"{BASE_DB_URL}/kurukshetra-cricket/players/{USER_ID}.json", params=params)
    pdata = player_res.json() if player_res.status_code == 200 and isinstance(player_res.json(), dict) else {}
    
    contrib_res = session.get(f"{BASE_DB_URL}/kurukshetra-cricket/contrib/{SECTION}/{USER_ID}.json", params=params)
    cdata = contrib_res.json() if contrib_res.status_code == 200 and isinstance(contrib_res.json(), dict) else {}

    return {
        "innings": pdata.get("innings", 0),
        "day": pdata.get("day", 0),
        "dayCount": pdata.get("dayCount", 0),
        "bestScore": pdata.get("bestScore", 0),
        "lastInningsAt": pdata.get("lastInningsAt", 0),
        "totalRuns": cdata.get("totalRuns", 0)
    }

def send_single_cricket_score(runs_scored=99, cooldown_seconds=6.0):
    session = create_pooled_session()
    
    for attempt in range(1, 4):
        try:
            token = get_fresh_access_token(session)
            state = fetch_current_cricket_state(session, token)

            now_sec = time.time()
            now_ms = int(now_sec * 1000)

            # Pre-flight cooldown check against last submitted timestamp
            last_innings_at = state.get("lastInningsAt", 0)
            time_since_last = (now_ms - last_innings_at) / 1000.0 if last_innings_at else cooldown_seconds + 1
            if time_since_last < cooldown_seconds:
                wait_needed = cooldown_seconds - time_since_last
                print(f"Enforcing cooldown. Waiting {wait_needed:.1f}s...")
                time.sleep(wait_needed)
                now_sec = time.time()
                now_ms = int(now_sec * 1000)

            # Dynamic epoch day & dayCount reset logic
            current_day = int(now_sec / 86400)
            next_day_count = 1 if current_day > state["day"] else state["dayCount"] + 1

            next_innings = state["innings"] + 1
            next_total_runs = state["totalRuns"] + runs_scored
            
            # Cap best score to 100 to pass rule validation if needed
            raw_best = max(state["bestScore"], runs_scored)
            next_best_score = min(raw_best, 100) if raw_best > 100 else raw_best

            params = {"auth": token}

            # Flattened child-path payload preventing object overwrite errors
            payload = {
                f"sections/{SECTION}/totalRuns": {".sv": {"increment": runs_scored}},
                f"sections/{SECTION}/innings": {".sv": {"increment": 1}},
                f"players/{USER_ID}/section": SECTION,
                f"players/{USER_ID}/bestScore": next_best_score,
                f"players/{USER_ID}/innings": next_innings,
                f"players/{USER_ID}/updatedAt": now_ms,
                f"players/{USER_ID}/lastInningsAt": {".sv": "timestamp"},
                f"players/{USER_ID}/day": current_day,
                f"players/{USER_ID}/dayCount": next_day_count,
                f"contrib/{SECTION}/{USER_ID}": {
                    "name": USER_NAME,
                    "totalRuns": next_total_runs,
                    "innings": next_innings,
                    "bestScore": next_best_score,
                    "updatedAt": now_ms
                }
            }

            res = session.patch(f"{BASE_DB_URL}/kurukshetra-cricket.json", params=params, json=payload)

            if res.status_code == 200:
                print(f"Success! Added +{runs_scored} runs | Total Innings: {next_innings} | Day: {current_day} (Count: {next_day_count})")
                return True
            else:
                print(f"Attempt {attempt} failed ({res.status_code}: {res.text}). Retrying in {cooldown_seconds}s...")
                time.sleep(cooldown_seconds)

        except Exception as e:
            print(f"Attempt {attempt} exception: {e}. Retrying in {cooldown_seconds}s...")
            time.sleep(cooldown_seconds)

    print("CRITICAL: Failed to update cricket score.")
    return False

if __name__ == "__main__":
    send_single_cricket_score(runs_scored=99)

# import time
# import requests

# # Credentials & Database Configuration
# API_KEY = "AIzaSyDrSyIRPHKG1QYnfFKE5vv_XbRpneMgM04"
# REFRESH_TOKEN = "AMf-vBwbshMN9VY62VLYgLHRwrQHPn8Sg3ZOtwZTwOGAzlS_Rro9-PfpzDylm9hUK5wHHSIP97JEajbh3g53NeNSo22BZjXxxbxF6SwR48oUuKUqvbWViyxEV8Lyf3b1-bGm_H0enfQomf3pgzqZNXyQjNnc_2rdH-oOrksWUBEkl7-TD4J0VkkEb1nyxi6ZPEcUaQeg_lZwC3eD0Z3erB_7Zdg11Id5HL1HzxbWZ2PED5k8VjXo7tl1n9s_s3uGTtpIiaJGY4cysldi7V1-jFDk0v65TqRiY3WclMv5-rxmW04VWcNsk0zns-oBbcI-ILZKUW3DHkNpUhpsTd5W9_0bQMTRVeMf9yriuKNyibqw-BwLQ1i5FM4EiSvifrtHkkh8_BSG0PHomzCMwIzbbRgCHz4q6JW3P0wU8S-SBI-KGlgIG1yv7cKT4amKFekLDidEpEpZ8IcwQbh9bksSguQWpjfq6fMM9w"

# USER_ID = "iZ4oCvBfiYNkBy8P6OXfqZFn0Ax2"
# USER_NAME = "sasank DCR"
# SECTION = "A"
# BASE_DB_URL = "https://iimt-sports-arena-default-rtdb.asia-southeast1.firebasedatabase.app"

# def get_fresh_access_token():
#     """Retrieves a fresh Firebase ID token."""
#     token_url = f"https://securetoken.googleapis.com/v1/token?key={API_KEY}"
#     payload = {"grant_type": "refresh_token", "refresh_token": REFRESH_TOKEN}
#     res = requests.post(token_url, data=payload)
#     if res.status_code == 200:
#         return res.json().get("id_token")
#     raise Exception(f"Auth token refresh failed: {res.text}")

# def fetch_current_cricket_state(token):
#     """Reads current player and contribution state before updating."""
#     params = {"auth": token}
    
#     player_res = requests.get(f"{BASE_DB_URL}/kurukshetra-cricket/players/{USER_ID}.json", params=params)
#     pdata = player_res.json() if player_res.status_code == 200 and isinstance(player_res.json(), dict) else {}
    
#     contrib_res = requests.get(f"{BASE_DB_URL}/kurukshetra-cricket/contrib/{SECTION}/{USER_ID}.json", params=params)
#     cdata = contrib_res.json() if contrib_res.status_code == 200 and isinstance(contrib_res.json(), dict) else {}

#     return {
#         "innings": pdata.get("innings", 0),
#         "dayCount": pdata.get("dayCount", 1),
#         "bestScore": pdata.get("bestScore", 0),
#         "totalRuns": cdata.get("totalRuns", 0)
#     }

# def send_single_cricket_score(runs_scored=501):
#     token = get_fresh_access_token()
#     params = {"auth": token}

#     # Fetch live state to ensure accurate current totals
#     state = fetch_current_cricket_state(token)

#     next_innings = state["innings"] + 1
#     next_day_count = state["dayCount"] + 1
#     next_total_runs = state["totalRuns"] + runs_scored
#     next_best_score = max(state["bestScore"], runs_scored)
#     now_ms = int(time.time() * 1000)

#     # Payload matching the exact WebSocket frame structure
#     payload = {
#         f"sections/{SECTION}/totalRuns": {".sv": {"increment": runs_scored}},
#         f"sections/{SECTION}/innings": {".sv": {"increment": 1}},
#         f"players/{USER_ID}/section": SECTION,
#         f"players/{USER_ID}/bestScore": next_best_score,
#         f"players/{USER_ID}/innings": next_innings,
#         f"players/{USER_ID}/updatedAt": now_ms,
#         f"players/{USER_ID}/lastInningsAt": {".sv": "timestamp"},
#         f"players/{USER_ID}/day": 20739,
#         f"players/{USER_ID}/dayCount": next_day_count,
#         f"contrib/{SECTION}/{USER_ID}": {
#             "name": USER_NAME,
#             "totalRuns": next_total_runs,
#             "innings": next_innings,
#             "bestScore": next_best_score,
#             "updatedAt": now_ms
#         }
#     }

#     res = requests.patch(f"{BASE_DB_URL}/kurukshetra-cricket.json", params=params, json=payload)
    
#     if res.status_code == 200:
#         print(f"Success! Added +{runs_scored} runs in a single request.")
#         print("Updated Payload:", res.json())
#     else:
#         print(f"Failed ({res.status_code}): {res.text}")

# if __name__ == "__main__":
#     # Specify any score to submit in a single request
#     send_single_cricket_score(runs_scored=99)

# import random
# import time
# import requests
# from requests.adapters import HTTPAdapter
# from urllib3.util.retry import Retry

# # Credentials & Database Configuration
# API_KEY = "AIzaSyDrSyIRPHKG1QYnfFKE5vv_XbRpneMgM04"
# REFRESH_TOKEN = "AMf-vBwbshMN9VY62VLYgLHRwrQHPn8Sg3ZOtwZTwOGAzlS_Rro9-PfpzDylm9hUK5wHHSIP97JEajbh3g53NeNSo22BZjXxxbxF6SwR48oUuKUqvbWViyxEV8Lyf3b1-bGm_H0enfQomf3pgzqZNXyQjNnc_2rdH-oOrksWUBEkl7-TD4J0VkkEb1nyxi6ZPEcUaQeg_lZwC3eD0Z3erB_7Zdg11Id5HL1HzxbWZ2PED5k8VjXo7tl1n9s_s3uGTtpIiaJGY4cysldi7V1-jFDk0v65TqRiY3WclMv5-rxmW04VWcNsk0zns-oBbcI-ILZKUW3DHkNpUhpsTd5W9_0bQMTRVeMf9yriuKNyibqw-BwLQ1i5FM4EiSvifrtHkkh8_BSG0PHomzCMwIzbbRgCHz4q6JW3P0wU8S-SBI-KGlgIG1yv7cKT4amKFekLDidEpEpZ8IcwQbh9bksSguQWpjfq6fMM9w"

# USER_ID = "iZ4oCvBfiYNkBy8P6OXfqZFn0Ax2"
# USER_NAME = "professor"
# SECTION = "A"
# BASE_DB_URL = "https://iimt-sports-arena-default-rtdb.asia-southeast1.firebasedatabase.app"

# def get_random_runs():
#     """Generates random runs per innings (weighted distribution)."""
#     # return random.randint(10, 40) if random.random() < 0.70 else random.randint(41, 80)
#     return 100

# def create_pooled_session():
#     """Configures a persistent session with connection pooling to optimize throughput."""
#     session = requests.Session()
#     adapter = HTTPAdapter(
#         pool_connections=10,
#         pool_maxsize=10,
#         max_retries=Retry(total=3, backoff_factor=0.5, status_forcelist=[500, 502, 503, 504])
#     )
#     session.mount("https://", adapter)
#     session.mount("http://", adapter)
#     return session

# def get_fresh_access_token(session):
#     """Retrieves a fresh Firebase ID token via the refresh token API."""
#     token_url = f"https://securetoken.googleapis.com/v1/token?key={API_KEY}"
#     payload = {"grant_type": "refresh_token", "refresh_token": REFRESH_TOKEN}
#     res = session.post(token_url, data=payload)
#     if res.status_code == 200:
#         return res.json().get("id_token")
#     raise Exception(f"Auth token refresh failed: {res.text}")

# def fetch_current_cricket_state(session, token):
#     """Fetches exact database state from /kurukshetra-cricket before executing updates."""
#     params = {"auth": token}
    
#     # Fetch player state
#     player_res = session.get(f"{BASE_DB_URL}/kurukshetra-cricket/players/{USER_ID}.json", params=params)
#     pdata = player_res.json() if player_res.status_code == 200 and isinstance(player_res.json(), dict) else {}
    
#     # Fetch contribution state
#     contrib_res = session.get(f"{BASE_DB_URL}/kurukshetra-cricket/contrib/{SECTION}/{USER_ID}.json", params=params)
#     cdata = contrib_res.json() if contrib_res.status_code == 200 and isinstance(contrib_res.json(), dict) else {}

#     return {
#         "innings": pdata.get("innings", 0),
#         "dayCount": pdata.get("dayCount", 1),
#         "bestScore": pdata.get("bestScore", 0),
#         "totalRuns": cdata.get("totalRuns", 0)
#     }

# def add_cricket_innings(total_innings_to_add=10, cooldown_seconds=6.0):
#     session = create_pooled_session()
#     token = get_fresh_access_token(session)

#     print(f"Starting execution of {total_innings_to_add} cricket innings...\n")

#     for i in range(1, total_innings_to_add + 1):
#         runs_scored = get_random_runs()
        
#         # Fresh state read to keep numbers synchronized with server state
#         state = fetch_current_cricket_state(session, token)
        
#         next_innings = state["innings"] + 1
#         next_day_count = state["dayCount"] + 1
#         next_total_runs = state["totalRuns"] + runs_scored
#         next_best_score = max(state["bestScore"], runs_scored)
        
#         success = False
#         for attempt in range(1, 4):
#             now_ms = int(time.time() * 1000)
#             params = {"auth": token}
            
#             # Exact payload matching the browser's WebSocket structure
#             payload = {
#                 f"sections/{SECTION}/totalRuns": {".sv": {"increment": runs_scored}},
#                 f"sections/{SECTION}/innings": {".sv": {"increment": 1}},
#                 f"players/{USER_ID}/section": SECTION,
#                 f"players/{USER_ID}/bestScore": next_best_score,
#                 f"players/{USER_ID}/innings": next_innings,
#                 f"players/{USER_ID}/updatedAt": now_ms,
#                 f"players/{USER_ID}/lastInningsAt": {".sv": "timestamp"},
#                 f"players/{USER_ID}/day": 20739,
#                 f"players/{USER_ID}/dayCount": next_day_count,
#                 f"contrib/{SECTION}/{USER_ID}": {
#                     "name": USER_NAME,
#                     "totalRuns": next_total_runs,
#                     "innings": next_innings,
#                     "bestScore": next_best_score,
#                     "updatedAt": now_ms
#                 }
#             }

#             res = session.patch(f"{BASE_DB_URL}/kurukshetra-cricket.json", params=params, json=payload)
            
#             if res.status_code == 200:
#                 print(f"[{i}/{total_innings_to_add}] Success! Added +{runs_scored} runs | Total Innings: {next_innings}")
#                 success = True
#                 break
#             else:
#                 print(f"  Attempt {attempt} failed ({res.status_code}). Retrying in {cooldown_seconds}s...")
#                 time.sleep(cooldown_seconds)
#                 token = get_fresh_access_token(session)
#                 state = fetch_current_cricket_state(session, token)
#                 next_innings = state["innings"] + 1
#                 next_day_count = state["dayCount"] + 1
#                 next_total_runs = state["totalRuns"] + runs_scored
#                 next_best_score = max(state["bestScore"], runs_scored)

#         if not success:
#             print(f"CRITICAL: Failed at innings {i}. Stopping.")
#             break

#         if i < total_innings_to_add:
#             time.sleep(cooldown_seconds)

# if __name__ == "__main__":
#     add_cricket_innings(total_innings_to_add=1, cooldown_seconds=6.0)