// The command registry list. Each command group lives in its own file and is
// added here with one import and one entry, so reverting a ticket removes only
// its own lines.
import type { AnyCommand } from '../registry';
import {
  brandCaptureCommand,
  brandFontsCommand,
  brandFromBriefCommand,
  brandListCommand,
  brandManualCommand,
  brandPickCommand,
  brandRmCommand,
  brandShowCommand,
  brandUseCommand,
} from './brand';
import { cloudDisableCommand, cloudEnableCommand, cloudListCommand } from './cloud';
import { doctorCommand } from './doctor';
import { filmBriefCommand } from './film';
import { lintCommand } from './lint';
import { migrateCommand } from './migrate';
import { approveCommand, newCommand, noteCommand, statusCommand } from './project';
import { schemaCommand } from './schema';
import { versionCommand } from './version';

export const COMMANDS: readonly AnyCommand[] = [
  versionCommand,
  newCommand,
  approveCommand,
  noteCommand,
  statusCommand,
  schemaCommand,
  migrateCommand,
  doctorCommand,
  lintCommand,
  brandCaptureCommand,
  brandFontsCommand,
  brandPickCommand,
  brandManualCommand,
  brandFromBriefCommand,
  brandShowCommand,
  brandListCommand,
  brandUseCommand,
  brandRmCommand,
  cloudListCommand,
  cloudEnableCommand,
  cloudDisableCommand,
  filmBriefCommand,
];
