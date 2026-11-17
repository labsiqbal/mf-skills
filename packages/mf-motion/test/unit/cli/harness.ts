import type { AnyCommand, CliIO } from '../../../src/cli/registry';
import { runCli } from '../../../src/cli/registry';

export interface Captured {
  code: number;
  stdout: string;
  stderr: string;
}

/** Run the CLI in-process with captured streams. */
export async function runIn(argv: string[], commands: readonly AnyCommand[], env: NodeJS.ProcessEnv = {}): Promise<Captured> {
  let stdout = '';
  let stderr = '';
  const io: CliIO = {
    stdout: { write: (text: string) => (stdout += text) },
    stderr: { write: (text: string) => (stderr += text), isTTY: false },
    env,
    cwd: process.cwd(),
  };
  const code = await runCli(argv, io, commands);
  return { code, stdout, stderr };
}
