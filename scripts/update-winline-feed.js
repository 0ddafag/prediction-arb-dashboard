const fs = require('fs/promises');
const path = require('path');
const { fetchWinlineCandidates } = require('../src/live-winline-polymarket');

async function main() {
  const outputPath = process.argv[2] || path.join(process.cwd(), 'data', 'live-winline.json');
  const capturedAt = new Date().toISOString();
  const candidates = await fetchWinlineCandidates({ now: new Date(capturedAt) });
  const payload = {
    schema_version: 1,
    source: 'winline_browser_rendered_dom_snapshot',
    captured_at: capturedAt,
    bookmaker: 'winline',
    sports: [...new Set(candidates.map((candidate) => candidate.sport))].sort(),
    candidate_count: candidates.length,
    candidates,
  };
  await fs.mkdir(path.dirname(outputPath), { recursive: true });
  await fs.writeFile(outputPath, `${JSON.stringify(payload, null, 2)}\n`);
  console.log(JSON.stringify({ output_path: outputPath, captured_at: capturedAt, candidate_count: candidates.length, sports: payload.sports }));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
