# Context

## Identity

MF Skills is Iqbal's public monorepo for `mf-copywriting`, `mf-design`,
`mf-masterplan`, and `mf-hillclimb`.

## Sources

- `mf-copywriting` imported with full Git history from
  https://github.com/labsiqbal/mf-copywriting at
  `f4f9d62208c2b2c552426342a2abe649290bffa1`.
- `mf-orca` (coordinator role) initially authored for T3 and imported from Infra
  commit `1661151`; retired 2026-11-17, history kept in Git.
- `mf-hillclimb` extracted from the mf-orca 1.2.1 hill-climb reference; method
  informed by [Theo Browne (@t3dotgg)](https://github.com/t3dotgg)'s
  [tstack](https://github.com/t3dotgg/tstack/tree/1085050f3baed1ac724caa4a8166145fb2ac88af).
- `mf-design` imported from owner-authored Infra commit `86bd99bfa82de995bdb91ac7db16ea2762d1df70`
  and renamed from `design-directions` on owner request.

- `mf-masterplan` imported with full Git history from
  https://github.com/labsiqbal/masterplan at
  `fa8c5d3e3b723ea4c158f3dfaa8098033e9793ed`. Original author Hermes;
  maintained adaptation by Iqbal. MIT license retained inside the package.
  Source version 0.3.0 remains draft; migration changes packaging and invocation,
  with generated artifact names and workflow preserved.

## Decisions

- Packages retain independent versions and release tags.
- Preserve the standalone copywriting repository and its prior releases.
- Registry presence and native discovery are distinct from behavior acceptance.

- Owner approved MIT licensing for the remaining packages on 2026-11-17. Each
  installable package carries its own license; imported notices remain intact.
- Skill payloads resolve project paths, tools, models, and authority from the
  consuming environment. Companion skills are optional unless their capability
  defines the workflow.
- Owner retired `mf-orca` on 2026-11-17 because harnesses provide delegation
  natively. Hill climb became standalone `mf-hillclimb` with a 10-round limit;
  council review was dropped because it only works in multi-provider harnesses.
