# MF Skills

Owner-maintained public skill monorepo. Each package lives under `skills/` and
keeps its native skill format. Read [Map](MAP.md), [context](context.md), and
[backlog](backlog.md). In a managed workspace, also load its applicable rules.

Use `writing-for-agents` for skill and agent instructions. Use `mf-copywriting`
for human-facing copy. Preserve imported attribution, source history, relative
references, and invocation controls. Keep private evaluation logs, credentials,
runtime configuration, and client artifacts outside this public repository.

Run `python3 scripts/check.py` before delivery. `draft` is for development;
`ready` requires relevant validation; `released` requires a verified tag.
Tag skills independently as `<skill-name>-v<version>`. Record resolved tag SHA
in the release receipt, never inside the tagged skill itself.

The owner authorizes public GitHub publication of this monorepo and skill
releases. This grants no authority over projects operated through these skills.
