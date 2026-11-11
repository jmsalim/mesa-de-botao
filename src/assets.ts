/**
 * Art and sound files in public/assets, plus the code that turns textures into game sprites.
 * Everything degrades gracefully: until a texture has loaded (or if it fails), the renderer keeps
 * using its code-drawn look, so the game never waits on the network.
 */
import { BUTTON_R, KEEPER_SIZE } from './config';

export type Skin = 'perolado' | 'tartaruga' | 'acrilico' | 'marmore';
export const SKINS: Skin[] = ['perolado', 'tartaruga', 'acrilico', 'marmore'];
export const DEFAULT_SKINS: [Skin, Skin] = ['perolado', 'tartaruga'];

export const SOUND_NAMES = [
  'flick', 'disc-hit', 'ball-tap', 'wall-bounce', 'net',
  'whistle-start', 'whistle-foul', 'whistle-end', 'crowd-goal', 'crowd-loop',
] as const;
export type SoundName = (typeof SOUND_NAMES)[number];

/** Every file the game loads, relative to public/assets (checked by a test). */
export const ASSET_FILES: string[] = [
  'textures/feltro.webp', 'textures/papel.webp',
  ...SKINS.map((s) => `textures/${s}.webp`),
  'images/mesa.webp',
  ...SOUND_NAMES.map((n) => `sounds/${n}.mp3`),
];

const base = (): string => (typeof import.meta !== 'undefined' && import.meta.env?.BASE_URL) || '/';
export const assetUrl = (rel: string): string => `${base()}assets/${rel}`;

/** Piece colours for confetti and effects, matched to each material. */
export const SKIN_COLORS: Record<Skin, string[]> = {
  perolado: ['#ffffff', '#e4e8f4', '#c9d3ff', '#ffd75e'],
  tartaruga: ['#d9740f', '#8a4208', '#f0b46a', '#ffd75e'],
  acrilico: ['#0b8a3b', '#52d982', '#ffffff', '#ffd75e'],
  marmore: ['#ffffff', '#bcc1cc', '#8f95a3', '#ffd75e'],
};

interface Loaded { felt: HTMLImageElement | null; skins: Partial<Record<Skin, HTMLImageElement>> }
export const loaded: Loaded = { felt: null, skins: {} };

function loadImage(rel: string): Promise<HTMLImageElement | null> {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => resolve(null);
    img.src = assetUrl(rel);
  });
}

/** Loads the small textures the field and pieces need (about 20 KB in total). */
export async function loadTextures(): Promise<void> {
  const [felt, ...skins] = await Promise.all([loadImage('textures/feltro.webp'), ...SKINS.map((s) => loadImage(`textures/${s}.webp`))]);
  loaded.felt = felt;
  SKINS.forEach((s, i) => { if (skins[i]) loaded.skins[s] = skins[i]!; });
  sprites.clear();
  patterns = new WeakMap();
}

// ---------- felt ----------
/** World units covered by one felt tile. */
export const FELT_TILE = 2.6;
let patterns = new WeakMap<CanvasRenderingContext2D, CanvasPattern>();

export function feltPattern(ctx: CanvasRenderingContext2D): CanvasPattern | null {
  if (!loaded.felt) return null;
  let p = patterns.get(ctx);
  if (!p) {
    p = ctx.createPattern(loaded.felt, 'repeat') ?? undefined;
    if (!p) return null;
    p.setTransform(new DOMMatrix().scale(FELT_TILE / loaded.felt.width));
    patterns.set(ctx, p);
  }
  return p;
}

// ---------- sprites ----------
const sprites = new Map<string, HTMLCanvasElement>();

function makeCanvas(w: number, h: number): [HTMLCanvasElement, CanvasRenderingContext2D] {
  const c = document.createElement('canvas');
  c.width = Math.max(2, Math.round(w)); c.height = Math.max(2, Math.round(h));
  return [c, c.getContext('2d')!];
}

function coverImage(g: CanvasRenderingContext2D, img: HTMLImageElement, w: number, h: number, zoom = 1): void {
  const s = Math.max(w / img.width, h / img.height) * zoom;
  g.drawImage(img, (w - img.width * s) / 2, (h - img.height * s) / 2, img.width * s, img.height * s);
}

/**
 * A button disc, lit from the top-left: material, bevelled rim, a recessed centre and a gloss arc.
 * `px` is the diameter in device pixels.
 */
export function buttonSprite(skin: Skin, px: number, variant = 0): HTMLCanvasElement | null {
  const img = loaded.skins[skin];
  if (!img) return null;
  const size = Math.max(8, Math.round(px));
  const v = ((variant % 4) + 4) % 4;
  const key = `b:${skin}:${size}:${v}`;
  const hit = sprites.get(key);
  if (hit) return hit;
  if (sprites.size > 48) sprites.clear(); // sizes change on resize: don't let the cache grow
  const [c, g] = makeCanvas(size, size);
  const R = size / 2;
  g.save();
  g.beginPath(); g.arc(R, R, R * 0.97, 0, Math.PI * 2); g.clip();
  // each of a team's discs shows a different turn of the material, like real pieces
  g.translate(R, R); g.rotate((v * Math.PI) / 2); g.translate(-R, -R);
  coverImage(g, img, size, size, 1.25);
  g.setTransform(1, 0, 0, 1, 0, 0);
  // soften light materials a touch, lift dark ones, so the shading reads on all of them
  const tone = g.createRadialGradient(R * 0.7, R * 0.6, R * 0.05, R, R, R);
  tone.addColorStop(0, 'rgba(255,255,255,0.28)');
  tone.addColorStop(0.55, 'rgba(255,255,255,0)');
  tone.addColorStop(1, 'rgba(0,0,0,0.5)');
  g.fillStyle = tone; g.fillRect(0, 0, size, size);
  if (skin === 'acrilico') { // green on green felt: brighten so the piece reads clearly
    g.globalCompositeOperation = 'lighter';
    g.fillStyle = 'rgba(70,150,95,0.55)'; g.fillRect(0, 0, size, size);
    g.globalCompositeOperation = 'source-over';
  }
  g.restore();
  // outer edge: dark line separates every material from the felt, then a light bevel just inside it
  g.lineWidth = Math.max(1.2, R * 0.07);
  g.strokeStyle = 'rgba(0,0,0,0.55)';
  g.beginPath(); g.arc(R, R, R * 0.965, 0, Math.PI * 2); g.stroke();
  g.lineWidth = Math.max(1, R * 0.05);
  g.strokeStyle = 'rgba(255,255,255,0.45)';
  g.beginPath(); g.arc(R, R, R * 0.86, Math.PI * 1.05, Math.PI * 1.65); g.stroke();
  // recessed centre ("dish"): dark rim upper-left, light lip lower-right
  g.lineWidth = Math.max(1, R * 0.07);
  g.strokeStyle = 'rgba(0,0,0,0.4)';
  g.beginPath(); g.arc(R, R, R * 0.52, Math.PI * 0.85, Math.PI * 1.85); g.stroke();
  g.strokeStyle = 'rgba(255,255,255,0.5)';
  g.beginPath(); g.arc(R, R, R * 0.52, Math.PI * 1.85, Math.PI * 0.85 + Math.PI * 2); g.stroke();
  const dish = g.createRadialGradient(R * 0.9, R * 0.85, 0, R, R, R * 0.5);
  dish.addColorStop(0, 'rgba(0,0,0,0)'); dish.addColorStop(1, 'rgba(0,0,0,0.18)');
  g.fillStyle = dish; g.beginPath(); g.arc(R, R, R * 0.5, 0, Math.PI * 2); g.fill();
  // gloss
  g.lineCap = 'round'; g.lineWidth = Math.max(1.5, R * 0.09);
  g.strokeStyle = 'rgba(255,255,255,0.55)';
  g.beginPath(); g.arc(R, R, R * 0.74, Math.PI * 1.12, Math.PI * 1.42); g.stroke();
  sprites.set(key, c);
  return c;
}

/** A goalkeeper block (rectangular piece) in the same material. Sizes in device pixels, w along the field's x. */
export function keeperSprite(skin: Skin, w: number, h: number): HTMLCanvasElement | null {
  const img = loaded.skins[skin];
  if (!img) return null;
  const W = Math.max(6, Math.round(w)), H = Math.max(6, Math.round(h));
  const key = `k:${skin}:${W}x${H}`;
  const hit = sprites.get(key);
  if (hit) return hit;
  const [c, g] = makeCanvas(W, H);
  const r = Math.min(W, H) * 0.22;
  const path = (inset: number) => {
    g.beginPath();
    g.roundRect(inset, inset, W - inset * 2, H - inset * 2, Math.max(1, r - inset));
  };
  g.save();
  path(0.5); g.clip();
  coverImage(g, img, W, H, 1.2);
  const lit = g.createLinearGradient(0, 0, W, 0);
  lit.addColorStop(0, 'rgba(255,255,255,0.3)'); lit.addColorStop(0.5, 'rgba(255,255,255,0)'); lit.addColorStop(1, 'rgba(0,0,0,0.45)');
  g.fillStyle = lit; g.fillRect(0, 0, W, H);
  g.restore();
  g.lineWidth = Math.max(1.2, Math.min(W, H) * 0.08); g.strokeStyle = 'rgba(0,0,0,0.55)';
  path(g.lineWidth / 2); g.stroke();
  g.lineWidth = Math.max(1, Math.min(W, H) * 0.06); g.strokeStyle = 'rgba(255,255,255,0.4)';
  g.beginPath(); g.moveTo(W * 0.2, H * 0.12); g.lineTo(W * 0.2, H * 0.88); g.stroke();
  sprites.set(key, c);
  return c;
}

/** Sizes the renderer should ask for: device pixels per world unit times the piece size. */
export const buttonPx = (pxPerUnit: number): number => BUTTON_R * 2 * pxPerUnit;
export const keeperPx = (pxPerUnit: number): [number, number] => [KEEPER_SIZE.d * pxPerUnit, KEEPER_SIZE.w * pxPerUnit];
