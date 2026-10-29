# Quiet Quest — Product & Engineering Specification

**Version:** 1.0 · **Status:** implementation-ready proposal · **Category:** access-first Twitch audience participation.

## 1. Product definition

**One-line pitch:** A cooperative Twitch experience where viewers can contribute without racing the chat, using either a short chat command or an accessible companion control.

**Problem:** Conventional chat games favor fast typists, frequent posters, and people who can parse a rapidly moving chat window. That can exclude viewers who use assistive technology, have limited motor/speech access, are new to the channel, or simply prefer not to post repeatedly.

**Product promise:** Give a viewer more than one clear way to make the same meaningful contribution, make the game outcome visible outside chat, and avoid rewarding spam or speed.

### Goals
- Deliver one complete 3-minute cooperative objective with a visible shared outcome.
- Accept equivalent actions from Twitch chat and an optional keyboard-accessible companion page.
- Ensure one contribution per participant per round and make scoring independent of message rate.
- Give the streamer pause, moderation, close, reset, and accessible session instructions.
- Make the overlay understandable without audio, chat access, or color perception.

### Non-goals
- Claiming full accessibility or replacing Twitch’s accessibility features.
- Speech recognition, voice biometrics, disability inference, or collecting accessibility profiles.
- Automatically mapping anonymous companion users to Twitch identities.
- Competitive speed runs, reward economies, public user rankings, or moderation automation.
- Complex multiplayer infrastructure or multiple simultaneous channels.

## 2. Actors and trust boundaries

- **Streamer:** starts and controls the session; owns the Twitch connection.
- **Chat participant:** contributes by a constrained command; stable Twitch ID is used only for per-round dedupe.
- **Companion participant:** contributes using a temporary session code in a browser. Anonymous web identity is weaker than Twitch identity and must be described honestly.
- **Viewer:** observes a broadcast status independent of chat scrollback.

**Identity rule:** The product does not claim that a browser companion participant is the same person as a Twitch chatter. Dedupe is per input channel. If the two input modes can be linked only with an explicit token or account flow, do not add that linkage in the MVP.

## 3. Core flow and mechanics

1. Broadcaster opens studio and selects Demo or Live.
2. The overlay provides a short instruction: “Choose one of three ways to help; no speed bonus.”
3. Viewer selects a contribution from chat (`!help 1`) or the companion page.
4. Backend validates session, round, allowed action, and per-source dedupe key.
5. Contribution increments an aggregate team meter; it does not create a public leaderboard.
6. At the end of a fixed contribution window, the engine applies the shared result and reveals what the group accomplished.
7. The streamer starts the next round or ends the session. Recap lists aggregate contributions only.

### MVP theme
Use an inclusive cooperative objective such as building a community festival space or restoring a shared library garden. Avoid claiming that the theme itself is a disability simulator. The inclusion principle is in the interaction model: low-speed, low-pressure, equivalent input modes.

### Fair participation rules
- One accepted contribution per source identity per round; no faster input earns more value.
- Each action has equal contribution value in MVP. If weighting is added, explain it and test it for inequity.
- Fixed or streamer-controlled windows; do not close early merely because one cohort is active.
- Invalid/duplicate actions receive private or low-frequency feedback, not repeated public chat messages.
- The streamer can pause and resume; paused time does not consume the round window.
- No public ranks or individual callouts by default.

## 4. Architecture

```text
Twitch EventSub ──> Twitch adapter ──┐
                                     ├─> Normalized ContributionCommand
Companion HTTP ──> Web adapter ─────┘             │
                                          Validation / dedupe
                                                   │
                                            Pure game reducer
                                            │               │
                                       SQLite events     Snapshot fanout
                                                           │
                                                Studio controls + OBS overlay
```

### Layers
- `domain/`: game state, action catalogue, round timer semantics, contribution reducer, invariants.
- `application/`: commands, identity-source policy, dedupe, session lifecycle, contribution acceptance.
- `adapters/twitch/`: OAuth, EventSub WebSocket, event mapping and connection status.
- `adapters/web/`: companion session, CSRF/origin checks, rate limits, opaque invite code.
- `adapters/storage/`: SQLite migrations, event log and checkpoints.
- `web/studio/`: streamer controls and setup.
- `web/companion/`: accessible contribution form, no account creation.
- `web/overlay/`: read-only transparent status.

### Core models
- `Session`: id, phase, round, state, createdAt, revision, mode (`demo|live`).
- `ContributionCommand`: sessionId, roundId, source (`twitch|companion`), actorKey, actionId, receivedAt, idempotencyKey.
- `ContributionAccepted`: eventId, actionId, source, acceptedAt; no display name by default.
- `OverlaySnapshot`: phase, round, prompt, timeRemaining, aggregate counts, connection state, accessible instruction.

### Security/reliability requirements
- Companion invite code is cryptographically random, revocable, scoped to one active session, and never grants operator privileges.
- State-changing companion requests require same-origin/CSRF protection, schema validation, rate limits, and server-side active-session checks.
- Twitch token remains server-side. Overlay and companion never receive it.
- Hash Twitch actor IDs with a per-session salt; delete hash keys at session retention boundary. Do not store raw chat messages.
- Idempotency uniqueness by `(sessionId, roundId, source, actorKey)` and delivery ID; transactionally update count and revision.
- Use integer server-side timestamps/monotonic timer; client timer is display only.
- WebSocket/SSE snapshots are read-only, versioned, and contain aggregate data only.
- On reconnect, duplicate input is ignored; UI marks stale state and operator can pause. Do not silently accept stale companion submissions.

## 5. Phase plan and definitions of done

### Phase 0 — Access principles, interaction parity, and story (Oct 28, T-5)
**Work:** identify the one barrier the MVP addresses; define chat and companion actions with exact parity; decide identity and dedupe boundaries; create one-round storyboard; define no-speed scoring; write user-facing privacy note; sketch studio, companion, overlay and error states.

**Done means:** a viewer can complete the action by either route; a low-vision/keyboard user can reach and submit the companion form; the product explicitly states that browser and Twitch identities are not linked; rules contain no speed bonus or public ranking; privacy/data inventory is approved; user story can be shown in 60 seconds.

### Phase 1 — Deterministic interaction engine and accessible static flow (Oct 29, T-4)
**Work:** implement domain types/reducer; create fake-clock test runner; implement companion action form against local simulator; add status messages, keyboard order, semantic controls, and empty/closed/duplicate outcomes.

**Done means:** full session works locally without Twitch; every transition and timing edge case has tests; duplicate identity contributes once; screen-reader output describes prompt, choices, result, and error; no action depends on pointer hover or color alone; timer test is deterministic.

### Phase 2 — Twitch adapter and dual-input vertical slice (Oct 30, T-3)
**Work:** implement official EventSub authorization and subscription; normalize Twitch command and companion POST to the same domain command; add session invite/revocation, rate limiting, dedupe, state persistence, and connection indicator.

**Done means:** one live chat command and one companion action produce the same state update; duplicate chat delivery is ignored; invalid/expired code is rejected; reconnect restores the active round; Twitch identity never leaks to overlay; operator can disable companion input.

### Phase 3 — Interaction polish and accessibility verification (Oct 31, T-2)
**Work:** complete overlay and responsive studio, make focus and status states consistent, implement reduced-motion mode and accessible help, run automated scans and manual keyboard/screen-reader checks, test mobile companion on narrow widths.

**Done means:** 390px companion page has no horizontal scrolling; all actions can be completed keyboard-only; live status is announced without repeated announcement spam; success/error messages are textual and persistent long enough to perceive; reduced-motion removes nonessential movement; axe has no unresolved critical violations; manual findings are recorded.

### Phase 4 — Live acceptance, evidence, and submission (Nov 1–2, T-1/T-0)
**Work:** test with broadcaster plus second viewer; verify chat and companion parity; rehearse reconnect and reset; clean-install; record a clear demo; capture genuine Codex session ID and repository/run instructions.

**Done means:** recorded video shows one real Twitch event and a companion action or explicitly labels any simulation; the operator can start/end without hidden commands; demo includes no identifying data beyond what is necessary; project builds from a clean clone; CI, setup, privacy, and scope docs pass; authentic Codex session ID is ready; submission is completed before the cutoff.

## 6. Verification strategy

- Domain unit/property: one-per-round, no speed weighting, fairness across sources, pause/resume, duplicate/stale command, reset.
- Contract: normalized Twitch and companion command share same schema; snapshot contains only aggregate safe fields.
- Security: invite entropy/revocation, CSRF, origin, rate limit, session isolation, no privilege escalation from companion path.
- E2E: simulator round; Twitch command; companion keyboard submission; reconnection; pause; reset; closed round; screen-reader status.
- Accessibility: Playwright/axe on start, active, submitted, duplicate, offline, and finished states; manual NVDA/VoiceOver or equivalent keyboard/screen-reader review; reduced-motion and zoom check.
- Live: two human accounts, one operator; verify the demo does not reward spam or show identity.

## 7. Rubric strategy and judge evidence

- **Innovation:** demonstrate equal game agency from two distinct input paths and a no-speed/no-spam participation model.
- **Potential impact:** explain the access barrier and show the alternative contribution flow; do not overclaim accessibility coverage.
- **Technological implementation:** show shared normalized command contract, identity boundaries, deterministic reducer, idempotency, reconnection, and a11y tests.
- **Design:** show chat instruction and overlay in one glance; let the companion path feel first-class, not a hidden fallback.

**Evidence:** annotated user-flow diagram; input parity table; short manual accessibility checklist; axe report and limitations; clip of chat and companion updating same overlay; privacy/data deletion description; real Codex session record.

## 8. Risk and cut line

- If companion identity/dedupe threatens the sprint, keep it session-scoped and clearly state it is not cross-linked to Twitch.
- If Twitch auth fails, simulator is for development only; do not claim live support. Cut companion network features only if necessary, but preserve the accessible chat command path and clearly call it a prototype.
- Never claim WCAG conformance from an axe pass. Prioritize complete keyboard flow, readable content, stable status, and manual assistive-tech checks.
- Cut multiple games, localization, sound, individual profiles, ranking, and animation before cutting parity, privacy, or testing.
