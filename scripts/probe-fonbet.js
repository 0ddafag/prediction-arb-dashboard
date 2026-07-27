const fonbet = require('../src/connectors/bookmakers/fonbet');

async function main() {
  const payload = await fonbet.fetchLine();
  const candidates = fonbet.extractMainWinnerCandidates(payload);
  const counts = {};
  for (const candidate of candidates) counts[candidate.sport] = (counts[candidate.sport] || 0) + 1;

  const samples = {};
  for (const sport of Object.keys(counts)) {
    const row = candidates.find((candidate) => candidate.sport === sport);
    samples[sport] = {
      event_id: row.provider_event_id,
      competition: row.competition,
      participants: row.participants,
      market_family_hint: row.market_family_hint,
      outcomes: row.outcomes,
      risk_hints: row.risk_hints,
    };
  }

  process.stdout.write(`${JSON.stringify({
    checked_at: new Date().toISOString(),
    packet_version: payload.packetVersion,
    candidate_count: candidates.length,
    counts,
    samples,
  }, null, 2)}\n`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
