# Context

## Identity

MF Skills is Iqbal's public monorepo for `mf-copywriting`, `mf-orca`, and `mf-design`.

## Sources

- `mf-copywriting` imported with full Git history from
  https://github.com/labsiqbal/mf-copywriting at
  `f4f9d62208c2b2c552426342a2abe649290bffa1`.
- `mf-orca` initially authored for owner-requested coordination in T3; source
  imported from Infra commit `1661151` with its native invocation metadata.
- Hill-climb and council methods informed by [Theo Browne (@t3dotgg)](https://github.com/t3dotgg)'s
  [tstack](https://github.com/t3dotgg/tstack/tree/1085050f3baed1ac724caa4a8166145fb2ac88af).
- `mf-design` imported from owner-authored Infra commit `86bd99bfa82de995bdb91ac7db16ea2762d1df70`
  and renamed from `design-directions` on owner request.

## Decisions

- Packages retain independent versions and release tags.
- Preserve the standalone copywriting repository and its prior releases.
- Private traces and deployment/account state remain outside this repository.
- Registry presence and native discovery are distinct from behavior acceptance.
