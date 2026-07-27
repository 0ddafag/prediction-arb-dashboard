const REQUIRED_FIELDS = [
  'venue', 'sport', 'geo', 'competition', 'event_ref', 'event_title', 'participants', 'start_at',
  'market_family', 'settlement_scope', 'outcome_key', 'outcome_label', 'decimal_odds', 'source_url', 'captured_at',
];

function normalizeBookmakerRow(raw) {
  for (const field of REQUIRED_FIELDS) {
    if (raw[field] == null || raw[field] === '') throw new Error(`${field} is required`);
  }
  if (!Array.isArray(raw.participants) || raw.participants.length < 2) {
    throw new Error('participants must contain at least two values');
  }
  const decimalOdds = Number(raw.decimal_odds);
  if (!Number.isFinite(decimalOdds) || decimalOdds <= 1) throw new Error('decimal_odds must be greater than 1');
  if (!Number.isFinite(Date.parse(raw.start_at))) throw new Error('start_at must be an ISO timestamp');
  if (!Number.isFinite(Date.parse(raw.captured_at))) throw new Error('captured_at must be an ISO timestamp');

  return {
    venue: String(raw.venue),
    sport: String(raw.sport),
    geo: String(raw.geo),
    competition: String(raw.competition),
    event_ref: String(raw.event_ref),
    event_title: String(raw.event_title),
    participants: raw.participants.map(String),
    start_at: new Date(raw.start_at).toISOString(),
    market_family: String(raw.market_family),
    settlement_scope: String(raw.settlement_scope),
    outcome_key: String(raw.outcome_key),
    outcome_label: String(raw.outcome_label),
    decimal_odds: decimalOdds,
    source_url: String(raw.source_url),
    captured_at: new Date(raw.captured_at).toISOString(),
    matching_mode: 'exact_only',
    raw_ref: raw.raw_ref || null,
  };
}

module.exports = { normalizeBookmakerRow, REQUIRED_FIELDS };
