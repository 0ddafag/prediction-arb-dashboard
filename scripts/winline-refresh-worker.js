const { randomUUID } = require('node:crypto');
const { execFile } = require('node:child_process');
const { promisify } = require('node:util');
const {
  claimPendingWinlineRefresh,
  completeWinlineRefresh,
  initializePostgres,
} = require('../src/storage/postgres-store');

const execFileAsync = promisify(execFile);
const POLL_INTERVAL_MS = Number(process.env.WINLINE_REFRESH_POLL_INTERVAL_MS || 4_000);
const WORKER_ID = process.env.WINLINE_REFRESH_WORKER_ID || `winline-worker-${randomUUID()}`;
let stopping = false;

function parseResult(stdout) {
  const lines = String(stdout || '').trim().split('\n').reverse();
  for (const line of lines) {
    try { return JSON.parse(line); } catch { /* Find the final JSON log line. */ }
  }
  return stdout ? { output: String(stdout).slice(-8_000) } : null;
}

async function runRequest(request, { exec = execFileAsync, complete = completeWinlineRefresh } = {}) {
  console.log(`[${WORKER_ID}] running request ${request.id}`);
  try {
    const sources = {};
    let failed = false;
    for (const source of ['winline', 'fonbet']) {
      try {
        const { stdout, stderr } = await exec('npm', ['run', `${source}:feed`], {
          cwd: process.cwd(),
          env: process.env,
          maxBuffer: 2 * 1024 * 1024,
        });
        sources[source] = { ...parseResult(stdout), stderr: stderr?.trim() || undefined };
      } catch (error) {
        failed = true;
        sources[source] = { ...parseResult(error.stdout), status: 'error', error: String(error.stderr || error.message).trim().slice(-8_000) };
      }
    }
    await complete(request.id, failed ? 'failed' : 'succeeded', {
      result: { sources },
      error: failed ? 'One or more source feeds failed' : null,
    });
    console.log(`[${WORKER_ID}] request ${request.id} ${failed ? 'failed' : 'succeeded'}`);
  } catch (error) {
    const message = String(error.message || 'Refresh worker failed').trim().slice(-8_000);
    await complete(request.id, 'failed', { error: message });
    console.error(`[${WORKER_ID}] request ${request.id} failed: ${message}`);
  }
}

async function main() {
  if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is required for the Winline refresh worker');
  await initializePostgres();
  console.log(`[${WORKER_ID}] polling every ${POLL_INTERVAL_MS}ms`);
  while (!stopping) {
    const request = await claimPendingWinlineRefresh(WORKER_ID);
    if (request) await runRequest(request);
    else await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
  }
}

for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, () => { stopping = true; });

if (require.main === module) {
  main().catch((error) => {
    console.error(`[${WORKER_ID}] fatal: ${error.message}`);
    process.exitCode = 1;
  });
}

module.exports = { parseResult, runRequest };
