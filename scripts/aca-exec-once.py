import base64
import os
import sys
import time

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
    stdin_payload = base64.b64decode(stdin_base64) if stdin_base64 else None
    stdin_sent = stdin_payload is None
    output_buffer = ""

    def send_stdin_when_ready():
        global stdin_sent
        if stdin_sent:
            return
        prompt_visible = "> " in output_buffer
        node_banner_complete = 'Type ".help" for more information.' in output_buffer
        if prompt_visible or node_banner_complete:
            # ACA's exec WebSocket sometimes omits Node's visible prompt even
            # though the REPL is ready. The completed Node banner is the next
            # reliable readiness boundary; allow the REPL one scheduling tick
            # before submitting the single command.
            if node_banner_complete and not prompt_visible:
                time.sleep(0.25)
            connection.send_binary(b"\x00\x00" + stdin_payload)
            stdin_sent = True

    while True:
        response = connection.recv()
        if not response:
            break
        if isinstance(response, str):
            print(response, end="", flush=True)
            output_buffer += response
            send_stdin_when_ready()
            continue
        if response[0] == 1:
            text = response[1:].decode("utf-8", errors="replace")
            print(text, flush=True)
            output_buffer += text
            send_stdin_when_ready()
            continue
        if response[0] == 2:
            print(response[1:].decode("utf-8", errors="replace"), file=sys.stderr, flush=True)
            continue
        if len(response) > 2 and response[0] == 0 and response[1] in (1, 2):
            stream = sys.stdout if response[1] == 1 else sys.stderr
            text = response[2:].decode("utf-8", errors="replace")
            print(text, end="", file=stream, flush=True)
            if response[1] == 1:
                output_buffer += text
                send_stdin_when_ready()
finally:
    connection.close()
