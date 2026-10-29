# Twitch Codex — TwitchCon Codex Hackathon Multi-Project Suite

Complete, implementation-ready specifications and working codebases for the **TwitchCon Codex Hackathon** (Submission deadline: **November 2, 2026 at 5:00 p.m. EST / 23:00 Amsterdam**).

This repository contains four independent, fully tested implementations exploring live audience participation, ethical streaming, accessibility, and broadcaster control.

---

## The Four Projects

All projects are located in [`twitch_hackathon_specs/`](twitch_hackathon_specs/):

### 1. [Habitat Relay](twitch_hackathon_specs/habitat-relay/) *(Recommended Submission)*
- **Live Demo:** [https://habitat-relay.onrender.com](https://habitat-relay.onrender.com)
- **Standalone Repo:** [knarayanareddy/habitat-relay](https://github.com/knarayanareddy/habitat-relay)
- **Concept:** A streamer-led, community-powered pollinator habitat simulation. Viewers vote (`!habitat 1` / `!habitat 2`) on ecological interventions within a fictional 6-token budget.
- **Key Features:** Full streamer authority (ties/pluralities require approval, safe undo, discard), dynamic SVG landscape, AES-256-GCM encrypted Twitch OAuth tokens, and EventSub WebSocket reader.
- **Verification:** 123/123 tests passing (94% coverage), 6 Playwright E2E journeys, automated axe WCAG 2.2 scans, and recorded video rehearsal.

### 2. [Context Desk](twitch_hackathon_specs/context-desk/)
- **Concept:** A source-first, broadcaster-reviewed live context desk. Turns moderator-submitted questions (`!context <question>`) into verified evidence cards with uncertainty caveats.
- **Key Features:** Curated NASA/JPL source pack, deterministic local lexical matching, first-class "insufficient evidence" state, EventSub Webhook with signed badge verification, and anonymous viewer voting.
- **Verification:** 39/39 unit/domain tests passing, 7 Playwright E2E journeys.

### 3. [Quiet Quest](twitch_hackathon_specs/quiet-quest/)
- **Concept:** An access-first cooperative community participation game designed for low-pressure streaming.
- **Key Features:** Dual-input parity between chat (`!help 1-3`) and a mobile-friendly, keyboard-accessible companion web app (`/companion`). No speed bonuses, no leaderboards, no viewer callouts, and no chat spam.
- **Verification:** 24/24 unit/domain tests passing, 6 Playwright E2E journeys.

### 4. [Open Lab Live](twitch_hackathon_specs/open-lab-live/)
- **Concept:** A participatory science experiment format: **Predict → Choose → Reveal → Learn**.
- **Key Features:** Versioned Albedo lesson based on NASA Science activities, seeded deterministic simulation conserving model energy units, neutral tie handling, and transparent OBS overlay.
- **Verification:** 12/12 unit tests passing, 3 Playwright E2E journeys. *(Note: Twitch integration is pending in this project; simulation-only).*

---

## Shared Architecture & Engineering Standards

- **Runtime:** Native Node.js (>=20.11), ES Modules, Vanilla JS frontend (zero build-step friction).
- **Domain Boundaries:** Pure deterministic reducers with zero I/O, no wall-clock dependencies, and injected RNG for 100% test reproducibility.
- **Security & Privacy:**
  - AES-256-GCM encryption for stored Twitch OAuth tokens.
  - Per-session salted HMAC hashing for viewer deduplication (zero viewer usernames or chat logs permanently persisted).
  - Same-origin CSRF validation on all state-changing endpoints.
  - Unguessable, revocable capability URLs for OBS browser sources.
- **Storage:** Durable SQLite (`better-sqlite3`) with WAL mode, revision checks, and automated 24-hour retention pruning.
- **Broadcast UX:** Transparent OBS Browser Source overlays designed for 1080p and 720p viewports with explicit safe margins.

---

## Getting Started

Navigate to any subproject directory to run locally:

```bash
cd twitch_hackathon_specs/habitat-relay
npm ci
npm test
npm start
```

Open [http://localhost:3000](http://localhost:3000) for the studio dashboard and [http://localhost:3000/?view=overlay](http://localhost:3000/?view=overlay) for the OBS Browser Source overlay.

---

## Hackathon Submission Roadmap

- **Selected Submission Candidate:** Habitat Relay (`twitch_hackathon_specs/habitat-relay/`)
- **Key Verification Record:** See [`twitch_hackathon_specs/habitat-relay/docs/VERIFICATION.md`](twitch_hackathon_specs/habitat-relay/docs/VERIFICATION.md)
- **Rehearsal Script:** See [`twitch_hackathon_specs/habitat-relay/docs/REHEARSAL.md`](twitch_hackathon_specs/habitat-relay/docs/REHEARSAL.md)
