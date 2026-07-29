#!/usr/bin/env python3
import json
import os
import subprocess
import time
from http.server import BaseHTTPRequestHandler, HTTPServer
from pathlib import Path

HOST = os.environ.get('WINLINE_WEBHOOK_HOST', '0.0.0.0')
PORT = int(os.environ.get('WINLINE_WEBHOOK_PORT', '8787'))
TOKEN = os.environ.get('WINLINE_WEBHOOK_TOKEN', '')
APP_DIR = os.environ.get('WINLINE_APP_DIR', '/home/test1/prediction-arb-dashboard')
LOG_DIR = Path(APP_DIR) / 'logs'
LOG_DIR.mkdir(parents=True, exist_ok=True)
LOG_FILE = LOG_DIR / 'winline-feed.log'
LOCK_FILE = Path('/tmp/winline-feed-refresh.lock')


def json_response(handler, status, payload):
    body = json.dumps(payload, ensure_ascii=False).encode('utf-8')
    handler.send_response(status)
    handler.send_header('Content-Type', 'application/json; charset=utf-8')
    handler.send_header('Content-Length', str(len(body)))
    handler.end_headers()
    handler.wfile.write(body)


class Handler(BaseHTTPRequestHandler):
    def do_GET(self):
        if self.path == '/health':
            return json_response(self, 200, {'ok': True, 'service': 'winline-webhook'})
        return json_response(self, 404, {'ok': False, 'message': 'not found'})

    def do_POST(self):
        expected = f'Bearer {TOKEN}'
        if self.path != '/winline-refresh' or not TOKEN or self.headers.get('Authorization') != expected:
            return json_response(self, 404, {'ok': False, 'message': 'not found'})

        if LOCK_FILE.exists():
            try:
                age = time.time() - LOCK_FILE.stat().st_mtime
            except OSError:
                age = 0
            if age < 10 * 60:
                return json_response(self, 202, {'accepted': True, 'status': 'already_running'})
            LOCK_FILE.unlink(missing_ok=True)

        env = os.environ.copy()
        cmd = ['npm', 'run', 'winline:feed']
        with LOG_FILE.open('ab') as log:
            log.write(f'\n--- refresh requested {time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())} ---\n'.encode())
            process = subprocess.Popen(
                cmd,
                cwd=APP_DIR,
                env=env,
                stdout=log,
                stderr=subprocess.STDOUT,
                start_new_session=True,
            )
        LOCK_FILE.write_text(str(process.pid))
        subprocess.Popen(
            ['sh', '-c', f'while kill -0 {process.pid} 2>/dev/null; do sleep 2; done; rm -f {LOCK_FILE}'],
            start_new_session=True,
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
        )
        return json_response(self, 202, {'accepted': True, 'status': 'started', 'pid': process.pid})

    def log_message(self, format, *args):
        return


if __name__ == '__main__':
    if not TOKEN:
        raise SystemExit('WINLINE_WEBHOOK_TOKEN is required')
    HTTPServer((HOST, PORT), Handler).serve_forever()
