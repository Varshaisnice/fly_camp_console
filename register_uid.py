import sys
import time
import sqlite3
from smartcard.System import readers
from smartcard.Exceptions import CardConnectionException, NoCardException
from smartcard.util import toHexString

DB_NAME = 'flycamp_framework.db'

def register_uid(uid):
    conn = sqlite3.connect(DB_NAME)
    cursor = conn.cursor()

    # Check if UID already exists
    # MODIFIED: Changed 'uid' to 'rfid_uid'
    cursor.execute("SELECT token_id FROM RFIDTokens WHERE rfid_uid = ?", (uid,))
    existing = cursor.fetchone()

    if existing:
        print(f"[!] UID {uid} is already registered with Token ID: {existing[0]}")
    else:
        # MODIFIED: Changed 'uid' to 'rfid_uid'
        cursor.execute("INSERT INTO RFIDTokens (rfid_uid) VALUES (?)", (uid,))
        conn.commit()
        token_id = cursor.lastrowid
        print(f"[+] UID {uid} registered with new Token ID: {token_id}")

    conn.close()

def main():
    print("Looking for ACR122U NFC reader...")

    r = readers()
    if len(r) == 0:
        print("No NFC readers found.")
        sys.exit()

    reader = r[0]
    print(f"Using reader: {reader}")

    connection = reader.createConnection()
    last_uid = None

    while True:
        try:
            connection.connect()

            GET_UID = [0xFF, 0xCA, 0x00, 0x00, 0x00]
            data, sw1, sw2 = connection.transmit(GET_UID)

            if sw1 == 0x90 and sw2 == 0x00:
                uid = toHexString(data).replace(" ", "")

                if uid != last_uid:
                    print(f"\n[+] New tag detected! UID: {uid}")
                    register_uid(uid)
                    last_uid = uid
                else:
                    pass

        except (CardConnectionException, NoCardException):
            if last_uid is not None:
                print("[ ] Tag removed.")
                last_uid = None
        except Exception as e:
            print(f"An unexpected error occurred: {e}")
            # It's good to have a general exception handler for long-running scripts
            break # Exit on other errors

        time.sleep(0.5)

if __name__ == "__main__":
    main()
