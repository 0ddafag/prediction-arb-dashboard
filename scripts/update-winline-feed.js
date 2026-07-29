const { fetchWinlineCandidates } = require('../src/live-winline-polymarket');
const { saveSourceSnapshot } = require('../src/storage/postgres-store');

async function main() {
  const capturedAt = new Date().toISOString();
  try {
    const candidates = await fetchWinlineCandidates({ now: new Date(capturedAt) });
    const payload = {
      schema_version: 2,
      source: 'winline_playwright_collector',
      captured_at: capturedAt,
      bookmaker: 'winline',
      sports: [...new Set(candidates.map((candidate) => candidate.sport))].sort(),
      candidate_count: candidates.length,
      candidates,
    };
    const persisted = await saveSourceSnapshot('winline', {
      candidate_count: candidates.length,
      sports: payload.sports,
    }, payload, process.env, { capturedAt, status: 'ok' });
    if (!persisted.persisted) throw new Error('DATABASE_URL is required for the external Winline collector');
    console.log(JSON.stringify({ source: 'winline', status: 'ok', captured_at: capturedAt, candidate_count: candidates.length, sports: payload.sports, persisted: true }));
  } catch (error) {
    const persisted = await saveSourceSnapshot('winline', { candidate_count: 0 }, {}, process.env, {
      capturedAt,
      status: 'error',
      error: error.message,
    }).catch(() => ({ persisted: false }));
    console.error(JSON.stringify({ source: 'winline', status: 'error', captured_at: capturedAt, error: error.message, persisted: persisted.persisted }));
    process.exitCode = 1;
  }
}

main();
