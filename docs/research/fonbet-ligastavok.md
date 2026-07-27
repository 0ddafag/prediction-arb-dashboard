# Fonbet and Liga Stavok transport reconnaissance

Verified: 2026-07-27 from the current server, read-only, without login or bypassing access controls.

## Fonbet

### Confirmed public data path

The public website `https://fon.bet/` presented a CAPTCHA/IP challenge from this host, but the client-facing line JSON was independently reachable without authentication:

- line snapshot: `https://line-lb51.bk6bba-resources.com/events/listBase?scopeMarket=1600&lang=ru`
- event detail: `https://line-lb51.bk6bba-resources.com/events/event?eventId={eventId}&lang=ru&scopeMarket=1600`

The `line-lb51` hostname may be a load-balanced client host rather than a permanent API hostname. The connector therefore supports `FONBET_LINE_BASE_URL` override and must be monitored for host rotation.

### Stable provider identifiers

Observed payload fields:

- event: `events[].id`;
- competition/segment: `events[].sportId` -> `sports[].id`;
- parent periods: `events[].parentId`, `events[].kind`;
- market/outcome: `customFactors[].e` plus `factors[].f`;
- decimal odds: `factors[].v`;
- line parameter: `factors[].p` / `factors[].pt`;
- snapshot version: `packetVersion`.

Main result factor mapping was consistent across live examples:

- `921`: participant/home 1;
- `922`: draw;
- `923`: participant/away 2.

Provider-native identity should therefore include at least `(eventId, factorId, parameter, packetVersion)`.

### Live coverage snapshot

The connector extracted 1,212 root winner candidates from one current line snapshot:

| Sport | Root candidates |
| --- | ---: |
| Football | 863 |
| Tennis | 304 |
| Basketball | 21 |
| UFC/MMA | 12 |
| Baseball | 12 |

Confirmed examples:

- MLB `eventId=66766941`, Texas Rangers–Seattle Mariners, factors `921/923`;
- UFC `eventId=66416936`, Islam Makhachev–Ian Machado Garry, factors `921/922/923` with draw quoted at 65;
- tennis `eventId=66755605`, Tabilo–Griekspoor, factors `921/923`;
- football `eventId=66621587`, KAMAZ–Rotor, factors `921/922/923`;
- WNBA `eventId=66673867`, Washington–Connecticut, factors `921/923`.

These are transport confirmations, not approved Polymarket matches. The coverage map remains `candidate` until exact participant/time/competition/rules comparison succeeds.

### Settlement handling

- Football `921/922/923` is treated as regulation 1X2.
- Basketball `921/923` is only a full-game/including-OT hint. Regulation 1X2 must be discovered separately and never inferred from it.
- UFC with `922` is not two-way risk-free coverage; it carries `DRAW_NO_CONTEST` risk.
- Tennis carries a `RETIREMENT` comparison requirement.
- Baseball carries cancellation/postponement rule risk.

## Liga Stavok

`https://www.ligastavok.ru/` returned a Qrator protection page:

- HTTP/application result: access blocked / `qrerror/403.html`;
- current-host IP and request ID were displayed;
- loaded protection resource: `/__qrator/qauth_utm_v2d_vd0ff.js`;
- validation path: `/__qrator/validate`.

No public odds JSON, bootstrap payload, API or WebSocket endpoint was confirmed. No CAPTCHA, Qrator validation or geofence was bypassed. Liga Stavok therefore remains a research-only shell and normal sync must skip it.

## Implementation

- `src/connectors/bookmakers/fonbet.js`: public line/event fetch, provider-ID preservation, root-sport detection and main winner candidate extraction.
- `src/connectors/bookmakers/ligastavok.js`: explicit blocked/research transport status.
- `config/coverage-map.json`: reconnaissance timestamps, source paths and sport-specific risk notes.
