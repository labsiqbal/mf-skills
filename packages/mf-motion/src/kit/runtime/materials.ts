/// <reference lib="dom" />
// Runtime parts of the kit materials (component-kit.md, Materials and grounds):
// the procedural canvases. Each function is self-contained (no imports, no
// module-level helpers) because the builder inlines its source into the
// composition script; randomness comes only from the mf.rand and mf.noise2
// generators passed in, so a seed always draws the same pixels.

type Noise = (x: number, y: number) => number;
type Rand = () => number;

/** Paper: the ground with soft fibre noise from seeded value noise and a few seeded fibres, drawn once. */
export function drawPaper(canvas: HTMLCanvasElement, noise: Noise, rand: Rand, ground: string, ink: string): void {
  const context = canvas.getContext('2d');
  if (!context) return;
  const { width, height } = canvas;
  context.fillStyle = ground;
  context.fillRect(0, 0, width, height);
  const image = context.getImageData(0, 0, width, height);
  const data = image.data;
  const scale = width / 960;
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const broad = noise(x / (48 * scale), y / (48 * scale));
      const fine = noise(1000 + x / (5 * scale), 1000 + y / (9 * scale));
      const shift = (broad - 0.5) * 5 + (fine - 0.5) * 7;
      const i = (y * width + x) * 4;
      data[i] = Math.max(0, Math.min(255, (data[i] ?? 0) + shift));
      data[i + 1] = Math.max(0, Math.min(255, (data[i + 1] ?? 0) + shift));
      data[i + 2] = Math.max(0, Math.min(255, (data[i + 2] ?? 0) + shift));
    }
  }
  context.putImageData(image, 0, 0);
  context.strokeStyle = ink;
  context.lineCap = 'round';
  const fibres = Math.round(220 * scale * scale);
  for (let k = 0; k < fibres; k += 1) {
    const x = rand() * width;
    const y = rand() * height;
    const angle = rand() * Math.PI * 2;
    const length = (6 + rand() * 18) * scale;
    context.globalAlpha = 0.03 + rand() * 0.04;
    context.lineWidth = Math.max(0.5, 0.6 * scale);
    context.beginPath();
    context.moveTo(x, y);
    context.quadraticCurveTo(x + Math.cos(angle + 0.4) * length * 0.5, y + Math.sin(angle + 0.4) * length * 0.5, x + Math.cos(angle) * length, y + Math.sin(angle) * length);
    context.stroke();
  }
  context.globalAlpha = 1;
}

/** Grain: a static seeded noise tile set as the element's repeating background. */
export function paintGrain(element: HTMLElement, rand: Rand, tile: number): void {
  const canvas = document.createElement('canvas');
  canvas.width = tile;
  canvas.height = tile;
  const context = canvas.getContext('2d');
  if (!context) return;
  const image = context.createImageData(tile, tile);
  for (let i = 0; i < image.data.length; i += 4) {
    const v = Math.round(rand() * 255);
    image.data[i] = v;
    image.data[i + 1] = v;
    image.data[i + 2] = v;
    image.data[i + 3] = 255;
  }
  context.putImageData(image, 0, 0);
  element.style.backgroundImage = `url(${canvas.toDataURL('image/png')})`;
}

/**
 * Ribbon field: three seeded ribbons (ground tone, accent, accent-soft) whose
 * swing grows with `intensity` (0-1) and drifts with the timeline time `t`.
 */
export function drawRibbons(canvas: HTMLCanvasElement, rand: Rand, t: number, intensity: number, colors: string[]): void {
  const context = canvas.getContext('2d');
  if (!context) return;
  const { width, height } = canvas;
  context.clearRect(0, 0, width, height);
  const phases: number[] = [];
  for (let k = 0; k < colors.length * 3; k += 1) phases.push(rand() * Math.PI * 2);
  const steps = 48;
  colors.forEach((color, r) => {
    const base = height * (0.38 + r * 0.14);
    const thick = height * (0.06 + 0.05 * intensity);
    const swing = height * (0.03 + 0.16 * intensity);
    const p1 = phases[r * 3] ?? 0;
    const p2 = phases[r * 3 + 1] ?? 0;
    const p3 = phases[r * 3 + 2] ?? 0;
    const at = (x: number) => base + swing * (Math.sin((x / width) * Math.PI * 2 + p1 + t * 0.6) * 0.7 + Math.sin((x / width) * Math.PI * 5 + p2 - t * 0.9) * 0.3);
    context.beginPath();
    for (let i = 0; i <= steps; i += 1) {
      const x = (i / steps) * width;
      const y = at(x) - thick * (0.6 + 0.4 * Math.sin((x / width) * Math.PI * 3 + p3));
      if (i === 0) context.moveTo(x, y);
      else context.lineTo(x, y);
    }
    for (let i = steps; i >= 0; i -= 1) context.lineTo((i / steps) * width, at((i / steps) * width) + thick);
    context.closePath();
    context.globalAlpha = 0.35 + 0.5 * intensity;
    context.fillStyle = color;
    context.fill();
  });
  context.globalAlpha = 1;
}

/** Riso texture: seeded ink specks whose displacement changes only at each 1/12 s step. */
export function drawRiso(canvas: HTMLCanvasElement, rand: Rand, step: number, color: string): void {
  const context = canvas.getContext('2d');
  if (!context) return;
  const { width, height } = canvas;
  context.clearRect(0, 0, width, height);
  // The same specks every step; only their offset moves, by the step's own draws.
  const specks: Array<[number, number, number]> = [];
  const count = Math.round((width * height) / 160);
  for (let k = 0; k < count; k += 1) specks.push([rand() * width, rand() * height, 0.3 + rand() * 0.7]);
  let dx = 0;
  let dy = 0;
  for (let s = 0; s <= step; s += 1) {
    dx = (rand() - 0.5) * 3;
    dy = (rand() - 0.5) * 3;
  }
  context.fillStyle = color;
  context.globalAlpha = 0.4;
  for (const [x, y, r] of specks) {
    context.beginPath();
    context.arc(x + dx, y + dy, r, 0, Math.PI * 2);
    context.fill();
  }
  context.globalAlpha = 1;
}
