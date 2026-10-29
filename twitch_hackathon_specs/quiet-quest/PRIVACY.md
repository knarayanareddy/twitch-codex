# Quiet Quest privacy and trust boundaries

## Data inventory

| Data | Purpose | Storage | Retention |
|---|---|---|---|
| Session ID, game mode, round state, aggregate action/source counts, event timestamps | Resume the cooperative game, render studio/overlay, and produce aggregate recap | SQLite `sessions` and `session_events` | Session expires after 24 hours; reset creates a new session and closes the old one |
| Salted HMAC of Twitch actor ID | Enforce one Twitch chat contribution per actor per round | SQLite `contributions`; no raw Twitch ID or display name | Deleted with its session after 24 hours |
| Random companion browser nonce, represented by salted HMAC in contribution rows | Enforce one companion contribution per browser token per round | Signed HttpOnly cookie in browser; salted hash in SQLite | Browser cookie expires after 24 hours; server hash and per-session salt expire with session |
| EventSub message ID | Ignore duplicate delivery | SQLite `contributions.delivery_id` | Deleted with its session after 24 hours |
| Twitch access/refresh token pair, broadcaster Twitch ID and login | Read the authorized broadcaster’s channel with EventSub and label studio connection status | Tokens are AES-256-GCM encrypted in SQLite; broadcaster ID/login are stored in the same credential table in plaintext. Credential values are held server-side in memory while active. | Until disconnect/revocation; token expiry triggers refresh/reauthorization |
| Operator passphrase and cookie-signing key | Protect streamer controls and signed cookies | Passphrase from server environment; key from environment or private local key file | Operator-managed; rotate deliberately |
| Companion invite code | Allow a viewer to join one active session | Hash only in SQLite; plaintext shown to operator/viewer during invite | Revoked by rotation, session end, reset, or 24-hour expiry |

## Non-goals and limitations

- Browser companion identity and Twitch identity are not linked. One person using both paths can contribute once through each path per round.
- Browser-token deduplication is a privacy-preserving convenience, not a strong identity check or Sybil-resistance mechanism. Clearing/replacing the browser token can yield another companion identity.
- No viewer display names, public ranks, raw chat text, disability/accessibility profiles, biometrics, or voice data are stored. The one exception is the authorized broadcaster’s Twitch ID/login needed to identify and label the connected channel; these are stored alongside the encrypted OAuth tokens. No chat replies or moderation actions are sent.
- Live Twitch authorization, actual EventSub receipt, revocation, and reconnect acceptance require a configured public HTTPS deployment and a human broadcaster. Automated tests use fake transport.
- The project is an access-first prototype, not a claim of WCAG conformance. Test with real users and relevant assistive technology before relying on it for an event.

## Controls

The operator can pause/resume, close a round, end, reset, disconnect Twitch, disable companion input, and rotate the companion code. Reset closes the current session and creates a fresh session with a fresh code. Session rows, aggregates, and salted actor hashes are deleted after 24 hours by the cleanup task. The CSV export includes only round-level totals.
