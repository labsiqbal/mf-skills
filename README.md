# MF Skills

Agent skills by Iqbal for writing and coordinating project work.

- **[mf-copywriting](skills/mf-copywriting/SKILL.md)**: English and Indonesian
  copywriting, source discussion, revision, and editorial review.
- **[mf-orca](skills/mf-orca/SKILL.md)**: project routing, workflow selection,
  bounded delegation, hill-climb evaluations, optional council reviews, and
  evidence-based completion reports.

## mf-orca capabilities

`mf-orca` coordinates work through the skills and tools available in your harness.
Project rules, the existing tracker, Git state, and runtime evidence guide its
decisions. Workers own implementation, checks, and UI capture; the coordinator
routes work, reviews evidence, and reports acceptance.

| Capability | Behavior |
|---|---|
| Routing and continuation | Select planning, prototyping, implementation, or review from current evidence; resume existing specs, tickets, and handoffs. |
| Bounded delegation | Give each worker a defined scope, checkout, output, and acceptance checks; save worker IDs for continuation. |
| Hill climb | Improve one candidate against a fixed baseline, workload, metric or rubric, and hard guards. Default: at most 3 candidate rounds; stop after 2 consecutive rounds without a qualifying improvement. |
| Best-candidate retention | Promote only verified improvements, retain the previous best on regression, and report whether acceptance was met, progress stalled, or the budget ran out. |
| UI evidence | Capture before/after on matching routes, data, states, viewport, theme, and zoom. Check interactions and accessibility separately where required. |
| Council review | When requested for a hill climb, use 3 model families across distinct providers to independently review the same frozen candidate, evidence, and rubric. Preserve findings, uncertainty, and dissent. |

Model and provider choices follow explicit owner and project instructions.
Otherwise, `mf-orca` resolves available routes through the harness using supported
session defaults. There is no fixed model roster. Record actual model, provider,
and effort when exposed; report missing members and unknown values without
silently substituting or claiming complete council coverage.

The [hill-climb reference](skills/mf-orca/references/hill-climb.md) defines the
evaluation contract, reviewer policy, evidence, and stop rules. Merge, release,
and deployment follow the project's authorization and gates.

## Install

Choose a skill with the Vercel Skills CLI:

```bash
npx skills add labsiqbal/mf-skills --skill mf-orca -g
npx skills add labsiqbal/mf-skills --skill mf-copywriting -g
```

Managed installations should update their existing source registry rather than
overwrite an active package. The standalone
[mf-copywriting repository](https://github.com/labsiqbal/mf-copywriting) remains
available; its history is preserved in this monorepo.

## Use

```text
Use mf-orca. Inspect this project's existing task state and continue the next
authorized step. Ask only for unresolved decisions that change the outcome.
```

```text
Use mf-orca in hill-climb mode. Improve this UI against a fixed rubric, keep
before/after evidence, and use a separate reviewer. Stop after at most 3 rounds
and report the best verified candidate.
```

```text
Use mf-orca in hill-climb mode with a council. Have 3 model families across
distinct providers independently review the same candidate, evidence, and rubric.
Honor my named model/provider choices; report unavailable members before claiming
complete coverage. Keep before/after evidence and stop after at most 3 rounds.
```

```text
Use mf-copywriting. Rewrite this product description for beginner readers.
Preserve the supplied features and avoid unsupported promises.
```

Explicit invocation syntax depends on the harness. Codex supports `$mf-orca`; Claude Code uses its native skill invocation.
Natural-language activation depends on native discovery and model behavior.

## Releases

Skills carry independent versions. A `released` skill has a verified
`<skill-name>-v<version>` tag.

Supported harnesses currently include Codex/T3 and Claude Code. Other harnesses
may install packages through their native skill mechanism.

## Credits

The hill-climb and council workflow is informed by
[Theo Browne (@t3dotgg)](https://github.com/t3dotgg) and his
[tstack repository](https://github.com/t3dotgg/tstack).
The reviewed Tstack revision is pinned in [source provenance](context.md#sources).
