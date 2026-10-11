from curl_cffi import requests, CurlOpt
from bs4 import BeautifulSoup
from urllib.parse import urljoin, urlparse
from collections import deque

IP = "172.67.195.215"
DOMAIN = "lifinlab.com"
START = "https://lifinlab.com/"

session = requests.Session()

visited = set()
queue = deque([START])


def fetch(url):
    parsed = urlparse(url)

    if parsed.hostname != DOMAIN:
        return None

    return session.get(
        url,
        headers={
            "Host": DOMAIN,
            "User-Agent": "Mozilla/5.0",
        },
        curl_options={
            CurlOpt.RESOLVE: [
                f"{DOMAIN}:443:{IP}"
            ]
        },
        timeout=20,
    )


while queue:

    url = queue.popleft()

    if url in visited:
        continue

    visited.add(url)

    try:
        r = fetch(url)

        if r is None:
            continue

        print(
            f"[{r.status_code}] "
            f"{len(r.content):>8} bytes "
            f"{url}"
        )

        content_type = r.headers.get(
            "content-type",
            ""
        ).lower()

        if "text/html" not in content_type:
            continue

        soup = BeautifulSoup(
            r.text,
            "html.parser"
        )

        for link in soup.find_all("a", href=True):

            next_url = urljoin(
                url,
                link["href"]
            )

            parsed = urlparse(next_url)

            if parsed.hostname == DOMAIN:
                clean = (
                    f"https://{DOMAIN}"
                    f"{parsed.path}"
                )

                if parsed.query:
                    clean += f"?{parsed.query}"

                if clean not in visited:
                    queue.append(clean)

    except Exception as e:

        print(
            "[ERROR]",
            url,
            e
        )

print("\nTotal pages found:", len(visited))

# import socket

# IP = "172.67.195.215"
# PORT = 443

# try:
#     sock = socket.create_connection((IP, PORT), timeout=10)
#     print(f"Connected to {IP}:{PORT}")
#     sock.close()
# except Exception as e:
#     print("Connection failed:", e)