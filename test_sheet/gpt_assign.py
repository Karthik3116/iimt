import json
import re
import sys
from playwright.sync_api import sync_playwright, TimeoutError as PlaywrightTimeoutError

ASSIGNMENTS_URL = (
    "https://newconnect.mheducation.com/student/class/section/157468169"
)

# Reuse the profile from the previous script, including saved login cookies.
PROFILE_DIR = "./mheducation_profile"


def extract_assignments(page):
    return page.evaluate("""
    () => {
        const hasDates = el => {
            const text = el.innerText || "";
            return /Start:/i.test(text) && /Due:/i.test(text);
        };

        const cards = [...document.querySelectorAll("body *")]
            .filter(el => hasDates(el))
            .filter(el => ![...el.children].some(hasDates));

        const results = [];
        const seen = new Set();

        for (const card of cards) {
            const text = (card.innerText || "").trim();
            const lines = text.split("\\\\n")
                .map(s => s.trim())
                .filter(Boolean);

            const dates = text.match(
                /Start:\\s*(.*?)\\s+Due:\\s*(.*?)(?=\\\\n|$)/is
            );

            const title = lines.find(
                line => !/\\\\b(Start|Due):/i.test(line) && !line.includes("|")
            );

            if (!title) continue;

            const type = lines.find(
                line => line !== title &&
                    !/\\\\b(Start|Due):/i.test(line) &&
                    !line.includes("|")
            );

            const course = lines.find(line => line.includes("|"));

            const item = {
                title,
                start: dates ? dates[1].trim() : null,
                due: dates ? dates[2].trim() : null,
                type: type || null,
                course_section: course || null
            };

            const key = JSON.stringify(item);
            if (!seen.has(key)) {
                results.push(item);
                seen.add(key);
            }
        }

        return results;
    }
    """)


def main():
    with sync_playwright() as p:
        context = p.chromium.launch_persistent_context(
            user_data_dir=PROFILE_DIR,
            headless=True
        )

        try:
            page = context.pages[0] if context.pages else context.new_page()
            page.goto(
                ASSIGNMENTS_URL,
                wait_until="domcontentloaded",
                timeout=60000
            )
            page.wait_for_timeout(3000)

            # Do not silently return an empty list when the session has expired.
            current_url = page.url.lower()
            page_text = page.locator("body").inner_text(timeout=10000).lower()

            if (
                "accounts.mheducation.com/login" in current_url
                or "sign in" in page_text
                and "assignment" not in page_text
            ):
                print(json.dumps({
                    "error": "Login required. Refresh the saved session first."
                }))
                return

            assignments = extract_assignments(page)
            print(json.dumps(assignments, indent=2, ensure_ascii=False))

        except Exception as exc:
            print(json.dumps({"error": str(exc)}))
            sys.exit(1)

        finally:
            context.close()


if __name__ == "__main__":
    main()