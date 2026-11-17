// Offline and determinism lint for a build folder. Real parsers only:
// parse5 for HTML, postcss for CSS, acorn for JavaScript.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { parse as parseJs } from 'acorn';
import { ancestor as walkAncestor } from 'acorn-walk';
import postcss, { type AtRule, type Declaration, type Root as CssRoot, type Rule } from 'postcss';
import { MfmError } from '../cli/errors';
import { type TimeGrid, resolveSpec } from '../time/index';
import {
  type Element,
  type TextNode,
  ancestors,
  attr,
  attrPosition,
  elements,
  hasAttr,
  hasClass,
  nodePosition,
  parseHtml,
  querySelectorAll,
  textContent,
  textNodes,
} from './dom';
import { ENTRANCE_KINDS, EXIT_KINDS, LINT_NUMBERS, entranceSeconds } from './numbers';

export type Severity = 'error' | 'warning';

export const RULES = {
  OFF001: 'error',
  OFF002: 'error',
  OFF003: 'error',
  OFF004: 'error',
  DET001: 'error',
  DET002: 'error',
  DET003: 'error',
  DET004: 'error',
  DET005: 'error',
  DET006: 'error',
  DET007: 'error',
  TXT001: 'error',
  TXT002: 'error',
  TXT003: 'error',
  TXT004: 'error',
  TXT005: 'error',
  TXT006: 'error',
  TXT007: 'error',
  CPY001: 'error',
  CPY002: 'error',
  CPY003: 'warning',
  STR001: 'error',
  STR002: 'error',
  STR003: 'error',
  STR004: 'error',
  STR005: 'warning',
  PRF001: 'warning',
} as const satisfies Record<string, Severity>;

export type RuleCode = keyof typeof RULES;

export interface Finding {
  code: RuleCode;
  file: string;
  line: number;
  col: number;
  message: string;
  snippet: string;
}

export interface LintResult {
  errors: Finding[];
  warnings: Finding[];
}

export interface LintOptions {
  profile?: string;
  /** Round folder: lint.json is written there. */
  round?: string;
}

/** Scripts a composition may load from files. */
const ALLOWED_SCRIPT = /^(vendor\/gsap\/[^/]+|vendor\/three\/[^/]+|vendor\/mf-runtime\.js)$/;

const NETWORK_URL = /^(?:[a-z][a-z0-9+.-]*:)?\/\//i;
const SCHEME = /^[a-z][a-z0-9+.-]*:/i;

/** Fetchable attributes by element (lower-case tag names). */
const FETCH_SRC = new Set(['script', 'img', 'source', 'video', 'audio', 'iframe', 'embed', 'track']);
const SVG_FETCH = new Set(['use', 'image', 'feimage']);
const CLIP_TRANSFORM_KEYS = new Set([
  'x', 'y', 'z', 'xPercent', 'yPercent', 'scale', 'scaleX', 'scaleY', 'rotation', 'rotate', 'rotationX', 'rotationY', 'rotationZ',
  'skew', 'skewX', 'skewY', 'transform', 'opacity', 'autoAlpha',
]);
const LAYOUT_KEYS = new Set(['top', 'left', 'right', 'bottom', 'width', 'height', 'letterSpacing', 'letter-spacing']);
const TWEEN_METHODS = new Set(['to', 'from', 'fromTo', 'set']);
const SKIP_TEXT = new Set(['script', 'style', 'template', 'noscript', 'head', 'title', 'textarea']);
const PLACEHOLDERS: Array<[RegExp, string]> = [
  [/lorem\s+ipsum/i, 'lorem ipsum'],
  [/your\s+text\s+here/i, '"your text here"'],
  [/^\s*(headline|subtitle)\s*$/i, 'a bare "headline" or "subtitle"'],
  [/\bTBD\b/, '"TBD"'],
  [/X{3,}/i, 'repeated XXX'],
  [/\{[A-Za-z_][\w.-]*\}/, 'an unfilled {var}'],
];

interface Composition {
  file: string;
  root: Element | null;
  id: string | null;
  width: number;
  height: number;
  durationSec: number | null;
  fps: string;
}

class Linter {
  readonly findings: Finding[] = [];
  private readonly sources = new Map<string, string[]>();
  constructor(readonly buildDir: string) {}

  add(code: RuleCode, file: string, line: number, col: number, message: string) {
    const lines = this.sources.get(file) ?? [];
    const snippet = (lines[line - 1] ?? '').trim().slice(0, 160);
    this.findings.push({ code, file, line, col, message, snippet });
  }

  remember(file: string, source: string) {
    this.sources.set(file, source.split(/\r?\n/));
  }

  rel(absolute: string): string {
    return path.relative(this.buildDir, absolute).split(path.sep).join('/');
  }

  /** OFF001/OFF002/OFF003 for one reference found in `file` (relative to `baseDir`). */
  checkUrl(raw: string, file: string, baseDir: string, line: number, col: number, what: string) {
    const url = raw.trim();
    if (url === '' || url.startsWith('#') || /^(data|blob|about):/i.test(url)) return;
    if (NETWORK_URL.test(url) || (SCHEME.test(url) && !/^file:/i.test(url) && !/^[a-z]:[\\/]/i.test(url))) {
      this.add('OFF001', file, line, col, `${what} loads ${url} from the network; copy the file into the build instead`);
      return;
    }
    if (/^file:/i.test(url) || /^[a-z]:[\\/]/i.test(url) || url.startsWith('/') || url.startsWith('\\')) {
      this.add('OFF002', file, line, col, `${what} uses ${url}, a path outside the build folder`);
      return;
    }
    let decoded = url.split(/[?#]/)[0] ?? '';
    try {
      decoded = decodeURI(decoded);
    } catch {
      // Keep the raw text.
    }
    const target = path.resolve(baseDir, decoded);
    const relative = path.relative(this.buildDir, target);
    if (relative.startsWith('..') || path.isAbsolute(relative)) {
      this.add('OFF002', file, line, col, `${what} uses ${url}, which leaves the build folder`);
      return;
    }
    if (!existsSync(target)) this.add('OFF003', file, line, col, `${what} uses ${url}, which does not exist in the build`);
  }
}

function lineCol(baseLine: number, baseCol: number, line: number, column: number): { line: number; col: number } {
  // postcss columns are 1-based, acorn columns 0-based; callers normalise to 1-based `column`.
  return line === 1 ? { line: baseLine, col: baseCol + column - 1 } : { line: baseLine + line - 1, col: column };
}

function srcsetUrls(value: string): string[] {
  return value
    .split(',')
    .map((candidate) => candidate.trim().split(/\s+/)[0] ?? '')
    .filter(Boolean);
}

/** url(...) and image-set("...") references in a CSS value. */
function cssUrls(value: string): string[] {
  const urls: string[] = [];
  for (const match of value.matchAll(/url\(\s*(?:"([^"]*)"|'([^']*)'|([^)\s]*))\s*\)/gi)) urls.push(match[1] ?? match[2] ?? match[3] ?? '');
  for (const set of value.matchAll(/image-set\(([^)]*)\)/gi)) {
    for (const match of (set[1] ?? '').matchAll(/(?:^|,)\s*(?:"([^"]*)"|'([^']*)')/g)) urls.push(match[1] ?? match[2] ?? '');
  }
  return urls;
}

function lengthPx(value: string, frame: number): number | null {
  const match = value.trim().match(/^(-?\d*\.?\d+)(px|%)?$/);
  if (!match) return null;
  const number = Number(match[1]);
  if (match[2] === '%') return (number / 100) * frame;
  return match[2] === 'px' || number === 0 ? number : null;
}

interface CssContext {
  file: string;
  baseDir: string;
  baseLine: number;
  baseCol: number;
  composition: Composition;
  documentRoot: Element | null;
  /** An inline style attribute: the element it styles. */
  styledElement?: Element;
}

function lintCss(linter: Linter, root: CssRoot, context: CssContext) {
  const { composition } = context;
  const shortSide = Math.min(composition.width, composition.height);
  const minReadable = LINT_NUMBERS.minReadableShare * shortSide;
  const readable = (element: Element) => hasClass(element, 'mf-line') || ancestors(element).some((a) => hasClass(a, 'mf-line'));
  const where = (node: Declaration | AtRule) => {
    const start = node.source?.start;
    return lineCol(context.baseLine, context.baseCol, start?.line ?? 1, start?.column ?? 1);
  };
  const ruleTargets = (rule: Rule | undefined): Element[] => {
    if (context.styledElement) return [context.styledElement];
    if (!rule || !context.documentRoot) return [];
    try {
      return querySelectorAll(context.documentRoot, rule.selector);
    } catch {
      return [];
    }
  };
  root.walkAtRules((atRule) => {
    if (atRule.name.toLowerCase() === 'import') {
      const params = atRule.params.trim();
      const quoted = params.match(/^(?:"([^"]*)"|'([^']*)')/);
      const urls = quoted ? [quoted[1] ?? quoted[2] ?? ''] : cssUrls(params);
      const at = where(atRule);
      for (const url of urls) linter.checkUrl(url, context.file, context.baseDir, at.line, at.col, '@import');
    }
  });
  root.walkDecls((decl) => {
    const prop = decl.prop.toLowerCase();
    const value = decl.value;
    const at = where(decl);
    for (const url of cssUrls(value)) linter.checkUrl(url, context.file, context.baseDir, at.line, at.col, `CSS ${prop}`);
    if (prop === 'animation-iteration-count' && /\binfinite\b/i.test(value)) {
      linter.add('DET004', context.file, at.line, at.col, 'animation-iteration-count: infinite loops forever; give it a count');
    }
    if (prop === 'animation' && /\binfinite\b/i.test(value)) linter.add('DET004', context.file, at.line, at.col, 'an infinite CSS animation loops forever');
    if (prop === 'transition' || prop.startsWith('transition-')) {
      linter.add('DET005', context.file, at.line, at.col, `${prop} animates outside the timeline; tween it in GSAP instead`);
    }
    if (prop === 'letter-spacing') {
      const match = value.trim().match(/^(-?\d*\.?\d+)(em|rem)$/);
      if (match && Number(match[1]) < LINT_NUMBERS.trackingFloorEm) {
        linter.add('TXT006', context.file, at.line, at.col, `letter-spacing ${value} is tighter than ${LINT_NUMBERS.trackingFloorEm}em`);
      }
    }
    const parentRule = decl.parent?.type === 'rule' ? (decl.parent as Rule) : undefined;
    const inKeyframes = (() => {
      let node = decl.parent;
      while (node) {
        if (node.type === 'atrule' && /keyframes$/i.test((node as AtRule).name)) return true;
        node = node.parent as typeof node;
      }
      return false;
    })();
    if (inKeyframes && LAYOUT_KEYS.has(prop)) {
      linter.add('STR001', context.file, at.line, at.col, `@keyframes animates ${prop}; animate transforms instead`);
    }
    if (prop === 'font-size' && !inKeyframes) {
      const px = value.trim().match(/^(\d*\.?\d+)px$/);
      if (px && Number(px[1]) < minReadable && ruleTargets(parentRule).some(readable)) {
        linter.add('TXT007', context.file, at.line, at.col, `font-size ${value} on readable text is below ${minReadable.toFixed(1)}px (2.6% of the short side)`);
      }
    }
    if (prop === 'backdrop-filter' || prop === '-webkit-backdrop-filter') {
      // Sizes declared beside it (inline styles parse into the same block).
      const block = decl.parent as { nodes?: Array<{ type: string; prop?: string; value?: string }> } | undefined;
      const sizeOf = (name: string, frame: number) => {
        const sibling = block?.nodes?.find((node) => node.type === 'decl' && node.prop?.toLowerCase() === name);
        return sibling?.value ? lengthPx(sibling.value, frame) : null;
      };
      const width = sizeOf('width', composition.width) ?? (sizeOf('inset', composition.width) === 0 ? composition.width : null);
      const height = sizeOf('height', composition.height) ?? (sizeOf('inset', composition.height) === 0 ? composition.height : null);
      if (width !== null && height !== null && width * height > LINT_NUMBERS.backdropMaxFrameShare * composition.width * composition.height) {
        linter.add('PRF001', context.file, at.line, at.col, 'backdrop-filter on an element larger than half the frame is slow to render');
      }
    }
  });
}

interface JsContext {
  file: string;
  baseLine: number;
  baseCol: number;
  documentRoot: Element | null;
  registered: Set<string>;
}

type AnyNode = { type: string; start: number; end: number; loc?: { start: { line: number; column: number } }; [key: string]: unknown };

function memberPath(node: AnyNode | undefined): string | null {
  if (!node) return null;
  if (node.type === 'Identifier') return node.name as string;
  if (node.type === 'MemberExpression') {
    const object = memberPath(node.object as AnyNode);
    const property = node.property as AnyNode;
    const name = node.computed ? (property.type === 'Literal' ? String(property.value) : null) : (property.name as string);
    return object && name !== null ? `${object}.${name}` : null;
  }
  if (node.type === 'ThisExpression') return 'this';
  return null;
}

const strip = (pathText: string) => pathText.replace(/^(window|self|globalThis)\./, '');

function propertyKey(property: AnyNode): string | null {
  const key = property.key as AnyNode;
  if (property.computed) return key.type === 'Literal' ? String(key.value) : null;
  return key.type === 'Identifier' ? (key.name as string) : key.type === 'Literal' ? String(key.value) : null;
}

function lintJs(linter: Linter, source: string, context: JsContext, module: boolean) {
  let program: AnyNode;
  try {
    program = parseJs(source, { ecmaVersion: 'latest', sourceType: module ? 'module' : 'script', locations: true, allowHashBang: true }) as unknown as AnyNode;
  } catch (error) {
    const loc = (error as { loc?: { line: number; column: number } }).loc;
    const at = lineCol(context.baseLine, context.baseCol, loc?.line ?? 1, (loc?.column ?? 0) + 1);
    linter.add('DET007', context.file, at.line, at.col, `the script does not parse: ${(error as Error).message}`);
    return;
  }
  const at = (node: AnyNode) => lineCol(context.baseLine, context.baseCol, node.loc?.start.line ?? 1, (node.loc?.start.column ?? 0) + 1);
  const report = (code: RuleCode, node: AnyNode, message: string) => {
    const position = at(node);
    linter.add(code, context.file, position.line, position.col, message);
  };
  const reported = new Set<number>();
  const once = (code: RuleCode, node: AnyNode, message: string) => {
    const key = node.start * 100 + Object.keys(RULES).indexOf(code);
    if (reported.has(key)) return;
    reported.add(key);
    report(code, node, message);
  };
  const isReference = (node: AnyNode, parents: AnyNode[]) => {
    const parent = parents[parents.length - 2];
    if (!parent) return true;
    if (parent.type === 'MemberExpression' && parent.property === node && !parent.computed) return false;
    if ((parent.type === 'Property' || parent.type === 'MethodDefinition' || parent.type === 'PropertyDefinition') && parent.key === node && !parent.computed) return false;
    if ((parent.type === 'VariableDeclarator' || parent.type === 'FunctionDeclaration' || parent.type === 'ClassDeclaration') && parent.id === node) return false;
    return true;
  };
  walkAncestor(program as never, {
    Identifier(rawNode: unknown, _state: unknown, rawParents: unknown) {
      const node = rawNode as AnyNode;
      const parents = rawParents as AnyNode[];
      if (!isReference(node, parents)) return;
      const name = node.name as string;
      if (['XMLHttpRequest', 'WebSocket', 'EventSource', 'fetch', 'importScripts'].includes(name)) once('OFF004', node, `${name} reaches the network; compositions must work offline`);
      if (name === 'Date') once('DET001', node, 'Date makes renders depend on the clock; use the timeline time');
      if (['setTimeout', 'setInterval', 'requestAnimationFrame', 'requestIdleCallback', 'queueMicrotask'].includes(name)) {
        once('DET003', node, `${name} is wall-clock timing; drive changes from the paused timeline`);
      }
    },
    MemberExpression(rawNode: unknown) {
      const node = rawNode as AnyNode;
      const full = memberPath(node);
      if (!full) return;
      const name = strip(full);
      if (name === 'navigator.sendBeacon' || name === 'fetch') once('OFF004', node, `${name} reaches the network; compositions must work offline`);
      if (['XMLHttpRequest', 'WebSocket', 'EventSource'].includes(name)) once('OFF004', node, `${name} reaches the network`);
      if (name === 'performance.now' || name === 'Date.now') once('DET001', node, `${name} makes renders depend on the clock`);
      if (['Math.random', 'crypto.getRandomValues', 'crypto.randomUUID', 'gsap.utils.random'].includes(name)) {
        once('DET002', node, `${name} is not seeded; use mf.rand(seed)`);
      }
      if (['setTimeout', 'setInterval', 'requestAnimationFrame', 'requestIdleCallback', 'queueMicrotask'].includes(name)) {
        once('DET003', node, `${name} is wall-clock timing; drive changes from the paused timeline`);
      }
    },
    ImportExpression(rawNode: unknown) {
      once('OFF004', rawNode as AnyNode, 'dynamic import() loads code at render time');
    },
    ObjectExpression(rawNode: unknown) {
      const node = rawNode as AnyNode;
      for (const property of (node.properties as AnyNode[]) ?? []) {
        if (property.type !== 'Property') continue;
        if (propertyKey(property) !== 'repeat') continue;
        const value = property.value as AnyNode;
        const minusOne = value.type === 'UnaryExpression' && value.operator === '-' && (value.argument as AnyNode).type === 'Literal' && (value.argument as AnyNode).value === 1;
        if (minusOne) once('DET004', property, 'repeat: -1 loops forever; give it a count that ends inside the composition');
      }
    },
    AssignmentExpression(rawNode: unknown) {
      const node = rawNode as AnyNode;
      const left = node.left as AnyNode;
      if (left.type !== 'MemberExpression') return;
      const object = memberPath(left.object as AnyNode);
      if (!object || strip(object) !== '__timelines') return;
      const property = left.property as AnyNode;
      if (left.computed && property.type === 'Literal' && typeof property.value === 'string') context.registered.add(property.value);
      else if (!left.computed && property.type === 'Identifier') context.registered.add(property.name as string);
    },
    CallExpression(rawNode: unknown) {
      const node = rawNode as AnyNode;
      const callee = node.callee as AnyNode;
      const calleePath = memberPath(callee);
      const args = (node.arguments as AnyNode[]) ?? [];
      if (calleePath && strip(calleePath) === 'gsap.timeline') {
        const options = args[0];
        const paused =
          options?.type === 'ObjectExpression' &&
          (options.properties as AnyNode[]).some((property) => property.type === 'Property' && propertyKey(property) === 'paused' && (property.value as AnyNode).type === 'Literal' && (property.value as AnyNode).value === true);
        if (!paused) once('DET006', node, 'gsap.timeline() without paused: true plays on its own; create it paused');
      }
      if (callee.type !== 'MemberExpression') return;
      const method = callee.computed ? null : ((callee.property as AnyNode).name as string);
      if (!method || !TWEEN_METHODS.has(method)) return;
      const varsArgs = method === 'fromTo' ? [args[1], args[2]] : [args[1]];
      const keys: Array<{ key: string; node: AnyNode }> = [];
      for (const vars of varsArgs) {
        if (vars?.type !== 'ObjectExpression') continue;
        for (const property of vars.properties as AnyNode[]) {
          if (property.type !== 'Property') continue;
          const key = propertyKey(property);
          if (key) keys.push({ key, node: property });
        }
      }
      if (keys.length === 0) return;
      for (const { key, node: keyNode } of keys) {
        if (LAYOUT_KEYS.has(key)) once('STR001', keyNode, `tweening ${key} re-lays out the page every frame; animate transforms instead`);
      }
      const target = args[0];
      if (target?.type === 'Literal' && typeof target.value === 'string' && context.documentRoot) {
        let targets: Element[] = [];
        try {
          targets = querySelectorAll(context.documentRoot, target.value);
        } catch {
          targets = [];
        }
        const transformKey = keys.find(({ key }) => CLIP_TRANSFORM_KEYS.has(key));
        if (transformKey && targets.some((element) => hasClass(element, 'clip'))) {
          once('STR002', node, `${method}("${target.value}") moves a .clip element; move a child rig instead`);
        }
      }
    },
  });
}

function compositionOf(file: string, root: Element | null): Composition {
  const number = (name: string, fallback: number | null) => {
    const value = root ? Number(attr(root, name)) : Number.NaN;
    return Number.isFinite(value) && value > 0 ? value : fallback;
  };
  return {
    file,
    root,
    id: root ? (attr(root, 'data-composition-id') ?? null) : null,
    width: number('data-width', 1920) ?? 1920,
    height: number('data-height', 1080) ?? 1080,
    durationSec: number('data-duration', null),
    fps: (root ? attr(root, 'data-fps') : undefined) ?? '30',
  };
}

interface FilmGrid {
  grid: TimeGrid;
  shots: Array<{ id: string; from: { sec: number; frame: number }; to: { sec: number; frame: number } }>;
}

function readFilmGrid(buildDir: string, fps: string): FilmGrid | null {
  const file = path.join(buildDir, 'assets', 'grid.json');
  if (!existsSync(file)) return null;
  try {
    const value = JSON.parse(readFileSync(file, 'utf8')) as Record<string, unknown>;
    return {
      grid: {
        fps: typeof value.fps === 'string' ? value.fps : fps,
        ...(typeof value.bpm === 'number' ? { bpm: value.bpm } : {}),
        ...(typeof value.beatsPerBar === 'number' ? { beatsPerBar: value.beatsPerBar } : {}),
        ...(typeof value.bars === 'number' ? { bars: value.bars } : {}),
        ...(typeof value.tailSec === 'number' ? { tailSec: value.tailSec } : {}),
        ...(typeof value.lengthSec === 'number' ? { lengthSec: value.lengthSec } : {}),
        ...(value.cues && typeof value.cues === 'object' ? { cues: value.cues as TimeGrid['cues'] & object } : {}),
      },
      shots: Array.isArray(value.shots) ? (value.shots as FilmGrid['shots']) : [],
    };
  } catch {
    return null;
  }
}

function visibleText(node: TextNode): boolean {
  if (node.value.trim() === '') return false;
  return !ancestors(node).some((element) => SKIP_TEXT.has(element.tagName.toLowerCase()) || hasAttr(element, 'hidden'));
}

function lintHtmlFile(linter: Linter, absolute: string, queue: string[], seen: Set<string>) {
  const file = linter.rel(absolute);
  const source = readFileSync(absolute, 'utf8');
  linter.remember(file, source);
  const baseDir = path.dirname(absolute);
  const document = parseHtml(source);
  const all = elements(document);
  const root = all.find((element) => hasAttr(element, 'data-composition-id')) ?? null;
  const composition = compositionOf(file, root);
  const htmlRoot = all.find((element) => element.tagName === 'html') ?? null;
  const registered = new Set<string>();
  const film = root ? attr(root, 'data-mf-kind') === 'film' : false;
  const filmGrid = film ? readFilmGrid(linter.buildDir, composition.fps) : null;

  // References in attributes.
  for (const element of all) {
    const tag = element.tagName.toLowerCase();
    const ref = (name: string, value: string | undefined, what = `${tag} ${name}`) => {
      if (value === undefined) return;
      const at = attrPosition(element, name);
      linter.checkUrl(value, file, baseDir, at.line, at.col, what);
    };
    if (FETCH_SRC.has(tag) || (tag === 'input' && attr(element, 'type')?.toLowerCase() === 'image')) ref('src', attr(element, 'src'));
    if (tag === 'link') ref('href', attr(element, 'href'));
    if (SVG_FETCH.has(tag)) {
      ref('href', attr(element, 'href'));
      ref('xlink:href', attr(element, 'xlink:href'));
    }
    const srcset = attr(element, 'srcset');
    if (srcset !== undefined) for (const url of srcsetUrls(srcset)) ref('srcset', url, `${tag} srcset`);
    if (tag === 'video') ref('poster', attr(element, 'poster'));
    if (tag === 'object') ref('data', attr(element, 'data'));
    const nested = attr(element, 'data-composition-src');
    if (nested !== undefined) {
      ref('data-composition-src', nested);
      const target = path.resolve(baseDir, nested.split(/[?#]/)[0] ?? '');
      if (existsSync(target) && !path.relative(linter.buildDir, target).startsWith('..') && !seen.has(target)) {
        seen.add(target);
        queue.push(target);
      }
    }
    // Inline style attributes.
    const style = attr(element, 'style');
    if (style !== undefined) {
      const at = attrPosition(element, 'style');
      try {
        lintCss(linter, postcss.parse(`a{${style}}`), {
          file,
          baseDir,
          baseLine: at.line,
          baseCol: at.col + 'style="'.length - 2,
          composition,
          documentRoot: htmlRoot,
          styledElement: element,
        });
      } catch {
        // A broken style attribute is the engine check's concern.
      }
    }
  }

  // <style>, linked CSS files, and scripts.
  for (const element of all) {
    const tag = element.tagName.toLowerCase();
    if (tag === 'style') {
      const text = element.childNodes.find((child) => child.nodeName === '#text') as TextNode | undefined;
      if (!text) continue;
      const at = nodePosition(text);
      try {
        lintCss(linter, postcss.parse(text.value), { file, baseDir, baseLine: at.line, baseCol: at.col, composition, documentRoot: htmlRoot });
      } catch {
        // A stylesheet postcss cannot read is reported by the engine check.
      }
    }
    if (tag === 'link' && /\bstylesheet\b/i.test(attr(element, 'rel') ?? '')) {
      const href = attr(element, 'href') ?? '';
      const target = path.resolve(baseDir, href.split(/[?#]/)[0] ?? '');
      if (!SCHEME.test(href) && !href.startsWith('/') && existsSync(target) && !path.relative(linter.buildDir, target).startsWith('..')) {
        const cssFile = linter.rel(target);
        const css = readFileSync(target, 'utf8');
        linter.remember(cssFile, css);
        try {
          lintCss(linter, postcss.parse(css), { file: cssFile, baseDir: path.dirname(target), baseLine: 1, baseCol: 1, composition, documentRoot: htmlRoot });
        } catch {
          // Reported by the engine check.
        }
      }
    }
    if (tag === 'script') {
      const src = attr(element, 'src');
      if (src !== undefined) {
        const at = attrPosition(element, 'src');
        const relative = path.relative(linter.buildDir, path.resolve(baseDir, src.split(/[?#]/)[0] ?? '')).split(path.sep).join('/');
        if (!ALLOWED_SCRIPT.test(relative)) {
          linter.add('DET007', file, at.line, at.col, `script ${src} is not vendor/gsap, vendor/three, vendor/mf-runtime.js or the composition's inline script`);
        }
        continue;
      }
      const type = (attr(element, 'type') ?? '').toLowerCase();
      if (type !== '' && type !== 'module' && !type.includes('javascript')) continue;
      const text = element.childNodes.find((child) => child.nodeName === '#text') as TextNode | undefined;
      if (!text) continue;
      const at = nodePosition(text);
      lintJs(linter, text.value, { file, baseLine: at.line, baseCol: at.col, documentRoot: htmlRoot, registered }, type === 'module');
    }
  }

  // DET006: the composition registers its paused timeline under its literal id.
  if (root && composition.id && !registered.has(composition.id)) {
    const at = attrPosition(root, 'data-composition-id');
    linter.add('DET006', file, at.line, at.col, `the composition does not register window.__timelines["${composition.id}"]`);
  }

  // Text and copy.
  for (const node of textNodes(document)) {
    if (!visibleText(node)) continue;
    const at = nodePosition(node);
    const owners = ancestors(node);
    const text = node.value;
    if (!owners.some((element) => hasClass(element, 'mf-line') || hasAttr(element, 'data-mf-static'))) {
      linter.add('TXT005', file, at.line, at.col, `visible text "${text.trim().slice(0, 40)}" is not in an mf-line and not marked data-mf-static`);
    }
    if (/[–—]/.test(text)) linter.add('CPY001', file, at.line, at.col, 'on-screen copy holds an em or en dash; use a hyphen, comma or colon');
    for (const [pattern, label] of PLACEHOLDERS) {
      if (pattern.test(text)) {
        linter.add('CPY002', file, at.line, at.col, `placeholder copy: ${label}`);
        break;
      }
    }
    if (/(?![©®™])\p{Extended_Pictographic}/u.test(text)) linter.add('CPY003', file, at.line, at.col, 'on-screen copy holds an emoji; keep it only when the brief or vars supplied it');
  }

  // Text lines.
  const lineGrid: TimeGrid | null = filmGrid?.grid ?? (composition.durationSec !== null ? { fps: composition.fps, lengthSec: composition.durationSec } : { fps: composition.fps });
  const fpsNumber = (() => {
    const [num = 30, den = 1] = composition.fps.split('/').map(Number);
    return num / den;
  })();
  for (const element of all.filter((candidate) => hasClass(candidate, 'mf-line'))) {
    const inValue = attr(element, 'data-mf-in');
    const outValue = attr(element, 'data-mf-out');
    const here = nodePosition(element);
    if (inValue === undefined) linter.add('TXT001', file, here.line, here.col, 'an mf-line has no data-mf-in entrance');
    if (outValue === undefined) linter.add('TXT002', file, here.line, here.col, 'an mf-line has no data-mf-out exit (use end to hold)');
    const resolveSide = (name: string, value: string, kinds: readonly string[]) => {
      const at = attrPosition(element, name);
      const [kind = '', ...specParts] = value.split('@');
      const spec = specParts.join('@');
      if (!kinds.includes(kind) || spec === '') {
        linter.add('TXT003', file, at.line, at.col, `${name}="${value}" needs <kind>@<spec> with kind one of ${kinds.join(', ')}`);
        return null;
      }
      try {
        return { kind, sec: resolveSpec(spec, lineGrid).sec };
      } catch (error) {
        linter.add('TXT003', file, at.line, at.col, `${name}="${value}": ${(error as Error).message}`);
        return null;
      }
    };
    const entrance = inValue !== undefined ? resolveSide('data-mf-in', inValue, ENTRANCE_KINDS) : null;
    const exit = outValue !== undefined && outValue !== 'end' ? resolveSide('data-mf-out', outValue, EXIT_KINDS) : null;
    if (entrance && exit) {
      const options = Number(attr(element, 'data-mf-options') ?? '') || undefined;
      const lands = entrance.sec + entranceSeconds(entrance.kind, textContent(element), fpsNumber, options ? { options } : {});
      if (exit.sec < lands - 1e-6) {
        const at = attrPosition(element, 'data-mf-out');
        linter.add('TXT004', file, at.line, at.col, `the exit at ${exit.sec.toFixed(2)} s starts before the ${entrance.kind} entrance lands at ${lands.toFixed(2)} s`);
      }
    }
  }

  // Scenes.
  const scenes = root ? elements(root).filter((element) => element.tagName === 'section' && hasClass(element, 'clip')) : [];
  for (const scene of scenes) {
    const media = elements(scene).some((element) => ['img', 'video', 'svg', 'canvas', 'picture', 'object'].includes(element.tagName.toLowerCase()));
    const hasText = textNodes(scene).some((node) => node.value.trim() !== '');
    if (!media && hasText && !hasAttr(scene, 'data-mf-type-scene')) {
      const at = nodePosition(scene);
      linter.add('STR005', file, at.line, at.col, 'a type-only scene needs data-mf-type-scene="<reason>"');
    }
  }
  if (film && root) {
    if (!filmGrid) {
      const at = nodePosition(root);
      linter.add('STR003', file, at.line, at.col, 'the film has no readable assets/grid.json to check scenes against');
    } else {
      const fps = (() => {
        const [num = 30, den = 1] = filmGrid.grid.fps.split('/').map(Number);
        return num / den;
      })();
      for (const scene of scenes) {
        const id = attr(scene, 'id') ?? '';
        const shot = filmGrid.shots.find((candidate) => candidate.id === id);
        const at = nodePosition(scene);
        if (!shot) {
          linter.add('STR003', file, at.line, at.col, `scene ${id ? `#${id}` : '(no id)'} matches no beat-grid shot`);
          continue;
        }
        const startFrame = Math.round(Number(attr(scene, 'data-start') ?? Number.NaN) * fps);
        const durationFrames = Math.round(Number(attr(scene, 'data-duration') ?? Number.NaN) * fps);
        const tolerance = LINT_NUMBERS.sceneToleranceFrames;
        if (!(Math.abs(startFrame - shot.from.frame) <= tolerance) || !(Math.abs(durationFrames - (shot.to.frame - shot.from.frame)) <= tolerance)) {
          linter.add('STR003', file, at.line, at.col, `scene #${id} starts or lasts more than ${tolerance} frame away from its grid shot`);
        }
      }
      const pieces = all.filter((element) => ['logo', 'shot', 'video'].includes(attr(element, 'data-mf-brand') ?? ''));
      const logo = pieces.some((element) => attr(element, 'data-mf-brand') === 'logo');
      const distinct = new Set(pieces.map((element) => `${attr(element, 'data-mf-brand')}:${attr(element, 'data-mf-brand') === 'video' ? '' : (attr(element, 'src') ?? attr(element, 'href') ?? '')}`));
      if (!logo || distinct.size < LINT_NUMBERS.filmMinRealPieces) {
        const at = nodePosition(root);
        linter.add('STR004', file, at.line, at.col, `the film uses ${distinct.size} real brand piece(s)${logo ? '' : ' and no logo'}; it needs the logo and at least ${LINT_NUMBERS.filmMinRealPieces} pieces`);
      }
    }
  }
}

/** Lint a build folder; writes lint.json into `options.round` when given. */
export function lint(buildDir: string, options: LintOptions = {}): LintResult {
  const root = path.resolve(buildDir);
  const index = path.join(root, 'index.html');
  if (!existsSync(index)) throw new MfmError('USAGE', { buildDir: root }, { message: `${root} has no index.html.` });
  const linter = new Linter(root);
  const queue = [index];
  const seen = new Set(queue);
  while (queue.length > 0) lintHtmlFile(linter, queue.shift() ?? index, queue, seen);
  const order = (a: Finding, b: Finding) => a.file.localeCompare(b.file) || a.line - b.line || a.col - b.col || a.code.localeCompare(b.code);
  const result: LintResult = {
    errors: linter.findings.filter((finding) => RULES[finding.code] === 'error').sort(order),
    warnings: linter.findings.filter((finding) => RULES[finding.code] === 'warning').sort(order),
  };
  if (options.round) {
    mkdirSync(options.round, { recursive: true });
    writeFileSync(
      path.join(options.round, 'lint.json'),
      `${JSON.stringify({ schemaVersion: 1, kind: 'lint', ...result }, null, 2)}\n`,
    );
  }
  return result;
}
