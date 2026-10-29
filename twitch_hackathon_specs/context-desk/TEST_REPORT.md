# Test report

**Run date:** 2026-10-28. **Scope:** offline/local test harness only.

| Check | Result |
|---|---|
| `npm run test:all` — Node domain/storage/retrieval/OAuth/EventSub tests | 28 passed, 0 failed |
| `npm run test:all` — Playwright browser tests | 4 passed, 0 failed |
| `npm run check` — JavaScript syntax checks plus Node suite | passed |
| `npm audit` | 0 vulnerabilities reported |
| Startup source-pack schema/hash/allowlist validation | passed in tests and server startup |
| Playwright + axe automated checks | passed in empty queue, selected review, insufficient-evidence, recap, and mobile review states |

Browser journeys exercised local demo fixtures → evidence review → explicit broadcaster-demo approval → read-only overlay → recap export; the separate insufficient-evidence path; unauthenticated queue denial; and mobile reflow. OAuth and EventSub unit tests use mocked Twitch HTTP responses and signed test payloads.

**Not performed:** genuine Twitch OAuth, a real channel subscription, a live moderator/broadcaster chat message, Twitch badge acceptance, or production deployment. The active preview is intentionally local-demo mode. The report makes no claim of live Twitch acceptance or manual screen-reader testing.
