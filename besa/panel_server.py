#!/usr/bin/env python3
"""
panel_server.py
---------------
Tiny HTTP server that:
  - Serves panel.html at http://127.0.0.1:8765/
  - Forwards POST /event?cmd=XXX as UDP to 127.0.0.1:9999

Run:  python3 panel_server.py
Then open:  http://127.0.0.1:8765
"""
import socket, os
from http.server import HTTPServer, BaseHTTPRequestHandler
from urllib.parse import urlparse, parse_qs

UDP_TARGET = ("127.0.0.1", 9999)
HTML_FILE  = os.path.join(os.path.dirname(__file__), "panel.html")
udp = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)

class Handler(BaseHTTPRequestHandler):
    def log_message(self, fmt, *args): pass  # silence access log

    def do_GET(self):
        if self.path == "/" or self.path == "/panel.html":
            try:
                with open(HTML_FILE, "rb") as f:
                    data = f.read()
                self.send_response(200)
                self.send_header("Content-Type", "text/html; charset=utf-8")
                self.send_header("Content-Length", len(data))
                self.end_headers()
                self.wfile.write(data)
            except FileNotFoundError:
                self.send_error(404, "panel.html not found")
        else:
            self.send_error(404)

    def do_POST(self):
        parsed = urlparse(self.path)
        if parsed.path == "/event":
            params = parse_qs(parsed.query)
            cmd = params.get("cmd", [""])[0].strip()
            valid = {"ARM_RIGHT","ARM_LEFT","BLINK_RIGHT","BLINK_LEFT","STARTLE"}
            if cmd in valid:
                udp.sendto(cmd.encode(), UDP_TARGET)
                print(f"[panel] → UDP: {cmd}")
                self.send_response(200)
                self.send_header("Access-Control-Allow-Origin", "*")
                self.end_headers()
                self.wfile.write(b"ok")
            else:
                self.send_error(400, f"Unknown command: {cmd}")
        else:
            self.send_error(404)

    def do_OPTIONS(self):
        self.send_response(200)
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "POST, GET, OPTIONS")
        self.end_headers()

if __name__ == "__main__":
    server = HTTPServer(("127.0.0.1", 8765), Handler)
    print("=" * 50)
    print(" ActiveThree Event Panel Server")
    print(" Open: http://127.0.0.1:8765")
    print(" UDP target: 127.0.0.1:9999")
    print(" Ctrl+C to stop")
    print("=" * 50)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\nStopped.")
