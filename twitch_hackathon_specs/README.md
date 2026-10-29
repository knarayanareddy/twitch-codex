# TwitchCon Codex Hackathon — Four Product Specifications

**Document status:** proposal / implementation-ready design. These are four independent concepts; each has its own end-to-end product/engineering spec and UI/UX design brief. Do not build all four for one submission. Select one, record the real Codex session used for substantive implementation, and verify the current official rules before submitting.

## Project folders

1. [`habitat-relay/`](habitat-relay/SPEC.md) — cause-oriented collaborative habitat simulation.
2. [`context-desk/`](context-desk/SPEC.md) — human-reviewed, source-first live context cards.
3. [`quiet-quest/`](quiet-quest/SPEC.md) — access-first community participation game.
4. [`open-lab-live/`](open-lab-live/SPEC.md) — Twitch chat steers a bounded interactive experiment.

Each folder contains `SPEC.md` and `UI_UX.md`. The specs include scope, users, flows, architecture, data/state model, phase plan, verification strategy, risks, and project-specific definitions of done. The UX briefs include visual direction, information architecture, key screen compositions, interaction and accessibility requirements, and design review gates.

## Sprint assumptions and schedule

The hackathon submission deadline is **November 2, 2026 at 5:00 p.m. EST** (23:00 in Amsterdam on that date). At the time this design set was prepared (October 28), this is a very short build window. The five-phase schedule in each spec is a risk-managed plan for **one selected project**, not a plan to deliver four products simultaneously. Reduce scope before cutting verification or the working Twitch demo.

- **T-5 / Oct 28:** choose one concept, freeze its smallest demonstrable loop, validate Twitch auth and event receipt.
- **T-4 / Oct 29:** build domain logic, fixtures, and the simulator.
- **T-3 / Oct 30:** connect Twitch input, streamer controls, state persistence, and overlay updates.
- **T-2 / Oct 31:** finish a coherent visual system and accessibility states; test failure and recovery paths.
- **T-1 / Nov 1:** run live Twitch verification, record the demo, freeze feature scope, prepare repository and submission materials.
- **T-0 / Nov 2:** final clean-room verification and submit with time buffer; do not plan on uploading at the deadline.

**No fabricated evidence:** clearly distinguish simulated, mocked, and live-verified behavior. A real Codex session ID must be captured from the actual build session; never copy another project's ID.

## Shared engineering baseline

The projects are designed around a small, auditable single-channel product:

- TypeScript, Node.js, React/Vite, one local Node process, Twitch EventSub WebSocket through a maintained library such as Twurple, SQLite for durable session state, and SSE or a read-only WebSocket for overlay snapshots.
- Separate the transport adapters, application services, deterministic domain core, persistence, and presentation. The domain core must not import Twitch, React, the database, wall-clock APIs, or random-number globals.
- Use explicit schemas for inbound events and external content; validate at boundaries. Normalize chat messages to small internal event types; do not pass raw provider payloads into UI components.
- Deduplicate provider deliveries and command replays. Make state transitions atomic. Inject clock and RNG for deterministic tests. Reconnect with bounded exponential backoff and expose operator-visible connection status.
- Keep OAuth credentials server-side, request the smallest scopes, protect cookie-backed state-changing routes with CSRF defenses, use secure/HttpOnly/SameSite cookies in production, redact secrets from logs, and never place tokens in OBS URLs or client bundles.
- Provide a local simulator with fixed fixtures so the principal experience can be demonstrated without a Twitch account. Label simulated traffic in the UI and recording.
- CI should run formatting, lint, typecheck, unit/domain tests, integration tests with fixtures, production build, and browser smoke tests. A minimal CI pipeline is part of “done,” not a later enhancement.

Twitch’s current documentation distinguishes installed chat clients and cloud chatbots. EventSub WebSocket subscription authorization must be implemented according to the selected model and current scope requirements; validate against official Twitch documentation rather than copying old IRC examples. See [Twitch chat authentication and EventSub](https://dev.twitch.tv/docs/chat/authenticating/), [the Twitch chatbot guide](https://dev.twitch.tv/docs/chat/chatbot-guide/), and [Twurple](https://github.com/twurple/twurple).

## UI/UX research approach

The design briefs use these references as **process aids, not visual templates**:

- [Impeccable](https://github.com/pbakaus/impeccable): use a deliberate design vocabulary and focused passes such as critique, audit, polish, and harden. The project is active as of October 28, 2026. Treat its output as critique, not authority; accept decisions only when they fit the product and can be tested.
- [UI UX Pro Max](https://github.com/nextlevelbuilder/ui-ux-pro-max-skill): use its searchable style, palette, typography, UX-rule, and stack guidance to compare directions and document a coherent system. Select one art direction; do not blindly mix suggested patterns or paste a stock dashboard aesthetic.
- [Playwright accessibility testing guidance](https://playwright.dev/docs/accessibility-testing): automated scans are useful but cannot detect every accessibility problem. Pair them with keyboard, screen-reader, reduced-motion, and manual review.
- [W3C WCAG 2.2](https://www.w3.org/TR/WCAG22/): use WCAG 2.2 AA as a design and test target for the app UI. Do not claim conformance solely because automated tests pass.

### Shared visual quality bar

- Create a project-specific identity, not the default AI-generated SaaS dashboard. Define a restrained palette, type scale, spacing scale, icon treatment, and motion principles before implementing screens.
- The OBS surface is broadcast graphics: transparent canvas, explicit safe areas, high legibility at stream scale, self-contained visuals, and no decorative panel that hides the gameplay or host.
- The operator UI is a tool, not a second broadcast. Prioritize state, next action, and recovery; keep the primary control obvious and avoid nested-card clutter.
- Text and controls must remain understandable without color or animation. Support keyboard operation, visible focus, labels, errors, empty/loading/offline states, and `prefers-reduced-motion`.
- Test the overlay at 1920×1080, 1280×720, a narrow dock, and a mobile-width operator view. Confirm that text remains legible when OBS scales the browser source down.

## Cross-project phase gates

Each project spec refines these common gates. A phase is not complete because code exists; the stated evidence must exist.

1. **Product and risk freeze:** user story, one-minute demo narrative, non-goals, privacy/safety constraints, event map, and wireframes approved.
2. **Domain core:** typed contracts, state machine, deterministic behavior, unit tests, and simulator pass without Twitch credentials.
3. **Twitch vertical slice:** OAuth/authorization works for the chosen official flow; one live chat event causes a meaningful, visible, safe state transition; reconnect and duplicate delivery are handled.
4. **Experience hardening:** operator and overlay states are complete; responsive and accessibility checks pass; critical failures are recoverable and documented.
5. **Release and submission:** clean install/build passes; live evidence is accurately labelled; 3-minute-or-shorter demo shows Twitch behavior and Codex use; repository, setup, demo, project summary, and real Codex session ID are ready before the cutoff.

## Sources and inspiration reviewed

Recent project references include [Mythweave](https://github.com/vickman787/mythweave), [SceneShift](https://github.com/raphaelmichoud/sceneshift-twitch), [StreamPulse](https://github.com/195440/stream-pulse), [Chat Is This Real](https://github.com/Marc-Dvci/chat-is-this-real), [Chat Clash](https://github.com/clccmatteo/chat-clash), and [TwitchWatcher](https://github.com/Istalry/TwitchWatcher). The prior research reviewed public repository descriptions and README-level claims; it did not execute or security-audit those repositories. Use them to study patterns, not to copy their code, assets, copy, or distinctive mechanics.
