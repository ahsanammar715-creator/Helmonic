import base64
import os
import sys

import websocket


url = os.environ["ACA_EXEC_URL"]
token = os.environ["ACA_EXEC_TOKEN"]

connection = websocket.create_connection(
    url,
    header=[f"Authorization: Bearer {token}"],
    timeout=240,
)

try:
    connection.send_binary(b'\x00\x04{"Width": 120, "Height": 40}')
    stdin_base64 = os.environ.get("ACA_EXEC_STDIN_B64")
    if stdin_base64:
        connection.send_binary(b"\x00\x00" + base64.b64decode(stdin_base64))
    while True:
        response = connection.recv()
        if not response:
            break
        if isinstance(response, str):
            print(response, end="", flush=True)
            continue
        if response[0] == 1:
            print(response[1:].decode("utf-8", errors="replace"), flush=True)
            continue
        if response[0] == 2:
            print(response[1:].decode("utf-8", errors="replace"), file=sys.stderr, flush=True)
            continue
        if len(response) > 2 and response[0] == 0 and response[1] in (1, 2):
            stream = sys.stdout if response[1] == 1 else sys.stderr
            print(response[2:].decode("utf-8", errors="replace"), end="", file=stream, flush=True)
finally:
    connection.close()
