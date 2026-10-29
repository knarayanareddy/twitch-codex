# Context Desk — UI/UX Design Brief

## 1. Art direction

**Direction:** “A calm newsroom research desk.” Use an editorial, evidence-forward visual system: warm off-white reading surfaces, near-black text, a restrained cobalt or teal for links and approved states, and amber for uncertainty/review-needed states. Avoid red/green true/false traffic-light framing. This is a research workflow, not a courtroom, warning dashboard, or AI chat window.

Use deliberate typography hierarchy: one editorial display face for the question, neutral highly legible sans for excerpts and controls, and a compact mono face only for IDs/timestamps. Evidence cards should look like citations in a field notebook, not promotional tiles. Keep the broadcast overlay visually quieter than the studio.

Use Impeccable for critique/audit/polish passes and UI UX Pro Max to compare editorial / evidence-review directions; record why the selected visual language supports careful review. Impeccable’s [repository](https://github.com/pbakaus/impeccable) and UI UX Pro Max’s [repository](https://github.com/nextlevelbuilder/ui-ux-pro-max-skill) are design-process references, not design authority.

## 2. Navigation and hierarchy

- **Setup:** connect channel; choose topic/source pack; explain allowed scope.
- **Review Desk:** queue column; selected question/evidence pane; sticky decision bar.
- **Overlay Preview:** exact broadcast card at target dimensions, never a separate style approximation.
- **Published / History:** approved cards, source links, reviewer decision, export.
- **Settings:** source pack, retention, allowed input roles, connection, disconnect.

The reviewer’s priority order is: (1) what question is being answered, (2) what evidence exists, (3) what remains uncertain, (4) what will be public, (5) approve/reject. Do not place the model response above the sources.

## 3. Screen composition

### A. Source pack and setup
- Show topic name, scope, included publishers, checked date, and what questions are out of scope.
- Provide an obvious “Demo with sample questions” path and separate “Connect Twitch” action.
- OAuth copy says what is requested, why, and what the app can do after authorization.
- Explicitly state: “Nothing appears on stream until you approve it.”

### B. Review Desk
- Left rail: queue with state label and age; show only sanitized question snippet, not a red-flag score.
- Center: question heading; sections titled **Evidence found**, **Evidence that disagrees / gaps**, **Draft context**, **What we cannot conclude**.
- Right/under-pane: source cards with publisher, date, excerpt, open-source control, and retrieval status.
- Sticky bottom decision bar: “Approve for overlay,” “Edit and approve,” “Reject,” “Insufficient evidence.” Approval requires a preview and a clear confirmation.
- Keep model/provider status in a technical disclosure, not as a badge implying correctness.
- No generated confidence percentage unless there is a rigorously defined and evaluated measure; default is no numeric confidence score.

### C. Broadcast card
- Transparent overlay with compact question, no more than three context bullets, one uncertainty line, and up to two source labels/links.
- A small “Reviewed by streamer/mod” label appears only after an actual review event.
- Keep citations readable at scaled OBS size; move full citations into a QR or studio recap only if QR remains usable and there is a visible text alternative.
- Never show raw chat usernames or unapproved drafts. When no card is active, overlay is fully transparent or shows a subtle standby prompt.

### D. Recap
- Chronological list of published cards and source links, with “edited by human” vs “drafted by system” provenance.
- Export omits raw chat text and viewer identity; sources and checked dates remain.

## 4. Token system (candidate)

| Token | Candidate | Meaning |
|---|---|---|
| `ink-950` | `#15191E` | dark text / broadcast base |
| `paper-50` | `#FAF8F2` | primary reading surface |
| `paper-200` | `#E8E4DA` | separators and quiet panels |
| `blue-700` | `#245C91` | links and active navigation |
| `teal-700` | `#256B64` | approved / active state when paired with label |
| `amber-700` | `#8B5C14` | uncertainty and review needed, always paired with text |
| `red-700` | `#9C3B36` | only destructive/error states with explicit text |
| `font-display` | locally bundled editorial serif | question/section headline |
| `font-body` | system sans or bundled accessible sans | evidence/control text |

Validate all combinations, links, hover/focus, dimmed overlays, and broadcast backgrounds against contrast requirements. Use CSS variables and named semantics (`--status-review`) rather than hardcoding palette values into components.

## 5. UX copy rules

- Say “Evidence found” rather than “proof”; “context card” rather than “verdict.”
- State uncertainty concretely: “The selected sources do not address X,” not “AI is unsure.”
- Use “Not enough evidence in this source pack” as a valid result.
- If a provider fails: “Draft unavailable. No card was published. Retry or use a prepared sample.”
- If reviewer edits a model draft, record the edited output as human-edited, not as model output.
- Never use “verified” unless a documented human verification step occurred and the term is defined.

## 6. Accessibility and responsive behavior

- Target WCAG 2.2 AA as a quality target. Use semantic headings, buttons, lists, and link text; keyboard order follows queue → question → sources → decision.
- Keep the selected question and decision controls available at 390px; stack the evidence cards instead of shrinking text.
- Announce queue count and state changes politely; do not send every new request to a screen-reader live region.
- Use visible focus, do not rely on color for state, support zoom/reflow, and reduce motion. Avoid auto-opening a new tab without warning.
- Overlay text is short, static by default, and readable at scene scale; include text source labels even where a QR is present.
- Run Playwright/axe on queue-empty, question-selected, insufficient-evidence, model-error, approval-preview, and published states. Manually test keyboard flow and a screen reader; automated scans are incomplete by design.

## 7. Visual review gates

1. **Trust hierarchy:** in a five-second glance, reviewer can tell question, evidence, uncertainty, and whether it is public.
2. **Evidence audit:** each evidence card visibly exposes source and date before the draft summary.
3. **Overlay legibility:** overlay preview tested over bright gameplay, dark gameplay, and camera backgrounds at 1280×720 and 1920×1080.
4. **Safety gate:** rejection and insufficient-evidence states are as polished as success; no false-confidence visuals.
5. **Final critique:** use Impeccable-style critique for hierarchy and state coverage; use UI UX Pro Max only to compare a few evidence-workflow patterns, then make a documented product decision.

## 8. Anti-patterns to reject

- AI chat bubble as the default layout, giant “TRUE/FALSE” badge, unexplained confidence meter, or citation text too small to read.
- A red danger dashboard that makes normal uncertainty look like an emergency.
- Publishing before the reviewer has inspected the evidence; reviewer controls hidden behind overflow menus.
- Trust badges based solely on source domain; a source title is not a claim that the source is infallible.
- Animation that implies the model is “thinking” when the underlying state has failed or timed out.
