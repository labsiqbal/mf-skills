# Frame audit fixtures

`fixtures.json` holds one composition per audit problem plus a clean one, a hold failure and a moving exemption. Each entry is built by `test/render/quality/audit/audit.test.ts` into a move build (`moveCtx` + `writeMoveBuild`, Mossmallow tokens) and audited with its `profile`. Text is placed with `position: fixed`, so `left`/`top` are frame pixels (16:9 is 1920 x 1080, 9:16 is 1080 x 1920). `expect.problems` is the exact set of problems the audit must report.
