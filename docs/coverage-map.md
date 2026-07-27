# Sportsbook ↔ Polymarket coverage map

Machine-readable source: [`config/coverage-map.json`](../config/coverage-map.json).

The map is a collection allowlist, not a list of every bookmaker page.

## Statuses

- `confirmed` — exact Polymarket intersection has been observed; normal sync may collect it.
- `candidate` — requested sport/market family needs route, rules and overlap verification; normal sync skips it.
- `no_intersection` — checked but no current Polymarket overlap; normal sync skips it and coverage audit may revisit it.
- `blocked` — inaccessible because of auth, geo or transport blocker.

Each rule records venue, sport, geography, competition, market family, settlement scope, source path, last check/match timestamps and recheck policy.

## Current confirmed coverage

| Venue | Sport | Geo | Competition | Market family | Source |
|---|---|---|---|---|---|
| Winline | Baseball | US | MLB | two-way moneyline | https://winline.ru/stavki/sport/bejsbol/ssha/mlb |

Fonbet, Liga Stavok and the remaining Winline sports stay `candidate` until browser/network and settlement-rule verification is complete. They must not populate production rows before confirmation.
