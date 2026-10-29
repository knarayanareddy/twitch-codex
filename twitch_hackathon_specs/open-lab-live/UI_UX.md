# Open Lab Live — UI/UX Design Brief

## 1. Art direction

**Direction:** “A live field notebook.” Use an editorial science-exhibit identity: a dark, broadcast-ready canvas with a strong central experiment visualization, a single accent for active input, and paper-like surfaces in the operator’s notes. Contrast anticipatory prompt and result reveal through layout and typography, not through flashing or a sudden color blast.

The overlay is the teaching surface: it should show the question, the audience input, the result, the explanation, and the source without requiring chat scrollback. The control room is a backstage instrument panel with visible readiness and one obvious next action. Avoid generic SaaS metrics, periodic-table decoration unrelated to the lesson, glassmorphism, and a fake lab-coat aesthetic.

Use [Impeccable](https://github.com/pbakaus/impeccable) as a critique/audit/polish vocabulary and [UI UX Pro Max](https://github.com/nextlevelbuilder/ui-ux-pro-max-skill) for structured style and typography comparisons. Pick one product-specific direction, then test at actual OBS scale.

## 2. App structure

- **Lesson setup:** objective, assumptions, source, demo/live, connection.
- **Control room:** phase, prompt, prediction count, experiment parameter, run/reveal/pause, status.
- **OBS overlay:** experiment question and state visualization; final explanation/source card.
- **Recap:** prediction, chosen parameter, simulation outcome, assumptions, source.

The app should use phase language consistently: **Predict → Choose → Reveal → Learn**. Button labels and overlay state use the same vocabulary.

## 3. Screen details

### A. Lesson setup
- Lesson title with reading level and a one-line objective.
- “What this simulation represents” and “What it does not represent” expandable disclosure.
- Source link, checked date, lesson version, and demo/live mode choice.
- A clear “Preview the full demo” button before Twitch connection; live setup is a separate step.

### B. Control room
- Top readiness strip: Twitch connection, active lesson version, demo/live, session state.
- Main panel: current phase and one primary next action (`Start predictions`, `Close predictions`, `Run experiment`, `Reveal result`).
- Side preview: exact overlay render, not a mock illustration.
- Prediction tally is aggregate; show total sample count and avoid precision theater when the count is low.
- Controls for pause/reset are always discoverable but visually secondary; reset requires confirmation.
- If there are zero predictions, provide a neutral operator choice or “continue with no audience predictions”; never render an embarrassing failure state.

### C. OBS overlay
- Transparent background, self-contained local assets, no runtime external fonts or image requests.
- Prompt phase: large question, 2–3 numbered options, command instruction, small timer/status.
- Reveal phase: hold the question at the top, animate only the key variable, then show outcome and plain-language explanation.
- Source card sits in a predictable lower corner and does not cover the key state; label it `Source` plus title, not a tiny raw URL.
- Persistent `SIMULATION` tag in all phases and `DEMO` tag for fixture mode.
- Maintain safe margin from stream edges and test behind both dark and bright content.

### D. Recap
- Small structured report: question/prediction totals, selected parameter, result, rule/version, assumptions, citation, run timestamp.
- Keep simulation limits near the result. Export as Markdown and JSON with schema version.

## 4. Tokens and motion

| Token | Candidate | Use |
|---|---|---|
| `lab-ink` | `#101821` | overlay background region / primary text |
| `paper` | `#F5F2E8` | operator reading surface |
| `chalk` | `#F9FAF6` | overlay text |
| `signal-blue` | `#4FA6D8` | active input state with label |
| `coral` | `#D97760` | reveal accent, never error-only |
| `muted` | `#9AA8AF` | secondary text only after contrast validation |
| `font-display` | bundled editorial sans/serif with character | question and result |
| `font-ui` | system/bundled highly readable sans | controls, data, source |
| Motion | one short state transition; no looping animation | anticipation/reveal |

Use a bounded motion pattern: input closes, short pause, result appears, explanation follows. Under reduced motion, replace with immediate state changes and clear textual headings. Test contrast at full opacity and with any translucent panels.

## 5. Interaction, copy, and content design

- Tell viewers exactly what to type and when the vote closes.
- Make input confirmation explicit and rate-limited; never imply an individual answer was accepted if only aggregate count is visible.
- Use “simulation result” rather than “what happens in nature” unless the lesson truly supports the broader statement.
- Use “In this model…” and “Assumptions…” to keep cause/effect bounded.
- Avoid grades or wrong-answer shaming. If prediction differs from result, frame it as a comparison, not a judgement.
- Keep one primary action per phase; no parallel controls that can cause contradictory transitions.

## 6. Accessibility and responsive acceptance

- The prompt, input choices, result, and source are textual and available to assistive technology; the visualization has a meaningful text alternative.
- Keyboard-operable operator controls with visible focus and logical order; no focus trap in source disclosure.
- Live-region updates are concise: announce phase changes and final result, not every vote.
- Respect reduced motion and avoid flashes, rapid scaling, parallax, or auto-advancing text.
- Use icons alongside text; no state depends on hue alone. Meet WCAG 2.2 AA target checks where applicable.
- Test studio at 1280px and 390px; overlay at 1920×1080 and 1280×720; check 200% zoom and browser text scaling.
- Automated Playwright/axe scans cover prediction, no-vote, reveal, source, and error states; manual review tests keyboard and screen reader.

## 7. Design review gates

1. **Learning clarity:** viewer can state the question and input in one glance.
2. **Causal clarity:** a viewer can tell which audience choice changed the simulation and what changed.
3. **Reveal timing:** the result is engaging but the transition does not obscure information or rely on motion.
4. **Source integrity:** source and assumptions are visible at the moment the explanation appears.
5. **Final critique:** conduct Impeccable-style critique for hierarchy and excessive decoration; use Pro Max for palette/type comparison; verify in the browser and OBS preview, not only a static mock.

## 8. Anti-patterns to reject

- A science-themed static poll where choices do not affect the outcome.
- A decorative 3D lab scene that hides text or increases implementation risk.
- Unlabeled axes, unexplained percentages, tiny source footnotes, or unsupported “correct answer” badges.
- Animation that implies measurement or scientific precision that the model does not provide.
- More than one experiment or lesson pack before the main loop, source card, and live Twitch event are solid.
