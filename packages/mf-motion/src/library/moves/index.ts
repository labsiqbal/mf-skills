// The library moves, one line each, appended by every move ticket:
//   move(metaOf, () => import('./<category>/<id>/index')),
// A move's meta comes from its own meta.ts (loaded at start-up); its builder
// loads on demand, so esbuild code-splits each move into its own chunk.
import type { MoveMeta, MoveModule } from '../contract';

export interface LibraryMove {
  meta: MoveMeta;
  load: () => Promise<MoveModule>;
}

const move = (meta: MoveMeta, load: () => Promise<MoveModule>): LibraryMove => ({ meta, load });
void move;

export const LIBRARY_MOVES: LibraryMove[] = [];
