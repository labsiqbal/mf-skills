// The library moves. Every move ticket appends its meta import and one entry:
//   import { meta as <name> } from './<category>/<id>/meta';
//   move(<name>, () => import('./<category>/<id>/index')),
// A move's meta loads at start-up; its builder loads on demand, so esbuild
// code-splits each move into its own chunk.
import type { MoveMeta, MoveModule } from '../contract';
import { meta as promptToResult } from './ai/prompt-to-result/meta';
import { meta as revenueStep } from './business/revenue-step/meta';
import { meta as followerMilestone } from './creator/follower-milestone/meta';
import { meta as rankedBars } from './data/ranked-bars/meta';
import { meta as terminalRun } from './dev/terminal-run/meta';
import { meta as taskCheckoff } from './productivity/task-checkoff/meta';
import { meta as messageCascade } from './social/message-cascade/meta';

export interface LibraryMove {
  meta: MoveMeta;
  load: () => Promise<MoveModule>;
}

const move = (meta: MoveMeta, load: () => Promise<MoveModule>): LibraryMove => ({ meta, load });

export const LIBRARY_MOVES: LibraryMove[] = [
  move(messageCascade, () => import('./social/message-cascade/index')),
  move(followerMilestone, () => import('./creator/follower-milestone/index')),
  move(promptToResult, () => import('./ai/prompt-to-result/index')),
  move(terminalRun, () => import('./dev/terminal-run/index')),
  move(taskCheckoff, () => import('./productivity/task-checkoff/index')),
  move(revenueStep, () => import('./business/revenue-step/index')),
  move(rankedBars, () => import('./data/ranked-bars/index')),
];
