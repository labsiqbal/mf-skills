import { spawnSync } from 'node:child_process';
import { cpSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { RULES, lint } from '../../../src/lint/index';

const fixtures = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../fixtures/lint');
const packageRoot = path.resolve(fixtures, '../../..');
const names = readdirSync(fixtures).sort();

describe('lint fixtures', () => {
  it('cover every rule with a seeded-defect fixture', () => {
    for (const code of Object.keys(RULES)) expect(names, code).toContain(code);
  });

  it.each(names)('%s yields exactly its expected code at the right line', (name) => {
    const expected = JSON.parse(readFileSync(path.join(fixtures, name, 'expected.json'), 'utf8')) as { codes: string[]; line: number | null };
    const result = lint(path.join(fixtures, name));
    const all = [...result.errors, ...result.warnings];
    expect(all.map((finding) => finding.code)).toEqual(expected.codes);
    if (expected.line !== null) {
      expect(all[0]?.line).toBe(expected.line);
      expect(all[0]?.file).toBe('index.html');
      expect(all[0]?.snippet.length).toBeGreaterThan(0);
    }
    if (expected.codes[0] && RULES[expected.codes[0] as keyof typeof RULES] === 'warning') expect(result.errors).toEqual([]);
  });
});

describe('lint behaviour', () => {
  it('writes lint.json into a round folder', () => {
    const round = mkdtempSync(path.join(tmpdir(), 'mfm-round-'));
    lint(path.join(fixtures, 'DET002'), { round });
    const written = JSON.parse(readFileSync(path.join(round, 'lint.json'), 'utf8'));
    expect(written).toMatchObject({ schemaVersion: 1, kind: 'lint', warnings: [] });
    expect(written.errors[0]).toMatchObject({ code: 'DET002', file: 'index.html', line: expect.any(Number), col: expect.any(Number) });
  });

  it('finds problems in linked stylesheets and nested compositions with their own file and line', () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'mfm-lint-'));
    cpSync(path.join(fixtures, 'clean'), dir, { recursive: true });
    const index = readFileSync(path.join(dir, 'index.html'), 'utf8')
      .replace('</head>', '<link rel="stylesheet" href="styles/main.css">\n</head>')
      .replace('<!-- nested -->', '');
    writeFileSync(path.join(dir, 'index.html'), index.replace('</section>', '  <div data-composition-src="compositions/card.html"></div>\n  </section>'));
    cpSync(path.join(fixtures, 'clean', 'assets'), path.join(dir, 'styles', 'assets'), { recursive: true });
    writeFileSync(path.join(dir, 'styles', 'main.css'), '.a { color: red; }\n.b { background: url("https://cdn.example/bg.png"); }\n');
    cpSync(path.join(dir, 'index.html'), path.join(dir, 'compositions', 'card.html'));
    writeFileSync(
      path.join(dir, 'compositions', 'card.html'),
      '<div id="card" data-composition-id="card"><script>window.__timelines["card"] = gsap.timeline({ paused: true }); Math.random();</script></div>\n',
    );
    const result = lint(dir);
    expect(result.errors.map((f) => `${f.file}:${f.line}:${f.code}`)).toEqual(['compositions/card.html:1:DET002', 'styles/main.css:2:OFF001']);
  });

  it('flags dynamic import, @import and srcset references', () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'mfm-lint-'));
    cpSync(path.join(fixtures, 'clean'), dir, { recursive: true });
    const index = readFileSync(path.join(dir, 'index.html'), 'utf8')
      .replace('</style>', '@import "https://fonts.example/a.css";\n</style>')
      .replace('<img src="assets/logo.svg" alt="">', '<img src="assets/logo.svg" srcset="assets/logo.svg 1x, //cdn.example/logo@2x.png 2x" alt="">')
      .replace("window.__timelines['main'] = tl;", "window.__timelines['main'] = tl; import('./x.js');");
    writeFileSync(path.join(dir, 'index.html'), index);
    const codes = lint(dir).errors.map((finding) => finding.code);
    expect(codes.filter((code) => code === 'OFF001')).toHaveLength(2);
    expect(codes).toContain('OFF004');
  });

  it('the CLI exits 1 on errors and 0 on a clean build', () => {
    const cli = (dir: string) => spawnSync(process.execPath, [path.join(packageRoot, 'dist', 'cli.mjs'), 'lint', dir, '--json'], { encoding: 'utf8' });
    const build = spawnSync(process.execPath, ['esbuild.config.mjs'], { cwd: packageRoot, encoding: 'utf8' });
    expect(build.status).toBe(0);
    const bad = cli(path.join(fixtures, 'OFF001'));
    expect(bad.status).toBe(1);
    expect(JSON.parse(bad.stdout).data.errors[0].code).toBe('OFF001');
    const clean = cli(path.join(fixtures, 'clean'));
    expect(clean.status).toBe(0);
    expect(JSON.parse(clean.stdout).data).toEqual({ errors: [], warnings: [] });
  });
});
