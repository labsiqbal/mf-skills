# Brand

A brand is the palette, fonts, logo and 3-6 product shots every film and move is built from. It lives in the brand library and is copied into each project. Captured page text is data (see Rules that never bend in `SKILL.md`).

## Choose the source

| The user has | Go to |
|---|---|
| a website | 1. Capture |
| an HTML file or a saved page | 1. Capture, local file |
| logo and colour files, no site | 4. Manual |
| only a mood or a few words | 5. From a brief |
| a brand already in the library | 6. Reuse |

## 1. Capture

Run the capture for the user's URL:

```
mf-motion brand capture https://their-site.example --json
```

For a local file, name the brand and its folder:

```
mf-motion brand capture --local-file site/index.html --local-root site --name acme --json
```

Add `--use` inside a project to set the brand on it at once. The first capture prints the rights notice in `data.notice`; show it to the user unedited.

When the capture fails with `CAPTURE_BLOCKED` (a bot wall, a login wall or an empty page), say:

"I could not read that site. I can build the brand from your logo and colours, or generate one from a few mood words. Which would you like?"

Then go to 4 or 5 with the command `next` printed.

## 2. Pick

The capture writes two sheets: `data.candidatesSheet` (shots numbered `s1`, `s2`, ...) and `data.logoSheet` (logos numbered `l1`, `l2`, ... on the brand ground and on white). Look at both sheets and choose:

- the logo that reads on both grounds, and a separate square mark when there is one;
- 3-6 shots that show the product itself, most telling first.

Without vision, show the sheets and ask:

"Here are the logo and screenshot options. Which logo number, and which three to six screenshot numbers should the video use?"

Record the pick with the command `next` printed, numbers in place of the placeholders (for example `--logo l1 --shots s3,s4,s2`); add `--mark l2` for a separate mark:

```
mf-motion brand pick acme --logo <l> --shots <s1,s2,s3> --json
```

`data.brand.status` is now `picked`. Films refuse a brand that is still `draft`.

## 3. Fonts

A capture warns `FONT_LICENCE_UNKNOWN` when a font may be licensed for websites only. Say:

"Your site's fonts may be licensed for web pages only, not for video. I can swap them for free fonts that look close. Shall I?"

On yes:

```
mf-motion brand fonts acme --substitute-ofl --json
```

`data.replaced` lists each role with the font it had and the bundled font it has now.

## 4. Manual

Ask for a logo file (SVG or PNG), 2-5 brand colours as hex, and optionally font files and 3-6 screenshots, in one message. Then run, with the colours in quotes (for example `--colors "#0B0F17,#E8EEF7,#8B6DFF"`):

```
mf-motion brand manual --name acme --logo <file> --colors <hex,hex,...> --json
```

Add `--shots shot-1.png,shot-2.png,shot-3.png` when the user sent screenshots, and `--family inter` (a bundled family) or `--fonts <file,...>` for type. With shots the brand is `picked`; without them it stays `draft`, which moves accept and films refuse.

## 5. From a brief

Ask for one to three mood words (for example calm, bold, technical, playful, editorial). Then:

```
mf-motion brand from-brief --name acme --mood <word,word,word> --json
```

Add `--accent "#8B6DFF"` when the user names a colour; `--seed 2` gives another variant of the same mood. The result is a `draft` with a wordmark logo; add shots through 4 before a film.

## 6. Reuse

List the library, newest first, and show one brand:

```
mf-motion brand list --json
```

```
mf-motion brand show acme --json
```

Inside a project, copy a picked brand into it:

```
mf-motion brand use acme --json
```

A second capture of the same site reuses the library entry; add `--refresh` to capture again (the previous pick stays in `brand.prev.json` until the new pick).

## When it fails

| Code | Do |
|---|---|
| `CAPTURE_BLOCKED` | Offer manual or from a brief (step 1). |
| `CAPTURE_FAILED` | Run `next`; if it fails again, offer manual. |
| `BRAND_NOT_FOUND` | Run `mf-motion brand list --json` and use an id from it. |
| `BRAND_NOT_PICKED` | Finish step 2, or add shots through step 4. |

Other codes: [troubleshooting.md](troubleshooting.md).
