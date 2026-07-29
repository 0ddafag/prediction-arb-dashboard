const http = require('http');
const fs = require('fs');
const path = require('path');
const { URL } = require('url');
const { buildDashboardPayload, buildOpportunitiesPayload } = require('./src/dashboard');
const {
  updateNormalizedMarket,
  updateMarketPair,
  updateLiveBookmakerOverride,
  updateLivePairOverride,
  createManualInput,
} = require('./src/storage');
const { impliedProbability } = require('./src/math');
const storage = require('./src/storage/postgres-store');
const { getPersistentState, upsertSetting, upsertOverride } = storage;

const PORT = Number(process.env.PORT || 4173);
const PUBLIC_DIR = path.join(__dirname, 'public');

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.svg': 'image/svg+xml',
};

function sendJson(res, status, payload) {
  const body = JSON.stringify(payload, null, 2);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
  });
  res.end(body);
}

function notFound(res) {
  res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
  res.end('Not found');
}

function serveStatic(res, pathname) {
  const requested = pathname === '/' ? '/index.html' : pathname;
  const filePath = path.join(PUBLIC_DIR, requested);
  if (!filePath.startsWith(PUBLIC_DIR) || !fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) {
    return notFound(res);
  }
  const ext = path.extname(filePath);
  res.writeHead(200, {
    'Content-Type': MIME[ext] || 'application/octet-stream',
    'Cache-Control': ext === '.html' ? 'no-store' : 'public, max-age=60',
  });
  fs.createReadStream(filePath).pipe(res);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let raw = '';
    req.on('data', (chunk) => {
      raw += chunk;
      if (raw.length > 1_000_000) {
        reject(new Error('Request body too large'));
      }
    });
    req.on('end', () => {
      if (!raw) return resolve({});
      try {
        resolve(JSON.parse(raw));
      } catch (error) {
        reject(new Error('Invalid JSON body'));
      }
    });
    req.on('error', reject);
  });
}

const WINLINE_WEBHOOK_TIMEOUT_MS = 8_000;
const WINLINE_RESPONSE_LIMIT = 64 * 1024;

async function triggerWinlineCollector() {
  const webhookUrl = process.env.WINLINE_COLLECTOR_WEBHOOK_URL;
  if (!webhookUrl) {
    if (storage.isPostgresConfigured()) {
      const request = await storage.enqueueWinlineRefresh();
      return {
        status: 202,
        payload: {
          ok: true,
          status: 'queued',
          message: 'Book refresh queued',
          request_id: request?.id,
          request: request ? {
            id: request.id,
            status: request.status,
            requested_at: request.requested_at,
          } : null,
        },
      };
    }
    return {
      status: 501,
      payload: {
        ok: false,
        status: 'not_configured',
        message: 'Winline manual refresh is not configured',
      },
    };
  }

  const headers = { Accept: 'application/json, text/plain' };
  if (process.env.WINLINE_COLLECTOR_WEBHOOK_TOKEN) {
    headers.Authorization = `Bearer ${process.env.WINLINE_COLLECTOR_WEBHOOK_TOKEN}`;
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), WINLINE_WEBHOOK_TIMEOUT_MS);
  try {
    const response = await fetch(webhookUrl, {
      method: 'POST',
      headers,
      signal: controller.signal,
    });
    const rawBody = await response.text();
    const bodyText = rawBody.slice(0, WINLINE_RESPONSE_LIMIT);
    let body = bodyText;
    try {
      body = JSON.parse(bodyText);
    } catch {
      // Keep a bounded plain-text response when the collector does not return JSON.
    }

    if (!response.ok) {
      return {
        status: 502,
        payload: {
          ok: false,
          status: 'error',
          message: `Winline collector returned HTTP ${response.status}`,
          collector: { status: response.status, body },
        },
      };
    }

    return {
      status: 200,
      payload: {
        ok: true,
        status: 'success',
        message: 'Winline collector refresh triggered',
        collector: { status: response.status, body },
      },
    };
  } catch (error) {
    const message = error.name === 'AbortError'
      ? 'Winline collector request timed out'
      : 'Winline collector request failed';
    if (storage.isPostgresConfigured()) {
      const request = await storage.enqueueWinlineRefresh();
      return {
        status: 202,
        payload: {
          ok: true,
          status: 'queued',
          message: 'Book refresh queued after collector webhook failure',
          request_id: request?.id,
          request: request ? {
            id: request.id,
            status: request.status,
            requested_at: request.requested_at,
          } : null,
          collector_error: message,
        },
      };
    }
    return {
      status: 502,
      payload: { ok: false, status: 'error', message },
    };
  } finally {
    clearTimeout(timeout);
  }
}

function safeRefreshResult(result) {
  if (!result || typeof result !== 'object') return null;
  const sources = result.sources && typeof result.sources === 'object' ? result.sources : {};
  return {
    sources: Object.fromEntries(Object.entries(sources).map(([source, details]) => {
      const summary = { status: details?.status || null };
      for (const key of ['captured_at', 'candidate_count', 'mapped_pairs', 'keys']) {
        if (details?.[key] != null) summary[key] = details[key];
      }
      if (Array.isArray(details?.sports)) summary.sports = details.sports;
      return [source, summary];
    })),
  };
}

function safeRefreshRequest(request) {
  if (!request) return null;
  return {
    id: request.id,
    status: request.status,
    requested_at: request.requested_at,
    started_at: request.started_at || null,
    finished_at: request.finished_at || null,
    error: request.error || null,
    result: safeRefreshResult(request.result),
  };
}

async function handleApi(req, res, pathname, searchParams = new URLSearchParams()) {
  if (req.method === 'GET' && pathname === '/api/health') {
    return sendJson(res, 200, { ok: true, service: 'prediction-arb-dashboard' });
  }

  if (req.method === 'GET' && pathname === '/api/state') {
    return sendJson(res, 200, await getPersistentState());
  }

  if (req.method === 'POST' && pathname === '/api/state/settings') {
    const payload = await readBody(req);
    if (!payload.key) return sendJson(res, 400, { error: 'key is required' });
    return sendJson(res, 200, { ok: true, updated: await upsertSetting(String(payload.key), payload.value) });
  }

  if (req.method === 'POST' && pathname === '/api/state/overrides') {
    const payload = await readBody(req);
    const rowId = payload.row_id || payload.rowId;
    const targetType = payload.target_type || payload.targetType || 'dashboard_row';
    return sendJson(res, 200, { ok: true, updated: await upsertOverride({ rowId, targetType, override: payload.override || {} }) });
  }

  if (req.method === 'GET' && pathname === '/api/data') {
    return sendJson(res, 200, await buildDashboardPayload());
  }
  const refreshStatusMatch = pathname.match(/^\/api\/books\/refresh(?:\/(status|\d+))?$/);
  if (req.method === 'GET' && refreshStatusMatch) {
    if (!storage.isPostgresConfigured()) {
      return sendJson(res, 200, { ok: true, status: 'not_configured', request: null });
    }
    const request = refreshStatusMatch[1] && refreshStatusMatch[1] !== 'status'
      ? await storage.getWinlineRefreshRequest(Number(refreshStatusMatch[1]))
      : await storage.getLatestWinlineRefreshRequest();
    return sendJson(res, 200, {
      ok: true,
      status: request ? request.status : 'no_state',
      request: safeRefreshRequest(request),
    });
  }
  if (req.method === 'GET' && pathname === '/api/opportunities') {
    return sendJson(res, 200, await buildOpportunitiesPayload({
      sport: searchParams.get('sport'),
      bookmaker: searchParams.get('bookmaker'),
      view: searchParams.get('view'),
    }));
  }

  if (req.method === 'POST' && pathname === '/api/refresh') {
    return sendJson(res, 200, await buildDashboardPayload());
  }

  if (req.method === 'POST' && (pathname === '/api/winline/refresh' || pathname === '/api/books/refresh')) {
    const result = await triggerWinlineCollector();
    return sendJson(res, result.status, result.payload);
  }

  if (req.method === 'POST' && pathname === '/api/manual-inputs') {
    const payload = await readBody(req);
    const created = createManualInput(payload);
    return sendJson(res, 201, { ok: true, created });
  }

  const oddsMatch = pathname.match(/^\/api\/markets\/([^/]+)\/odds$/);
  if (req.method === 'POST' && oddsMatch) {
    const bookmakerMarketId = decodeURIComponent(oddsMatch[1]);
    const payload = await readBody(req);
    const edited = payload.edited_decimal_odds === '' || payload.edited_decimal_odds == null
      ? null
      : Number(payload.edited_decimal_odds);

    const isLive = bookmakerMarketId.startsWith('bm-live-fonbet-') || bookmakerMarketId.startsWith('bm-live-winline-');
    const updated = isLive
      ? updateLiveBookmakerOverride(bookmakerMarketId, edited)
      : updateNormalizedMarket(bookmakerMarketId, (market) => {
        market.edited_decimal_odds = edited;
        market.effective_decimal_odds = edited ?? market.captured_decimal_odds ?? null;
        market.implied_prob = impliedProbability(market.effective_decimal_odds);
        market.limit_notes = payload.limit_notes || market.limit_notes || '';
        return market;
      });
    await upsertOverride({
      rowId: bookmakerMarketId,
      targetType: 'bookmaker_market',
      override: { edited_decimal_odds: edited, limit_notes: payload.limit_notes || null },
    });

    return sendJson(res, 200, { ok: true, updated });
  }

  const pairPricesMatch = pathname.match(/^\/api\/pairs\/([^/]+)\/prices$/);
  if (req.method === 'POST' && pairPricesMatch) {
    const pairId = decodeURIComponent(pairPricesMatch[1]);
    const payload = await readBody(req);
    const toNullableNumber = (value) => (value === '' || value == null ? null : Number(value));

    const values = {
      poly_no_market_override: toNullableNumber(payload.poly_no_market_override),
      poly_no_limit_override: toNullableNumber(payload.poly_no_limit_override),
      poly_no_easy_override: toNullableNumber(payload.poly_no_easy_override),
    };
    const isLive = pairId.startsWith('pair-live-fonbet-') || pairId.startsWith('pair-live-winline-');
    const updated = isLive
      ? updateLivePairOverride(pairId, values)
      : updateMarketPair(pairId, (pair) => ({ ...pair, ...values }));
    await upsertOverride({ rowId: pairId, targetType: 'market_pair', override: values });

    return sendJson(res, 200, { ok: true, updated });
  }

  return notFound(res);
}

function createServer() {
  return http.createServer(async (req, res) => {
    try {
      const url = new URL(req.url, `http://${req.headers.host}`);
      const pathname = decodeURIComponent(url.pathname);
      if (pathname.startsWith('/api/')) {
        return await handleApi(req, res, pathname, url.searchParams);
      }
      return serveStatic(res, pathname);
    } catch (error) {
      return sendJson(res, 500, { error: error.message });
    }
  });
}

if (require.main === module) {
  const server = createServer();
  server.listen(PORT, () => {
    console.log(`Prediction arb dashboard running at http://localhost:${PORT}`);
  });
}

module.exports = { createServer };
