import os
import pickle
import io
from googleapiclient.discovery import build
from googleapiclient.http import MediaIoBaseDownload
from google_auth_oauthlib.flow import InstalledAppFlow
from google.auth.transport.requests import Request

# Using the Drive scope you already authorized
SCOPES = ['https://www.googleapis.com/auth/drive']

def authenticate_drive():
    creds = None
    if os.path.exists('token.pickle'):
        with open('token.pickle', 'rb') as token:
            creds = pickle.load(token)
            
    if not creds or not creds.valid:
        if creds and creds.expired and creds.refresh_token:
            creds.refresh(Request())
        else:
            flow = InstalledAppFlow.from_client_secrets_file('credentials.json', SCOPES)
            creds = flow.run_local_server(port=0)
        with open('token.pickle', 'wb') as token:
            pickle.dump(creds, token)
            
    return creds


def main():
    print("Authenticating using saved token...")
    creds = authenticate_drive()
    service = build('drive', 'v3', credentials=creds)
    file_id = '1-8A3GXCBJD-zRoCYRnhIXzMEjqsrqsU0'
    
    # The name of the file that will be saved on your computer
    output_filename = 'Exact_Replica_Schedule.xlsx'
    
    try:
        print(f"Downloading live Excel file from Google Drive...")
        request = service.files().get_media(fileId=file_id)
        
        # Open a local file in write-binary ('wb') mode
        with open(output_filename, 'wb') as fh:
            downloader = MediaIoBaseDownload(fh, request)
            done = False
            while not done:
                status, done = downloader.next_chunk()
                print(f"Download {int(status.progress() * 100)}% complete...")
                
        print(f"\n✅ SUCCESS: The exact replica has been saved as '{output_filename}' in your test_sheet folder!")
        print("You can now open it in Microsoft Excel and all colors and tabs will be preserved perfectly.")
        
    except Exception as e:
        print("\nAn error occurred:")
        print(e)

if __name__ == '__main__':
    main()


