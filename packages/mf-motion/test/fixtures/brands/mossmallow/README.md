# Mossmallow demo brand fixture

Mossmallow is an invented light consumer brand (a houseplant care app) made for mf-motion tests, previews and onboarding. Its name was collision-checked on 2026-11-17; its domain `mossmallow.example` is reserved and never fetched. The logo, mark, screens and copy were drawn and written for this project. No real brand, person or product appears.

- `site/`: the static brand site (HTML and CSS, no scripts) that `brand capture --local-file site/index.html --local-root site --name mossmallow` captures.
  - `assets/logo.svg`, `assets/mark.svg`: full colour; `logo-mono.svg`, `mark-mono.svg`: single colour.
  - `assets/screens/<name>-desktop.png` (1440x900) and `<name>-phone.png` (390x844): rendered from `screens-src/`.
  - `assets/fonts/NotoSans.woff2` with `OFL.txt`: WOFF2 copy of the bundled Noto Sans (SIL Open Font License 1.1).
- `screens-src/`: the four app screens (shelf, watering, check-up, streak) as HTML with the brand tokens.
- `fixture.json`: the bundled fonts the site carries and the candidates `fixtures:brands` picks.
- `expected.json`: the colour roles, font roles, candidate counts and copy the capture must produce.
- `examples.json`: variables for each seed move, in the brand's voice.

Regenerate (from `packages/mf-motion/`): `npm run fixtures:screens -- --only mossmallow` after editing `screens-src/`, then `npm run build && npm run fixtures:brands -- --only mossmallow` to refresh `assets/demo-brands/mossmallow/`.
