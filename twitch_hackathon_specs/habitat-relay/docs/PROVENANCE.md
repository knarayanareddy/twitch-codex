# Content, Asset & Dependency Provenance

## App-authored material

- The Pollinator Corridor scenario text, decision rules, numeric indicators and game-token balance are original, hand-authored software content. The values are not copied ecological measurements or forecasts.
- The habitat landscape is a simple SVG drawn in `public/js/app.js`; the interface uses local CSS/system fonts. There are no third-party stock photos, remote image assets, or external runtime font/CDN dependencies.
- Build outputs do not contain generated or AI-sourced ecological claims. Source material informs explanatory copy only.

## Referenced content

- European Environment Agency, *Protecting and restoring Europe’s wild pollinators and their habitats*, 18 June 2025. Used for background wording about habitat diversity/connectivity, wildflower strips, pollinator-friendly management, and deadwood nesting habitat. Checked 2026-10-28: <https://www.eea.europa.eu/en/analysis/publications/protecting-and-restoring-europes-wild-pollinators-and-their-habitats>
- Food and Agriculture Organization of the United Nations, *Global Action on Pollination Services for Sustainable Agriculture*. Used to support inclusive wording that pollinators are not only managed honeybees. Checked 2026-10-28: <https://www.fao.org/pollination/about/en>
- IVN Natuureducatie, *Tuinieren: tips en inspiratie*. Optional, non-pledge further reading for a locally appropriate garden/shared-green-space action. Checked 2026-10-28: <https://www.ivn.nl/aanbod/tuinieren/>

The source cards and recap explicitly state that citations do not validate the game scores. The IVN action is optional, outside the game, and not a purchase, pledge, donation, or data-collection flow.

## Dependency and license inventory

A clean `npm ci` completed on Node.js 20.20.2; `npm audit` reported **zero vulnerabilities** on 2026-10-28. npm emitted a deprecation notice for transitive `prebuild-install@7.1.3` (MIT); no vulnerability was reported. License identifiers below were read from the installed package manifests for the dependency tree in `package-lock.json`; this is an inventory, not legal advice.

### Direct dependencies

| Package | Role | License |
|---|---|---|
| `better-sqlite3` | Runtime persistence | MIT |
| `dotenv` | Runtime environment configuration | BSD-2-Clause |
| `ws` | Runtime Twitch WebSocket transport | MIT |
| `@axe-core/playwright` | Development/test accessibility checks | MPL-2.0 |
| `@playwright/test` | Development/test browser automation | Apache-2.0 |

### Installed transitive packages

| Package | License |
|---|---|
| `axe-core` | MPL-2.0 |
| `base64-js` | MIT |
| `bindings` | MIT |
| `bl` | MIT |
| `buffer` | MIT |
| `chownr` | ISC |
| `decompress-response` | MIT |
| `deep-extend` | MIT |
| `detect-libc` | Apache-2.0 |
| `end-of-stream` | MIT |
| `expand-template` | MIT OR WTFPL |
| `file-uri-to-path` | MIT |
| `fs-constants` | MIT |
| `github-from-package` | MIT |
| `ieee754` | BSD-3-Clause |
| `inherits` | ISC |
| `ini` | ISC |
| `mimic-response` | MIT |
| `minimist` | MIT |
| `mkdirp-classic` | MIT |
| `napi-build-utils` | MIT |
| `node-abi` | MIT |
| `once` | ISC |
| `playwright` | Apache-2.0 |
| `playwright-core` | Apache-2.0 |
| `prebuild-install` | MIT |
| `pump` | MIT |
| `rc` | BSD-2-Clause OR MIT OR Apache-2.0 |
| `readable-stream` | MIT |
| `safe-buffer` | MIT |
| `semver` | ISC |
| `simple-concat` | MIT |
| `simple-get` | MIT |
| `string_decoder` | MIT |
| `strip-json-comments` | MIT |
| `tar-fs` | MIT |
| `tar-stream` | MIT |
| `tunnel-agent` | Apache-2.0 |
| `util-deprecate` | MIT |
| `wrappy` | ISC |

This list should be regenerated and reviewed when dependencies change. No package code or license text is copied into the application’s public asset directory.
