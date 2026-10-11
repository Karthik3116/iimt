from datetime import datetime, timedelta
import requests

def main():
    print("=== IIM Trichy Brain Bubbles Booker ===")
    
    # Default User Information
    email = input("Enter email [default: kartheek.p26030@iimtrichy.ac.in]: ").strip() or "kartheek.p26030@iimtrichy.ac.in"
    name = input("Enter name [default: kartheek]: ").strip() or "kartheek"
    mobile = input("Enter mobile [default: 9063492573]: ").strip() or "9063492573"

    # 1. Select Room (BB-1 to BB-8 mapped to index 0 to 7)
    print("\nSelect Brain Bubble Room:")
    print("1: BB-1 (Reserved Physically Challenged)")
    print("2: BB-2 (Big Smart TV)")
    print("3: BB-3 (Square table, 1 computer)")
    print("4: BB-4 (Round table, 1 computer)")
    print("5: BB-5 (Board, power sockets)")
    print("6: BB-6 (Pedestal drawer, power sockets)")
    print("7: BB-7 (Square table, power sockets)")
    print("8: BB-8 (Board, computer table)")
    
    bb_choice = int(input("Choose Room Number (1-8): ").strip())
    bb_index = bb_choice - 1  # Backend uses 0-based indexing for room selection
    
    # 2. Select Date
    print("\nSelect Booking Date:")
    print("1: Today")
    print("2: Tomorrow")
    date_choice = int(input("Choose Option (1 or 2): ").strip())
    
    target_date = datetime.now().date()
    if date_choice == 2:
        target_date += timedelta(days=1)
    
    date_str = target_date.strftime("%Y-%m-%d")

    # 3. Select Start Time and Duration
    print("\nEnter start hour in 24-hour format (e.g., 10 for 10 AM, 19 for 7 PM, 22 for 10 PM):")
    start_hour = int(input("Start hour (10 to 23): ").strip())
    num_slots = int(input("How many consecutive 1-hour slots?: ").strip())

    # Build the formatted selection string
    slots = []
    for i in range(num_slots):
        h1 = start_hour + i
        h2 = h1 + 1
        # Format: YYYY-MM-DD HH:MM/HH:MM <room_index> 1
        slots.append(f"{date_str} {h1:02d}:00/{h2:02d}:00 {bb_index} 1")
    
    selection_str = ";".join(slots)
    print(f"\n[+] Generated Selection payload: {selection_str}")

    # 4. HTTP Session Execution
    session = requests.Session()
    base_url = "https://library.iimtrichy.ac.in/brain-bubbles/"
    headers = {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
        "Content-Type": "application/x-www-form-urlencoded",
        "Referer": base_url
    }

    # Step 1: Validate Limits (GET Request)
    validate_params = {
        "form": "21",
        "sel": selection_str,
        "cpapphb_validate_limits": email
    }
    
    print("\n[1/2] Sending validation check...")
    val_res = session.get(base_url, params=validate_params, headers=headers)
    print(f"Validation Response Status: {val_res.status_code}")

    # Step 2: Submit Booking (POST Request)
    payload = {
        "cp_pform_psequence": "_1",
        "cp_appbooking_pform_process": "1",
        "cp_appbooking_id": "21",
        "cp_ref_page": base_url,
        "form_structure_1": "",
        "refpage_1": base_url,
        "cp_appbooking_pform_status": "1",
        "anonce": "3e6babeec4", # Update this nonce if the token expires on the site
        "fieldname1_1": selection_str,
        "fieldname1_1_services": str(bb_index),
        "fieldname1_1_capacity": "1;1;1;1;1;1;1;1",
        "tcostfieldname1_1": "0.00",
        "fieldname3_1": name,
        "email_1": email,
        "fieldname11_1": mobile,
        
    }

    print("[2/2] Submitting booking payload...")
    post_res = session.post(base_url, data=payload, headers=headers)

    if post_res.status_code == 200:
        print("\n🎉 SUCCESS! Booking request completed.")
    else:
        print(f"\n❌ FAILED with status code: {post_res.status_code}")

if __name__ == "__main__":
    main()

# import requests

# def submit_booking():
#     session = requests.Session()
    
#     # Target URLs
#     base_url = "https://library.iimtrichy.ac.in/brain-bubbles/"
    
#     # 1. Selection Data
#     email = "test.p25130@iimtrichy.ac.in"
    
#     # UPDATED FOR 07:00 PM - 08:00 PM (19:00 to 20:00)
#     selection = "2026-10-03 22:00/23:00 2 1"
    
#     # 2. Validate limits (GET Request)
#     validate_params = {
#         "form": "21",
#         "sel": selection,
#         "cpapphb_validate_limits": email
#     }
    
#     print("Validating booking limits...")
#     session.get(base_url, params=validate_params)
    
#     # 3. Submit Booking (POST Request)
#     payload = {
#         "cp_pform_psequence": "_1",
#         "cp_appbooking_pform_process": "1",
#         "cp_appbooking_id": "21",
#         "cp_ref_page": base_url,
#         "form_structure_1": "",
#         "refpage_1": base_url,
#         "cp_appbooking_pform_status": "1",
#         # "anonce": "3e6babeec4", # Remember to update this token if it expires
#         "fieldname1_1": selection,
#         "fieldname1_1_services": "0",
#         "fieldname1_1_capacity": "1;1;1;1;1;1;1;1",
#         "tcostfieldname1_1": "0.00",
#         "fieldname3_1": "test",             # Name
#         "email_1": email,                   # Email
#         "fieldname11_1": "1234567890",      # Mobile
        
#         # Add the remaining fields below if they are required by the server:
#         # "fieldnameX_1": "Student",  (Category)
#         # "fieldnameY_1": "251300",   (Roll Number)
#         # "fieldnameZ_1": "2"         (Team Members)
#     }
    
#     headers = {
#         "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/117.0.0.0 Safari/537.36",
#         "Content-Type": "application/x-www-form-urlencoded",
#         "Referer": base_url
#     }
    
#     print("Submitting booking form for 07:00 PM - 08:00 PM...")
#     response = session.post(base_url, data=payload, headers=headers)
    
#     if response.status_code == 200:
#         print("Success! Request sent successfully.")
#     else:
#         print(f"Failed with status code: {response.status_code}")

# if __name__ == "__main__":
#     submit_booking()