// parse5 tree helpers for lint: walking, attributes with source positions,
// text content, and a small CSS selector matcher (type, #id, .class,
// [attr], [attr=value], descendant and child combinators, selector lists).
import { parse } from 'parse5';

export interface Location {
  startLine: number;
  startCol: number;
  startOffset: number;
  endOffset: number;
}

export interface Attr {
  name: string;
  value: string;
}

export interface Element {
  nodeName: string;
  tagName: string;
  attrs: Attr[];
  childNodes: Node[];
  parentNode: Element | Document | null;
  namespaceURI: string;
  sourceCodeLocation?: Location & { attrs?: Record<string, Location>; startTag?: Location; endTag?: Location };
  content?: Document;
}

export interface TextNode {
  nodeName: '#text';
  value: string;
  parentNode: Element | null;
  sourceCodeLocation?: Location;
}

export interface Document {
  nodeName: '#document' | '#document-fragment';
  childNodes: Node[];
}

export type Node = Element | TextNode | Document | { nodeName: '#comment' | '#documentType'; parentNode?: Element | null };

export function parseHtml(source: string): Document {
  return parse(source, { sourceCodeLocationInfo: true }) as unknown as Document;
}

export function isElement(node: Node): node is Element {
  return typeof (node as Element).tagName === 'string';
}

export function isText(node: Node): node is TextNode {
  return node.nodeName === '#text';
}

/** Every element in document order (template contents included). */
export function elements(root: Node): Element[] {
  const out: Element[] = [];
  const visit = (node: Node) => {
    if (isElement(node)) {
      out.push(node);
      if (node.content) node.content.childNodes.forEach(visit);
    }
    const children = (node as { childNodes?: Node[] }).childNodes;
    if (children) children.forEach(visit);
  };
  visit(root);
  return out;
}

/** Every text node in document order. */
export function textNodes(root: Node): TextNode[] {
  const out: TextNode[] = [];
  const visit = (node: Node) => {
    if (isText(node)) out.push(node);
    if (isElement(node) && node.content) node.content.childNodes.forEach(visit);
    const children = (node as { childNodes?: Node[] }).childNodes;
    if (children) children.forEach(visit);
  };
  visit(root);
  return out;
}

export function attr(element: Element, name: string): string | undefined {
  return element.attrs.find((a) => a.name === name)?.value;
}

export function hasAttr(element: Element, name: string): boolean {
  return element.attrs.some((a) => a.name === name);
}

export function classes(element: Element): string[] {
  return (attr(element, 'class') ?? '').split(/\s+/).filter(Boolean);
}

export function hasClass(element: Element, name: string): boolean {
  return classes(element).includes(name);
}

export function ancestors(node: Node): Element[] {
  const out: Element[] = [];
  let current = (node as { parentNode?: Element | Document | null }).parentNode ?? null;
  while (current && isElement(current as Node)) {
    out.push(current as Element);
    current = (current as Element).parentNode;
  }
  return out;
}

/** Text of an element and its descendants. */
export function textContent(node: Node): string {
  return textNodes(node).map((text) => text.value).join('');
}

/** Line and column (1-based) of an attribute's value, or of the element. */
export function attrPosition(element: Element, name: string): { line: number; col: number; offset: number } {
  const location = element.sourceCodeLocation?.attrs?.[name] ?? element.sourceCodeLocation;
  return { line: location?.startLine ?? 1, col: location?.startCol ?? 1, offset: location?.startOffset ?? 0 };
}

export function nodePosition(node: Element | TextNode): { line: number; col: number; offset: number } {
  const location = node.sourceCodeLocation;
  return { line: location?.startLine ?? 1, col: location?.startCol ?? 1, offset: location?.startOffset ?? 0 };
}

// Selectors.

interface Compound {
  tag: string | null;
  id: string | null;
  classes: string[];
  attrs: Array<{ name: string; value: string | null }>;
}

interface Complex {
  /** Right to left: the subject first, then each ancestor step with its combinator. */
  steps: Array<{ compound: Compound; combinator: ' ' | '>' | null }>;
}

function parseCompound(text: string): Compound | null {
  const compound: Compound = { tag: null, id: null, classes: [], attrs: [] };
  let rest = text;
  const tag = rest.match(/^(\*|[a-zA-Z][\w-]*)/);
  if (tag) {
    compound.tag = tag[1] === '*' ? null : (tag[1] ?? '').toLowerCase();
    rest = rest.slice(tag[0].length);
  }
  while (rest.length > 0) {
    let match = rest.match(/^#([\w-]+)/);
    if (match) {
      compound.id = match[1] ?? null;
      rest = rest.slice(match[0].length);
      continue;
    }
    match = rest.match(/^\.([\w-]+)/);
    if (match) {
      compound.classes.push(match[1] ?? '');
      rest = rest.slice(match[0].length);
      continue;
    }
    match = rest.match(/^\[\s*([\w:-]+)\s*(?:=\s*(?:"([^"]*)"|'([^']*)'|([^\]\s]+))\s*)?\]/);
    if (match) {
      compound.attrs.push({ name: (match[1] ?? '').toLowerCase(), value: match[2] ?? match[3] ?? match[4] ?? null });
      rest = rest.slice(match[0].length);
      continue;
    }
    // Pseudo-classes and elements are ignored: the match is a superset.
    match = rest.match(/^::?[\w-]+(\([^)]*\))?/);
    if (match) {
      rest = rest.slice(match[0].length);
      continue;
    }
    return null;
  }
  return compound;
}

/** Parse a selector list; unsupported pieces make that selector match nothing. */
export function parseSelector(selector: string): Complex[] {
  const out: Complex[] = [];
  for (const part of selector.split(',')) {
    const tokens = part.trim().replace(/\s*([>+~])\s*/g, ' $1 ').split(/\s+/).filter(Boolean);
    const steps: Complex['steps'] = [];
    let combinator: ' ' | '>' | null = null;
    let ok = tokens.length > 0;
    for (let i = tokens.length - 1; i >= 0 && ok; i -= 1) {
      const token = tokens[i] ?? '';
      if (token === '>' || token === '+' || token === '~') {
        if (token !== '>') ok = false;
        combinator = '>';
        continue;
      }
      const compound = parseCompound(token);
      if (!compound) {
        ok = false;
        break;
      }
      steps.push({ compound, combinator: steps.length === 0 ? null : (combinator ?? ' ') });
      combinator = null;
    }
    if (ok && steps.length > 0) out.push({ steps });
  }
  return out;
}

function matchesCompound(element: Element, compound: Compound): boolean {
  if (compound.tag && element.tagName.toLowerCase() !== compound.tag) return false;
  if (compound.id && attr(element, 'id') !== compound.id) return false;
  const own = classes(element);
  if (!compound.classes.every((name) => own.includes(name))) return false;
  return compound.attrs.every((a) => (a.value === null ? hasAttr(element, a.name) : attr(element, a.name) === a.value));
}

function matchesComplex(element: Element, complex: Complex): boolean {
  const [subject, ...rest] = complex.steps;
  if (!subject || !matchesCompound(element, subject.compound)) return false;
  let current: Element | null = element;
  for (const step of rest) {
    const parents: Element[] = current ? ancestors(current) : [];
    if (step.combinator === '>') {
      const parent: Element | undefined = parents[0];
      if (!parent || !matchesCompound(parent, step.compound)) return false;
      current = parent;
    } else {
      const found: Element | undefined = parents.find((candidate) => matchesCompound(candidate, step.compound));
      if (!found) return false;
      current = found;
    }
  }
  return true;
}

export function matches(element: Element, selector: string): boolean {
  return parseSelector(selector).some((complex) => matchesComplex(element, complex));
}

export function querySelectorAll(root: Node, selector: string): Element[] {
  const parsed = parseSelector(selector);
  if (parsed.length === 0) return [];
  return elements(root).filter((element) => parsed.some((complex) => matchesComplex(element, complex)));
}
