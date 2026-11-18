# Quality

Every piece passes through rounds: build, check, render, measure, a judged packet and one gate verdict. The gate decides; you report what it decided. The rules on verdicts and metrics in `SKILL.md` apply to every step here.

## 1. Run the round

For a film, the round command lints, audits, checks, renders, measures and assembles the packet in one go (`film round`, see `references/film.md`). When a round stops on lint or audit findings, fix each one at its file and line, then run the round again; nothing renders until they are clean.

To rebuild the packet of the latest round (for example after the round folder changed):

```
mf-motion packet --json
```

`data.dir` is the packet folder, `data.hash` its content hash, and `data.instruction` the judge instruction with the target and hash filled in.

## 2. Get the scores

Use the first way your harness allows:

1. **A fresh reviewer.** Dispatch a subagent with a fresh context, the packet folder and `data.instruction`. Its JSON becomes `rounds/<n>/scores.json` with `judge.mode` `fresh` and `judge.context` `subagent`.
2. **Yourself, in this session.** Read `facts.md` first, then look at every image in the packet, then score with the same instruction. Write `judge.mode` `self` and `judge.context` `same-session`.
3. **No images.** When you cannot view images, skip scoring and gate with `--no-vision` (step 3).

The instruction, as the CLI prints it (`{target}` and `{hash}` filled in):

```
You are judging one piece of motion design. You did not make it. Judge only what the
images and facts.md show. Do not guess what the maker intended.

Score six axes from 1 to 10 using the anchors in the rubric: hook, brand, motion,
legibility, rhythm, finish. Use whole numbers. Read the anchor tables before scoring and
pick the highest anchor the work fully meets.

The measured facts are true. If a fact contradicts what you see, trust the fact.
Never score an axis above what a listed measured cap allows.

For every axis below {target}, write at least one fix: when (seconds), where (element),
the problem, and the exact change (a number, an element or a timing). No adjectives
without a number.

Return only JSON matching the scores schema, with packetHash set to {hash}.
```

The scores schema:

```
mf-motion schema scores --json
```

## 3. Gate

```
mf-motion gate --json
```

Without scores, because you cannot view images:

```
mf-motion gate --no-vision --json
```

`data.level` is the verdict; `data.hardFailures`, `data.capped` and `data.summary` say why.

| Level | Means | Next |
|---|---|---|
| `PASS` | a fresh reviewer scored every axis at the target, no hard failure | deliver this round |
| `PASS-SELF` | the same, scored in this session | deliver this round |
| `PASS-MEASURED` | no hard failure; no scores (no image viewing) | deliver this round |
| `FAIL` | a hard failure, an axis under target, or invalid scores | apply the fixes, run another round |

Tell the user which check it was, in these words:

- `PASS`: "Checked by a fresh reviewer"
- `PASS-SELF`: "Checked in the same session"
- `PASS-MEASURED`: "Checked by measurements only; I could not view images"

## 4. Another round

After a `FAIL`, apply every fix line of every axis under target and every hard failure, add a BANNED entry for each pattern the judge named, rebuild, and run the round again. A round can run at most three times; after the third without a pass, deliver the best round with zero hard failures and say which axes stayed under target. A fourth round needs the user's approval:

```
mf-motion approve --subject extra-round --text "<their words>" --json
```

## When it fails

| Code | Do |
|---|---|
| `PACKET_MISSING` | Run the round (or `sheets` and `measure`) for this round, then `packet`. |
| `SCORES_STALE` | The packet changed after scoring; score the current packet again. |
| `SCORES_INVALID` | Check the JSON against `mf-motion schema scores --json` and write it again. |
| `HARD_FAILURES` | Fix the listed failures; no score overrules them. |
| `ROUND_LIMIT` | Offer the user an extra round (step 4). |

Other codes: [troubleshooting.md](troubleshooting.md).
