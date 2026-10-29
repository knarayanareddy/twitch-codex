# Quiet Quest build audit

**Scope:** compare the implementation with `SPEC.md` and `UI_UX.md`, deliberately excluding real Twitch OAuth, live EventSub receipt/reconnect, and broadcaster acceptance. Demo chat is a local fixture, not Twitch evidence.

## Non-Twitch build checklist

| Requirement | Status | Implementation / evidence |
|---|---|---|
| Cooperative three-minute objective; fixed 12-point goal; three equal actions; no speed bonus or public ranking | Built | `src/domain/game.js`; fake-clock reducer tests in `test/game.test.js` cover exact expiry, pause/resume, close, no early completion, stale round, invalid and late contributions. |
| Shared contribution path and per-source dedupe; repeated EventSub delivery IDs are idempotent | Built in application/storage; real Twitch input excluded | `src/application/quest-service.js`, `src/adapters/storage/sqlite-store.js`; service tests cover same-identity dedupe, same identity on separate routes, and duplicate delivery. |
| Anonymous companion join, temporary invite, rotation/revocation, one browser-token action per round, no identity linking | Built | URL-fragment invite exchange, scoped HttpOnly cookie, salted hash, and join/contribute routes; unit and browser tests cover join, invalid/stale code, duplicate, rotation, reset, and ended-session states. No Twitch identity is involved in companion identity. |
| Studio Demo lifecycle: start, pause/resume, close, next round, end, reset, companion disable/enable, invite rotation | Built | `public/js/studio.js`, `src/server.js`; Playwright covers start, pause/resume, close/next, end and confirmed reset; service tests cover companion disable and invite rotation. Destructive controls require confirmation. |
| Companion form: manual code entry, semantic equal-value radio choices, persistent result, retry/error/duplicate/closed guidance | Built | `public/companion.html`, `public/js/companion.js`; E2E covers valid/invalid manual code, keyboard action/submit, a recoverable request failure with selection preserved, duplicate, stale invite, and ended session. SSE loss/restoration is visibly and politely announced. |
| Read-only OBS overlay with a session-specific URL, shared progress, source totals, instruction and game/connection status | Built | `public/overlay.html`, `public/js/overlay.js`, `public/css/overlay.css`; E2E checks the shared total, paused state, lack of participant names, and overlay-card bounds at 1280×720 and a narrow 390×844 preview. Studio assigns the current session URL and opens it in a new tab. |
| Aggregate recap and CSV; no actor key/message exposed in recap | Built | `QuestService.history()` and recap routes return round aggregates; `test/quest-service.test.js` and Playwright verify recap/export shape and omit fixture identities. |
| SQLite persistence, restart recovery for local demo, transactional dedupe, 24-hour retention | Built | `src/adapters/storage/sqlite-store.js`; `test/storage.test.js` closes/reopens file-backed SQLite, restores state/invite, rechecks dedupe, and verifies expiry cascades delete contributions and events. |
| Operator/participant trust boundaries, same-origin mutation checks, rate limits, cookie signing, encryption helper, session isolation | Built for local/demo scope | `src/adapters/security.js`, server routes and SQLite constraints; unit tests cover cookie tampering, origin/scheme checks and token envelope; Playwright checks unauthenticated/cross-origin rejection and join rate limiting. The test reset route is enabled only in isolated test mode. |
| Responsive/reduced-motion/automated accessibility checks | Automated checks built | Playwright checks studio at 390px, companion at 320px and 768px, reduced-motion CSS, keyboard radio/submit, invalid/submitted/duplicate/offline/paused/closed views, and axe tags `wcag2a`, `wcag2aa`, `wcag21aa`, `wcag22aa`. No horizontal overflow was observed at tested sizes. |
| Setup and privacy operations notes | Built | `README.md`, `.env.example`, and `PRIVACY.md` describe local demo, data classes, retention and the broadcaster-credential exception. |

## Changes made while auditing

- Kept the studio overlay and companion links bound to the active session/invite; invite rotation refreshes the URL.
- Fixed companion choices not rendering when the fieldset contained its legend.
- Made duplicate/reloaded contributions state clearly that the browser token already contributed, without repeatedly rewriting the live status region on SSE refreshes.
- Added visible companion live-update reconnect/restore status and a helpful message when a previously joined session has ended.
- Refreshing recap after reset now shows the old session’s aggregate result.
- Added file-backed persistence/retention, UI reset, invite invalidation, rate-limit, manual code-entry, keyboard/retry, and expanded axe-state checks.

## Verification run

- `npm run check`: JavaScript syntax checks and **24/24 Node tests passed**.
- `npm run test:e2e`: **6/6 Playwright tests passed**. These use local SQLite, a local server, simulated chat, and fake network conditions.
- `npm audit`: **0 vulnerabilities** at audit time.
- No manual NVDA/VoiceOver (or equivalent) review, real-user parity test, production deployment test, or true browser 200% zoom/text-enlargement session was performed. Automated axe success is not a WCAG conformance claim.

## Explicitly outside this audit

No real Twitch OAuth authorization, production callback, broadcaster account, actual `channel.chat.message` event, token revocation against Twitch, or genuine Twitch reconnect was tested. The local simulator must not be presented as live acceptance evidence. Streamer moderation actions against Twitch chat are also excluded with the Twitch integration; the delivered non-Twitch control is disabling companion input.
