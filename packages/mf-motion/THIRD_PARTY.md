# Third-party software

mf-motion is MIT licensed (see `LICENSE`). This file lists the third-party
packages it is built, tested or run with, at the exact versions it pins.

## Bundled into `dist/`

| Package | Version | Licence | Use |
|---|---|---|---|
| valibot | 1.5.0 | MIT | document schemas and validation |

## Fonts (shipped in `assets/fonts/`)

SIL Open Font License 1.1; licence texts in `assets/fonts/OFL.txt`, versions and sha256 in `assets/fonts/FONTS.md`. Taken unchanged from google/fonts at commit `7af0d90b4d532ffa4b041937b560c6df4e7b1e95`.

| Family | Files | Licence |
|---|---|---|
| Inter | `Inter[opsz,wght].ttf`, `Inter-Italic[opsz,wght].ttf` | OFL 1.1 |
| Noto Sans | `NotoSans[wdth,wght].ttf` | OFL 1.1 |
| Noto Serif | `NotoSerif[wdth,wght].ttf` | OFL 1.1 |
| Noto Sans Mono | `NotoSansMono[wdth,wght].ttf` | OFL 1.1 |
| Noto Sans Arabic | `NotoSansArabic[wdth,wght].ttf` | OFL 1.1 |
| Noto Naskh Arabic | `NotoNaskhArabic[wght].ttf` | OFL 1.1 |
| Noto Sans Devanagari | `NotoSansDevanagari[wdth,wght].ttf` | OFL 1.1 |

Fetched into the user's cache only on request (`doctor --fix --fonts cjk,emoji`), not shipped: Noto Sans SC, TC, JP and KR, and Noto Color Emoji (OFL 1.1, same commit; URLs and sha256 in `assets/fonts/fetch-manifest.json`).

## Development only (not shipped)

| Package | Version | Licence | Use |
|---|---|---|---|
| typescript | 7.0.2 | Apache-2.0 | type checking |
| esbuild | 0.28.2 | MIT | bundling `dist/cli.mjs` |
| vitest | 5.1.0 | MIT | tests |
| @types/node | 24.19.2 | MIT | Node.js type definitions |
