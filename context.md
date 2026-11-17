# Context

## Identity

MF Skills is Iqbal's public monorepo for `mf-copywriting`, `mf-design`,
`mf-masterplan`, and `mf-hillclimb`.

## Sources

- `mf-copywriting` imported with full Git history from
  https://github.com/labsiqbal/mf-copywriting at
  `f4f9d62208c2b2c552426342a2abe649290bffa1`.
- `mf-design` authored by Iqbal; formerly named `design-directions`.
- `mf-masterplan` imported with full Git history from
  https://github.com/labsiqbal/masterplan at
  `fa8c5d3e3b723ea4c158f3dfaa8098033e9793ed`. Original author Hermes;
  maintained adaptation by Iqbal. MIT license retained inside the package.
- `mf-hillclimb` authored by Iqbal; method informed by
  [Theo Browne (@t3dotgg)](https://github.com/t3dotgg)'s
  [tstack](https://github.com/t3dotgg/tstack/tree/1085050f3baed1ac724caa4a8166145fb2ac88af).

## Decisions

- Packages carry independent versions and release tags.
- The standalone copywriting repository and its prior releases stay available.
- Every package is MIT licensed and ships its own license; imported notices
  remain intact.
- Skill payloads resolve project paths, tools, models, and authority from the
  consuming environment. Companion skills are optional unless their capability
  defines the workflow.
- Installation and discovery are distinct from behavior acceptance.
