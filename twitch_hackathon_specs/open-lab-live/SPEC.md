# Open Lab Live — Product & Engineering Specification

**Version:** 1.0 · **Status:** implementation-ready proposal · **Category:** participatory science / interactive learning stream.

## 1. Product definition

**One-line pitch:** A streamer hosts a short, safe simulation; chat predicts the result, chooses a variable, and sees a source-backed reveal.

**Problem:** Educational streams can become passive explanations. Polls create participation but often do not make audience choices affect a visible outcome or support a clear learning loop.

**Product promise:** In a few minutes, viewers make a prediction, influence one bounded simulation, compare the result, and see where the explanation came from. It is an informal learning aid, not formal instruction or a scientific instrument.

### Goals
- One complete 3–5 minute experiment loop: prediction → input → simulation → reveal → source.
- Chat choices visibly affect deterministic simulation output.
- Streamer owns pacing and can pause/reveal/replay.
- Content uses a curated source card and explicitly distinguishes simulation from real measurement.
- A local demo can be replayed without a Twitch connection or external model provider.

### Non-goals
- Physical experiments, dangerous instructions, medical/engineering advice, or real-time telemetry.
- General-purpose tutor, freeform model lesson generation, live web retrieval, multi-language automatic translation, or multiple lesson packs in MVP.
- Scoring individual viewers, competitive leaderboards, payments, or donation collection.

## 2. Initial lesson and learning objective

Choose a simple, low-risk **pollinator patch simulation** or another approved school-level concept after checking overlap with the selected project. For distinctness from Habitat Relay, Open Lab’s core should be an explicit experimental method: viewers make a prediction, set one variable, observe a controlled result, and compare prediction to simulation. Keep variables, ranges, equations/heuristics, assumptions, and sources visible in docs.

Each lesson definition includes:
- learning objective, audience level, accessibility reading level;
- starting state and discrete variables;
- allowed experiment choices and deterministic rules;
- expected outputs and bounded explanation;
- source metadata, checked date, and caveats;
- safe and unsafe prompt examples for moderation.

## 3. User journey and functional requirements

### Viewer journey
1. Viewer sees the question and prediction choices on the overlay.
2. Viewer votes via a constrained chat command (e.g. `!predict 2`).
3. Operator closes prediction and chooses/accepts an experimental parameter.
4. The simulation updates from the explicit parameter and session seed.
5. Overlay reveals result and a concise comparison (“Our prediction / simulation outcome / why”).
6. Source card and assumption note remain visible long enough to read.

### Streamer journey
- Load lesson, preview the run, connect Twitch or start demo.
- Start prediction; view aggregate counts; close; select/confirm parameter; run/reveal.
- Pause or reset at any point; replay from seed for the recording.

### Acceptance outcomes
- The outcome changes when the audience-selected input changes, and this relationship is visible in the demo.
- Same lesson version + seed + input sequence yields identical result.
- No external model response is required to calculate or reveal the experiment.
- Source, assumptions, and “simulation” label are visible; no viewer answer is described as objectively right/wrong without context.

## 4. Architecture

```text
EventSub chat ─> adapter ─> normalized PredictionSubmitted ─┐
                                                            ├─> domain lesson engine
Studio control ─> application command ──────────────────────┘          │
                                                               SQLite event log
                                                                      │
                                                   snapshot/event stream ─> overlay
                                                                      │
                                                                    studio
```

### Suggested modules
- `lessons/`: versioned JSON lesson content and schema.
- `domain/lesson-engine.ts`: pure calculation, validation, and state transitions.
- `domain/session.ts`: prediction windows, pause/resume, reveal, reset.
- `application/`: command handling, dedupe, idempotency, source display.
- `adapters/twitch/`: OAuth/EventSub connection and event mapping.
- `adapters/storage/`: SQLite event log and current snapshot.
- `web/studio/`: lesson selection, controls, connection health, preview.
- `web/overlay/`: transparent broadcast view, read-only.
- `simulator/`: fixed event script and deterministic seed.

### Data contracts
- `LessonDefinition`: id, version, objective, variable specs, choice catalogue, simulation function/version, sources, caveats.
- `LabSession`: id, lessonVersion, seed, phase, selectedParameter, predictionsAggregate, revision, timestamps.
- `LabEvent`: `PredictionAccepted`, `PredictionClosed`, `ParameterSelected`, `ExperimentRun`, `ResultRevealed`, `SessionPaused`, `SessionReset`.
- `OverlaySnapshot`: phase, prompt, prediction tally, selected parameter, outcome label, explanation, source label, simulation notice.

Avoid eval/dynamic code in lesson definitions. Use validated declarative data and a finite set of reviewed simulation functions. Validate numeric bounds on both authoring and runtime paths.

## 5. Engineering quality and safety

- Deterministic pure-function engine with injected seed and explicit lesson version. Add golden test vectors for all outcomes.
- EventSub input normalized and schema-checked; dedupe by provider event ID and one-vote-per-chatter/per-round key; rate limits prevent spam.
- Session transitions atomic and revisioned. Browser clients cannot set outcome directly; only application commands invoke the domain engine.
- Presenter/overlay gets only a safe snapshot; operator API requires authenticated session and CSRF protection.
- OAuth minimum scopes; tokens server-side; logs redact identity and text by default.
- Lesson content is reviewed and versioned; source URL is HTTPS; explanatory claims link to source and are date checked. Do not generate science claims from an LLM in the hackathon MVP.
- Never describe simulated outcome as a real experiment or measured ecological result. Place the simulation disclaimer on both overlay and recap.
- Accessibility: include text descriptions for visual changes and no audio-only feedback.

## 6. Phase plan and definitions of done

### Phase 0 — Lesson, safety review, and measurable demo (Oct 28, T-5)
**Work:** choose one bounded lesson and objective; validate factual basis; write one-minute story; specify variables/rules and expected outputs; define safe scope; choose one source; map EventSub/controls; sketch overlay and operator control room.

**Done means:** a reviewer can calculate expected output by hand from the documented rule; source supports the explanation; no physical safety instructions; simulation limitation is explicit; one audience choice changes a visible outcome; final storyboard fits under 90 seconds; all interaction states are mapped.

### Phase 1 — Engine, lesson schema, and replay fixtures (Oct 29, T-4)
**Work:** implement strict lesson schema, finite rule engine, seeded simulator, fake clock, event fixtures, and unit/golden tests. Build static overlay with fixture state and source card.

**Done means:** all golden vectors pass; invalid/out-of-range values are rejected; repeated replay yields same result; no `eval` or model computation; demo follows the exact lesson path; source/caveat is present in all reveal states.

### Phase 2 — Twitch vertical slice and operator controls (Oct 30, T-3)
**Work:** implement selected official Twitch auth/EventSub model; receive constrained prediction command; dedupe and aggregate; connect studio close/parameter/run/reveal actions to engine; persist events and recover active session.

**Done means:** one live vote is reflected in tally; duplicate messages do not overcount; broadcaster can close and reveal; restart recovers a safe, coherent state; disconnected state cannot falsely show live-ready; credentials do not appear in browser or OBS URL.

### Phase 3 — UI polish, accessibility, and failure handling (Oct 31, T-2)
**Work:** finish setup, control room, overlay and recap; implement large-readable labels, reduced motion, offline/reconnect states, keyboard operation, automated browser tests, and axe scans.

**Done means:** experiment question and accepted input are readable at broadcast scale; result includes text explanation independent of graphic; every operator action has an accessible label; `prefers-reduced-motion` is honored; error and no-vote outcomes are coherent; no critical accessibility violations remain; manual review covers keyboard and screen reader.

### Phase 4 — Live verification, video, and freeze (Nov 1–2, T-1/T-0)
**Work:** run real broadcaster + human viewer test, verify prediction and reveal, test offline simulator, record under-three-minute video, clean-clone install, write README/architecture/lesson citations, capture real Codex session ID, and submit with buffer.

**Done means:** a fresh clone runs demo and tests; video clearly labels demo vs live and shows Twitch action driving result; source and simulation limitation appear on screen; build/test commands pass; README gives exact setup and required scopes; no credentials/PII are committed; Codex ID is authentic; submission is confirmed before deadline.

## 7. Verification plan

- Unit/golden: each rule branch, input boundaries, seeded outcome, lesson-version compatibility.
- Property: bounded outputs, invariant preservation, deterministic replay, no direct client-provided outcome.
- Contract: lesson schema, EventSub fixtures, overlay snapshot, source metadata.
- Integration: transaction/restart recovery, dedupe, pause/resume, connection lifecycle mocks.
- E2E: demo prediction → operator close → parameter selection → reveal → source/recap; offline/no-vote path.
- Manual: real Twitch test; OBS scale; keyboard-only studio; reduced-motion mode; screen-reader output for result and source.

## 8. Rubric strategy and evidence

- **Innovation:** demonstrate the full experiment loop, not just a poll; audience input changes a deterministic experiment.
- **Potential impact:** articulate one learning objective and present a source/assumption; avoid claiming formal educational outcome without testing.
- **Technological implementation:** show versioned lesson contracts, deterministic seeded engine, EventSub, durable events, replay, and automated tests.
- **Design:** create anticipation before reveal; make result legible and satisfying; explain why the simulation behaves as it does.

**Evidence bundle:** lesson card with source, rule diagram, golden test examples, live-vote clip, overlay before/after, demo label, setup instructions, and genuine Codex session reference.

## 9. Risks and cut line

- If the science concept cannot be verified quickly, switch to a known simple authored model or defer the project; do not improvise authoritative claims.
- If EventSub is late, preserve the deterministic interactive demo but do not claim live Twitch support.
- Avoid AI-generated experiments, free text answer evaluation, external data APIs, and multiple lessons before the vertical slice is stable.
- Cut confetti, sound, lesson selection, analytics, and chat replies before cutting the visible experiment effect, source card, or tests.
