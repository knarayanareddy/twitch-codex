# Open Lab Live

Open Lab Live is a source-backed, operator-controlled science-stream prototype. It is a **local deterministic simulation**, not a Twitch-connected product, a real experiment, a measurement, or a climate forecast. Twitch OAuth, chat ingestion, and EventSub are deliberately not implemented here; those are the remaining external integration work.

## What is implemented

- A versioned albedo lesson with audience and reading level, controlled-variable/start state, golden expected outputs for all seeded inputs, safe/out-of-scope prompt examples, a NASA Science citation, explicit assumptions and limits, and a closed input vocabulary (`!predict 1`, `!predict 2`, `!predict 3`). The browser accepts sample fixtures only; no chat command is connected.
- A controlled operator flow: **Predict → Choose → Reveal → Learn**. The operator may choose any condition, sees ties and no-vote cycles neutrally, can pause/resume, reset with confirmation, end a session, and replay the same seed.
- A seeded, deterministic toy rule. It chooses one of 80, 100, or 120 **model-energy units**, then calculates `absorbed = round(incoming × (100 − albedo) ÷ 100)` and `reflected = incoming − absorbed`. The illustrative 20%, 50%, and 80% settings and outputs are not NASA values. They are not watts, degrees, or material measurements.
- A responsive operator studio, labelled five-person local fixture simulator, aggregate-only run notes, JSON and Markdown exports, and a read-only transparent OBS browser surface that withholds the answer until the reveal.
- SQLite persistence, one vote per pseudonymous actor per cycle (with a hard 500-vote cycle cap), delivery-ID deduplication support for a future provider, signed operator cookies, same-origin mutation checks, bounded request bodies, rate-limited login, security headers, 24-hour session expiry, and privacy/data-limit disclosures.
- Automated domain, service, storage, security, HTTP integration, browser-flow, and axe accessibility checks.

## Requirements

- Node.js **20.11 or newer**.
- npm.
- A local browser installed for Playwright if running browser tests (`npx playwright install chromium`).

## Run locally

```sh
cd twitch_hackathon_specs/open-lab-live
npm ci
cp .env.example .env
```

Edit `.env` before opening the studio. Set a unique `DEMO_PASSCODE` of at least 12 characters; the example value is public and must not be used on a shared machine. For a non-demo deployment, set an operator passphrase of at least 24 characters and provide a stable `OPEN_LAB_COOKIE_SECRET` of at least 32 characters. The local cookie secret is generated into `data/.open-lab-cookie-key` if omitted. Keep `.env`, that key, and `data/open-lab.sqlite` private.

```sh
npm start
```

Open `http://localhost:4190`. Sign in with the local demo passphrase, then choose **Start demo predictions**. Add labelled sample voters from the **LOCAL FIXTURE · NOT CHAT** panel, close predictions, choose a condition, run the model, and reveal it. The simulator has five fixed sample actors and is designed to make the full journey repeatable—not to imitate live chat volume or sentiment. The preview and standalone `/overlay?session=…` page use the same public, read-only state.

### OBS setup

In OBS, add a **Browser** source whose URL is the studio's **Open source** overlay URL. Keep the page transparent and use the default 1280 × 720 canvas (or set a suitable custom canvas). The overlay URL contains an unguessable session identifier, but it is read-only and exposes aggregate predictions only. Do not publish the operator studio URL or passphrase. The pre-session `/overlay?preview=1` page is a design preview, not a live session.

### Environment variables

| Variable | Purpose |
| --- | --- |
| `HOST`, `PORT` | Bind address and HTTP port; defaults `0.0.0.0:4190`. |
| `DEMO_MODE=1` | Enables local-demo authentication using `DEMO_PASSCODE`. This does not enable Twitch. |
| `DEMO_PASSCODE` | Local operator passphrase; 12+ characters for demo mode. |
| `OPEN_LAB_OPERATOR_PASSCODE` | Operator passphrase for a non-demo deployment; 24+ characters. |
| `OPEN_LAB_COOKIE_SECRET` | Stable signing secret, 32+ characters; required for non-demo authentication. |
| `DATABASE_PATH` | SQLite file; defaults `./data/open-lab.sqlite`. |
| `TRUST_PROXY_HTTPS=1` | Only behind a correctly configured HTTPS reverse proxy that sets forwarded host/protocol. Enables origin checking against those forwarded headers. |
| `NODE_ENV=production` | Adds `Secure` to the signed operator cookie. Configure trusted HTTPS correctly as well. |

Do not expose this prototype directly to the public internet. It has not undergone independent penetration testing, a privacy/legal review, or operational load testing.

## Checks

```sh
npm test                 # deterministic domain, SQLite/service, security and HTTP-route tests
npm run check             # syntax checks plus node:test
npx playwright install chromium   # first time only, if needed
npm run test:e2e           # real browser interaction and axe checks
npm run test:all           # unit/integration and browser checks
```

The Playwright suite starts an isolated local demo server on port 4191 and uses `data/e2e.sqlite`. Stop any other service on that port before running it. These checks verify only the local mock, not Twitch authorization, a channel, EventSub signatures/retries, or live stream acceptance.

## Local demo recording

Run `OPEN_LAB_DEMO_PASSCODE='your local passphrase' npm run demo:record`. The script starts and cleans up an isolated temporary local demo server, then writes `docs/open-lab-local-demo.webm` (about 15 seconds, no narration). The clip shows the locally simulated loop only: it is not Twitch or OBS evidence. It requires the Playwright Chromium browser to be installed.

## HTTP surface

- `GET /api/health`, `GET /api/lesson`, and public `GET /api/overlay/:sessionId` are read-only.
- `GET /api/auth/status`, `POST /api/auth/login`, `POST /api/auth/logout` manage the local operator cookie. Login requires same-origin `Origin` and a JSON body.
- `GET /api/studio`, `POST /api/sessions`, `POST /api/sessions/:id/:action`, `GET /api/studio/:id/events`, and `GET /api/recap` are operator-only. Mutations require a signed cookie and same-origin `Origin`.
- `POST /api/sessions/:id/demo-vote` accepts only one of five known sample-voter IDs and a numbered lesson choice; no arbitrary viewer name or message is stored.
- `GET /api/overlay/:id/events` is a read-only SSE stream. It exposes public snapshots only; operator-only seed/selection state is sent on a separate studio stream.
- `GET /api/recap/export.json` and `/api/recap/export.md` download aggregate run notes.

Sessions and prediction aggregates are retained for at most 24 hours and then pruned. Pseudonymous per-session actor HMACs support duplicate prevention; raw actor IDs, chat text, and viewer names are not persisted. Exports include the session seed and should be treated as operator run notes.

## Product and architecture notes

- [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) — module boundaries, state authority, snapshot separation, privacy, persistence, and trust assumptions.
- [`docs/DEMO_STORYBOARD.md`](docs/DEMO_STORYBOARD.md) — a 75-second local demonstration script and recovery language.
- [`docs/VERIFICATION.md`](docs/VERIFICATION.md) — what passed locally and what has not been tested or claimed.

## Source and model provenance

NASA Science's [Explore Albedo Activity](https://science.nasa.gov/wp-content/uploads/2023/10/Explore-Albedo-Activity.pdf) supports the qualitative relationship used in the lesson: higher albedo reflects a larger share of light; lower albedo absorbs more. It does **not** support the prototype's chosen 20%, 50%, and 80% settings, seeded 80/100/120 model-unit inputs, or any generated output. The lesson carries this distinction on the studio source card, OBS overlay, and exports.

## Remaining integration work

The product currently reports `twitchIntegration: pending` and `modelProvider: none`. To connect Twitch in a future, separately tested change, implement OAuth/token storage and revocation, least-privilege scopes, callback/state validation, EventSub subscription/verification/signature/timestamp checks, retry and delivery-ID handling, bounded exact-command parsing, actor-key mapping, disconnect/reconnect handling, chat-rate limits, and a real-channel acceptance checklist. Do not claim those checks from the local simulation tests.
