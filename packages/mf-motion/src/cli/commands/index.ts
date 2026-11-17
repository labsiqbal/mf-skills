// The command registry list. Each command group lives in its own file and is
// added here with one import and one entry, so reverting a ticket removes only
// its own lines.
import type { AnyCommand } from '../registry';
import { versionCommand } from './version';

export const COMMANDS: readonly AnyCommand[] = [
  versionCommand,
];
