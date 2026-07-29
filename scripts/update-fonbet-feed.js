const { defaultFetchCandidates } = require('../src/live-fonbet-polymarket');
const { saveSourceSnapshot } = require('../src/storage/postgres-store');

async function main() {
  const capturedAt = new Date().toISOString();
  try {
    const candidates = await defaultFetchCandidates();
    const payload = {
      schema_version: 1,
      source: 'fonbet_public_client_collector',
      captured_at: capturedAt,
      bookmaker: 'fonbet',
      sports: [...new Set(candidates.map((candidate) => candidate.sport))].sort(),
      candidate_count: candidates.length,
      candidates,
    };
    const persisted = await saveSourceSnapshot('fonbet', {
      candidate_count: candidates.length,
      sports: payload.sports,
    }, payload, process.env, { capturedAt, status: 'ok' });
    if (!persisted.persisted) throw new Error('DATABASE_URL is required for the external Fonbet collector');
    console.log(JSON.stringify({ source: 'fonbet', status: 'ok', captured_at: capturedAt, candidate_count: candidates.length, sports: payload.sports, persisted: true }));
  } catch (error) {
    const persisted = await saveSourceSnapshot('fonbet', { candidate_count: 0 }, {}, process.env, {
      capturedAt,
      status: 'error',
      error: error.message,
    }).catch(() => ({ persisted: false }));
    console.error(JSON.stringify({ source: 'fonbet', status: 'error', captured_at: capturedAt, error: error.message, persisted: persisted.persisted }));
    process.exitCode = 1;
  }
}

if (require.main === module) main();

module.exports = { main };
