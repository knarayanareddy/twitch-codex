# Context Desk — Product & Engineering Specification

**Version:** 1.0 · **Status:** implementation-ready proposal · **Category:** source-first, human-reviewed live context tool.

## 1. Product definition

**One-line pitch:** Turn a Twitch chat question into a concise, streamer-approved context card that shows sources, uncertainty, and what remains unknown.

**User problem:** Streamers and moderators may want to respond to a live question or claim without stopping the broadcast to search multiple tabs. A fast AI answer can be wrong, contextless, or overconfident; a static fact-check link may be hard for viewers to follow.

**Product promise:** Context Desk helps the host investigate a narrow class of questions using an explicit source set, presents evidence before any generated prose, and requires a human review before broadcast. It is a research aid, not a truth oracle or professional advice service.

### Goals
- Capture a question from a moderator-controlled workflow.
- Retrieve relevant source passages from a preapproved, limited corpus.
- Show evidence, source metadata, and uncertainty in a review desk.
- Require broadcaster/moderator approval before public overlay display.
- Keep source links in the recap and make the review state auditable.

### Non-goals
- General-purpose open-web fact checking; political persuasion; medical, legal, financial, or emergency advice.
- Automatic bans, moderation actions, or unreviewed model output in chat.
- Automatic claims of truth/falsehood, universal source credibility rankings, or guaranteed accuracy.
- Building a search engine, a complete RAG platform, or a source crawling service.

## 2. Users and permissions

- **Broadcaster:** connects their channel, sets the allowed topic/source pack, approves or rejects a public card, and controls overlay visibility.
- **Moderator/reviewer:** submits or triages a question and sees evidence; only authorized roles can publish.
- **Viewer:** sees an approved concise card and optional source link; can vote on the next question, not on factual truth.
- **Maintainer/editor:** prepares a versioned source manifest and verifies source terms, publication dates, and snippets.

Permission matrix must be enforced server-side, not only by hiding buttons. If Twitch role data cannot be reliably verified, restrict publication controls to the authenticated broadcaster and label moderator role support as unavailable.

## 3. Product behavior and user journey

1. Broadcaster connects and selects a preconfigured topic pack.
2. A moderator adds a question through the studio or a restricted chat command.
3. A request enters `queued`; duplicates are coalesced; rate limits prevent floods.
4. Retrieval selects a small number of relevant documents/excerpts from the approved pack.
5. A structured draft presents source excerpts, citations, disagreement/coverage gaps, and a concise summary proposal.
6. Reviewer checks each cited excerpt and either edits/approves, rejects, or marks insufficient evidence.
7. Only approved cards are sent to the overlay; no model response is posted to chat automatically.
8. A timestamped recap includes the question, human-approved summary, citations, and a visible caveat.

### Key product states
`idle → connected → question-queued → retrieving → review-required → approved → published → archived`

Alternative terminal states: `insufficient-evidence`, `rejected`, `failed`, `cancelled`. A state transition must have an actor, timestamp, and reason code, but should not unnecessarily retain message text or personally identifying data.

## 4. Scope and content policy

### Hackathon MVP
- One low-stakes educational topic pack with a small, reviewed set of sources bundled as data or fetched from explicitly allowlisted HTTPS endpoints.
- One review queue, one approved-card overlay, one chat question path, and one export path.
- Retrieval can be lexical first (title/body keyword search) to reduce external fragility. A model may optionally draft a summary from retrieved excerpts but must return structured output and cannot invent citations.
- For a live demo, preload three test questions and their source excerpts. Clearly label fixtures as demo content.

### Disallowed/blocked topics for MVP
Medical diagnosis/treatment, legal conclusions, financial recommendations, urgent safety events, personal accusations about identifiable people, private information, and any question for which no suitable source exists. Return an empathetic “not in scope / insufficient evidence” state; do not improvise.

### Evidence record
`EvidenceItem`: `id`, `sourceTitle`, `publisher`, `url`, `publishedAt?`, `checkedAt`, `excerpt`, `retrievalMethod`, `contentHash`, `license/usageNote`, `sourcePackVersion`. Do not store full pages unless terms permit. If excerpt display rights are unclear, show a short paraphrase written by the team with link and metadata instead.

## 5. Architecture

```text
Twitch EventSub / Studio input
              │
       Ingress + role/rate checks
              │
       Question application service ──> Question state machine
              │                              │
       Retrieval port                  SQLite transaction log
              │                              │
       Curated source adapter ──> Evidence proposal (validated schema)
                                             │
                                      Human review service
                                       │              │
                                    Studio UI     approved card
                                                      │
                                               read-only overlay
```

### Layers
- `domain/`: question states, permission rules, approval policy, citation invariants. No network/database/framework imports.
- `application/`: queue use cases, rate limiting, dedupe, retrieval orchestration, review actions, publish command.
- `adapters/twitch/`: auth, EventSub, normalized message, broadcaster/moderator verification where supported.
- `adapters/evidence/`: curated pack loader and optional allowlisted fetch adapter; sanitization and content hash.
- `adapters/model/` (optional): provider interface, timeout, strict schema validation, budget and retry policy.
- `adapters/storage/`: SQLite migrations and repositories.
- `web/studio/`, `web/overlay/`: privileged reviewer UI vs read-only broadcast UI.

### Critical invariants
1. A public card must reference at least one evidence item from the configured source pack.
2. Evidence IDs and URLs in the output must be drawn from retrieval results; fabricated citations cause validation failure.
3. `published` requires an authenticated approval event; model output alone cannot publish.
4. `insufficient-evidence` is a valid successful result, not an exception.
5. The overlay receives approved content only; no raw prompt, hidden moderation note, token, or unreviewed excerpt.
6. Every generated summary has a bounded length and a visible “human reviewed” state only after actual human approval.

### Data model
- `Question`: id, sanitized text, channel/session id, source, state, createdAt, expiresAt, topicPackVersion.
- `EvidenceProposal`: questionId, excerpt refs, candidate summary, uncertainty notes, model/provider metadata optional, createdAt, schemaVersion.
- `ReviewDecision`: questionId, reviewerIdHash, decision, editedText?, reasonCode, timestamp.
- `PublishedCard`: public-safe text, evidence refs, publishedAt, expiresAt, version.

### API sketch
- `POST /api/questions` — validate and enqueue input.
- `GET /api/review-queue` — authenticated reviewer queue.
- `POST /api/questions/:id/approve` — publish reviewed card.
- `POST /api/questions/:id/reject` — close with reason code.
- `GET /overlay/:opaqueSessionKey` — read-only SSE snapshot.
- `GET /api/health` — liveness/dependency readiness without secrets.
All mutation endpoints validate schema, origin/CSRF, role, ownership, and rate limits.

## 6. Privacy, security, and reliability

- Use minimum Twitch scopes under the chosen installed-chat flow; do not request moderation permissions unless the MVP genuinely uses and verifies them.
- OAuth tokens remain server-side and are excluded from logs, query strings, browser storage, source maps, exports, screenshots, and Git history.
- Sanitize chat input as plain text; bound length, reject control characters/URLs if not needed, and never render untrusted HTML/Markdown unsanitized.
- Treat retrieved pages and chat messages as untrusted input/prompt-injection content. Model instructions must mark excerpts as data, not instructions; remove scripts and irrelevant markup; do not follow arbitrary links from chat.
- Use URL allowlists, HTTPS-only fetch, DNS/IP checks to mitigate SSRF, request timeouts/size caps, redirect limits, and content-type validation if remote retrieval is enabled.
- Rate-limit by channel, actor, and global queue. Coalesce similar requests without silently dropping all alternatives.
- Encrypt any persisted OAuth credential; apply short retention to raw question text; store aggregate analytics only if needed and disclose it.
- Fail closed: model timeout, invalid schema, unavailable source, or permission uncertainty means no public card.

## 7. Phase plan and definitions of done

### Phase 0 — Domain boundary, source audit, and trust model (Oct 28, T-5)
**Work:** select one low-stakes topic; choose 5–10 sources; confirm link stability and allowed excerpt use; define disallowed topics and fallback messages; write approval matrix and data-retention policy; define a 90-second demo journey; wireframe queue, evidence view, and overlay.

**Done means:** every in-scope question class and out-of-scope class is written; every source has publisher, URL, check date, usage note, and owner; a reviewer can explain why a card is safe to publish; no “AI verified” language; a threat model covers prompt injection, link abuse, SSRF, role spoofing, and credential leakage; wireframes include insufficient-evidence and provider-down states.

### Phase 1 — Domain state machine and curated retrieval (Oct 29, T-4)
**Work:** implement question/review/publish states, command contracts, source pack schema, deterministic local retrieval, evidence references, sanitization, and fixtures. Add unit tests for permissions, citation validity, dedupe, expiration, rejection, and insufficient evidence.

**Done means:** no network or model key required for core demo; all valid transitions are tested; a proposal cannot publish without reviewer approval; citations must match the source manifest; prompt injection in a fixture is treated as plain untrusted text; malformed source content produces a safe error state.

### Phase 2 — Twitch ingress and review vertical slice (Oct 30, T-3)
**Work:** implement documented Twitch OAuth/EventSub flow for the selected user model; accept moderator input only if role verification works; otherwise use broadcaster studio input; connect the review queue and publish action; add delivery dedupe and event freshness status.

**Done means:** one live permitted question reaches the queue; an unauthorized role cannot publish; duplicate delivery creates one question; stale/disconnected transport is visible; the app can recover without losing already approved cards; no mutation can be triggered through an overlay URL.

### Phase 3 — Evidence UX, model guardrails, and overlay (Oct 31, T-2)
**Work:** implement the evidence-first review screen, optional schema-constrained summary adapter, publication preview, source links, overlay state, export, loading/error states, accessibility pass, and browser tests.

**Done means:** reviewer can compare proposal text to source excerpts without leaving the review context; each citation opens the expected HTTPS source; evidence insufficiency is visible; model failures do not publish; only approved card data reaches overlay; axe scans show no critical violations and keyboard/screen-reader checks cover review and publish flow.

### Phase 4 — Red-team checks, live acceptance, and submission freeze (Nov 1–2, T-1/T-0)
**Work:** test injection strings, bogus links, oversized prompts, model timeout, source outage, revoked OAuth, role spoofing, and replayed events; run live Twitch test; document topic limits and data lifecycle; create under-three-minute demo; capture genuine Codex session ID; clean-clone and submit.

**Done means:** all safety tests fail closed; one live interaction is recorded and accurately labelled; clean install reproduces the demo; repository has setup, source-list, threat-model, test, and failure-behavior docs; no real private viewer information is exposed; authentic Codex session ID and submission artifacts are ready before the deadline.

## 8. Test and evaluation strategy

- Unit: state transitions, permissions, citations, content length, expiry, topic rejection.
- Contract: source manifest schema, model response schema, EventSub fixtures, overlay allowlist.
- Security: prompt-injection fixtures, SSRF payloads, HTML/script payloads, CSRF, role spoofing, secret scanning.
- Integration: source fetch timeouts/redirects, DB transaction rollback, reviewer authorization, published-card snapshot.
- E2E: question → retrieval → review → approve → overlay → recap; and insufficient evidence → no publish.
- Evaluation set: a small, manually labelled set of in-scope questions, out-of-scope questions, conflicting sources, and no-answer cases. Report counts and known limits; do not imply statistical validity from a tiny set.

## 9. Rubric strategy and judge evidence

- **Innovation:** present as a source-first live “context desk,” not an AI chatbot; demonstrate the human review and uncertainty path.
- **Potential impact:** focus on media literacy in a deliberately bounded topic; show where evidence came from and how viewers can inspect it.
- **Technological implementation:** demonstrate EventSub, validation, retrieval, citation integrity, role checks, state transitions, persistence, and failure-safe behavior.
- **Design:** make evidence legible and review fast; a source, excerpt, uncertainty note, and approval are visually distinct.

**Evidence package:** architecture and trust-boundary diagram; test/evaluation summary with caveats; live event segment; review-to-overlay transition; source list and licensing notes; exact model/provider behavior (or explicit “model not used”); real Codex session proof.

## 10. Risks and cut line

- If source/legal review is uncertain, use bundled summaries with links rather than republishing excerpts.
- If reliable role verification is not finished by T-3, restrict publication to broadcaster-only studio controls.
- If model schema or safety behavior is unstable by T-2, ship deterministic curated cards; never make the AI a launch dependency.
- Drop arbitrary open-web search, multi-language generation, chat bot replies, and moderation actions before dropping human approval or source attribution.
