# Baiting / Matching Map — Winline MLB ↔ Polymarket

Reference file for screenshot-driven MLB rows currently seeded into the dashboard.

## Mapping rule
- Winline rows are two-way `12` moneyline rows.
- Dashboard hedge logic uses the **opposite Polymarket YES side** for the same game.
- `poly_outcome_index` is the team-side mapping anchor kept in store; row order must not be trusted.

## Current seeded batch

| Winline event | Winline outcome | Book odds | Polymarket market id | Polymarket listing / note | pair_id |
|---|---:|---:|---:|---|---|
| Сент-Луис — Чикаго Кабс | Сент-Луис | 2.01 | 3017196 | Chicago Cubs vs. St. Louis Cardinals | `pair-mlbshot-mlb-stl-chc-2026-07-27-1` |
| Сент-Луис — Чикаго Кабс | Чикаго Кабс | 1.81 | 3017196 | Chicago Cubs vs. St. Louis Cardinals | `pair-mlbshot-mlb-stl-chc-2026-07-27-0` |
| Техас — Сиэтл | Техас | 2.07 | 3017180 | exact slug note: `mlb-sea-tex-2026-07-27` | `pair-mlbshot-mlb-sea-tex-2026-07-26-1` |
| Техас — Сиэтл | Сиэтл | 1.76 | 3017180 | exact slug note: `mlb-sea-tex-2026-07-27` | `pair-mlbshot-mlb-sea-tex-2026-07-26-0` |
| Детройт — Балтимор | Детройт | 1.85 | 3017182 | Baltimore Orioles vs. Detroit Tigers | `pair-mlbshot-mlb-bal-det-2026-07-27-1` |
| Детройт — Балтимор | Балтимор | 1.97 | 3017182 | Baltimore Orioles vs. Detroit Tigers | `pair-mlbshot-mlb-bal-det-2026-07-27-0` |
| Питтсбург — Аризона | Питтсбург | 1.78 | 3017186 | Arizona Diamondbacks vs. Pittsburgh Pirates | `pair-mlbshot-mlb-ari-pit-2026-07-27-1` |
| Питтсбург — Аризона | Аризона | 2.05 | 3017186 | Arizona Diamondbacks vs. Pittsburgh Pirates | `pair-mlbshot-mlb-ari-pit-2026-07-27-0` |
| Майами — Филадельфия | Майами | 2.34 | 3017184 | Philadelphia Phillies vs. Miami Marlins | `pair-mlbshot-mlb-phi-mia-2026-07-27-1` |
| Майами — Филадельфия | Филадельфия | 1.60 | 3017184 | Philadelphia Phillies vs. Miami Marlins | `pair-mlbshot-mlb-phi-mia-2026-07-27-0` |
| Вашингтон — Торонто | Вашингтон | 1.78 | 3017188 | Toronto Blue Jays vs. Washington Nationals | `pair-mlbshot-mlb-tor-wsh-2026-07-27-1` |
| Вашингтон — Торонто | Торонто | 2.05 | 3017188 | Toronto Blue Jays vs. Washington Nationals | `pair-mlbshot-mlb-tor-wsh-2026-07-27-0` |
| Цинциннати — Кливленд | Цинциннати | 1.61 | 3017190 | Cleveland Guardians vs. Cincinnati Reds | `pair-mlbshot-mlb-cle-cin-2026-07-27-1` |
| Цинциннати — Кливленд | Кливленд | 2.34 | 3017190 | Cleveland Guardians vs. Cincinnati Reds | `pair-mlbshot-mlb-cle-cin-2026-07-27-0` |
| Н-Й Метс — Атланта | Н-Й Метс | 1.95 | 3017192 | Atlanta Braves vs. New York Mets | `pair-mlbshot-mlb-atl-nym-2026-07-27-1` |
| Н-Й Метс — Атланта | Атланта | 1.86 | 3017192 | Atlanta Braves vs. New York Mets | `pair-mlbshot-mlb-atl-nym-2026-07-27-0` |
| Чикаго Уайт Сокс — Н-Й Янкис | Чикаго Уайт Сокс | 2.14 | 3017194 | New York Yankees vs. Chicago White Sox | `pair-mlbshot-mlb-nyy-cws-2026-07-27-1` |
| Чикаго Уайт Сокс — Н-Й Янкис | Н-Й Янкис | 1.72 | 3017194 | New York Yankees vs. Chicago White Sox | `pair-mlbshot-mlb-nyy-cws-2026-07-27-0` |
| Л-А Эйнджелс — Хьюстон | Л-А Эйнджелс | 1.97 | 3017198 | Houston Astros vs. Los Angeles Angels | `pair-mlbshot-mlb-hou-laa-2026-07-27-1` |
| Л-А Эйнджелс — Хьюстон | Хьюстон | 1.84 | 3017198 | Houston Astros vs. Los Angeles Angels | `pair-mlbshot-mlb-hou-laa-2026-07-27-0` |
| Окленд — Бостон | Окленд | 2.35 | 3017200 | Boston Red Sox vs. Athletics | `pair-mlbshot-mlb-bos-oak-2026-07-27-1` |
| Окленд — Бостон | Бостон | 1.60 | 3017200 | Boston Red Sox vs. Athletics | `pair-mlbshot-mlb-bos-oak-2026-07-27-0` |
| Сан-Франциско — Милуоки | Сан-Франциско | 2.10 | 3017202 | Milwaukee Brewers vs. San Francisco Giants | `pair-mlbshot-mlb-mil-sf-2026-07-27-1` |
| Сан-Франциско — Милуоки | Милуоки | 1.74 | 3017202 | Milwaukee Brewers vs. San Francisco Giants | `pair-mlbshot-mlb-mil-sf-2026-07-27-0` |

## Browser note
Using Chromium I was able to navigate to the Winline MLB upcoming page and refresh the dashboard batch from live quotes. The previously seeded played game `Филадельфия — Н-Й Янкис` was removed, and the missing upcoming game `Сент-Луис — Чикаго Кабс` was added from the live MLB page.
