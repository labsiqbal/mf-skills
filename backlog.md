# Backlog

- [ ] MF-008 - Make all MF skill packages portable for public use.
  State: Doing. Claim: mf-portability-20261117-c60a632d | active.
  Session: NUC, T3/Codex; workspace thread c60a632d-c0b61cea2aefe4e0.
  Checkout: `~/workspace/.worktrees/mf-skills-portability-20261117`, branch
  `fix/public-skill-portability`; Git common-dir `mf-skills/.git`.
  Scope: all four packages, public installation/dependency documentation and
  portability checks; preserve MF-007 and its active import checkout.
  Base: `d13f80f` / PR #7 (Masterplan import), not yet integrated into main.
  Claimed: 2026-11-17T03:26:08.736485+00:00
  Acceptance: no personal runtime/path prerequisites; optional methods have
  fallbacks; package/regression checks pass; license coverage stated honestly.
  Delivery: PR against import branch; no merge, release or runtime rollout.
  Next: audit and patch; private evaluation evidence stays outside this repo.

- [x] MF-007 - Move Masterplan into this monorepo as `mf-masterplan`.
  State: Done (PR delivery). Claim: mf-masterplan-20261117-t3-4d38d4b0 | released.
  Session: NUC (`LINC`), T3/Codex Linc; native session ID unavailable.
  Checkout: `~/workspace/tools/skills-lab/mf-skills`, branch
  `chore/import-mf-masterplan`; Git common-dir `.git`.
  Scope: import full source history, package, tests and license; rename skill;
  migrate registered host bindings and workspace routes.
  Claimed: 2026-11-17T03:17:25.278794+00:00
  Checks: package/skill validators, imported regression suite, registry checks,
  binding readback. Delivery: https://github.com/labsiqbal/mf-skills/pull/7.
  Import commit: `d13f80fb279fe30866c6ffec75cd279fd91ed538`.
  Standards/Spec review completed; legacy-doc finding fixed in source commit
  `50be0da`. No new release tag. Retain this canonical task branch while the
  PR awaits integration; next: merge with history retained, then return to main.
  Evidence: package/skill validators and imported regression suite pass; full
  Git history and MIT license retained. Seven existing host links migrated;
  Codex main/Linc, Hermes, Pi and Grok native discovery returns enabled
  `mf-masterplan` only; Claude Code binding/source readback passes.

- [x] MF-006 - Add `mf-design` for comparing HTML directions and tuning one
  selection. Renamed from owner-authored `design-directions`; source delivered
  on `feat/mf-design-html-workflow`. Package/skill checks and Codex main/Linc
  native discovery pass; version 0.1.0 remains draft pending a real design brief.
  Source integration follows PR review; no release tag.

- [x] MF-005 - Add conversational copywriting and persuasive storytelling to
  mf-copywriting 0.3.0, including flexible practical ebook chapters in both
  languages. Package validator, skill validator, reference and installed-link
  checks pass; editorial diff reviewed without an independent writing trial.
  Execution: LINC, `~/workspace/tools/skills-lab/mf-skills`, branch
  `feat/copywriting-conversational-storytelling`, base `25dfe0e`.
  Existing symlinks read this source. Delivery: PR #5; no release tag.

- [x] MF-001 - Import both skills, publish public monorepo, migrate existing
  bindings, and release mf-orca.

- [x] MF-002 - Make mf-orca coordinator-only with mandatory harness exceptions.
  Source and binding checks pass; independent fixture and review evidence retained
  privately. Version 1.0.0 is ready for review; no release tag claimed.

- [x] MF-003 - Add requested hill-climb coordination with fixed evaluation,
  before/after evidence, runtime model selection, bounded review and best-candidate
  retention. Native fixture and independent Standards/Spec reviews pass;
  version 1.1.0 merged in PR #2. README documents capabilities and credits Theo
  Browne's GitHub and Tstack repository. Release and installed rollout pending.

- [x] MF-004 - Inherit full-access worker permissions without duplicate owner
  approval for authorized work. Package, binding and registry checks pass;
  version 1.1.1 remains draft until runtime behavior is verified. No release tag
  or change to existing worker modes claimed.

- [ ] masterplan-entry-routing - Sharpen Masterplan entry and exit boundaries
  (migrated from the standalone source; Later, unclaimed). Add capability-gap
  check; route strategic fog to `wayfinder`, unresolved existing-project changes
  to `grill-with-docs`, and resolved implementation plans to `to-spec`. Preserve
  canonical domain decisions in project CONTEXT/ADRs. Done when routing examples
  and boundary regressions pass without weakening greenfield planning.

- [ ] masterplan-beta-field-validation - Remaining evidence before version 1.0
  (migrated from the standalone source; Later, unclaimed). Run full-fork planning
  against a small MIT repository and one-to-one GitHub Issues publish/claim/status/
  evidence/dependency round-trip in a sandbox. Done when both receipts exist and
  discovered failures have regression checks. Prior greenfield and deck browser
  checks remain recorded in the imported source history.
