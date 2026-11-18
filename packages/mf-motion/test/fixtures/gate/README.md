# Gate fixtures

One tiny round folder per case: `metrics.json`, `packet/` (placeholder 1 x 1 PNG sheets, `facts.md`, the packet's canonical metrics copy and `packet.json` with its hash), `scores.json` when the case is judged, `lint.json` for the lint case, and `expect.json` listing the gate runs (`args`) with the expected level, error code, hard failures and capped axes.

- Named cases of gate.md: `high-scores-measured-defect`, `hard-failure-perfect-scores`, `no-vision`, `self-judge`, `stale-scores`, `same-family-library`, plus `missing-fix`, `below-target` and `clean-pass`.
- `hard-<check>`: one per hard check (a failing `metrics.hard` entry; `hard-lint` through `lint.json`) with perfect scores.
- `cap-<check>`: one per measured cap of the rubric, fresh judge at 10.

The base metrics are `../packets/film-round/metrics.json` (a real `measure` run). Regenerate after changing `generate.ts`:

```sh
cd packages/mf-motion
./node_modules/.bin/esbuild test/fixtures/gate/generate.ts --bundle --platform=node --format=esm --packages=external --outfile=test/fixtures/gate/.gen.mjs
node test/fixtures/gate/.gen.mjs && rm test/fixtures/gate/.gen.mjs
```
