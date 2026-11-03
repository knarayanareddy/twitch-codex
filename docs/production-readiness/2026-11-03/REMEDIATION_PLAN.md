# twitch-codex — remediation plan

Planned actions only. Scope each project independently and do not use live Twitch accounts or publish broadcast content without owner permission. Confidence: medium, documentation-only rework.

## P0 — baseline project contracts
**TW-T1** (TW-1; prerequisite: owner selects projects; observed `README.md`, `twitch_hackathon_specs/context-desk/src/server.js`, `twitch_hackathon_specs/habitat-relay/src/server.js`, `twitch_hackathon_specs/open-lab-live/src/server.js`, and targeted SHA-pinned rereads of `twitch_hackathon_specs/quiet-quest/src/server.js` and `twitch_hackathon_specs/quiet-quest/src/application/twitch-manager.js`).
1. Map each selected project's entry point, operator/broadcaster roles, deployment, storage, provider integration and explicit demo limitations.
2. Complete omitted route-tail review and line-level auth/chat-command mapping for the already-confirmed Quiet Quest source path before making project-wide claims; reconcile package scripts with CI and recorded README claims per project.
3. Define expected authorized and denied flows with synthetic accounts and data, distinguishing simulation output from real Twitch activity.
Deliverable: per-project architecture and acceptance matrix. Verify each claim against its own code or label unknown. DoD: [ ] four project boundaries recorded; [ ] selected projects scoped; [ ] demo limitations explicit. Exit: approved test scope.

## P1 — authentication, replay and data lifecycle
**TW-T2** (TW-2/TW-3/TW-4; after T1; observed `twitch_hackathon_specs/context-desk/src/server.js`, `twitch_hackathon_specs/context-desk/SECURITY.md`, `twitch_hackathon_specs/habitat-relay/src/server.js`, and targeted SHA-pinned rereads of `twitch_hackathon_specs/quiet-quest/src/server.js`, `twitch_hackathon_specs/quiet-quest/src/application/twitch-manager.js`, and `twitch_hackathon_specs/habitat-relay/src/adapters/twitch.js`; proposed project-specific integration tests).
1. Trace role authorization, CSRF, forwarded-host handling and secret configuration to every selected state-changing route; define trusted proxy rules.
2. Test invalid OAuth state, insufficient scope, forged/replayed webhooks, unauthorized publication, cross-origin writes and restart/multi-instance cache behavior.
3. Select durable replay/rate limits and encrypted backup retention as appropriate; rehearse key rotation, revocation and deletion through restore boundaries.
Deliverable: per-project threat controls and regression suite. Verify deliberately disabling authorization or signature verification makes the corresponding end-to-end negative test fail. DoD: [ ] denied paths observed; [ ] restart semantics tested; [ ] secrets and retention policy verified. Exit: selected trust boundaries accepted.

## P2 — live feasibility and accessibility
**TW-T3** (TW-1; after T1/T2; observed `twitch_hackathon_specs/open-lab-live/src/server.js`, `docs/context-desk/js/app.js`, `twitch_hackathon_specs/context-desk/test/twitch-oauth.test.js`, and targeted SHA-pinned rereads of `twitch_hackathon_specs/quiet-quest/src/application/twitch-manager.js` and `twitch_hackathon_specs/habitat-relay/src/adapters/twitch.js`; proposed provider adapter/runtime verification).
1. For Open Lab, obtain owner approval and official Twitch specifications before designing integration; retain demo-only labels until verification.
2. Exercise approved provider sandbox or limited broadcaster account for OAuth, EventSub delivery, role enforcement and disconnect/reconnect; do not infer live acceptance from mocks or local source presence.
3. Manually test keyboard, screen-reader announcements, overlay scaling and safe publication/rejection paths in each selected project.
Deliverable: provider and usability acceptance record. Verify a denied role cannot publish and a disconnected provider never silently claims live operation. DoD: [ ] live or sandbox evidence recorded; [ ] overlay and keyboard reviewed; [ ] unimplemented integrations labelled. Exit: owner accepts remaining gaps.

## P3 — release and recovery
**TW-T4** (preventive operations requirement; after T2/T3; observed `README.md`, the four project `package.json` manifests, and `twitch_hackathon_specs/context-desk/SECURITY.md`; proposed project-specific release runbooks).
1. Define immutable per-project releases, configuration and least-privilege credentials; do not conflate Pages with server deployment.
2. Rehearse SQLite backup/restore, retention cleanup and overlay-link revocation in isolated environments using synthetic data.
3. Independently observe deployment identity, smoke tests and rollback, recording privacy impact and restoration results.
Deliverable: release and recovery evidence. Verify restored data, expiration and invalidated links by observation. DoD: [ ] deployed SHA identified; [ ] restore observed; [ ] owner accepts per-project release. Exit: independent acceptance.

Dependencies: T1 → T2 → T3 → T4. Acceptance: [ ] project-specific auth and replay tested; [ ] demo versus live status accurate; [ ] broadcaster and accessibility checks observed; [ ] restore and rollback demonstrated. Owner approval is needed for accounts, live tests, secrets, production data and deployment. Stop publication on uncertain authorization or provider state; revert to a verified artifact and restore only with the approved retention policy.
