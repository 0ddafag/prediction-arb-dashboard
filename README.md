# prediction-arb-dashboard

Node dashboard for comparing bookmaker odds against Polymarket NO-side hedges. The current MVP is intentionally manual-first: it supports screenshot/manual intake, editable bookmaker odds, manual pair overrides, and a live sandbox calculator.

## What is included

- Live Polymarket fetch for mapped markets and featured rows
- Screenshot/manual bookmaker intake queue
- Editable `captured_odds` / `edited_odds` / `scenario_odds`
- Manual row creation from the UI
- File-backed store in `data/store.json`
- Health endpoint for deploys: `GET /api/health`
- Basic smoke tests with Node's built-in test runner

## Local run

```bash
cd /home/test1/prediction-arb-dashboard
npm test
PORT=4173 npm start
```

Then open `http://127.0.0.1:4173/`.

## Environment

- `PORT` — HTTP port, default `4173`
- `POLYMARKET_TIMEOUT_MS` — upstream timeout for Polymarket requests, default `10000`
- `WINLINE_COLLECTOR_WEBHOOK_URL` — optional on-demand collector endpoint. If absent, the dashboard button reports `not configured` and does not fake a data reload.
- `WINLINE_COLLECTOR_WEBHOOK_TOKEN` — optional Bearer token sent to the collector endpoint; never returned or logged by the dashboard.

### Manual Winline refresh

The dashboard's `Refresh` button only reloads `/api/data`. `Refresh Winline` first sends `POST` to `WINLINE_COLLECTOR_WEBHOOK_URL`; the external collector is responsible for running Playwright and writing the Winline snapshot to Neon. Render never runs the Winline collector. On a successful trigger, the browser reloads `/api/data` and displays the latest available snapshot.

To enable this later, set these Render environment variables:

```text
WINLINE_COLLECTOR_WEBHOOK_URL=https://your-vps.example/winline-refresh
WINLINE_COLLECTOR_WEBHOOK_TOKEN=<long-random-token>
```

Without the webhook URL, the button honestly shows `not configured`.

A simple VPS wrapper can be a small token-checking HTTP server that runs the existing collector command on demand (no timer or systemd job). For example, save this as `/opt/prediction-arb-dashboard/winline-webhook.py`, set `WINLINE_WEBHOOK_TOKEN` and `WINLINE_APP_DIR`, then run it in the foreground with `python3 /opt/prediction-arb-dashboard/winline-webhook.py`:

```python
import os, subprocess
from http.server import BaseHTTPRequestHandler, HTTPServer

class Handler(BaseHTTPRequestHandler):
    def do_POST(self):
        if self.path != '/winline-refresh' or self.headers.get('Authorization') != f"Bearer {os.environ['WINLINE_WEBHOOK_TOKEN']}":
            self.send_response(404); self.end_headers(); return
        subprocess.Popen(['npm', 'run', 'winline:feed'], cwd=os.environ['WINLINE_APP_DIR'], start_new_session=True)
        self.send_response(202); self.end_headers(); self.wfile.write(b'{"accepted":true}')
    def log_message(self, *_): pass

HTTPServer(('127.0.0.1', 8787), Handler).serve_forever()
```

Put this behind the VPS reverse proxy at `https://your-vps.example/winline-refresh`. The command runs only when the dashboard button calls it; do not add a cron/systemd timer for this MVP.


### Recommended: Render

This project is a long-running Node server with mutable local state (`data/store.json`). Between Render and Vercel, Render is the better default because:

- it runs the app as a normal Node web service instead of serverless functions
- health checks and always-on API routes map directly to the current architecture
- moving from JSON storage to SQLite/Postgres later is straightforward

`render.yaml` is included for a one-click-ish GitHub-connected deploy.

### Why not Vercel first

Vercel is great for static frontends and stateless functions, but this app currently writes manual edits/intake into a local JSON file. That is a bad fit for Vercel's ephemeral/serverless execution model. To make Vercel the right target, the storage layer should be moved to a real external database first.

## Production caveat

Current persistence is file-based. That is acceptable for MVP demos, but for production you should migrate `data/store.json` to SQLite/Postgres/Supabase before relying on manual edits as durable data.

## Render deploy flow

1. Push this repo to GitHub.
2. In Render, create a new **Web Service** from the GitHub repo.
3. Render will detect `render.yaml`.
4. Confirm the service settings and deploy.
5. Verify `GET /api/health` and the dashboard UI.

## GitHub

Suggested repository name: `prediction-arb-dashboard`
