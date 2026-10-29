# Habitat Relay — UI/UX Design Brief

## 1. Art direction

**Direction:** “Field guide meets live ecosystem.” Use a warm, grounded, editorial visual language: an ink-dark broadcast canvas, pale field-note surfaces in the operator UI, botanical green/lichen, clay/amber for trade-offs, and a bright neutral for essential text. The overlay should feel like a small live nature exhibit, not a generic SaaS dashboard or a noisy game HUD.

The habitat illustration is the hero. Use simple original SVG/vector layers—land, water, vegetation, pollinators—whose state changes are explainable. Avoid heavy photorealism, stock nature photography behind text, glass effects, dense gradients, and ornamental cards inside cards. Do not lift artwork from reference repositories.

**Reference workflow:** consult [Impeccable](https://github.com/pbakaus/impeccable) for critique/audit/polish passes and [UI UX Pro Max](https://github.com/nextlevelbuilder/ui-ux-pro-max-skill) to compare palette/type/layout directions. Record the chosen tokens in the project, then verify in the actual browser/OBS scale. Neither tool is a substitute for product-specific design decisions.

## 2. Information architecture

- **Studio:** Connect → choose channel → choose Demo/Live → start session.
- **Control room:** connection/status rail; large current round; choice controls; audience tally; pause/resume/close; source/action details; event log.
- **OBS overlay:** habitat scene; round prompt; participation instruction; tally; state-change caption; optional source/action card.
- **Session recap:** rounds, accepted decisions, anonymized participation counts, cited resources, explicit simulation disclaimer.

The operator’s main action must be visible without scrolling. Put destructive actions (reset/end) behind a confirmation and visually separate them from round controls.

## 3. Screen specifications

### A. Connect / setup
- A single-column setup panel with a step indicator: “Connect channel” → “Preview overlay” → “Start.”
- Show the exact channel identity and connected account; require confirmation before starting a live session.
- Demo mode is a prominent, first-class option (“Try without Twitch”) rather than a hidden developer switch.
- Explain requested permissions in plain language and provide a cancel/disconnect action.
- States: no app config, authorizing, callback success, access denied, token expired, channel mismatch, retrying.

### B. Control room
- Header: Habitat Relay mark, channel name, LIVE/DEMO pill, connection health, session elapsed time.
- Main column (~2/3): landscape preview with current round and one-sentence objective; underneath, choice buttons and “Close round” action.
- Side column (~1/3): participation count, vote distribution, event freshness, source card, operator activity.
- Persistent status text: “Connected · Last event 2s ago” or “Reconnecting · votes temporarily paused.” Avoid relying on a green/red dot alone.
- Pause freezes the game clock and shows the same state in overlay. Resume states what will happen next. Reset is destructive and requires a confirmation with the session name.
- For a small viewport, side information moves below the main controls; no horizontal scrolling at 390px.

### C. OBS overlay
- Transparent page background. Layout target 1920×1080, but each widget stays legible when OBS scales it to a 700–900px-wide region.
- Core composition: a compact landscape illustration (roughly 50–60% of widget width); an adjacent text block with round, prompt, timer, and 2–3 response labels.
- Tallies use simple bars plus numeric labels; names and chat text are not displayed by default.
- State-change reveal lasts only long enough to understand; do not obscure the next prompt. Respect reduced motion with a cross-fade or direct state swap.
- Source card shows a short source name + “Open source” affordance; full URLs are available in the studio/recap. Final CTA is clearly external and optional.
- Always show a small “SIMULATION” label. In demo mode also show “DEMO DATA.”
- No inputs, login, token, or operator-only actions appear in the broadcast surface.

### D. Recap
- Vertical chronology: scenario → choices → consequence → source/action links.
- “Simulation, not measured restoration” disclaimer is near the top, not buried in a footer.
- Export controls: Markdown and JSON; JSON schema version is included. Export contains aggregate vote counts, never raw chat or viewer IDs.

## 4. Design tokens (starting point)

Treat these as initial candidates, not immutable brand rules. Check contrast before accepting.

| Token | Candidate | Usage |
|---|---|---|
| `ink-950` | `#101916` | broadcast background / primary dark |
| `forest-800` | `#244A3B` | secondary habitat region |
| `leaf-500` | `#77B77B` | positive habitat state and focus accent (with label) |
| `clay-500` | `#D98952` | trade-off / attention accent, never error-only by color |
| `paper-100` | `#F4F1E8` | operator surface and text on dark |
| `slate-600` | `#52615A` | secondary operator text only where contrast passes |
| Display type | a locally bundled expressive serif | scenario title / narrative beats |
| UI type | locally bundled/system sans | controls, values, labels, instructions |
| Spacing | 4px base, 8/12/16/24/32/48px scale | consistent rhythm |
| Shape | 4–8px corners in operator; restrained corners on overlay | avoid pill-everything styling |

Do not load Google Fonts in OBS at runtime. Bundle licensed font assets or use a strong local system stack. Validate each foreground/background pair, including hover, disabled, chart, and translucent-overlay states; do not assume the proposed palette passes contrast.

## 5. Interaction and content principles

- Use verbs on controls: “Start scenario,” “Pause,” “Close round,” “Commit choice,” “End session.”
- Display the command in the exact form viewers should enter, e.g. `Type !habitat 1`; include a numbered visual alternative.
- Vote state must be readable as both count and proportion. Never use motion as the only update signal.
- A source card says why the source is relevant, not merely “AI verified.” Use “Background source” or “Learn more,” not a trust badge.
- Error copy states the problem, its effect, and next action: “Twitch disconnected. Current round is paused; reconnect to continue.”
- Avoid live tickers of every vote, usernames, or escalating visual effects that create clutter or reveal identities.

## 6. Accessibility and responsive acceptance

Target WCAG 2.2 AA as a product-quality objective. Automated checks with Playwright/axe are a safety net, not a conformance certificate; Playwright explicitly recommends combining automation with manual and inclusive testing.

- Every studio control works by keyboard; focus order follows the visual sequence; focus is visible on dark and light surfaces.
- Screen-reader labels announce round, state, connection health, and validation errors. Live-region updates are throttled/coalesced to avoid announcing every vote.
- Never communicate state by color alone. Include labels/icons/numeric values.
- Respect `prefers-reduced-motion`; avoid pulsing, parallax, flashes, and continuous animation.
- Minimum text sizing: operator body 16px baseline; overlay text should be tested at final OBS output, not just CSS pixel size.
- Test desktop studio at 1280px, narrow operator view at 390px, overlay at 1920×1080 and 1280×720, plus reduced-motion and 200% browser zoom.
- Manual check: keyboard-only start/pause/close/reset; NVDA or VoiceOver announcements; color-blind simulation; text legibility over the target gameplay background.

## 7. Visual review gates

1. **Direction gate:** one moodboard, one palette, type pair, overlay composition, and list of rejected clichés approved before coding.
2. **Wireframe gate:** operator can explain the next action and connection state in five seconds; viewer can explain how to vote in one glance.
3. **Prototype gate:** real-scale OBS browser-source preview with sample content; source cards and numbers remain readable.
4. **Polish gate:** Impeccable-style critique for hierarchy, consistency, empty/error states, accessibility, and decorative excess; UI UX Pro Max comparison used only to test alternatives.
5. **Release gate:** screenshots at actual target dimensions, contrast results, axe report, keyboard review notes, and a 15-second overlay capture included in repository docs.

## 8. Anti-patterns to reject

- Generic dashboard hero metrics unrelated to the operator’s next decision.
- Gradient text, glowing borders, nested cards, random nature photos behind low-contrast type.
- Vote bars that rely only on hue; animated pollen clouds that never stop; continuously scrolling chat in the game region.
- Full-screen popup on every vote, forced account creation for viewers, or unexplained OAuth permission requests.
- Presenting fictional habitat scores as real conservation impact.
