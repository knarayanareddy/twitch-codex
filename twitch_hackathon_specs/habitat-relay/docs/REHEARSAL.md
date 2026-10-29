# Habitat Relay — Demo Rehearsal

## 3–5 minute run of show

The normal three-round vote timer is 90 seconds per round. For a short prepared demo, close each round early after the audience has voted; this changes no scoring rule.

1. **Set the frame (20–30 sec).** Open the local studio. Explain that the landscape is an authored simulation, not measured restoration. Show the source card and the optional, no-pledge action.
2. **Show the broadcast (15 sec).** Open the overlay preview. For an OBS Browser Source use the copied session-scoped URL, and do not share it publicly. Point out `DEMO DATA` in a demo rehearsal.
3. **Round one: flowers (35–45 sec).** Start demo, click **Rehearse a tie**, explain the two option costs, close the round, select the streamer’s tie resolution and approve. Show that the simulation changes only after approval and the fictional budget decreases once.
4. **Round two: shelter (35–45 sec).** Add sample audience, close and approve the two-token shelter choice. Point out that four tokens have now been spent.
5. **Round three: connections (35–45 sec).** Add sample audience, close the round, and choose the one-token seasonal-diversity route; the three-token connections route is intentionally unaffordable with two tokens left. Approve and show the final field notes and optional IVN link.
6. **Close (20–30 sec).** Download Markdown and JSON recaps. Explain that the recaps include aggregate votes, source references, and game-only fictional token usage, never chat names or text. Optionally demonstrate safe undo before any vote is cast in the next round, then reset; reset revokes the OBS capability URL.

Total scripted talking time: approximately 3–4 minutes, excluding setup delays. A short un-narrated local UI capture is saved at `docs/evidence/habitat-relay-demo-rehearsal.webm`; it is a simulated rehearsal only, not live Twitch footage or a complete submission video. No live Twitch footage or authorization claim should be used unless a separate real-account acceptance test has genuinely been completed.

## Live rehearsal safety (not acceptance evidence)

A real broadcaster can configure `.env` using the README, authorize the matching account, verify the selected channel, and start live only after chat status is ready. This checklist describes the feature, not a completed live test. The current implementation request explicitly excludes using Twitch credentials or sending a real on-channel acceptance message.
