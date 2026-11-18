// Breaks rule 6: unseeded randomness in its timeline script.
import type { MoveModule, ResolvedVars } from '../../../../src/library/contract';
import type { Composition, MoveCtx } from '../../../../src/kit/build/move';
import { build as card } from '../fixture-card/index';
import { meta as base } from '../fixture-card/meta';

export const meta = { ...base, id: 'fixture-bad-random' };
export const vars = meta.vars;

export function build(ctx: MoveCtx, v: ResolvedVars): Composition {
  const composition = card(ctx, v);
  return { ...composition, id: meta.id, script: `${composition.script}\n  tl.to('#fc-card', { x: Math.random() * 10 * ctx.u, duration: 0.2 }, 1);` };
}

export default { meta, vars, build } satisfies MoveModule;
