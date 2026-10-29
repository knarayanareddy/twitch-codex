# Quiet Quest — UI/UX Design Brief

## 1. Art direction

**Direction:** “Warm, quiet co-op.” Create a calm, crafted shared-world interface that feels welcoming without infantilizing participants. Use a light parchment or deep dusk base with a small set of vivid, high-contrast contribution accents. The stream scene should be emotionally warm but visually still; the companion page should feel like a short, obvious form, not a mini game dashboard.

The experience is designed to be understood by someone who sees only the broadcast for a few seconds. The core visual is one shared objective with progress and an explicit next action. Avoid “accessibility = pastel,” medical iconography, pity language, flashing celebrations, dense chat feeds, and “retro pixel art” as a default shortcut. Select one illustration style and use original project assets.

Use Impeccable for hierarchy and polish critique and UI UX Pro Max to compare accessible/inclusive patterns. Follow [WCAG 2.2](https://www.w3.org/TR/WCAG22/) as a quality target; use [Playwright accessibility testing guidance](https://playwright.dev/docs/accessibility-testing) with manual checks.

## 2. Navigation

- **Studio:** setup, connect, demo/live, launch.
- **Control room:** session status, round instruction, pause/resume/close, aggregate contributions.
- **Companion:** one screen: enter session code → choose one action → confirm → see outcome.
- **OBS overlay:** common goal, progress, choices, time/status, no identities.
- **Recap:** aggregate result, contributor pathways as counts only, session reset/export.

## 3. Screen-level design

### A. Companion page
- Start with a plain-language title and a one-sentence explanation: “Help the community build the shared space. One contribution per round; speed does not matter.”
- Session code field with visible label, format example, paste support, and inline error guidance.
- Choice controls are full-width semantic buttons or radio cards with both text and icon; no small icon-only targets.
- After submit, show a persistent “Contribution recorded” confirmation and the shared progress summary. Do not rely on a disappearing toast.
- Keep a single primary action per step; preserve the selected option if a recoverable network failure occurs.
- No countdown pressure in the companion. If a round has a closing time, explain it and support a clear submission status.

### B. Operator control room
- Header: connection state, channel, LIVE/DEMO, active session, pause state.
- Main panel: current objective and next operator action.
- Progress panel: aggregate counts and which input sources are connected (if safe to show).
- A visible “Participation instructions” block mirrors the exact overlay copy.
- Destructive controls separated; “End session” and “Reset” require confirmation.
- Offline mode includes “Pause while reconnecting” rather than silently consuming time.

### C. OBS overlay
- Transparent background, one shared visual, one short instruction, large progress bar with text and number.
- Instruction examples: `Chat: !help 1` and `Companion: scan/open link` (show URL/QR only if it can be read and has text alternative).
- Show “No speed bonus” only if it fits clearly; avoid making the surface too dense.
- Use a small contribution-mode legend with text labels and recognizable icons, not color-only distinctions.
- Use static updates or a gentle progress transition; reduced-motion mode switches to a direct update.
- No usernames, rank list, loud chat scrolling, animated reward loops, or speed timer as the visual focus.

### D. Connection/error states
- Distinguish transport status from game state: “Game paused” / “Chat reconnecting.”
- If the companion link expires, show next step and a new-code action only to the operator.
- If submission is rejected as duplicate, say “You’ve already contributed this round”; avoid implying a system error.
- If the round is closed, state when the next round begins or how to continue watching.

## 4. Visual tokens (starting candidates)

| Token | Candidate | Usage |
|---|---|---|
| `night-950` | `#141B26` | broadcast base / dark mode |
| `cream-50` | `#FBF7EF` | companion background |
| `ink-900` | `#182230` | primary text on light |
| `sky-700` | `#235A86` | focus/action accent |
| `moss-700` | `#326A55` | progress/positive state, also label it |
| `sun-600` | `#A35C13` | active/attention state, also label it |
| `line-300` | `#BBC3C8` | borders only when contrast permits |
| Type | bundled/system sans with open shapes | body and controls |
| Corners | 8px companion actions, 6px studio panels | quiet, tactile feel |
| Motion | short opacity/position changes only | disabled or near-zero under reduced motion |

Validate all color pairs, component boundaries, focus rings, disabled controls, and overlays using contrast checks. Never encode input source only by hue.

## 5. Accessibility requirements

- Companion’s entire journey is operable with Tab, Shift+Tab, Enter, Space, and Escape where appropriate; focus is visible and not obscured.
- Use real labels, fieldset/legend for grouped choices, semantic button/radio controls, and descriptive errors associated with inputs.
- Announce successful contribution and rejected/duplicate state once, politely; aggregate live updates must not interrupt the form.
- Test zoom to 200%, browser text enlargement, narrow 320–390px widths, and portrait layout.
- Respect `prefers-reduced-motion`, avoid flashing, and provide textual alternatives to icons/illustrations.
- Make target sizes comfortably operable; never rely on hover or drag.
- Overlay has concise visible instructions and readable text at OBS output; no essential information exists only in the companion page or only in chat.
- Automated Playwright/axe scans cover all form states; manual review covers keyboard and screen reader. Document limitations and fixes.

## 6. Review gates

1. **Parity test:** two people independently complete the same action using chat vs companion; neither route feels subordinate.
2. **Speed/fairness test:** slower readers and participants joining near round open can understand whether their action counted; no spam advantage.
3. **Keyboard test:** complete session code, choose, submit, retry, and error handling without pointer.
4. **Broadcast test:** check at 1280×720 and a narrow OBS source; read prompt from a phone-sized preview.
5. **Polish critique:** Impeccable-style audit for hierarchy, status, forms, motion, and anti-patterns; Pro Max used to compare, not to auto-select the visual identity.

## 7. Anti-patterns to reject

- Countdown-centric UI, “fastest wins,” leaderboards, streaks, or public participation counts per individual.
- Companion code or link displayed as a tiny QR with no text alternative.
- Color-only progress, icon-only actions, or one-second success toasts.
- A vague statement such as “accessible for everyone” without testing evidence.
- More settings than the participant action requires, or a full dashboard on mobile.
