# Open Lab Live — 75-second demo storyboard

**Local simulator only.** This script demonstrates the complete operator-controlled loop without Twitch. The sample voters are fixtures, not viewers. Keep that label visible whenever the fixture controls are used.

| Time | Host / operator action | What the audience sees |
| --- | --- | --- |
| 0:00–0:10 | Introduce the question: “With the same incoming light, which surface absorbs the most in this model?” | Question, three numbered settings, `SIMULATION` and `DEMO` tags, fixed-window timer. |
| 0:10–0:22 | Explain the input: “Choose one: type `!predict 1`, `!predict 2`, or `!predict 3`. I’ll close predictions before testing one condition.” In this local build, add one or two labelled sample voters in the studio. | Aggregate count changes; no viewer name or message appears. |
| 0:22–0:30 | Close predictions. Say whether there was a lead, a tie, or no votes, neutrally. | Numbered tallies remain visible; public overlay says predictions are closed. |
| 0:30–0:40 | Choose one condition (the leading condition is only a default), then run the model. | Operator preview identifies the selected condition; the result is still held from the audience. |
| 0:40–0:58 | Reveal. Read the chosen input and the arithmetic: `incoming × (100 − albedo) ÷ 100`. Compare all three settings. | Model-unit result, all three outputs, simulation disclaimer, concise assumption note, and NASA source title appear together. |
| 0:58–1:15 | Learn: “Lower albedo means a larger absorbed share in this rule. These percentages are teaching settings, not measurements.” Open the recap’s assumptions if time permits. | Run note keeps prediction totals, chosen condition, formula/version, assumptions, output, and source. |

## Safe recovery lines

- **No predictions:** “No votes this round; that is okay. I’ll choose a condition so we can still inspect the model.”
- **Tie:** “The prediction is tied. I’ll choose one condition to test; neither side is being marked wrong.”
- **Stream or studio reconnecting:** pause the experiment, leave the page open while EventSource reconnects, confirm the server-backed phase, then resume. Do not claim the overlay is current if its status says reconnecting.
- **Out-of-scope health or dangerous request:** the local demo does not accept free text or perform moderation. Do not answer with advice; follow the platform’s applicable safety process. The lesson records examples for streamer preparation, not an automated safety classifier.

## Timing and evidence boundary

The script is intentionally under 90 seconds as a short demo cut; it is not an educational-outcome evaluation. The browser flow and local fixtures are test evidence only. No Twitch authorization, live chat input, real viewer participation, or OBS capture is implied.
