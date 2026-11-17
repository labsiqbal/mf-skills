import { describe, expect, it } from 'vitest';
import { MfmError } from '../../../src/cli/errors';
import { lastJson, run, runJson, runTool } from '../../../src/proc/run';

const node = process.execPath;

describe('lastJson', () => {
  it('reads the last JSON value and ignores log lines around it', () => {
    expect(lastJson('{"a":1}')).toEqual({ a: 1 });
    expect(lastJson('starting {weird}\nprogress 50%\n{"ok":true,"n":{"m":[1,2]}}\n')).toEqual({ ok: true, n: { m: [1, 2] } });
    expect(lastJson('{"first":1}\n{"second":{"x":"}"}}\ndone.\n')).toEqual({ second: { x: '}' } });
    expect(lastJson('[1,[2,3]] trailing {not json}')).toEqual([1, [2, 3]]);
    expect(lastJson('{"a":1}\n{"b":2}')).toEqual({ b: 2 });
    expect(lastJson('no json here')).toBeUndefined();
    expect(lastJson('')).toBeUndefined();
  });
});

describe('run', () => {
  it('captures stdout, stderr and the exit code without a shell', async () => {
    const result = await run(node, ['-e', 'process.stdout.write("out");process.stderr.write("err");process.exit(3)']);
    expect(result).toMatchObject({ code: 3, stdout: 'out', stderr: 'err', timedOut: false });
  });

  it('feeds stdin and streams chunks to callbacks', async () => {
    let seen = '';
    const result = await run(node, ['-e', 'process.stdin.pipe(process.stdout)'], {
      input: 'hello',
      onStdout: (chunk) => (seen += chunk),
    });
    expect(result.stdout).toBe('hello');
    expect(seen).toBe('hello');
  });

  it('stops a process that runs past its timeout', async () => {
    const result = await run(node, ['-e', 'setInterval(() => {}, 1000)'], { timeoutMs: 300 });
    expect(result.timedOut).toBe(true);
    expect(result.code === null || result.code !== 0).toBe(true);
    await expect(runTool(node, ['-e', 'setInterval(() => {}, 1000)'], { tool: 'sleeper', timeoutMs: 300 })).rejects.toMatchObject({
      code: 'TIMEOUT',
    });
  });

  it('reports a program that cannot start', async () => {
    const result = await run('mf-motion-no-such-program-xyz', []);
    expect(result.code).toBeNull();
    expect(result.spawnError?.code).toBe('ENOENT');
    const error = await runTool('mf-motion-no-such-program-xyz', [], { tool: 'ghost' }).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(MfmError);
    expect((error as MfmError).code).toBe('TOOL_FAILED');
    expect((error as MfmError).details).toMatchObject({ spawnError: 'ENOENT' });
  });

  it('extracts JSON from a tool and fails when there is none', async () => {
    const { json } = await runJson(node, ['-e', 'console.log("log line");console.log(JSON.stringify({v:1}))'], { tool: 'node' });
    expect(json).toEqual({ v: 1 });
    await expect(runJson(node, ['-e', 'console.log("nothing")'], { tool: 'node' })).rejects.toMatchObject({ code: 'TOOL_FAILED' });
  });
});
