# Frame audit fixtures

`fixtures.json` holds one composition per audit problem plus a clean one, a hold failure and a moving exemption. Each entry is built by `test/render/quality/audit/audit.test.ts` into a move build (`moveCtx` + `writeMoveBuild`, Mossmallow tokens) and audited with its `profile`. Text is placed with `position: fixed`, so `left`/`top` are frame pixels (16:9 is 1920 x 1080, 9:16 is 1080 x 1920, 1:1 is 1080 x 1080). `expect.problems` is the exact set of problems the audit must report.

`short-line` (v1.2) is a 1:1 `overlay-alpha` sentence in a 190u column left of the face band that wraps to about 10 graphemes a line, plus a one-line label that must not be flagged; its `alsoAt` entry renders the same composition at 16:9, where the 1:1 line-length rule does not apply. `expect.hits` is the exact number of merged hits.
