# Habitat Relay

A local-first Twitch experience where chat votes on a three-round **illustrative pollinator-habitat scenario**. The streamer reviews and approves every decision. The OBS overlay shows the shared state, sources, and vote counts. It makes no claim that game metrics are ecological measurements or that a virtual choice causes real-world restoration.

## What is implemented

- Complete playable demo: three rounds, two choices per round, live tally, sample audience, tie/no-vote resolution, streamer approval, pause/resume, round timer, reset, and anonymized recap export.
- A six-token fictional, game-only budget; each choice shows its token cost. Tokens are deducted only on streamer approval, restored by safe undo, and never represent money, materials, or ecological measurement.
- Custom responsive studio and transparent OBS overlay (`/?view=overlay`).
- SQLite-backed state/event history; transactionally deduplicated votes and Twitch delivery IDs.
- Optional Twitch OAuth authorization-code flow and `channel.chat.message` EventSub WebSocket subscription using the installed account as the chat reader.
- AES-256-GCM encryption for stored Twitch access/refresh tokens, token refresh, revocation/disconnect path, reconnect handling, minimum `user:read:chat` scope, and no chat replies.
- 122 Node.js tests covering domain rules (including budget deduction/undo/migration), persistence, security helpers, Twitch protocol behavior with mocks, HTTP APIs, and full three-round API flows; six Playwright/Chromium browser tests.

## Requirements

- Node.js 20.11 or newer (tested here on Node 20.20).
- npm.
- Optional live chat: a Twitch Developer Application and a broadcaster account that can authorize the app.

## Start the demo

```bash
cd twitch_hackathon_specs/habitat-relay
npm install
npm test
npm run test:coverage
npm start
```

Open [http://localhost:3000](http://localhost:3000). Choose **Start a demo session**, then:

1. Click **Add sample audience** to create a 4–3 vote, or **Rehearse a tie** for a 3–3 tie.
2. Optionally click an option card to add your own one-per-round demo vote.
3. Click **Close round & review**.
4. Resolve a tie/no-vote case by selecting a path; all outcomes require streamer approval.
5. Repeat through all three rounds and download the anonymized recap.

The separate overlay is at [http://localhost:3000/?view=overlay](http://localhost:3000/?view=overlay). Use the studio’s **Preview OBS overlay** link for a framed preview; add the non-preview URL as an OBS Browser Source. The overlay uses local CSS/SVG and does not require a CDN.

## Optional live Twitch setup

**Do not put Twitch secrets in the browser, OBS URL, source code, or chat.** The server uses the OAuth authorization-code flow, keeps refresh/access tokens server-side, and encrypts the token record in SQLite.

1. Create/register a Twitch application in the Twitch Developer Console.
2. Register this exact redirect URI in the app:
   - Local: `http://localhost:3000/auth/twitch/callback`
   - For a hosted deployment, use its HTTPS callback and set the exact same value in `TWITCH_REDIRECT_URI`.
3. Copy the template and create a strong encryption key:

```bash
cp .env.example .env
openssl rand -hex 32
```

4. Put the Twitch client ID, client secret, redirect URI, and generated 64-character hex key in `.env`. Keep `.env` out of version control.
5. Restart `npm start`, then click **Connect Twitch** in the app. Approve `user:read:chat` for the broadcaster account.
6. Wait for the UI to show **Connected**. Choose **Start live**. Chat can vote using the displayed command: `!habitat 1` or `!habitat 2`. Option numbers match the active round’s two choices.

This build is an **installed-chat reader**: it reads one channel as the account that authorized it and does not send bot messages or perform moderation. The EventSub WebSocket flow and scopes are based on Twitch’s current chat documentation; check the current requirements in the [Twitch authentication/EventSub docs](https://dev.twitch.tv/docs/chat/authenticating/) before registering or deploying. OAuth redirect URI, app status, and account permissions must agree exactly. If the scope is wrong or Twitch revokes the subscription, the studio reports the connection state and live voting stops; the local demo remains available.

### Local vs hosted caveat

The defaults are for a local single-user application. The server binds to `0.0.0.0` to support development previews; do **not** expose it as a public service without adding an authenticated operator session, TLS termination, rate limiting at the edge, secret rotation, backups, and a reviewed deployment configuration. Same-origin checks mitigate cross-site requests but are not a substitute for operator authentication. The local `/api/operator/overlay-link` endpoint itself has no operator authentication and can mint a read-only overlay capability, so keep this process on a trusted local machine; do not use a shared/public preview for a real Twitch OAuth secret.

## Commands and controls

- `!habitat 1` — vote for the first option.
- `!habitat 2` — vote for the second option.
- One vote per Twitch chatter per round; no public voter names, rank, or chat transcript is retained.
- Demo mode supports sample ballots, bounded to 20 synthetic votes per action.
- Round timers are server-side and pause/resume preserves remaining time.
- If the vote is tied or empty, the broadcaster explicitly chooses; if it has a plurality, the streamer still approves before the habitat changes.
- The game starts with six fictional field tokens. Option costs (one to three) are shown before voting; cost applies only after approval, and a safe undo restores the exact previous balance. A path that exceeds the balance cannot be committed; for example, two two-token choices leave too little for the three-token final route, so choose its lower-cost option. Discard has no token cost.
- The OBS URL is a random, session-scoped, read-only capability link. Reset revokes it; do not share it outside your broadcast setup.

## Engineering notes

### Architecture

```text
Twitch EventSub WS ─> TwitchAdapter ─> normalized chat command ─> HabitatService
                                                                  │
                                                          pure domain reducer
                                                             │           │
                                                        SQLite store   public snapshot
                                                                          │
                                                          studio + OBS overlay over SSE
```

- `src/domain/`: scenario definitions and deterministic state machine.
- `src/application/`: session orchestration, privacy-preserving dedupe, demo controls, recap.
- `src/adapters/store.js`: SQLite state, events, dedupe and encrypted secrets.
- `src/adapters/twitch.js`: OAuth, token lifecycle, EventSub WebSocket and reconnect/migration.
- `src/server.js`: same-origin JSON/SSE endpoints and static UI.
- `public/`: studio, accessible controls, responsive styles, and separate OBS view.
- `tests/`: unit, service, persistence, security, Twitch adapter, and HTTP integration tests.

### Test and coverage

```bash
npm ci
npx playwright install chromium
npm run test:all
npm run test:coverage
npm audit
npm run demo:record
```

Latest verified run: **123 Node test cases passed**, 0 failed; **6 Playwright/Chromium E2E tests passed**, including axe WCAG 2.2 AA scans, reset/undo, resource-budget behavior, session-scoped OBS link revocation, 390px/reduced-motion and narrow-width behavior, and screenshot capture. `npm ci` completed and `npm audit` reported zero vulnerabilities (there is a deprecation warning for transitive `prebuild-install@7.1.3`). Screenshots are in `docs/evidence/` for the ready studio at 1280×720, studio at 390px, and overlay at 1920×1080 and 1280×720. The latest coverage run reports 96.72% overall line coverage including tests; refresh locally with `npm run test:coverage`.

Automated coverage is not a conformance certificate. A human screen-reader/NVDA or VoiceOver check, real OBS Browser Source review at scene scale, true 200% browser zoom review, physical color-blind/usability review, and formal dependency-license legal review and production deployment review have not been performed here; a manifest-based inventory is in `docs/PROVENANCE.md`. Playwright uses a narrow viewport as a zoom proxy. Twitch protocol tests use mocks; a real Twitch app, broadcaster authorization, and live-channel EventSub message have **not** been verified and remain explicitly out of scope for this build.

## Data and privacy

- Raw chat text is not written to SQLite or exported.
- The vote dedupe table contains per-session HMAC hashes, not logins or display names; the hash key is derived with the active session ID. These rows are deleted on reset.
- Domain event records contain aggregate choices and timestamps, not chat identity.
- Recap JSON contains aggregate vote totals, selected choices, simulation disclaimer, source IDs, and metric state.
- OAuth tokens are encrypted with AES-256-GCM; losing/changing the encryption key makes the stored tokens unusable. Disconnect deletes the encrypted credential record.
- Session history remains in the local SQLite database; remove the database file to erase local session history.

## Sources used for scenario content

- European Environment Agency, [Protecting and restoring Europe’s wild pollinators and their habitats](https://www.eea.europa.eu/en/analysis/publications/protecting-and-restoring-europes-wild-pollinators-and-their-habitats), briefing published 18 June 2025; checked 28 October 2026.
- Food and Agriculture Organization of the United Nations, [Global Action on Pollination Services for Sustainable Agriculture](https://www.fao.org/pollination/about/en); checked 28 October 2026.

Sources inform authored scenario text, not the numeric game mechanics. The interface clearly labels metrics as **simulation indicators**.

## Known limitations / next hardening work

- Playwright Chromium flows and screenshot evidence have been run; real OBS scene composition, a human screen-reader check, and manual 200% zoom review remain outstanding.
- Live Twitch app creation, OAuth callback, actual broadcaster authorization, and on-channel EventSub delivery are explicitly excluded from this implementation request and remain unverified; do not imply otherwise.
- Studio operator actions are local-preview controls with same-origin protections, not a hardened multi-user authentication system.
- The source/action content is informational only; no donation, volunteer form, or real restoration action is operated by this app.
