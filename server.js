const http = require('http');
const fs = require('fs');
const path = require('path');
const { URL } = require('url');
const { buildDashboardPayload } = require('./src/dashboard');
const { updateNormalizedMarket, updateMarketPair, createManualInput } = require('./src/storage');
const { impliedProbability } = require('./src/math');

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

async function handleApi(req, res, pathname) {
  if (req.method === 'GET' && pathname === '/api/health') {
    return sendJson(res, 200, { ok: true, service: 'prediction-arb-dashboard' });
  }

  if (req.method === 'GET' && pathname === '/api/data') {
    return sendJson(res, 200, await buildDashboardPayload());
  }

  if (req.method === 'POST' && pathname === '/api/refresh') {
    return sendJson(res, 200, await buildDashboardPayload());
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

    const updated = updateNormalizedMarket(bookmakerMarketId, (market) => {
      market.edited_decimal_odds = edited;
      market.effective_decimal_odds = edited ?? market.captured_decimal_odds ?? null;
      market.implied_prob = impliedProbability(market.effective_decimal_odds);
      market.limit_notes = payload.limit_notes || market.limit_notes || '';
      return market;
    });

    return sendJson(res, 200, { ok: true, updated });
  }

  const pairPricesMatch = pathname.match(/^\/api\/pairs\/([^/]+)\/prices$/);
  if (req.method === 'POST' && pairPricesMatch) {
    const pairId = decodeURIComponent(pairPricesMatch[1]);
    const payload = await readBody(req);
    const toNullableNumber = (value) => (value === '' || value == null ? null : Number(value));

    const updated = updateMarketPair(pairId, (pair) => ({
      ...pair,
      poly_no_market_override: toNullableNumber(payload.poly_no_market_override),
      poly_no_limit_override: toNullableNumber(payload.poly_no_limit_override),
      poly_no_easy_override: toNullableNumber(payload.poly_no_easy_override),
    }));

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
        return await handleApi(req, res, pathname);
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
