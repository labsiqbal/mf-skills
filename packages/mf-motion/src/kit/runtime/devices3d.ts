/// <reference lib="dom" />
// Runtime parts of the kit device frames (component-kit.md, Device frames):
// the image stack stepped at 12 fps for any screen, and the true-3D laptop and
// phone built in three.js from extruded rounded rectangles with the screen as a
// CanvasTexture. Self-contained functions: the builder inlines their source.

interface Timeline {
  to(target: object, vars: Record<string, unknown>, position?: number): unknown;
  set(target: object, vars: Record<string, unknown>, position?: number): unknown;
}

/** Show one image of a stack at a time, stepping at `fps` from `from` to `to` (seconds). */
export function stepStack(tl: Timeline, images: HTMLElement[], from: number, to: number, fps: number): void {
  if (images.length === 0) return;
  images.forEach((image, i) => tl.set(image, { autoAlpha: i === 0 ? 1 : 0 }, 0));
  let shown = 0;
  for (let k = 1; from + k / fps < to; k += 1) {
    const next = k % images.length;
    if (next === shown) continue;
    const at = from + k / fps;
    tl.set(images[shown] as HTMLElement, { autoAlpha: 0 }, at);
    tl.set(images[next] as HTMLElement, { autoAlpha: 1 }, at);
    shown = next;
  }
}

export interface Device3dOptions {
  kind: 'laptop' | 'phone';
  /** Body, screen bezel and ground colours as CSS colour strings. */
  body: string;
  bezel: string;
  /** Screen sources (decoded <img> elements); with several, they step at stackFps. */
  screens: HTMLImageElement[];
  stackFps: number;
  /** Turn on y (radians) at t = 0 and at the end. */
  turnFrom: number;
  turnTo: number;
  durationSec: number;
}

/**
 * Build the scene on `canvas` with the THREE namespace and return a renderer of
 * time t: the device turns from turnFrom to turnTo and the screen shows the
 * stack frame of t. Rendering is a pure function of t.
 */
export function device3d(THREE: any, canvas: HTMLCanvasElement, options: Device3dOptions): (t: number) => void {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true, preserveDrawingBuffer: true });
  renderer.setPixelRatio(1);
  renderer.setSize(canvas.width, canvas.height, false);
  renderer.setClearColor(0x000000, 0);
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(28, canvas.width / canvas.height, 0.1, 100);
  camera.position.set(0, options.kind === 'laptop' ? 1.6 : 0.4, options.kind === 'laptop' ? 8.5 : 9.5);
  camera.lookAt(0, options.kind === 'laptop' ? 0.35 : 0, 0);
  scene.add(new THREE.AmbientLight(0xffffff, 0.75));
  const key = new THREE.DirectionalLight(0xffffff, 1.1);
  key.position.set(3, 5, 6);
  scene.add(key);

  const rounded = (w: number, h: number, r: number) => {
    const shape = new THREE.Shape();
    shape.moveTo(-w / 2 + r, -h / 2);
    shape.lineTo(w / 2 - r, -h / 2);
    shape.quadraticCurveTo(w / 2, -h / 2, w / 2, -h / 2 + r);
    shape.lineTo(w / 2, h / 2 - r);
    shape.quadraticCurveTo(w / 2, h / 2, w / 2 - r, h / 2);
    shape.lineTo(-w / 2 + r, h / 2);
    shape.quadraticCurveTo(-w / 2, h / 2, -w / 2, h / 2 - r);
    shape.lineTo(-w / 2, -h / 2 + r);
    shape.quadraticCurveTo(-w / 2, -h / 2, -w / 2 + r, -h / 2);
    return shape;
  };
  const slab = (w: number, h: number, depth: number, r: number, color: string) => {
    const geometry = new THREE.ExtrudeGeometry(rounded(w, h, r), { depth, bevelEnabled: true, bevelSize: Math.min(r, depth) * 0.4, bevelThickness: depth * 0.4, bevelSegments: 4, curveSegments: 10 });
    geometry.translate(0, 0, -depth / 2);
    return new THREE.Mesh(geometry, new THREE.MeshStandardMaterial({ color: new THREE.Color(color), roughness: 0.55, metalness: 0.15 }));
  };

  const screenCanvas = document.createElement('canvas');
  const aspect = options.kind === 'laptop' ? 16 / 10 : 9 / 19.5;
  screenCanvas.width = options.kind === 'laptop' ? 960 : 360;
  screenCanvas.height = Math.round(screenCanvas.width / aspect);
  const screenContext = screenCanvas.getContext('2d') as CanvasRenderingContext2D;
  const texture = new THREE.CanvasTexture(screenCanvas);
  texture.colorSpace = THREE.SRGBColorSpace;

  const device = new THREE.Group();
  let screenW: number;
  let screenH: number;
  if (options.kind === 'laptop') {
    const lid = new THREE.Group();
    const lidBody = slab(4.2, 2.75, 0.08, 0.14, options.body);
    lid.add(lidBody);
    const bezel = slab(4.02, 2.57, 0.01, 0.1, options.bezel);
    bezel.position.z = 0.085;
    lid.add(bezel);
    screenW = 3.84;
    screenH = screenW / aspect;
    const screen = new THREE.Mesh(new THREE.PlaneGeometry(screenW, screenH), new THREE.MeshBasicMaterial({ map: texture, toneMapped: false }));
    screen.position.set(0, 0.03, 0.105);
    lid.add(screen);
    lid.position.set(0, 1.375, -1.4);
    lid.rotation.x = -0.18;
    device.add(lid);
    const base = slab(4.3, 2.9, 0.12, 0.16, options.body);
    base.rotation.x = -Math.PI / 2;
    base.position.set(0, 0, 0);
    device.add(base);
    const deck = slab(3.4, 1.4, 0.005, 0.06, options.bezel);
    deck.rotation.x = -Math.PI / 2;
    deck.position.set(0, 0.07, -0.55);
    device.add(deck);
  } else {
    const body = slab(1.72, 3.6, 0.16, 0.26, options.body);
    device.add(body);
    const bezel = slab(1.62, 3.5, 0.01, 0.22, options.bezel);
    bezel.position.z = 0.155;
    device.add(bezel);
    screenW = 1.5;
    screenH = screenW / aspect;
    const screen = new THREE.Mesh(new THREE.PlaneGeometry(screenW, Math.min(screenH, 3.3)), new THREE.MeshBasicMaterial({ map: texture, toneMapped: false }));
    screen.position.z = 0.175;
    device.add(screen);
  }
  scene.add(device);

  let drawn = -1;
  return (t: number) => {
    const frames = options.screens.length;
    const index = frames <= 1 ? 0 : Math.floor(t * options.stackFps + 1e-6) % frames;
    if (index !== drawn && frames > 0) {
      const image = options.screens[index] as HTMLImageElement;
      // Cover the screen with the image, cropped from its top.
      const scale = Math.max(screenCanvas.width / image.naturalWidth, screenCanvas.height / image.naturalHeight);
      const w = image.naturalWidth * scale;
      screenContext.clearRect(0, 0, screenCanvas.width, screenCanvas.height);
      screenContext.drawImage(image, (screenCanvas.width - w) / 2, 0, w, image.naturalHeight * scale);
      texture.needsUpdate = true;
      drawn = index;
    }
    const p = Math.max(0, Math.min(1, t / Math.max(1e-6, options.durationSec)));
    const eased = p * p * (3 - 2 * p);
    device.rotation.y = options.turnFrom + (options.turnTo - options.turnFrom) * eased;
    renderer.render(scene, camera);
  };
}
