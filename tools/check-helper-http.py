#!/usr/bin/env python3
"""Read-only checks against a running helper. Never pair or request with a token."""
import http.client
import json
import socket
import argparse
from pathlib import Path
from datetime import datetime, timezone


def request(path, expected, headers=None, method="GET"):
    connection = http.client.HTTPConnection("127.0.0.1", 17643, timeout=4)
    values = {"X-Doubao-Bob-Client": "bob-plugin-v1"}
    values.update(headers or {})
    connection.request(method, path, headers=values)
    response = connection.getresponse()
    body = response.read()
    assert response.status == expected, (path, response.status)
    assert response.getheader("Cache-Control") == "no-store"
    assert response.getheader("Access-Control-Allow-Origin") is None
    data = json.loads(body)
    assert "cookie" not in data and "token" not in data
    connection.close()


request("/health", 200)
request("/v1/session", 401)
request("/health", 403, {"Origin": "https://example.invalid"})
request("/health", 403, {"Origin": "null"})
request("/health", 403, {"Sec-Fetch-Site": "cross-site"})
request("/health", 403, {"Host": "evil.example"})
request("/v1/session", 403, {"Origin": "https://example.invalid"}, "OPTIONS")
with socket.create_connection(("127.0.0.1", 17643), timeout=4) as connection:
    connection.sendall(
        b"GET /health HTTP/1.1\r\nHost: 127.0.0.1:17643\r\n"
        b"X-Doubao-Bob-Client: bob-plugin-v1\r\nContent-Length: 0\r\nContent-Length: 0\r\n\r\n"
    )
    assert connection.recv(1024).startswith(b"HTTP/1.1 400 ")
print("Running helper HTTP protection checks: 8 passed; no pairing or credentials used.")
parser = argparse.ArgumentParser()
parser.add_argument("--output", type=Path)
args = parser.parse_args()
if args.output:
    args.output.write_text(json.dumps({
        "checksPassed": 8,
        "observedAt": datetime.now(timezone.utc).isoformat(),
        "credentialsUsed": False,
        "pairingPerformed": False,
    }, indent=2) + "\n")
