# Open Lab Live — implementation architecture

## Runtime boundary

```text
Browser studio ── same-origin JSON controls ──┐
Browser studio ── authenticated SSE snapshots ─┤
                                               ├─> application service ─> pure phase engine
Read-only overlay ── public JSON + SSE ────────┘            │                   │
                                                             └──> SQLite store ◄─┘

Local fixture simulator ──> exact choice IDs ──> same prediction service

Twitch OAuth / EventSub: NOT IMPLEMENTED
```

The server is a small Node HTTP process. Lesson JSON is validated at import; it contains finite settings and descriptions, never executable rule code. `domain/simulation.js` is the only calculation path. `domain/lab-engine.js` consumes explicit event times and an injected seed; it does not read the wall clock or generate IDs. `application/lab-service.js` validates controls, deduplicates votes, applies state transitions, constructs safe snapshots, and aggregates revealed runs. `adapters/storage/sqlite-store.js` commits state changes and event rows transactionally.

## State and authority

The finite phases are `ready → predict → choose → reveal → learn`, plus `paused` and `closed`. Server-side phase validation is authoritative. The browser can request an action but cannot provide a result, energy input, prediction total, phase, or seed. The operator selects an allowed choice only after predictions close. A reveal event is required before the public snapshot contains the result.

The demo has five fixed fixture voter IDs and three finite choice numbers. The identity used by the service is HMACed with a per-session salt; raw fixture identifiers are not stored. One actor can vote once per source and cycle, every cycle is capped at 500 accepted predictions, and a future provider delivery ID has a database uniqueness constraint. The local simulator never calls the `twitch` source path.

## Snapshot separation

- **Public overlay:** prompt, phase, aggregate choice counts, simulation/demo labels, source title, and (only after reveal) calculation plus the concise assumption summary. No session seed, operator-selected hidden condition, raw actor identity, or chat text.
- **Operator snapshot:** public information plus the seed and current selection needed to operate or replay the run.
- Studio and overlay use distinct SSE clients; each update serializes the correct snapshot audience. Streams send an initial snapshot, heartbeat comments, and fresh snapshots on state changes. The browser automatically reconnects; server-side timers close expired prediction windows.

## Persistence and data lifetime

SQLite stores session state, phase-event summaries, keyed actor hashes, aggregate choice rows, and optional provider delivery IDs. It does not store raw chat messages or display names. Session-linked rows cascade away when the session expires; pruning runs at startup and periodically. The default retention is 24 hours. Exports are operator-only and include a replay seed, so treat exported run notes as operator data.

## Authentication and request safety

Operator endpoints require an eight-hour signed HttpOnly/SameSite cookie. Mutating requests require a matching same-origin `Origin`; deployment behind HTTPS proxy requires explicit `TRUST_PROXY_HTTPS=1`. Login has an HMAC-keyed, in-memory rate limit, request bodies are bounded, and responses set CSP, `nosniff`, referrer, and permissions headers. Local demo auth is not a substitute for a production identity provider; do not expose this prototype directly to the public internet.

## Relevant modules

- `src/content/lessons/albedo-lab.json` — version, audience/readability, controlled variables, bounded settings, expected golden outputs, safety examples, assumptions, and NASA citation.
- `src/domain/lesson.js` — lesson contract, source-host allowlist, finite input validation.
- `src/domain/simulation.js` — deterministic seeded model and invariant vectors.
- `src/domain/lab-engine.js` — phase machine, hidden-until-reveal result, pause/resume, reset/replay.
- `src/application/lab-service.js` — session lifecycle, validation, dedupe, public/operator snapshots, recap.
- `src/adapters/storage/sqlite-store.js` — transactional SQLite state/event/prediction storage.
- `src/adapters/security.js` — cookie signing, same-origin validation, keyed digests.
- `src/server.js` — HTTP routes, authentication, SSE, exports, health, retention timers.
- `public/` — accessible operator studio, exact read-only overlay, data/limits page, local styles.
- `test/` and `e2e/` — unit, persistence, HTTP, security, end-to-end, responsive, and axe checks.

## Deliberate integration boundary

The product reports `twitchIntegration: pending`; there is no OAuth callback, token vault/revocation, EventSub subscription/signature verifier, chat listener, live vote route, or real-channel acceptance test. The service/store are shaped to accept a normalized finite choice and dedupe ID in a future provider adapter, but that contract has not been connected or validated against Twitch. Do not represent the simulator as live integration.
