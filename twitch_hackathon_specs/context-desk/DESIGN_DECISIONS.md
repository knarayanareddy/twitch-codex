# Design decisions

## Chosen direction: a calm newsroom research desk

The UI follows the supplied design brief: warm paper surfaces, near-black reading text, a restrained teal for approved actions, amber for review/uncertainty paired with text, editorial serif question/card headings, and neutral system sans for controls and excerpts. The studio presents the question, evidence, source metadata, and gaps before the draft. There is no verdict badge, confidence meter, “AI verified” label, or model-thinking animation.

The review flow places citations beside short paraphrased excerpts and the exact overlay preview. The approval control stays visible, but publication requires a source selection, an editable public text pass, preview review, explicit confirmation, and the server-side broadcaster permission. Rejection and insufficient evidence receive first-class states. At mobile widths the queue and evidence stack rather than shrinking source text.

The overlay is deliberately quieter than the studio: a transparent OBS browser-source page with one dark, readable card, a visible review label, uncertainty line, and up to two source links. With no approved card it is fully transparent. The source-pack screen states scope, checked dates, usage notes, retention, and the lack of a model.

## Design-process honesty

`UI_UX.md` names Impeccable and UI UX Pro Max as suggested process references. Those tools were not installed or run during this implementation; this record is not a claim that either performed a critique or generated the design. The selected visual direction follows the supplied brief and the explicit trust/readability hierarchy above. Playwright/axe checks are automated and do not replace manual screen-reader, keyboard, or broadcast-scene review.
