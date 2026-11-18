# Tessarine demo brand fixture

Tessarine is an invented dark SaaS brand (an observability and evaluation workbench for AI agents) made for mf-motion tests, previews and onboarding. Its name was collision-checked on 2026-11-17; its domain `tessarine.example` is reserved and never fetched. The logo, mark, screens and copy were drawn and written for this project. No real brand, person or product appears.

- `site/`: the static brand site (HTML and CSS, no scripts) that `brand capture --local-file site/index.html --local-root site --name tessarine` captures.
  - `assets/logo.svg`, `assets/mark.svg`: full colour; `logo-mono.svg`, `mark-mono.svg`: single colour. The wordmark is drawn as stroked paths in the proportions of Inter SemiBold.
  - `assets/screens/<name>-desktop.png` (1440x900) and `<name>-phone.png` (390x844): rendered from `screens-src/`.
  - `assets/fonts/Inter.woff2` and `NotoSansMono.woff2` with `OFL.txt`: WOFF2 copies of the bundled Inter and Noto Sans Mono (SIL Open Font License 1.1).
- `screens-src/`: the four app screens (run timeline, trace tree, eval scoreboard, cost per run) as HTML with the brand tokens.
- `fixture.json`: the bundled fonts the site carries and the candidates `fixtures:brands` picks.
- `expected.json`: the colour roles, font roles, candidate counts and copy the capture must produce.
- `examples.json`: variables for each seed move, in the brand's voice.

Regenerate (from `packages/mf-motion/`): `npm run fixtures:screens -- --only tessarine` after editing `screens-src/`, then `npm run build && npm run fixtures:brands -- --only tessarine` to refresh `assets/demo-brands/tessarine/`.
