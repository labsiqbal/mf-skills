# The Quillfen Review demo brand fixture

The Quillfen Review is an invented editorial brand (an independent long-form magazine with print issues, a reading app and an audio edition) made for mf-motion tests, previews and onboarding. Its name was collision-checked on 2026-11-17; its domain `quillfen.example` is reserved and never fetched. The logo, mark, screens and copy were drawn and written for this project. No real brand, person or product appears.

- `site/`: the static brand site (HTML and CSS, no scripts) that `brand capture --local-file site/index.html --local-root site --name quillfen` captures. The hero carries a second line in Arabic (`dir="rtl"`) that exercises right-to-left shaping and the direction marker in `brand.md`.
  - `assets/logo.svg`, `assets/mark.svg`: full colour; `logo-mono.svg`, `mark-mono.svg`: single colour. The wordmark is the outlines of the bundled Noto Serif (regular instance); the mark is a nib drawn from two arcs, cut by a slit and a breather hole.
  - `assets/screens/<name>-desktop.png` (1440x900) and `<name>-phone.png` (390x844): rendered from `screens-src/`.
  - `assets/fonts/NotoSerif.woff2`, `Inter.woff2` and `NotoNaskhArabic.woff2` with `OFL.txt`: WOFF2 copies of the bundled families (SIL Open Font License 1.1).
- `screens-src/`: the four app screens (issue cover, article with drop cap and pull quote, reading progress and bookmarks, audio edition player) as HTML with the brand tokens.
- `fixture.json`: the bundled fonts the site carries and the candidates `fixtures:brands` picks.
- `expected.json`: the colour roles, font roles, candidate counts, copy and right-to-left lines the capture must produce.
- `examples.json`: variables for each seed move, in the brand's voice.

Regenerate (from `packages/mf-motion/`): `npm run fixtures:screens -- --only quillfen` after editing `screens-src/`, then `npm run build && npm run fixtures:brands -- --only quillfen` to refresh `assets/demo-brands/quillfen/`.
