# Quiet Quest

A low-pressure cooperative Twitch game: viewers can make the same one-point contribution either with a short chat command or a keyboard-accessible companion page. There is no speed bonus, leaderboard, individual callout, or chat reply.

## Run locally

```sh
cp .env.example .env
# Keep DEMO_MODE=1 and use the example passphrase only for a local demonstration.
npm ci
npm start
```

Open `http://localhost:4180` and sign in with `quiet-quest-local-demo`. Choose **Start demo round**. The local chat simulator is explicitly marked as simulated; it is not a Twitch event. Use **New code** or **Copy link** to share a temporary companion invite. OBS can load the **Overlay source** URL. The local service persists to `data/quiet-quest.sqlite` and retains session records for 24 hours.

## Game loop

- The objective is a shared community festival garden, with a fixed 3-minute contribution window and a goal of 12 actions.
- Each route offers the same three actions: plant native flowers, create shade, or set out water. Every accepted action adds exactly one to the shared meter.
- Chat commands are `!help 1`, `!help 2`, and `!help 3`. Demo chat is a clearly labelled fixture; Live chat uses Twitch EventSub and only parses these exact commands.
- Dedupe is one accepted contribution per Twitch actor **per chat route** and one per temporary browser token **per companion route**, per round. The product does not claim that those routes identify the same person.
- The contribution window does not close early when the goal is reached. The streamer may pause/resume, close a round, start the next round, end, or reset; end/reset require confirmation.

## Optional Twitch setup

1. Create a Twitch developer application and configure the exact redirect URL `/auth/twitch/callback` on a public HTTPS host.
2. Set `DEMO_MODE=0`, `QUIET_QUEST_OPERATOR_PASSCODE` (at least 24 characters), `QUIET_QUEST_COOKIE_SECRET` (at least 32 strong characters), `TWITCH_CLIENT_ID`, `TWITCH_CLIENT_SECRET`, and `TWITCH_REDIRECT_URI` in the server environment. Use a private persistent `TWITCH_TOKEN_ENCRYPTION_KEY` or retain the generated key file in `data/`.
3. Sign into the studio and choose **Authorize Twitch chat**. The installed-chat OAuth flow requests only `user:read:chat`; it does not send chat, request moderation permissions, or act as a bot account. The authorized broadcaster’s own account is the channel read by EventSub.
4. Start a Live session. The server opens a Twitch EventSub WebSocket and subscribes to `channel.chat.message`. The public overlay and companion page never receive OAuth tokens or Twitch IDs.

A public HTTPS deployment and actual broadcaster authorization are required for live acceptance. The included Twitch tests use local fakes; no live Twitch authorization or chat event is claimed by this repository. If chat reconnects, the studio marks it and offers **Pause while reconnecting**. The game clock is server-controlled; a browser clock is only a display.

## Data and security notes

- Raw Twitch chat messages or viewer display names are not persisted. The authorized broadcaster’s Twitch ID and login are retained with the OAuth credential record so the service can identify which channel to read. A per-session salted HMAC of the Twitch actor ID is used only for per-round deduplication; the per-session salt and event/contribution rows expire with the session after 24 hours.
- A companion invite is a random, revocable bearer code that can only join one active session. A signed, HttpOnly browser token deduplicates companion input for that browser; it is not an account and can be replaced or cleared. Companion and Twitch identities are intentionally not linked.
- Persisted Twitch access/refresh tokens are AES-256-GCM encrypted server-side. Cookie and encryption key files are created with mode `0600`; protect/retain them securely alongside encrypted backups, and never commit them.
- The overlay is read-only. Session mutation routes require studio authentication and same-origin checks. Companion mutation routes require same-origin checks, invite/session validation, rate limits, and a scoped anonymous cookie.
- Recap/export contains round-level aggregate totals only. It contains no names, actor hashes, original chat text, invite code, or browser nonce.

See [`SPEC.md`](SPEC.md) for product acceptance criteria, [`UI_UX.md`](UI_UX.md) for the design brief, and [`PRIVACY.md`](PRIVACY.md) for the data inventory and limitations.

## Tests

```sh
npm run check       # syntax checks plus deterministic unit/integration tests
npm run test:e2e    # local Playwright journeys, responsive checks, and axe scans
npm run test:all    # both test suites
npm run test:coverage
npm audit
```

The test server uses in-memory SQLite, fixed local credentials, fake clocks, local EventSub responses, and a test-only reset endpoint. Those are simulations—not real Twitch authorization, human testing, or live production acceptance. Automated axe scans are not an accessibility conformance claim. Manual keyboard and screen-reader findings must be recorded separately.
