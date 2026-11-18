// Agent-flow scenarios: test/agent-flows/<flow>.yaml lists the exact command
// lines a skill reference prescribes, each with its expected exit code and
// assertions on the JSON envelope. They prove the skill, followed literally, works.
//
// Scenario format (a small YAML subset):
//   name: <flow>
//   env:                      optional; "{tmp}" becomes a fresh temporary folder,
//                             "{cache}" the private test cache with the engine and Chrome
//     KEY: "value"
//   copy:                     optional; package-relative fixtures copied into the scenario folder
//     - test/fixtures/projects/film -> film
//   steps:
//     - run: mf-motion <command> ... --json
//       exit: <code>
//       save: <name>           optional; later steps may use {<name>.<path>} (for example {packet.data.hash})
//       expect:                optional; `<path> <op> <JSON value>`, op one of == != > < >= <=
//         - data.brand.status == "picked"
//     - write: film/rounds/1/scores.json      a fixture written into the scenario folder, with
//       from: test/agent-flows/fixtures/x.json  {tmp} and {<name>.<path>} filled in (the agent's judgement)
// Command lines may use {tmp} (the scenario folder) and saved values too.
import { cpSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { COMMANDS } from '../../src/cli/commands/index';
import { splitLine } from '../unit/skill/skill-files';
import { testBrowser, testCacheRoot } from '../helpers/engine';
import { runIn } from '../unit/cli/harness';

const here = path.dirname(fileURLToPath(import.meta.url));

export interface Step {
  run: string;
  exit: number;
  expect: string[];
  save?: string;
  write?: string;
  from?: string;
}

export interface Scenario {
  name: string;
  env: Record<string, string>;
  copy: Array<{ from: string; to: string }>;
  steps: Step[];
}

const scalar = (text: string): string => {
  const value = text.trim();
  return /^".*"$/.test(value) ? (JSON.parse(value) as string) : value;
};

/** Parse the scenario subset; anything else is an error naming the line. */
export function parseScenario(text: string): Scenario {
  const scenario: Scenario = { name: '', env: {}, copy: [], steps: [] };
  let section: 'env' | 'steps' | 'copy' | null = null;
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
      const match = body.match(/^(name|env|steps|copy):\s*(.*)$/);
      if (!match) fail();
      if (match?.[1] === 'name') scenario.name = scalar(match[2] ?? '');
      else section = match?.[1] as 'env' | 'steps' | 'copy';
      inExpect = false;
      return;
    }
    if (section === 'env') {
      const match = body.match(/^([A-Z_][A-Z0-9_]*):\s*(.+)$/);
      if (!match) fail();
      scenario.env[match?.[1] ?? ''] = scalar(match?.[2] ?? '');
      return;
    }
    if (section === 'copy') {
      const match = body.match(/^-\s+(\S+)\s+->\s+(\S+)$/);
      if (!match) fail();
      scenario.copy.push({ from: match?.[1] ?? '', to: match?.[2] ?? '' });
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
    const pair = (item ? item[1] : body)?.match(/^(run|exit|expect|save|write|from):\s*(.*)$/);
    if (!pair || !step) return fail();
    if (pair[1] === 'run') step.run = scalar(pair[2] ?? '');
    else if (pair[1] === 'exit') step.exit = Number(pair[2]);
    else if (pair[1] === 'save') step.save = scalar(pair[2] ?? '');
    else if (pair[1] === 'write') step.write = scalar(pair[2] ?? '');
    else if (pair[1] === 'from') step.from = scalar(pair[2] ?? '');
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
const packageRoot = path.resolve(here, '..', '..');

/** Fill {tmp} and {<saved>.<path>} placeholders. */
export function fill(text: string, tmp: string, saved: Record<string, unknown>): string {
  return text.replace(/\{tmp\}/g, tmp).replace(/\{([a-z][\w-]*)\.([^}]+)\}/gi, (whole, name: string, at: string) => {
    if (!(name in saved)) return whole;
    const value = valueAt(saved[name], at);
    if (value === undefined) throw new Error(`no ${at} in saved ${name}`);
    return String(value);
  });
}

describe('agent-flow scenarios', () => {
  it('reads the scenario format', () => {
    const parsed = parseScenario('name: x\nenv:\n  A: "{tmp}"\nsteps:\n  - run: mf-motion version --json\n    exit: 0\n    expect:\n      - data.cli == "1.0.0"\n');
    expect(parsed).toEqual({ name: 'x', env: { A: '{tmp}' }, copy: [], steps: [{ run: 'mf-motion version --json', exit: 0, expect: ['data.cli == "1.0.0"'] }] });
    const full = parseScenario('name: y\ncopy:\n  - a/b -> c\nsteps:\n  - run: mf-motion packet --json\n    exit: 0\n    save: packet\n  - write: c/s.json\n    from: f.json\n');
    expect(full.copy).toEqual([{ from: 'a/b', to: 'c' }]);
    expect(full.steps).toEqual([{ run: 'mf-motion packet --json', exit: 0, expect: [], save: 'packet' }, { run: '', exit: 0, expect: [], write: 'c/s.json', from: 'f.json' }]);
    expect(fill('{tmp}/x {packet.data.hash}', '/t', { packet: { data: { hash: 'abc' } } })).toBe('/t/x abc');
    expect(check({ data: { cli: '1.0.0' }, next: ['a'] }, 'next.length >= 1')).toBeNull();
    expect(check({ data: { cli: '1.0.0' } }, 'data.cli == "2.0.0"')).toMatch(/got "1.0.0"/);
  });

  for (const file of scenarios) {
    it(`${file} passes step by step`, async () => {
      const scenario = parseScenario(readFileSync(path.join(here, file), 'utf8'));
      expect(scenario.name).toBe(file.replace(/\.yaml$/, ''));
      const tmp = mkdtempSync(path.join(tmpdir(), `mfm-flow-${scenario.name}-`));
      if (Object.values(scenario.env).some((value) => value.includes('{cache}'))) await testBrowser();
      const env = Object.fromEntries(Object.entries(scenario.env).map(([key, value]) => [key, value.replace('{tmp}', tmp).replace('{cache}', testCacheRoot())]));
      // Commands run in process; some modules read process.env, so the scenario's
      // variables apply there too for the scenario's duration.
      const saved = Object.fromEntries(Object.keys(env).map((key) => [key, process.env[key]]));
      Object.assign(process.env, env);
      try {
        for (const { from, to } of scenario.copy) {
          mkdirSync(path.dirname(path.join(tmp, to)), { recursive: true });
          cpSync(path.join(packageRoot, from), path.join(tmp, to), { recursive: true });
        }
        const saved: Record<string, unknown> = {};
        for (const [i, step] of scenario.steps.entries()) {
          if (step.write) {
            expect(step.from, `step ${i + 1} writes from a fixture`).toBeDefined();
            const target = path.join(tmp, step.write);
            mkdirSync(path.dirname(target), { recursive: true });
            writeFileSync(target, fill(readFileSync(path.join(packageRoot, step.from ?? ''), 'utf8'), tmp, saved));
            continue;
          }
          const argv = splitLine(fill(step.run, tmp, saved));
          expect(argv[0], `step ${i + 1} runs mf-motion`).toBe('mf-motion');
          const result = await runIn(argv.slice(1), COMMANDS, { NO_COLOR: '1', PATH: process.env.PATH, ...env });
          expect(result.code, `step ${i + 1} (${step.run}) exit: ${result.stdout.slice(0, 400)}`).toBe(step.exit);
          const envelope = JSON.parse(result.stdout) as unknown;
          if (step.save) saved[step.save] = envelope;
          const failures = step.expect.map((assertion) => check(envelope, assertion)).filter((message) => message !== null);
          expect(failures, `step ${i + 1} (${step.run})`).toEqual([]);
        }
      } finally {
        for (const [key, value] of Object.entries(saved)) {
          if (value === undefined) delete process.env[key];
          else process.env[key] = value;
        }
      }
    }, 900_000);
  }
});
