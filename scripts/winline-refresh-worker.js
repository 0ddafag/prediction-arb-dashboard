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

async function runRequest(request) {
  console.log(`[${WORKER_ID}] running request ${request.id}`);
  try {
    const { stdout, stderr } = await execFileAsync('npm', ['run', 'winline:feed'], {
      cwd: process.cwd(),
      env: process.env,
      maxBuffer: 2 * 1024 * 1024,
    });
    const result = parseResult(stdout);
    await completeWinlineRefresh(request.id, 'succeeded', { result });
    console.log(`[${WORKER_ID}] request ${request.id} succeeded${stderr ? `: ${stderr.trim().slice(-500)}` : ''}`);
  } catch (error) {
    const result = parseResult(error.stdout);
    const message = String(error.stderr || error.message || 'Winline feed failed').trim().slice(-8_000);
    await completeWinlineRefresh(request.id, 'failed', { result, error: message });
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
