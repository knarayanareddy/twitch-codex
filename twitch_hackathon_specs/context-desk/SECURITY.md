# Security and privacy notes

## Trust boundaries

```text
Twitch chat / studio form (untrusted text)
  → same-channel and rate checks
  → signed EventSub + per-message role badge (Twitch input only)
  → source-pack allowlist + deterministic local retrieval
  → authenticated broadcaster review and explicit confirmation
  → minimal public-card snapshot
  → opaque, read-only overlay / recap export
```

The source pack is curated application data, not fetched from the network. Questions and source excerpts are data, never executable HTML or model instructions. There is no model, arbitrary web search, URL fetch, chat reply, moderation action, or automatic publication.

## Controls implemented

- **Authorization / CSRF:** local broadcaster passphrase login sets an HttpOnly, SameSite cookie; protected APIs require it. Mutations check the request origin and JSON content type. Twitch callback uses a short-lived, one-use OAuth state tied to the local session and an HttpOnly SameSite=Lax state cookie. Demo login is clearly simulated and cannot start real Twitch OAuth.
- **Twitch identity:** OAuth scopes are `user:read:chat` and `user:bot`, with no chat-write or moderation scope. The connected account is checked against an optional configured broadcaster ID. Credentials are encrypted using AES-256-GCM and never returned to the browser. The app-token is memory-only. Disconnect attempts revocation and subscription deletion.
- **EventSub:** HMAC-SHA256 is checked over the exact raw body, message ID, and timestamp using constant-time comparison. Stale timestamps and duplicate delivery IDs are rejected. The subscription channel and reader must match the connected broadcaster; a per-message signed broadcaster/moderator badge and `!context` prefix are required. If authorization, callback verification, token refresh, channel, or role is uncertain, chat intake is disabled.
- **Question safety:** text length is bounded; control characters are normalized; HTML, URLs, email addresses, phone-like contact data, high-risk advice, personal-information requests, and unsupported topics fail closed. Retrieval is local lexical matching against 5–10 versioned records with checked hashes. No URL in a question is fetched.
- **Publication invariant:** server-side state and permissions enforce authenticated broadcaster-only publication. Review requires retrieved evidence, an allowlisted source ID/URL/hash, plain bounded fields, a checked preview, and an explicit confirmation. Rejection and insufficient evidence close without publishing. Duplicate requests are coalesced and in-memory per-actor/global rate limits apply.
- **Overlay / export:** the opaque session path supports read-only JSON and SSE only. It returns only approved title, summary, caveat, up to two citations, expiry, and review label. Recap export excludes raw question text and viewer IDs. CSP, `nosniff`, no-referrer, safe DOM text rendering, and HTTPS-only source URL allowlists are used.
- **Retention:** question, evidence, audit events, and card records carry a 24-hour expiry; cleanup runs once per minute and audit events cascade with expired questions. Tokens are encrypted at rest; session cookies and OAuth tokens are not logged or written to URLs.

## Known limitations and operating requirements

- This is an MVP, not a security certification or a multi-tenant production service. Use a trusted HTTPS reverse proxy, restrict host/network access, set production secrets, and back up SQLite only through an approved encrypted process.
- Rate-limit and EventSub replay caches are process-local. Restarting clears these caches. SQLite uniqueness/dedupe is by normalized question text and a short time window, not a durable Twitch message ID.
- A moderator may submit a question through signed chat, but the review/publish UI is broadcaster-authenticated; the broadcaster is the only publishing authority. Moderator badge support has not been live-accepted.
- The source-topic classifier is intentionally small and rule-based. Novel wording may be rejected or miss an out-of-scope phrasing; review the question and sources rather than assuming exhaustive classification.
- The phrase “broadcaster reviewed” corresponds to a server-side approval decision. It is not a claim that NASA/JPL or Twitch endorses the card.
- The 24-hour purge is application cleanup, not secure erasure from storage media, filesystem snapshots, or backups. Disable or protect backups containing the database.
- Playwright/axe results are automated checks only. A manual keyboard, screen-reader, deployment, and live Twitch acceptance remain operational checks; they are not represented as completed here.
