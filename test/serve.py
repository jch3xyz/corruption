#!/usr/bin/env python3
"""Dev server for the test harness. Serves the repo root with
Cache-Control: no-store so edited modules are never stale in the browser.

Run from anywhere:  python3 test/serve.py   →  http://localhost:8437/test/harness/index.html
"""
import http.server
import os
import sys

PORT = int(sys.argv[1]) if len(sys.argv) > 1 else 8437
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


class NoStoreHandler(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=ROOT, **kwargs)

    def end_headers(self):
        self.send_header('Cache-Control', 'no-store')
        super().end_headers()

    def log_message(self, *args):
        pass  # keep the terminal quiet


if __name__ == '__main__':
    with http.server.ThreadingHTTPServer(('127.0.0.1', PORT), NoStoreHandler) as srv:
        print(f'serving {ROOT} on http://localhost:{PORT} (no-store)')
        srv.serve_forever()
