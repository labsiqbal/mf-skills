# MF Skills

Agent skills by Iqbal for writing, product planning, web design, and iterative improvement.

- **[mf-copywriting](skills/mf-copywriting/SKILL.md)**: English and Indonesian
  copywriting, source discussion, revision, and editorial review.
- **[mf-design](skills/mf-design/SKILL.md)**: compare distinct HTML directions,
  choose one, and tune its CSS through a live panel with reset and export.
- **[mf-masterplan](skills/mf-masterplan/SKILL.md)**: turn a product idea or
  existing source into a build-ready package with research, decisions, ticket
  contracts, and an offline HTML deck.
- **[mf-hillclimb](skills/mf-hillclimb/SKILL.md)**: improve a product, UI,
  prompt, or code in rounds against a fixed metric or rubric, keeping only
  verified gains.

## mf-hillclimb capabilities

| Capability | Behavior |
|---|---|
| Fixed evaluation contract | Bind baseline, workload, metric or rubric, hard guards, and the improvement rule before any candidate result. |
| Round limits | At most 10 candidate rounds after baseline; stop early after 2 consecutive rounds without a qualifying improvement. Your limits win. |
| Independent evaluation | Programmatic checks first; subjective judgments go to a separate read-only reviewer. The builder never scores its own candidate. |
| Best-candidate retention | Promote only verified improvements, keep the previous best on regression, and report whether acceptance was met, progress stalled, or the budget ran out. |
| UI evidence | Capture before/after on matching routes, data, states, viewport, theme, and zoom. Check interactions and accessibility separately where required. |

Model and provider choices follow your instructions and project rules; there is
no fixed model roster. Merge, release, and deployment follow the project's gates.

## Install

Choose a skill with the Vercel Skills CLI:

```bash
npx skills add labsiqbal/mf-skills --skill mf-copywriting -g
npx skills add labsiqbal/mf-skills --skill mf-design -g
npx skills add labsiqbal/mf-skills --skill mf-masterplan -g
npx skills add labsiqbal/mf-skills --skill mf-hillclimb -g
```

If your installation uses a source registry, update that registry rather than
overwrite an active package. No registry is required for ordinary installation.
The standalone
[mf-copywriting repository](https://github.com/labsiqbal/mf-copywriting) remains
available; its history is preserved in this monorepo.

## Requirements and portability

No package requires the author's account, filesystem paths, workspace layout,
source registry, or model/provider roster. Project instructions and your request
choose those. Author credits and public repository URLs identify provenance and
installation sources, not accounts you must use for your work.

| Skill | Required capability | Optional capability and fallback |
|---|---|---|
| `mf-copywriting` | Read Markdown and work with the supplied brief | Updates use available retrieval tools or source exports; no named research skill is required. |
| `mf-design` | Write HTML/CSS/JS or edit the existing app | Companion design skills and embedded preview are optional; open the files in a local browser for selection. Report unavailable automated checks. |
| `mf-masterplan` | Read/write Markdown and resolve product decisions | Python 3.10+ runs stdlib helpers. Installed `mmdc` renders diagrams; authorized `--allow-download` enables pinned `npx`. Without rendering, use SVG fallback or report a text-only package. Independent review falls back to labeled self-review. |
| `mf-hillclimb` | Run the chosen checks and edit the candidate | A separate builder or reviewer is optional; without delegation, evaluate by script or in a fresh context and label the review as same-agent. |

Without Node or the Skills CLI, copy one complete `skills/<name>/` folder into
your harness's documented skill directory. Keep its references, scripts, assets,
and `LICENSE` together. Restart or reload skill discovery as your harness requires.
Existing application tools and external trackers retain their own prerequisites.

## Use

```text
Use mf-copywriting. Rewrite this product description for beginner readers.
Preserve the supplied features and avoid unsupported promises.
```

```text
Use mf-design. Create three distinct HTML directions for this landing-page brief,
show a comparison, then tune my choice through a live panel with CSS export.
```

```text
Use mf-masterplan. Turn this product idea into a build-ready package,
resolve product decisions with me, and preserve the project's existing tracker.
```

```text
Use mf-hillclimb. Improve this UI against a fixed rubric, keep before/after
evidence, and use a separate reviewer. Report the best verified candidate.
```

Explicit invocation syntax depends on the harness. Codex supports `$mf-hillclimb`; Claude Code uses its native skill invocation.
Natural-language activation depends on native discovery and model behavior.

## Releases

Skills carry independent versions. A `released` skill has a verified
`<skill-name>-v<version>` tag.

Packages use Markdown skill instructions with optional Codex UI metadata.
Invocation and tool availability vary by harness; installation alone does not
prove workflow quality. Current validation status lives in each `SKILL.md`;
versions marked `draft` remain under evaluation.

## License

[MIT](LICENSE). Each independently installable package includes its license.
The imported Masterplan package retains its original contributor notice in
[its license](skills/mf-masterplan/LICENSE).

## Credits

The mf-hillclimb workflow is informed by
[Theo Browne (@t3dotgg)](https://github.com/t3dotgg) and his
[tstack repository](https://github.com/t3dotgg/tstack).
The reviewed Tstack revision is pinned in [source provenance](context.md#sources).
