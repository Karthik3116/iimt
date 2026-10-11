from playwright.sync_api import sync_playwright
import time

def get_clean_assignments(username, password, section_id):
    raw_api_data = None

    with sync_playwright() as p:
        # Run invisibly in the background
        browser = p.chromium.launch(headless=True) 
        context = browser.new_context(
            user_agent="Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
            viewport={'width': 1920, 'height': 1080}
        )
        page = context.new_page()
        
        # Native Stealth
        page.add_init_script("""
            Object.defineProperty(navigator, 'webdriver', {
                get: () => undefined
            });
        """)

        try:
            print("Logging into McGraw Hill...")
            page.goto("https://accounts.mheducation.com/login")
            page.wait_for_load_state("networkidle")
            
            page.wait_for_selector("input[type='email']", timeout=15000)
            page.type("input[type='email']", username, delay=50)
            page.type("input[type='password']", password, delay=50)
            
            with page.expect_navigation(timeout=30000):
                page.click("button:has-text('Sign In')")
            
            page.wait_for_load_state("networkidle")
            time.sleep(3) 

            print("Fetching assignments...")
            class_url = f"https://newconnect.mheducation.com/student/class/section/{section_id}"
            
            # Actively wait for the specific API response that contains "studentAssignments"
            with page.expect_response(lambda response: "studentAssignments" in response.url and response.status == 200, timeout=30000) as response_info:
                page.goto(class_url, wait_until="domcontentloaded") 
            
            # Safely extract the JSON immediately while the browser is still open
            raw_api_data = response_info.value.json()

        except Exception as e:
            print(f"Browser automation error: {e}")
        finally:
            browser.close()

    # --- Parse and Print the Data ---
    if raw_api_data and "sectionAssignments" in raw_api_data:
        print("\n--- YOUR ASSIGNMENTS ---")
        
        course_details = {}
        for assignment in raw_api_data.get('sectionAssignments', []):
            course_details[assignment['id']] = {
                "name": assignment.get('name', 'Unknown'),
                "due": assignment.get('endDateTime', 'No due date')
            }

        for student_status in raw_api_data.get('studentAssignments', []):
            assignment_id = student_status.get('sectionAssignment')
            status = student_status.get('status', 'UNKNOWN')
            
            details = course_details.get(assignment_id)
            
            if details:
                # Format the due date string cleanly
                due_date_clean = details['due'].replace("T", " ")[:16]
                
                # --- NEW FILTER APPLIED HERE ---
                if due_date_clean >= "2026-10-11":
                    print(f"Status: {status.ljust(10)} | Due: {due_date_clean} | Name: {details['name']}")
    else:
        print("\nFailed to capture the assignment data. The network request timed out or the data structure changed.")

if __name__ == "__main__":
    USER_EMAIL = "kartheek.p26030@iimtrichy.ac.in"
    USER_PASSWORD = "Karthik926464#" 
    SECTION_ID = "157468169"
    
    get_clean_assignments(USER_EMAIL, USER_PASSWORD, SECTION_ID)
