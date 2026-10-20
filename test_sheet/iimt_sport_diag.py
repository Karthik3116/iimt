
import requests

# Hardcode your existing credentials here
API_KEY = "AIzaSyDrSyIRPHKG1QYnfFKE5vv_XbRpneMgM04"
REFRESH_TOKEN = "AMf-vBxFYko4Uq_O9zGXMIxB4XvbqePEc0DZ_Lo4iUgt9tjkwR7B8vd7Q-BiHW9Tbphp9mb5v8bJVHfw4Pl1JhNG5N5XLoMAAdANy0MHwlhVdOgKrcLL8Nhv_eiHdvYpG4yQqZyzVfgjpL3-wVvFeRE5DYXl5jOMjopngCs4untOycO0NGj2CKzQPOmbR1wpjnzOu3WJpi9NB0ZzpejcbxjIq_F1hYS7BKihVwtHqQ0KuE8hgRzfKEhupM_icpPPk9UmYCluJDUP5agyYWIWDu2Kxf9B89sS29YPizgKmJhrpelQJsjPepQ5hAIjgalID9ctpV8fcQC4Spfb6qH7RdXsk9GkPPrW0Z5SOY8A7NTLjAJIM1LZ9sRAfbv7t0_SiMB5uTl_FMSGv0ilqpXupxHepXQX023e5qC0YsPJJFnTqyq3YUpwPa0sWtvMSwQrXzDn9iQBXoxn"
USER_ID = "KkVTbSi8GlWXYU5L82tNjaUTmMP2"
USER_NAME = "Suman"
SECTION = "B"

BASE_DB_URL = (
    "https://iimt-sports-arena-default-rtdb."
    "asia-southeast1.firebasedatabase.app"
)


def diagnose():
    with requests.Session() as session:
        response = session.post(
            "https://securetoken.googleapis.com/v1/token",
            params={"key": API_KEY},
            data={
                "grant_type": "refresh_token",
                "refresh_token": REFRESH_TOKEN,
            },
            timeout=20,
        )

        print("Token refresh:", response.status_code)

        if response.status_code != 200:
            print("Authentication response:", response.text[:500])
            return

        data = response.json()
        token = data.get("id_token")

        if not token:
            print("No ID token returned.")
            return

        print("UID matches configured user:",
              data.get("user_id") == USER_ID)

        paths = [
            f"high-basketball/players/{USER_ID}.json",
            f"high-basketball/contrib/{SECTION}/{USER_ID}.json",
        ]

        for path in paths:
            try:
                result = session.get(
                    f"{BASE_DB_URL}/{path}",
                    params={"auth": token},
                    timeout=20,
                )

                print(f"\n{path}")
                print("HTTP:", result.status_code)
                print("Response:", result.text[:500])

            except requests.RequestException as exc:
                print("Request error:", str(exc))


if __name__ == "__main__":
    diagnose()
