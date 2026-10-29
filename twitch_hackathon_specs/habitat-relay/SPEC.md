# Habitat Relay — Product & Engineering Specification

**Version:** 1.0 · **Status:** implementation scope delivered for local demo and mocked Twitch adapter · **Primary audience:** one streamer, Twitch chat, and viewers watching the broadcast.

> **Verification boundary (2026-10-28):** the local demo, server, OAuth/EventSub adapter, database, studio, read-only OBS view, recap, and automated tests are implemented. The explicitly excluded real Twitch authorization and live-chat acceptance are not verified; mock tests are not live evidence. See [`docs/VERIFICATION.md`](docs/VERIFICATION.md) for remaining human/manual release checks and [`docs/DECISIONS.md`](docs/DECISIONS.md) for the local-only security boundary.

## 1. Product definition

**One-line pitch:** A Twitch community restores a simulated habitat through cooperative, streamer-approved decisions, then leaves with a sourced, voluntary real-world action.

**Problem:** Live audience participation often rewards volume and reaction speed, while cause-themed streams can show a donation counter without helping viewers understand the issue or choose an appropriate next step.

**Product promise:** Within one short stream segment, chat can make a visible, consequential choice; the audience can understand the ecological trade-off; and the streamer can show one verified external resource. The simulation never represents itself as real restoration.

### Goals
- Deliver one complete 3–5 minute interactive habitat scenario.
- Make chat input visibly change the habitat and its game state.
- Give the streamer pause, approve, undo-last-transition (where safe), reset, and demo controls.
- Tie each scenario choice to a concise source card and final optional action.
- Work in OBS as a transparent, self-contained Browser Source overlay.

### Non-goals for the hackathon MVP
- Claiming real-world impact, tracking donations, fundraising, or collecting pledges.
- User accounts for viewers, multi-channel SaaS, mobile native apps, or multi-platform chat.
- AI-generated ecological facts, unmoderated chat-to-action, real-time geospatial mapping, or a general game-authoring engine.
- A production-grade scientific model. The habitat is an authored, clearly labelled educational simulation.

## 2. Users and jobs

- **Broadcaster/operator:** start a scenario, understand connection state, control progression, and recover from a mistake without exposing credentials.
- **Chat participant:** make a contribution with a short command; see whether it counted and how it affected the shared state.
- **Viewer who does not type:** understand what the audience is deciding and see the result without relying on chat scrollback.
- **Cause-content editor (can be the team):** prepare sourced scenario cards, explain uncertainty, and ensure external action links are legitimate and optional.

## 3. Experience contract and acceptance outcomes

### Primary flow
1. Operator opens local studio, connects the chosen Twitch account, verifies channel, and launches demo or live mode.
2. Overlay displays scenario title, habitat state, current round, deadline, and participation instructions.
3. Chat contributes using the displayed command (e.g. `!habitat 1`); the app validates and deduplicates it.
4. The overlay shows a live tally with count and percentage, not a wall of usernames.
5. At the round close, the deterministic rules engine applies the selected option. If the round is configured as consequential, streamer approval is required before commit.
6. The habitat animation/state changes; a short trade-off explanation and source citation become visible.
7. A final card offers an external action link and makes explicit that the game score is simulated.
8. Operator can export an anonymized session recap and reset.

### MVP acceptance criteria
- One scenario runs from start to final card in demo mode without network access.
- During live verification, an authorized Twitch chat event is received and produces exactly one valid vote/state transition.
- Duplicate EventSub delivery does not create a second vote or extra resource decrement.
- Streamer pause stops round timers and the overlay clearly shows paused state.
- Reset returns the exact initial state; export omits chat text and raw Twitch tokens.
- Every educational claim displayed has a source record; the action card is optional and distinct from game scoring.

## 4. Content and game rules

### Scenario structure
Use a single authored scenario: **Pollinator Corridor**. The opening state is a simplified landscape with a limited fictional resource budget. Each round presents two or three viable interventions; choices have understandable, non-binary trade-offs. The engine uses explicit state fields (e.g. habitat connectivity, pollinator shelter, water stress, community resource budget) with bounded integer values.

Avoid representing ecosystem variables as scientifically predictive. UI copy should say “scenario simulation” and explain that outcomes are authored for play. Each card contains: title, plain-language summary, trade-off, source title/author, source URL, publication/checked date, and optional next-step link. Content is stored as versioned JSON and reviewed manually.

### Participation rules
- Accept only well-formed commands for the active round.
- One vote per stable Twitch chatter identity per round; never expose identity in the broadcast by default.
- Invalid or late votes receive a quiet, rate-limited acknowledgement only in the studio log; avoid spam replies.
- Threshold and tie-break behavior are fixed and documented. Default tie-break is streamer choice, not random chance.
- The broadcaster can close early, pause, or discard a round. Streamer action is recorded as an event.
- Do not reward repeated messages, subscriptions, bits, or donations in the MVP.

## 5. System architecture

```text
Twitch EventSub WS ──> Twitch adapter ──> Event normalizer ──> Application service
                                                               │
                                                       Habitat domain reducer
                                                         │              │
                                                   SQLite event log   State snapshot
                                                                          │
Studio UI ── operator commands / REST ────────────────────────────────────┤
                                                                          └──> Overlay SSE/WS
```

### Suggested stack
TypeScript, Node.js, React/Vite, Twurple for Twitch integration, SQLite, Zod (or equivalent runtime schemas), Vitest/Node test runner, Playwright, and `@axe-core/playwright` for automated checks. Keep all assets local in the project; the OBS overlay must not depend on external fonts or runtime image services.

### Boundaries
- `domain/`: pure reducer, rules, state types, content references. No I/O imports.
- `application/`: commands, validation orchestration, event deduplication, transaction boundary.
- `adapters/twitch/`: OAuth, EventSub session lifecycle, provider event mapping.
- `adapters/storage/`: SQLite repositories, schema and migrations.
- `server/`: studio APIs, auth/session, overlay snapshot transport, health endpoint.
- `web/studio/`, `web/overlay/`: separate operator and broadcast views.
- `content/`: schema-validated scenario, sources, copy, external links.

### Core contracts
- `GameSession`: `id`, `scenarioVersion`, `phase`, `roundIndex`, `state`, `startedAt`, `pausedAt?`, `revision`.
- `DomainEvent`: `VoteAccepted`, `RoundClosed`, `ChoiceCommitted`, `SessionPaused`, `SessionResumed`, `SessionReset`, `FinalActionViewed` (viewed is aggregate-only; no identity required).
- Every external command includes a provider delivery/event ID, received timestamp, and normalized actor key. The actor key is used only for session-level dedupe; do not log raw identity in normal logs.
- `OverlaySnapshot`: schema-versioned, read-only, no tokens, no raw chat, no private moderation/control values.

### Reliability requirements
- Persist each accepted domain event and resulting revision atomically.
- Enforce unique provider delivery ID and unique vote key `(session, round, actor_hash)`.
- Use injected monotonic clock for timers and persisted wall time for audit display; never compute duration from client clocks.
- Reconnect with bounded exponential backoff and jitter; on reconnect, reconcile channel/session state and clearly mark stale data until ready.
- Apply rate limits at command ingress and use a per-channel send queue if acknowledgement messages are enabled.

## 6. Privacy, safety, and security

- Request only the scopes required by the selected installed-chat flow and current Twitch documentation. Re-check scopes against the official reference before live test.
- Keep refresh/access tokens out of browser storage, URL query/fragment, logs, screenshots, exports, and OBS source URL. Prefer encrypted-at-rest tokens or an in-memory-only demo token path.
- Studio state-changing requests require CSRF protection and same-origin checks; overlay is read-only and unauthenticated only through an unguessable, revocable session identifier.
- Hash actor identifiers with a per-session salt; do not keep a cross-stream viewer profile. Delete identity-derived vote data on reset/retention expiry.
- Validate URLs against a strict `https` allowlist for source and action links. Use rel-safe links and no arbitrary HTML in cards.
- Keep cause copy non-prescriptive, localized in plain language, and honest about simulation vs real-world outcomes.

## 7. Phase plan and definitions of done

### Phase 0 — Product lock and content safety (Oct 28, T-5)
**Work:** freeze scenario to one habitat/three rounds; write a 90-second story beat; decide voting/tie/timeout rules; prepare 3–5 reviewed source/action cards; create event and state diagrams; define what is simulated; sketch overlay and studio at 1920×1080 and 1280×720; select auth flow and scopes from current Twitch docs.

**Done means:** product brief has one primary user story and explicit non-goals; all displayed claims map to source entries; each choice and state change is enumerated; an architecture decision record documents transport, persistence, token handling, and demo mode; wireframes show loading/empty/offline/paused/error states; no unresolved legal or factual claim is presented as confirmed.

### Phase 1 — Domain core and simulator (Oct 29, T-4)
**Work:** implement typed state machine and reducer; create content schema; implement seeded simulator and transcript fixtures; implement event-log persistence interface and in-memory adapter; add unit/property tests for voting, ties, timer close, pause/resume, reset, invalid input, and resource bounds.

**Done means:** domain tests run offline and deterministically; every transition has a test and documented invariant; invalid events leave state unchanged; a scripted demo reaches the final action card; no React/Twitch/SQLite imports occur in the domain layer; reviewers can replay fixtures and obtain identical snapshots.

### Phase 2 — Twitch vertical slice and durability (Oct 30, T-3)
**Work:** implement account authorization, channel selection, EventSub WebSocket subscribe/ready flow, normalized `ChatCommand` event, dedupe, vote persistence, operator start/pause, and overlay snapshot stream. Build a visible connection state machine (`disconnected`, `authorizing`, `connecting`, `ready`, `recovering`, `error`).

**Done means:** one real authorized message in the target channel increments one vote visible in the overlay; replaying its fixture or delivery ID does not increment again; token expiry/revocation yields actionable operator guidance; reconnect restores state without duplicating a round transition; secrets are absent from client bundle, logs, overlay, and repository.

### Phase 3 — Visual finish and accessibility (Oct 31, T-2)
**Work:** implement studio/overlay layouts, source/action cards, game-state transitions, operator confirmation for reset/commit, reduced-motion variant, keyboard navigation and accessible labels. Add browser tests for viewport and primary flows. Run axe scans on key states, then manual keyboard and screen-reader spot checks.

**Done means:** studio is usable at desktop and mobile widths; overlay stays readable at intended OBS source dimensions; every interactive control has a visible focus indicator and meaningful name; state does not rely on color or motion; prefers-reduced-motion removes nonessential animation; no critical automated accessibility violations remain; manual check findings are recorded and resolved or explicitly listed.

### Phase 4 — Live acceptance, submission, and freeze (Nov 1–2, T-1/T-0)
**Work:** clean clone/install, run CI, perform live auth and Twitch event test, test disconnect/restart, record a rehearsal, capture Codex session ID, write setup/run instructions, add screenshots, license/provenance notes, demo script, and submit with a buffer.

**Done means:** fresh environment can run simulator and production build; live and simulated footage are clearly distinguished; video under three minutes shows the working Twitch experience and how Codex was used; repository contains source/assets/run instructions; Codex session ID is the genuine project-building thread; no uncommitted credential or broken setup step remains; submission is confirmed before cutoff.

## 8. Verification plan

- **Unit:** reducer invariants, voting, tie resolution, resource bounds, pause/freeze, event ordering.
- **Contract:** Twitch sample payloads map to normalized events; content JSON validates; overlay snapshot contains no forbidden fields.
- **Integration:** SQLite transaction rollback, unique event constraints, restart recovery, token lifecycle mocks.
- **Browser E2E:** demo flow, operator pause/approve/reset, overlay updates, failure and reconnect display, export/download.
- **Manual:** live chat test with one operator and one human viewer; check OBS Browser Source at actual scene scale; keyboard-only operator flow; screen-reader status announcement.
- **Release:** lint, typecheck, tests, build, secrets scan, license/dependency review, clean-install test.

## 9. Rubric strategy and evidence

- **Innovation:** show the causal chain from a chat choice to habitat consequences and then to an evidence-based action card. Do not pitch it as merely an environmental-themed poll.
- **Impact:** name the intended learning/awareness outcome; show citations and an optional external action. Make no unsupported impact metric claims.
- **Technological implementation:** demonstrate deterministic transitions, EventSub receipt, duplicate protection, persistence/reconnect, simulator, and automated tests.
- **Design:** make the habitat change readable in a small overlay; use an emotionally coherent reveal; show a calm, usable studio with a visible connection state.

**Judge-ready evidence:** one-page architecture diagram; short test summary; an uncut live Twitch interaction segment; source card close-up; screenshots at OBS scale; clear statement of what is simulated and what was live verified.

## 10. Key risks and cut line

- **Scope creep:** cut scenario variety, personalization, and AI before cutting the end-to-end loop.
- **Twitch auth problems:** retain a fully labelled simulator; never claim live integration based on mocks.
- **Misleading cause claims:** keep content authored and source-linked; remove any claim that cannot be verified before demo.
- **Low readability:** prioritize text labels and simple landscape transformations over intricate canvas animation.
- **Last-minute instability:** feature freeze by Nov 1; only fix blockers after that.
