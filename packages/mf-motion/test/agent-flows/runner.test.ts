// Agent-flow scenarios: test/agent-flows/<flow>.yaml lists the exact command
// lines a skill reference prescribes, each with its expected exit code and
// assertions on the JSON envelope. They prove the skill, followed literally, works.
//
// Scenario format (a small YAML subset):
//   name: <flow>
//   env:                      optional; "{tmp}" becomes a fresh temporary folder
//     KEY: "value"
//   steps:
//     - run: mf-motion <command> ... --json
//       exit: <code>
//       expect:                optional; `<path> <op> <JSON value>`, op one of == != > < >= <=
//         - data.brand.status == "picked"
import { mkdtempSync, readFileSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { COMMANDS } from '../../src/cli/commands/index';
import { splitLine } from '../unit/skill/skill-files';
import { runIn } from '../unit/cli/harness';

const here = path.dirname(fileURLToPath(import.meta.url));

export interface Step {
  run: string;
  exit: number;
  expect: string[];
}

export interface Scenario {
  name: string;
  env: Record<string, string>;
  steps: Step[];
}

const scalar = (text: string): string => {
  const value = text.trim();
  return /^".*"$/.test(value) ? (JSON.parse(value) as string) : value;
};

/** Parse the scenario subset; anything else is an error naming the line. */
export function parseScenario(text: string): Scenario {
  const scenario: Scenario = { name: '', env: {}, steps: [] };
  let section: 'env' | 'steps' | null = null;
  let step: Step | null = null;
  let inExpect = false;
  text.split(/\r?\n/).forEach((raw, index) => {
    const line = raw.replace(/\s+#.*$/, '').replace(/^#.*$/, '');
    if (line.trim() === '') return;
    const fail = () => {
      throw new Error(`scenario line ${index + 1}: cannot read "${raw}"`);
    };
    const indent = line.length - line.trimStart().length;
    const body = line.trim();
    if (indent === 0) {
      const match = body.match(/^(name|env|steps):\s*(.*)$/);
      if (!match) fail();
      if (match?.[1] === 'name') scenario.name = scalar(match[2] ?? '');
      else section = match?.[1] as 'env' | 'steps';
      inExpect = false;
      return;
    }
    if (section === 'env') {
      const match = body.match(/^([A-Z_][A-Z0-9_]*):\s*(.+)$/);
      if (!match) fail();
      scenario.env[match?.[1] ?? ''] = scalar(match?.[2] ?? '');
      return;
    }
    if (section !== 'steps') return fail();
    const item = body.match(/^-\s+(.*)$/);
    if (item && inExpect && indent > 4) {
      step?.expect.push(item[1] ?? '');
      return;
    }
    if (item) {
      step = { run: '', exit: 0, expect: [] };
      scenario.steps.push(step);
      inExpect = false;
    }
    const pair = (item ? item[1] : body)?.match(/^(run|exit|expect):\s*(.*)$/);
    if (!pair || !step) return fail();
    if (pair[1] === 'run') step.run = scalar(pair[2] ?? '');
    else if (pair[1] === 'exit') step.exit = Number(pair[2]);
    else inExpect = true;
  });
  return scenario;
}

/** Value at a path such as `data.checks[0].id` or `next.length`. */
export function valueAt(doc: unknown, at: string): unknown {
  return at
    .replace(/\[(\d+)\]/g, '.$1')
    .split('.')
    .reduce<unknown>((value, key) => (value === null || value === undefined ? undefined : (value as Record<string, unknown>)[key]), doc);
}

/** Check one assertion; returns null when it holds, else a message. */
export function check(doc: unknown, assertion: string): string | null {
  const match = assertion.match(/^(\S+)\s*(==|!=|>=|<=|>|<)\s*(.+)$/);
  if (!match) return `cannot read assertion "${assertion}"`;
  const actual = valueAt(doc, match[1] ?? '');
  const wanted = JSON.parse(match[3] ?? 'null') as unknown;
  const same = JSON.stringify(actual) === JSON.stringify(wanted);
  const n = Number(actual);
  const w = Number(wanted);
  const holds = { '==': same, '!=': !same, '>': n > w, '<': n < w, '>=': n >= w, '<=': n <= w }[match[2] as '=='];
  return holds ? null : `${assertion}: got ${JSON.stringify(actual)}`;
}

const scenarios = readdirSync(here).filter((name) => name.endsWith('.yaml')).sort();

describe('agent-flow scenarios', () => {
  it('reads the scenario format', () => {
    const parsed = parseScenario('name: x\nenv:\n  A: "{tmp}"\nsteps:\n  - run: mf-motion version --json\n    exit: 0\n    expect:\n      - data.cli == "1.0.0"\n');
    expect(parsed).toEqual({ name: 'x', env: { A: '{tmp}' }, steps: [{ run: 'mf-motion version --json', exit: 0, expect: ['data.cli == "1.0.0"'] }] });
    expect(check({ data: { cli: '1.0.0' }, next: ['a'] }, 'next.length >= 1')).toBeNull();
    expect(check({ data: { cli: '1.0.0' } }, 'data.cli == "2.0.0"')).toMatch(/got "1.0.0"/);
  });

  for (const file of scenarios) {
    it(`${file} passes step by step`, async () => {
      const scenario = parseScenario(readFileSync(path.join(here, file), 'utf8'));
      expect(scenario.name).toBe(file.replace(/\.yaml$/, ''));
      const tmp = mkdtempSync(path.join(tmpdir(), `mfm-flow-${scenario.name}-`));
      const env = Object.fromEntries(Object.entries(scenario.env).map(([key, value]) => [key, value.replace('{tmp}', tmp)]));
      for (const [i, step] of scenario.steps.entries()) {
        const argv = splitLine(step.run);
        expect(argv[0], `step ${i + 1} runs mf-motion`).toBe('mf-motion');
        const result = await runIn(argv.slice(1), COMMANDS, { NO_COLOR: '1', PATH: process.env.PATH, ...env });
        expect(result.code, `step ${i + 1} (${step.run}) exit: ${result.stdout.slice(0, 400)}`).toBe(step.exit);
        const envelope = JSON.parse(result.stdout) as unknown;
        const failures = step.expect.map((assertion) => check(envelope, assertion)).filter((message) => message !== null);
        expect(failures, `step ${i + 1} (${step.run})`).toEqual([]);
      }
    }, 300_000);
  }
});
