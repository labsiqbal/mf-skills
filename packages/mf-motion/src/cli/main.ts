import { COMMANDS } from './commands/index';
import { ERRORS, EXIT } from './errors';
import { failureEnvelope, renderJson } from './output';
import { CLI_VERSION, runCli } from './registry';

const [major = 0] = process.versions.node.split('.').map(Number);
if (major < 22) {
  const info = ERRORS.NODE_TOO_OLD;
  const message = `${info.message} Found ${process.versions.node}.`;
  if (process.argv.includes('--json')) {
    process.stdout.write(
      renderJson(failureEnvelope('', CLI_VERSION, { code: 'NODE_TOO_OLD', message, hint: info.hint, details: { node: process.versions.node } })),
    );
  } else {
    process.stderr.write(`error NODE_TOO_OLD: ${message}\nhint: ${info.hint}\n`);
  }
  process.exitCode = EXIT.environment;
} else {
  process.exitCode = await runCli(
    process.argv.slice(2),
    { stdout: process.stdout, stderr: process.stderr, env: process.env, cwd: process.cwd() },
    COMMANDS,
  );
}
