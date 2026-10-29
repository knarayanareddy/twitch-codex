# Context Desk

A source-first, broadcaster-reviewed live context tool. It turns a bounded Solar System Basics question into a small evidence proposal and a deterministic draft; a human reviews both before anything can reach the read-only overlay. It is not a fact oracle, an open-web search engine, or professional advice.

## Quick start — offline local demo

Requires Node.js 20.11 or newer.

```sh
npm ci
cp .env.example .env
```

Edit `.env` and set a private `DEMO_PASSCODE` of at least 12 characters. Leave Twitch variables blank for an offline-only demo. The demo login is explicitly simulated broadcaster access; it does **not** connect to Twitch.

```sh
npm start
```

Open `http://localhost:4173`, sign in with the passphrase, select **Try the demo**, then inspect a question. The three fixtures are labelled as demo data. Evidence appears before the draft. Edit the approved public question, title, up to three context bullets, summary, and caveat; select one or two citations; inspect the exact preview; then confirm approval. Provenance distinguishes an unchanged deterministic draft from human-edited copy. The Pluto fixture can be approved; the changing Saturn-moon count should remain insufficient evidence. Open the overlay link to see the read-only card and use Published & recap to export a Markdown recap. In Setup, refresh vote results; the separate `/vote?session=…` page accepts one choice from fixed prompts under a signed anonymous browser token. Promoting the winner only queues a suggestion for review. No model key, network fetch, or Twitch connection is required for this journey.

For live deployments, do not use demo mode or expose the local-demo passphrase. Put the app behind HTTPS, set `NODE_ENV=production`, use a unique `CONTEXT_DESK_ACCESS_TOKEN` (at least 24 characters) and a random 32-byte `CONTEXT_DESK_COOKIE_SECRET`, and protect the host and database.

## Tests and checks

```sh
npm test             # domain, state, storage, EventSub, OAuth and security fixtures
npm run test:e2e     # Playwright browser journey, overlay, recap, responsive and axe checks
npm run test:all     # both suites
npm run check        # syntax checks plus unit suite
npm audit            # dependency advisory check
```

The browser tests start an isolated in-memory test server on port 4174. A reset endpoint is compiled into the server only when both `NODE_ENV=test` and `CONTEXT_DESK_TEST_MODE=1`; it is not enabled by the normal `npm start` configuration. E2E fixtures, OAuth HTTP responses, and EventSub signatures are local mocks—not genuine Twitch events or authorization.

## Twitch OAuth and EventSub setup

This code supports the Authorization Code OAuth flow and signed EventSub webhook subscription; this workspace has **not** been authorized against a Twitch account or live-accepted. To configure a real connection:

1. Register a Twitch Developer application. Set its OAuth redirect URI to the exact public HTTPS URL ending in `/auth/twitch/callback`.
2. Deploy this app at a public HTTPS origin and set `TWITCH_EVENTSUB_CALLBACK_URL` to that origin plus `/api/twitch/eventsub`. The callback must be reachable from Twitch.
3. Set `TWITCH_CLIENT_ID`, `TWITCH_CLIENT_SECRET`, `TWITCH_REDIRECT_URI`, and `TWITCH_EVENTSUB_CALLBACK_URL` in the server environment. Generate independent high-entropy values for `TWITCH_EVENTSUB_SECRET` (10–100 characters), `CONTEXT_DESK_ENCRYPTION_KEY` (32 bytes / 64 hex characters), and `CONTEXT_DESK_COOKIE_SECRET`. Optionally set `TWITCH_BROADCASTER_ID` to pin the only account allowed to connect.
4. Set `DEMO_MODE=0`, configure the broadcaster-only local access token, deploy behind HTTPS, and sign in. In Setup, choose **Authorize Twitch chat access** and complete the Twitch consent screen as the broadcaster. The OAuth flow requests only `user:read:chat` and `user:bot`; the app does not request chat-write or moderation scopes. The app uses a server-side app token to create one `channel.chat.message` webhook subscription for the authorized broadcaster account.
5. Wait for Twitch's signed callback challenge. Until the subscription is confirmed and the account and callback have passed checks, moderator input remains disabled. A moderator or the broadcaster can submit only `!context <question>` from a signed, current EventSub message whose per-message badge is `moderator` or `broadcaster` for the configured channel. Ordinary chat is ignored. A broadcaster must still authenticate to the Context Desk studio and explicitly approve before any public card appears.

The access/refresh token pair is encrypted at rest with AES-256-GCM; the encryption key and OAuth client secret remain server-side. Do not rotate or lose the encryption key without first disconnecting and reconnecting the account. Disconnect removes the local credential record and attempts to revoke the token and delete the EventSub subscription. If refresh fails or Twitch revokes the subscription, intake fails closed until reconnect.

A successful mock OAuth or callback test is not evidence of actual Twitch authorization, a live chat message, or production deployment. Record those separately if performed.

## Data lifecycle and boundaries

- One versioned source pack: [`data/topic-pack.json`](data/topic-pack.json). Six short team-authored paraphrases link to NASA/JPL pages; full webpages are never downloaded at runtime.
- Deterministic local lexical matching and fixed templates only. No model provider is called; `modelProvider` is `none`.
- Questions are bounded plain text. HTML, links, contact information, disallowed topics, exact live moon counts, and unsupported pack topics are rejected or routed to insufficient evidence.
- A card needs at least one retrieved pack citation, a reviewed public question, one to three bounded plain-text bullets, a title/summary/caveat, human review, and broadcaster confirmation. The overlay is read-only and receives only approved, public-safe fields; it never receives the original submitted wording, viewer/user ID, audit note, or token.
- Question text, evidence proposals, review events, published cards, and anonymous vote records expire after 24 hours; the cleanup task runs once per minute. Recap export includes the approved public question and card content/source links, but not original submitted wording or viewer identity. Anonymous voting is cookie-based and can be reset by clearing/replacing a browser token; it is not an identity or Sybil-resistance system.
- The opaque overlay key is persisted in `data/.context-desk-session-key`; the SQLite database is `data/context-desk.sqlite`. Both are local runtime data and are excluded from Git.
- Rate limits and EventSub replay IDs are in memory and reset after restart. SQLite audit entries use a keyed hash of the actor ID rather than storing the raw Twitch chatter ID.

## Project map

- `src/domain/` — pack validation, question policy, sanitization.
- `src/application/` — deterministic retrieval and review/publish state transitions.
- `src/adapters/twitch/` — signed EventSub validation, badge/command parsing, OAuth and encrypted token storage.
- `src/adapters/storage/` — SQLite persistence, expiry and audit log.
- `src/server.js` — same-origin HTTP API, login, API authorization, read-only overlay and SSE snapshots.
- `public/` — responsive newsroom-style studio and OBS browser-source overlay.
- `test/`, `e2e/` — offline unit/contract/security fixtures and Playwright journey.
- [`SECURITY.md`](SECURITY.md), [`SOURCE_AUDIT.md`](SOURCE_AUDIT.md), [`DEMO_RUNBOOK.md`](DEMO_RUNBOOK.md), [`DESIGN_DECISIONS.md`](DESIGN_DECISIONS.md).
