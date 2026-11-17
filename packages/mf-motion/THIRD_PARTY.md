# Third-party software

mf-motion is MIT licensed (see `LICENSE`). This file lists the third-party
packages it is built, tested or run with, at the exact versions it pins.

## Bundled into `dist/`

| Package | Version | Licence | Use |
|---|---|---|---|
| valibot | 1.5.0 | MIT | document schemas and validation |
| parse5 | 8.1.1 | MIT | lint: HTML parsing |
| entities | 9.0.0 | BSD-2-Clause | HTML entities (used by parse5) |
| postcss | 8.5.33 | MIT | lint: CSS parsing |
| nanoid | 3.3.20 | MIT | used by postcss |
| picocolors | 1.1.1 | ISC | used by postcss |
| source-map-js | 1.2.2 | BSD-3-Clause | used by postcss |
| acorn | 8.19.0 | MIT | lint: JavaScript parsing |
| acorn-walk | 8.3.5 | MIT | lint: JavaScript syntax tree walking |

The BSD and ISC licence texts of the bundled packages follow at the end of this file.

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

## Licence texts (bundled BSD and ISC packages)

### entities

```
Copyright (c) Felix Böhm
All rights reserved.

Redistribution and use in source and binary forms, with or without modification, are permitted provided that the following conditions are met:

Redistributions of source code must retain the above copyright notice, this list of conditions and the following disclaimer.

Redistributions in binary form must reproduce the above copyright notice, this list of conditions and the following disclaimer in the documentation and/or other materials provided with the distribution.

THIS IS PROVIDED BY THE COPYRIGHT HOLDERS AND CONTRIBUTORS "AS IS" AND ANY EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT LIMITED TO, THE IMPLIED WARRANTIES OF MERCHANTABILITY AND FITNESS FOR A PARTICULAR PURPOSE ARE DISCLAIMED. IN NO EVENT SHALL THE COPYRIGHT HOLDER OR CONTRIBUTORS BE LIABLE FOR ANY DIRECT, INDIRECT, INCIDENTAL, SPECIAL, EXEMPLARY, OR CONSEQUENTIAL DAMAGES (INCLUDING, BUT NOT LIMITED TO, PROCUREMENT OF SUBSTITUTE GOODS OR SERVICES; LOSS OF USE, DATA, OR PROFITS; OR BUSINESS INTERRUPTION) HOWEVER CAUSED AND ON ANY THEORY OF LIABILITY, WHETHER IN CONTRACT, STRICT LIABILITY, OR TORT (INCLUDING NEGLIGENCE OR OTHERWISE) ARISING IN ANY WAY OUT OF THE USE OF THIS,
EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGE.
```

### picocolors

```
ISC License

Copyright (c) 2021-2024 Oleksii Raspopov, Kostiantyn Denysov, Anton Verinov

Permission to use, copy, modify, and/or distribute this software for any
purpose with or without fee is hereby granted, provided that the above
copyright notice and this permission notice appear in all copies.

THE SOFTWARE IS PROVIDED "AS IS" AND THE AUTHOR DISCLAIMS ALL WARRANTIES
WITH REGARD TO THIS SOFTWARE INCLUDING ALL IMPLIED WARRANTIES OF
MERCHANTABILITY AND FITNESS. IN NO EVENT SHALL THE AUTHOR BE LIABLE FOR
ANY SPECIAL, DIRECT, INDIRECT, OR CONSEQUENTIAL DAMAGES OR ANY DAMAGES
WHATSOEVER RESULTING FROM LOSS OF USE, DATA OR PROFITS, WHETHER IN AN
ACTION OF CONTRACT, NEGLIGENCE OR OTHER TORTIOUS ACTION, ARISING OUT OF
OR IN CONNECTION WITH THE USE OR PERFORMANCE OF THIS SOFTWARE.
```

### source-map-js

```
Copyright (c) 2009-2011, Mozilla Foundation and contributors
All rights reserved.

Redistribution and use in source and binary forms, with or without
modification, are permitted provided that the following conditions are met:

* Redistributions of source code must retain the above copyright notice, this
  list of conditions and the following disclaimer.

* Redistributions in binary form must reproduce the above copyright notice,
  this list of conditions and the following disclaimer in the documentation
  and/or other materials provided with the distribution.

* Neither the names of the Mozilla Foundation nor the names of project
  contributors may be used to endorse or promote products derived from this
  software without specific prior written permission.

THIS SOFTWARE IS PROVIDED BY THE COPYRIGHT HOLDERS AND CONTRIBUTORS "AS IS" AND
ANY EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT LIMITED TO, THE IMPLIED
WARRANTIES OF MERCHANTABILITY AND FITNESS FOR A PARTICULAR PURPOSE ARE
DISCLAIMED. IN NO EVENT SHALL THE COPYRIGHT HOLDER OR CONTRIBUTORS BE LIABLE
FOR ANY DIRECT, INDIRECT, INCIDENTAL, SPECIAL, EXEMPLARY, OR CONSEQUENTIAL
DAMAGES (INCLUDING, BUT NOT LIMITED TO, PROCUREMENT OF SUBSTITUTE GOODS OR
SERVICES; LOSS OF USE, DATA, OR PROFITS; OR BUSINESS INTERRUPTION) HOWEVER
CAUSED AND ON ANY THEORY OF LIABILITY, WHETHER IN CONTRACT, STRICT LIABILITY,
OR TORT (INCLUDING NEGLIGENCE OR OTHERWISE) ARISING IN ANY WAY OUT OF THE USE
OF THIS SOFTWARE, EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGE.
```
