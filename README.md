# MF Skills

Agent skills by Iqbal for writing and coordinating project work.

- **[mf-copywriting](skills/mf-copywriting/SKILL.md)**: English and Indonesian
  copywriting, source discussion, revision, and editorial review.
- **[mf-orca](skills/mf-orca/SKILL.md)**: project routing, workflow selection,
  bounded delegation, scope changes, and evidence-based completion reports.

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
