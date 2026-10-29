# Source pack audit — Solar System Basics v1.0.0

**Review date recorded in the pack:** 2026-10-28. **Runtime behavior:** metadata and short, team-authored paraphrases only; no page fetching or full-page storage. `contentHash` is SHA-256 over the exact curated paraphrase. Startup rejects an invalid hash, a non-HTTPS or unapproved host, duplicate IDs, missing publisher/date/usage note, or unsupported pack schema.

| ID | Publisher / page | URL | What the paraphrase is used for | Boundary / caveat |
|---|---|---|---|---|
| `nasa-planet-definition` | NASA Science — What is a Planet? | https://science.nasa.gov/solar-system/planets/what-is-a-planet/ | IAU 2006 Solar System definition and Pluto classification | Classification wording is scoped to the definition; the source notes discussion about terminology. |
| `jpl-planet-definition` | NASA JPL Solar System Dynamics — What is a Planet? | https://ssd.jpl.nasa.gov/planets/def.html | Corroborating definition and dwarf-planet distinction | Not a claim of universal agreement across every astronomy community. |
| `nasa-solar-system-facts` | NASA Science — Solar System Facts | https://science.nasa.gov/solar-system/solar-system-facts/ | Solar System includes the Sun and multiple classes of bound objects | Changing object counts are not frozen or rendered as current totals. |
| `nasa-cosmic-distances` | NASA Science — Cosmic Distances | https://science.nasa.gov/solar-system/cosmic-distances/ | Rounded AU and light-year concepts | Values are rounded; the linked source is authoritative for precision/conventions. |
| `nasa-moons-facts` | NASA Science — Moons: Facts | https://science.nasa.gov/solar-system/moons/facts/ | General moon diversity and orbit context | Exact totals are excluded; count questions intentionally become insufficient evidence. |
| `nasa-comet-facts` | NASA Science — Comet Facts | https://science.nasa.gov/solar-system/comets/facts/ | Icy remnants; warming, coma, and tail context | No particular comet's status, orbit, or impact risk is inferred. |

The excerpts are original paraphrases and do not reproduce the pages verbatim. Each record carries its own `licenseUsageNote`; links and publisher attribution remain visible in the studio, overlay, and recap. These notes are source-use documentation, not legal advice or a guarantee that any third-party media on the linked pages can be republished.

`data/evaluation-cases.json` adds six manually labelled functional cases: supported planet and distance questions, nuanced classification wording, out-of-scope medical advice, a volatile moon count, and an unsupported measurement. Tests verify expected state and minimum evidence refs; the nuanced case still requires a human caveat/review. This small set is not a statistically meaningful retrieval or scientific-accuracy evaluation. The pack contains no deliberately contradictory source pair, so claims of conflict resolution are not made. Source records must be rechecked by a maintainer before a future pack-version release.
