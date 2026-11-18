// Breaks rule 2: a literal brand colour in its CSS.
import type { MoveModule, ResolvedVars } from '../../../../src/library/contract';
import type { Composition, MoveCtx } from '../../../../src/kit/build/move';
import { build as card } from '../fixture-card/index';
import { meta as base } from '../fixture-card/meta';

export const meta = { ...base, id: 'fixture-bad-color' };
export const vars = meta.vars;

export function build(ctx: MoveCtx, v: ResolvedVars): Composition {
  const composition = card(ctx, v);
  return { ...composition, id: meta.id, css: `${composition.css}\n.fc-title { color: #FF0000; }\n` };
}

export default { meta, vars, build } satisfies MoveModule;
