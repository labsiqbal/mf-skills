# mf-copywriting

A bilingual copywriting skill for natural, context-aware human-facing content in English and Indonesian.

Natural does not have to mean casual. Copy can stay clear, professional, or technical without sounding translated, templated, or machine-written.

**Author:** Iqbal · **Version:** 0.2.0 · **Status:** ready

## What it covers

- Brief discovery before writing: purpose, channel, reader, source material, voice, structure, and constraints.
- English-first guidance with an optional Indonesian branch.
- Landing pages, sales copy, articles, social posts, email, WhatsApp, video scripts, and presentations.
- GitHub descriptions, READMEs, issues, pull requests, release notes, and Discussions.
- Source-based writing when the user has no firsthand experience or sources yet.
- A source discussion step before writing on the user's behalf: findings, evidence limits, and editorial angles.
- Preservation of facts, numbers, prices, deadlines, promises, uncertainty, commands, paths, and technical identifiers.
- Separation of audience-facing copy from internal notes, builder instructions, and prototype status.
- Editorial taste assessment across six dimensions on a 1-10 scale, separate from fact and format checks.
- On-demand research updates for language usage, communication style, and copywriting patterns.

The main entrypoint is [`SKILL.md`](SKILL.md). English guidance lives in [`en/guide.md`](en/guide.md). Indonesian guidance is optional in [`id/panduan.md`](id/panduan.md).

For agent instructions, use `writing-for-agents`. This skill handles human-facing language and editorial quality; it does not replace technical instruction design.

## Install with `npx`

Install globally with the Vercel Skills CLI:

```bash
npx skills add labsiqbal/mf-copywriting -g
```

Install for a specific supported agent:

```bash
npx skills add labsiqbal/mf-copywriting -g --agent claude-code
```

The CLI detects the root `SKILL.md` and keeps the language references with it. Check the CLI's supported agent names with `npx skills add --help`.

To install from a local clone instead:

```bash
git clone https://github.com/labsiqbal/mf-copywriting.git
```

Installation and activation behavior depends on the agent harness. Existing local installations should be checked before replacement.

## Use it

Explicit invocation:

```text
Use mf-copywriting. Write a GitHub repository description for a personal
expense tracker. Readers are beginner developers. Available features: manual
expense entry and CSV export. Do not claim bank sync.
```

A source-discussion flow:

```text
Use mf-copywriting. Write a website article about AI for administrative work.
I have no firsthand experience or sources. Research and discuss the evidence
and possible angle with me before drafting on my behalf.
```

A direct revision:

```text
Use mf-copywriting. Rewrite this email so it feels warm and straightforward.
Preserve the dates, payment amount, and promises already stated.
```

The skill asks only questions that can change the claims, direction, or output. A complete brief can proceed directly.

## Writing on the user's behalf

No firsthand experience does not block the work. The skill can find and read relevant sources, show what they support, explain evidence limits, and ask the user which angle or conclusion fits. After the direction is clear, it writes with attribution and citations near relevant claims.

Sources support facts. They do not prove that the user experienced, tested, or personally endorses something. If the user delegates the angle, the skill can write an attributed explanation and editorial conclusion without inventing a personal belief.

## Taste assessment

The six editorial dimensions are:

1. Reader relevance.
2. Sharpness of perspective.
3. Credible voice.
4. Reading pleasure.
5. Judgment and restraint.
6. Intended effect.

Scores are integer judgments from 1 to 10 with quotes and reasons. They are not summed or averaged. Factual defects still require correction even when the copy reads well. User-selected samples are the style reference for their context.

## On-demand language updates

```text
mf-copywriting-update. Update Indonesian language references for Instagram
captions in Indonesia over the last 30 days.
```

The update mode researches language, communication style, and copywriting patterns within the requested scope. It is on demand. No recurring schedule is created automatically. Current-trend claims require dated sources and a comparable baseline. A generation label does not automatically determine slang or tone.

## Repository layout

- [`SKILL.md`](SKILL.md): entrypoint, triggers, and routing.
- [`en/guide.md`](en/guide.md): primary English guide.
- [`id/panduan.md`](id/panduan.md): optional Indonesian guide.
- [`en/references/content/`](en/references/content/): English format guides.
- [`id/references/konten/`](id/references/konten/): Indonesian format guides.
- [`id/references/taste.md`](id/references/taste.md): Indonesian taste matrix.
- [`id/references/uji.md`](id/references/uji.md): behavior fixtures.
- [`id/references/update.md`](id/references/update.md): on-demand language update flow.

## Status and evidence

Version 0.2.0 is ready for draft and revision work with final human review. The research, source discussion, waiting-for-direction, and continuation flow were tested with separate agents and source review. The tests do not prove universal factual accuracy, consistent taste on every first draft, or equal behavior across every model and harness.

`ready` means validated for its tested scope. `released` requires a verified Git tag. Version and author metadata live in [`SKILL.md`](SKILL.md).
