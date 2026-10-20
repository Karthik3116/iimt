import random
import time
import requests
from requests.adapters import HTTPAdapter
from urllib3.util.retry import Retry

# 1. Credentials & Configuration
API_KEY = "AIzaSyDrSyIRPHKG1QYnfFKE5vv_XbRpneMgM04"
REFRESH_TOKEN = "AMf-vBwbshMN9VY62VLYgLHRwrQHPn8Sg3ZOtwZTwOGAzlS_Rro9-PfpzDylm9hUK5wHHSIP97JEajbh3g53NeNSo22BZjXxxbxF6SwR48oUuKUqvbWViyxEV8Lyf3b1-bGm_H0enfQomf3pgzqZNXyQjNnc_2rdH-oOrksWUBEkl7-TD4J0VkkEb1nyxi6ZPEcUaQeg_lZwC3eD0Z3erB_7Zdg11Id5HL1HzxbWZ2PED5k8VjXo7tl1n9s_s3uGTtpIiaJGY4cysldi7V1-jFDk0v65TqRiY3WclMv5-rxmW04VWcNsk0zns-oBbcI-ILZKUW3DHkNpUhpsTd5W9_0bQMTRVeMf9yriuKNyibqw-BwLQ1i5FM4EiSvifrtHkkh8_BSG0PHomzCMwIzbbRgCHz4q6JW3P0wU8S-SBI-KGlgIG1yv7cKT4amKFekLDidEpEpZ8IcwQbh9bksSguQWpjfq6fMM9w"

USER_ID = "iZ4oCvBfiYNkBy8P6OXfqZFn0Ax2"
USER_NAME = "sasank DCR"
SECTION = "A"

# API_KEY = "AIzaSyDrSyIRPHKG1QYnfFKE5vv_XbRpneMgM04"
# REFRESH_TOKEN = "AMf-vBxFYko4Uq_O9zGXMIxB4XvbqePEc0DZ_Lo4iUgt9tjkwR7B8vd7Q-BiHW9Tbphp9mb5v8bJVHfw4Pl1JhNG5N5XLoMAAdANy0MHwlhVdOgKrcLL8Nhv_eiHdvYpG4yQqZyzVfgjpL3-wVvFeRE5DYXl5jOMjopngCs4untOycO0NGj2CKzQPOmbR1wpjnzOu3WJpi9NB0ZzpejcbxjIq_F1hYS7BKihVwtHqQ0KuE8hgRzfKEhupM_icpPPk9UmYCluJDUP5agyYWIWDu2Kxf9B89sS29YPizgKmJhrpelQJsjPepQ5hAIjgalID9ctpV8fcQC4Spfb6qH7RdXsk9GkPPrW0Z5SOY8A7NTLjAJIM1LZ9sRAfbv7t0_SiMB5uTl_FMSGv0ilqpXupxHepXQX023e5qC0YsPJJFnTqyq3YUpwPa0sWtvMSwQrXzDn9iQBXoxn"
# USER_ID = "KkVTbSi8GlWXYU5L82tNjaUTmMP2"
# USER_NAME = "Suman"
# SECTION = "B"

BASE_DB_URL = "https://iimt-sports-arena-default-rtdb.asia-southeast1.firebasedatabase.app"

def get_weighted_random_points():
    """Generates score between 50 and 200 with 80% weighting on lower range."""
    # return random.randint(200, 300) if random.random() < 0.80 else random.randint(500, 800)
    return 147
    
    

def create_pooled_session():
    """Creates a persistent HTTP session with socket reuse."""
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
    """Refreshes Firebase access token using the refresh token API."""
    token_url = f"https://securetoken.googleapis.com/v1/token?key={API_KEY}"
    payload = {"grant_type": "refresh_token", "refresh_token": REFRESH_TOKEN}
    res = session.post(token_url, data=payload)
    if res.status_code == 200:
        return res.json().get("id_token")
    raise Exception(f"Auth refresh failed: {res.text}")

def fetch_current_state(session, token):
    """Fetches live player and contribution state from Firebase."""
    params = {"auth": token}

    player_res = session.get(f"{BASE_DB_URL}/high-basketball/players/{USER_ID}.json", params=params)
    if player_res.status_code != 200 or not isinstance(player_res.json(), dict):
        raise Exception(f"Failed to fetch player state ({player_res.status_code}): {player_res.text}")
    pdata = player_res.json()

    contrib_res = session.get(f"{BASE_DB_URL}/high-basketball/contrib/{SECTION}/{USER_ID}.json", params=params)
    if contrib_res.status_code != 200 or not isinstance(contrib_res.json(), dict):
        raise Exception(f"Failed to fetch contrib state ({contrib_res.status_code}): {contrib_res.text}")
    cdata = contrib_res.json()

    return {
        "games": pdata.get("games", 0),
        "day": pdata.get("day", 0),
        "dayCount": pdata.get("dayCount", 0),
        "best": pdata.get("best", 0),
        "lastGameAt": pdata.get("lastGameAt", 0),
        "totalPoints": cdata.get("totalPoints", 0)
    }

def add_games_zero_failures(total_games_to_add=10, cooldown_seconds=6.0):
    session = create_pooled_session()
    
    print(f"Executing {total_games_to_add} games with zero-failure sync...\n")

    for i in range(1, total_games_to_add + 1):
        score = get_weighted_random_points()
        success = False

        for attempt in range(1, 4):
            try:
                token = get_fresh_access_token(session)
                state = fetch_current_state(session, token)

                now_sec = time.time()
                now_ms = int(now_sec * 1000)

                # Pre-flight cooldown check against last submitted game timestamp
                last_game_at = state["lastGameAt"]
                time_since_last = (now_ms - last_game_at) / 1000.0 if last_game_at else cooldown_seconds + 1
                if time_since_last < cooldown_seconds:
                    wait_needed = cooldown_seconds - time_since_last
                    print(f"  Enforcing server cooldown. Waiting {wait_needed:.1f}s...")
                    time.sleep(wait_needed)
                    now_sec = time.time()
                    now_ms = int(now_sec * 1000)

                current_day = int(now_sec / 86400)
                next_day_count = 1 if current_day > state["day"] else state["dayCount"] + 1
                next_games = state["games"] + 1
                next_total_points = state["totalPoints"] + score
                next_best = max(state["best"], score)

                params = {"auth": token}
                payload = {
                    f"sections/{SECTION}/totalPoints": {".sv": {"increment": score}},
                    f"sections/{SECTION}/games": {".sv": {"increment": 1}},
                    f"players/{USER_ID}": {
                        "name": USER_NAME,
                        "section": SECTION,
                        "best": next_best,
                        "games": next_games,
                        "updatedAt": now_ms,
                        "lastGameAt": {".sv": "timestamp"},
                        "day": current_day,
                        "dayCount": next_day_count
                    },
                    f"contrib/{SECTION}/{USER_ID}": {
                        "name": USER_NAME,
                        "totalPoints": next_total_points,
                        "games": next_games,
                        "best": next_best,
                        "updatedAt": now_ms
                    }
                }

                res = session.patch(f"{BASE_DB_URL}/high-basketball.json", params=params, json=payload)

                if res.status_code == 200:
                    print(f"[{i}/{total_games_to_add}] Success! Added +{score} pts | Total Games: {next_games} | Day: {current_day} (Count: {next_day_count})")
                    success = True
                    sleep_if = random.randint(30,31)
                    print("sleeping :- " , sleep_if)
                    time.sleep(sleep_if)
                    break
                else:
                    print(f"  Attempt {attempt} failed ({res.status_code}: {res.text}). Retrying in {cooldown_seconds}s...")
                    time.sleep(cooldown_seconds)

            except Exception as e:
                print(f"  Attempt {attempt} error: {e}. Retrying in {cooldown_seconds}s...")
                time.sleep(cooldown_seconds)

        if not success:
            print(f"CRITICAL: Failed game {i}. Stopping.")
            break

        if i < total_games_to_add:
            time.sleep(cooldown_seconds)

if __name__ == "__main__":
    add_games_zero_failures(total_games_to_add=30, cooldown_seconds=random.randint(8,15))

# import random
# import time
# import requests
# from requests.adapters import HTTPAdapter
# from urllib3.util.retry import Retry

# # 1. Credentials
# API_KEY = "AIzaSyDrSyIRPHKG1QYnfFKE5vv_XbRpneMgM04"
# REFRESH_TOKEN = "AMf-vBwbshMN9VY62VLYgLHRwrQHPn8Sg3ZOtwZTwOGAzlS_Rro9-PfpzDylm9hUK5wHHSIP97JEajbh3g53NeNSo22BZjXxxbxF6SwR48oUuKUqvbWViyxEV8Lyf3b1-bGm_H0enfQomf3pgzqZNXyQjNnc_2rdH-oOrksWUBEkl7-TD4J0VkkEb1nyxi6ZPEcUaQeg_lZwC3eD0Z3erB_7Zdg11Id5HL1HzxbWZ2PED5k8VjXo7tl1n9s_s3uGTtpIiaJGY4cysldi7V1-jFDk0v65TqRiY3WclMv5-rxmW04VWcNsk0zns-oBbcI-ILZKUW3DHkNpUhpsTd5W9_0bQMTRVeMf9yriuKNyibqw-BwLQ1i5FM4EiSvifrtHkkh8_BSG0PHomzCMwIzbbRgCHz4q6JW3P0wU8S-SBI-KGlgIG1yv7cKT4amKFekLDidEpEpZ8IcwQbh9bksSguQWpjfq6fMM9w"

# USER_ID = "iZ4oCvBfiYNkBy8P6OXfqZFn0Ax2"
# USER_NAME = "professor"
# SECTION = "A"
# BASE_DB_URL = "https://iimt-sports-arena-default-rtdb.asia-southeast1.firebasedatabase.app"

# def get_weighted_random_points():
#     """Generates score between 50 and 200 with 80% weighting on lower range."""
#     return random.randint(50, 125) if random.random() < 0.80 else random.randint(126, 200)
#     # return 331

# def create_pooled_session():
#     """Creates a persistent HTTP session with socket reuse."""
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
#     """Refreshes Firebase access token."""
#     token_url = f"https://securetoken.googleapis.com/v1/token?key={API_KEY}"
#     payload = {"grant_type": "refresh_token", "refresh_token": REFRESH_TOKEN}
#     res = session.post(token_url, data=payload)
#     if res.status_code == 200:
#         return res.json().get("id_token")
#     raise Exception(f"Auth refresh failed: {res.text}")

# def fetch_current_state(session, token):
#     """Fetches exact database values right before sending game update."""
#     params = {"auth": token}
    
#     player_res = session.get(f"{BASE_DB_URL}/high-basketball/players/{USER_ID}.json", params=params)
#     pdata = player_res.json() if player_res.status_code == 200 and player_res.json() else {}
    
#     contrib_res = session.get(f"{BASE_DB_URL}/high-basketball/contrib/{SECTION}/{USER_ID}.json", params=params)
#     cdata = contrib_res.json() if contrib_res.status_code == 200 and contrib_res.json() else {}

#     return {
#         "games": pdata.get("games", 0),
#         "dayCount": pdata.get("dayCount", 1),
#         "best": pdata.get("best", 0),
#         "totalPoints": cdata.get("totalPoints", 0)
#     }

# def add_games_zero_failures(total_games_to_add=10, cooldown_seconds=6.0):
#     session = create_pooled_session()
#     token = get_fresh_access_token(session)

#     print(f"Executing {total_games_to_add} games with zero-failure sync strategy...\n")

#     for i in range(1, total_games_to_add + 1):
#         score = get_weighted_random_points()
        
#         # Fresh GET before every request eliminates state desynchronization
#         state = fetch_current_state(session, token)
        
#         next_games = state["games"] + 1
#         next_day_count = state["dayCount"] + 1
#         next_total_points = state["totalPoints"] + score
#         next_best = max(state["best"], score)
        
#         success = False
#         for attempt in range(1, 4):
#             now_ms = int(time.time() * 1000)
#             params = {"auth": token}
            
#             payload = {
#                 f"sections/{SECTION}/totalPoints": {".sv": {"increment": score}},
#                 f"sections/{SECTION}/games": {".sv": {"increment": 1}},
#                 f"players/{USER_ID}": {
#                     "name": USER_NAME,
#                     "section": SECTION,
#                     "best": next_best,
#                     "games": next_games,
#                     "updatedAt": now_ms,
#                     "lastGameAt": {".sv": "timestamp"},
#                     "day": 20739,
#                     "dayCount": next_day_count
#                 },
#                 f"contrib/{SECTION}/{USER_ID}": {
#                     "name": USER_NAME,
#                     "totalPoints": next_total_points,
#                     "games": next_games,
#                     "best": next_best,
#                     "updatedAt": now_ms
#                 }
#             }

#             res = session.patch(f"{BASE_DB_URL}/high-basketball.json", params=params, json=payload)
            
#             if res.status_code == 200:
#                 print(f"[{i}/{total_games_to_add}] Success! Added +{score} pts | Total Games: {next_games}")
#                 success = True
#                 break
#             else:
#                 print(f"  Attempt {attempt} failed ({res.status_code}). Waiting {cooldown_seconds}s and re-syncing...")
#                 time.sleep(cooldown_seconds)
#                 token = get_fresh_access_token(session)
#                 state = fetch_current_state(session, token)
#                 next_games = state["games"] + 1
#                 next_day_count = state["dayCount"] + 1
#                 next_total_points = state["totalPoints"] + score
#                 next_best = max(state["best"], score)

#         if not success:
#             print(f"CRITICAL: Failed game {i}. Stopping.")
#             break

#         # Cooldown prevents timestamp rule violation
#         if i < total_games_to_add:
#             time.sleep(cooldown_seconds)

# if __name__ == "__main__":
#     add_games_zero_failures(total_games_to_add=1, cooldown_seconds=6.0)

# # import random
# # import time
# # import requests

# # # 1. Session Credentials (Refresh from browser DevTools if you get 401)
# # API_KEY = "AIzaSyDrSyIRPHKG1QYnfFKE5vv_XbRpneMgM04"
# # REFRESH_TOKEN = "AMf-vBwbshMN9VY62VLYgLHRwrQHPn8Sg3ZOtwZTwOGAzlS_Rro9-PfpzDylm9hUK5wHHSIP97JEajbh3g53NeNSo22BZjXxxbxF6SwR48oUuKUqvbWViyxEV8Lyf3b1-bGm_H0enfQomf3pgzqZNXyQjNnc_2rdH-oOrksWUBEkl7-TD4J0VkkEb1nyxi6ZPEcUaQeg_lZwC3eD0Z3erB_7Zdg11Id5HL1HzxbWZ2PED5k8VjXo7tl1n9s_s3uGTtpIiaJGY4cysldi7V1-jFDk0v65TqRiY3WclMv5-rxmW04VWcNsk0zns-oBbcI-ILZKUW3DHkNpUhpsTd5W9_0bQMTRVeMf9yriuKNyibqw-BwLQ1i5FM4EiSvifrtHkkh8_BSG0PHomzCMwIzbbRgCHz4q6JW3P0wU8S-SBI-KGlgIG1yv7cKT4amKFekLDidEpEpZ8IcwQbh9bksSguQWpjfq6fMM9w"

# # USER_ID = "iZ4oCvBfiYNkBy8P6OXfqZFn0Ax2"
# # USER_NAME = "professor"
# # SECTION = "A"

# # BASE_DB_URL = "https://iimt-sports-arena-default-rtdb.asia-southeast1.firebasedatabase.app"

# # def get_weighted_random_points():
# #     """
# #     Generates a weighted random score:
# #     80% chance -> 50 to 125
# #     20% chance -> 126 to 200
# #     """
# #     if random.random() < 0.80:
# #         return random.randint(50, 125)
# #     else:
# #         return random.randint(126, 200)

# # def get_fresh_access_token():
# #     """Generates a fresh Firebase ID Token using the Refresh Token."""
# #     token_url = f"https://securetoken.googleapis.com/v1/token?key={API_KEY}"
# #     payload = {
# #         "grant_type": "refresh_token",
# #         "refresh_token": REFRESH_TOKEN
# #     }
# #     res = requests.post(token_url, data=payload)
# #     if res.status_code == 200:
# #         return res.json().get("id_token")
# #     else:
# #         raise Exception(f"Failed to refresh auth token (Token may be expired or revoked): {res.text}")

# # def send_game_score(points_scored, increment_games=True):
# #     # Step A: Get fresh authentication token
# #     token = get_fresh_access_token()
# #     params = {"auth": token}

# #     # Step B: Read current player state
# #     player_get_url = f"{BASE_DB_URL}/high-basketball/players/{USER_ID}.json"
# #     player_res = requests.get(player_get_url, params=params)
    
# #     current_best = 0
# #     current_games = 0
# #     current_day_count = 1
    
# #     if player_res.status_code == 200 and player_res.json():
# #         pdata = player_res.json()
# #         current_best = pdata.get("best", 0)
# #         current_games = pdata.get("games", 0)
# #         current_day_count = pdata.get("dayCount", 1)

# #     # Step C: Read current contribution state
# #     contrib_get_url = f"{BASE_DB_URL}/high-basketball/contrib/{SECTION}/{USER_ID}.json"
# #     contrib_res = requests.get(contrib_get_url, params=params)
    
# #     current_total_points = 0
# #     if contrib_res.status_code == 200 and contrib_res.json():
# #         cdata = contrib_res.json()
# #         current_total_points = cdata.get("totalPoints", 0)

# #     # Calculate updated state based on toggle
# #     new_games = current_games + (1 if increment_games else 0)
# #     new_day_count = current_day_count + (1 if increment_games else 0)
# #     new_best = max(current_best, points_scored)
# #     new_total_points = current_total_points + points_scored
# #     now_ms = int(time.time() * 1000)

# #     # Step D: Construct Payload
# #     atomic_payload = {
# #         f"sections/{SECTION}/totalPoints": {".sv": {"increment": points_scored}},
# #         f"players/{USER_ID}": {
# #             "name": USER_NAME,
# #             "section": SECTION,
# #             "best": new_best,
# #             "games": new_games,
# #             "updatedAt": now_ms,
# #             "lastGameAt": {".sv": "timestamp"},
# #             "day": 20739,
# #             "dayCount": new_day_count
# #         },
# #         f"contrib/{SECTION}/{USER_ID}": {
# #             "name": USER_NAME,
# #             "totalPoints": new_total_points,
# #             "games": new_games,
# #             "best": new_best,
# #             "updatedAt": now_ms
# #         }
# #     }

# #     # Optionally increment section total games
# #     if increment_games:
# #         atomic_payload[f"sections/{SECTION}/games"] = {".sv": {"increment": 1}}

# #     # Step E: Send PATCH Request
# #     target_url = f"{BASE_DB_URL}/high-basketball.json"
# #     response = requests.patch(target_url, params=params, json=atomic_payload)

# #     if response.status_code == 200:
# #         print(f"Success! Points added: +{points_scored} | Increment Games: {increment_games}")
# #         print("Updated Payload:", response.json())
# #     else:
# #         print(f"Update failed ({response.status_code}): {response.text}")

# # if __name__ == "__main__":
# #     # TOGGLES
# #     INCREMENT_GAMES = True  # Set to True to increment game counts, or False for points only
# #     NUM_RUNS = 1            # Number of iterations

# #     for i in range(NUM_RUNS):
# #         score = get_weighted_random_points()
# #         print(f"Generated Score: {score}")
# #         send_game_score(points_scored=score, increment_games=INCREMENT_GAMES)
# #         if i < NUM_RUNS - 1:
# #             time.sleep(5)
