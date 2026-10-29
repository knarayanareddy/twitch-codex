# Verification Record

**Environment:** Node.js 20.20.2, Playwright Chromium. **Date:** 2026-10-28 (local).

## Automated checks

| Check | Result | Notes |
|---|---:|---|
| `node --check` | Passed | All JavaScript files under `src/`, `public/`, and `tests/`. |
| `npm test` | 123 passed, 0 failed | Domain, resource budget, service/migration/recap, HTTP, SQLite, security and Twitch adapter mocks. |
| `npm run test:e2e` | 6 passed, 0 failed | Latest run includes axe scans, demo completion and real budget-exhaustion handling, pause/resume/undo/discard/reset, overlay isolation/revocation, 390px/reduced-motion, 640px narrow-width proxy, desktop start-button visible-at-720px assertion, and refreshed screenshot capture. |
| `npm run test:coverage` | Passed | 96.72% total line coverage including tests; `src/server.js` is the largest remaining production-module gap at 84.54%. |
| `npm ci` + `npm audit` | Passed | Clean lockfile install; zero reported vulnerabilities. npm did print a deprecation warning for transitive `prebuild-install@7.1.3`. |
| Evidence screenshots | Refreshed and visually inspected | `docs/evidence/studio-1280x720.png`, `studio-390x844.png`, `overlay-1920x1080.png`, `overlay-1280x720.png`. |

## Manual/release checks

- [x] Browser screenshot review at target sizes (refreshed evidence inspected after the final layout and copy adjustments).
- [x] Automated axe checks on setup/studio and overlay states (test scan, not a full accessibility certification).
- [x] Reduced-motion and 390px overflow checks in Playwright, plus a 640 CSS-pixel narrow-width proxy for desktop 200% zoom.
- [x] Keyboard focus visibility and Enter activation smoke test; a full human keyboard-only review remains outstanding.
- [ ] NVDA or VoiceOver announcement review and true 200% browser zoom manual review.
- [ ] Real OBS Browser Source checked at the intended gameplay scene scale.
- [x] Un-narrated local simulation rehearsal clip recorded at `docs/evidence/habitat-relay-demo-rehearsal.webm`.
- [ ] Submission video showing the genuine Codex workflow and session ID; neither has been fabricated or implied by the local simulator clip.
- [x] Clean `npm ci` install and `npm audit` (zero vulnerabilities); a manifest-based license inventory is recorded in `docs/PROVENANCE.md`; formal legal and production deployment reviews remain outstanding.
- [ ] **Real Twitch OAuth and live chat acceptance intentionally excluded** by the task; no credential-based test was run and no live integration claim is made.

## Interpretation

Mocks prove adapter behavior against test doubles only. Automated browser success demonstrates the local demo/API behavior, not real Twitch authorization, live EventSub delivery, actual OBS compositing, screen-reader conformance, or production hosting safety. Do not describe the uncompleted checks as passed.
