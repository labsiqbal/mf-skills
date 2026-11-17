/// <reference lib="dom" />
// mf.fitText: measure a line with Range.getBoundingClientRect after fonts load
// and step its font size down by 2% until it fits or reaches the minimum
// readable size (type.minReadablePx); then fail naming the variable.
import { NUMBERS } from '../numbers';

export const FIT_STEP = 0.98;

export interface FitResult {
  sizePx: number;
  widthPx: number;
  steps: number;
}

export class FitError extends Error {
  readonly variable: string;
  constructor(variable: string, message: string) {
    super(message);
    this.name = 'FitError';
    this.variable = variable;
  }
}

function frameShortSide(element: HTMLElement): number {
  const root = element.closest('[data-composition-id]') as HTMLElement | null;
  const width = Number(root?.dataset.width ?? element.ownerDocument.documentElement.clientWidth);
  const height = Number(root?.dataset.height ?? element.ownerDocument.documentElement.clientHeight);
  return Math.min(width, height);
}

/** Width of the element's text set on one line (wrapping turned off while measuring). */
export function textWidth(element: HTMLElement): number {
  const previous = element.style.whiteSpace;
  element.style.whiteSpace = 'nowrap';
  const range = element.ownerDocument.createRange();
  range.selectNodeContents(element);
  const width = range.getBoundingClientRect().width;
  element.style.whiteSpace = previous;
  return width;
}

/** Shrink the element's font size until its text is at most maxWidthPx wide. */
export function fitText(element: HTMLElement, maxWidthPx: number, options: { minPx?: number } = {}): FitResult {
  const minPx = options.minPx ?? NUMBERS['type.minReadablePx'].shortSideShare * frameShortSide(element);
  let size = Number.parseFloat(getComputedStyle(element).fontSize);
  let steps = 0;
  let width = textWidth(element);
  while (width > maxWidthPx && size * FIT_STEP >= minPx) {
    size *= FIT_STEP;
    element.style.fontSize = `${size}px`;
    steps += 1;
    width = textWidth(element);
  }
  if (width > maxWidthPx) {
    const variable = element.dataset.mfVar ?? element.id ?? 'text';
    const error = new FitError(
      variable,
      `variable "${variable}" is too long: ${(element.textContent ?? '').length} characters need ${Math.ceil(width)} px at the minimum readable size ${Math.round(minPx * 10) / 10} px, the box is ${Math.round(maxWidthPx)} px; shorten it or raise maxChars only with a wider layout`,
    );
    const errors = ((window as unknown as { __mfErrors?: Array<{ code: string; variable: string; message: string }> }).__mfErrors ??= []);
    errors.push({ code: 'VARIABLE_TOO_LONG', variable, message: error.message });
    throw error;
  }
  return { sizePx: Math.round(size * 100) / 100, widthPx: Math.round(width * 100) / 100, steps };
}
