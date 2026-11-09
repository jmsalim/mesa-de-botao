import { FIELD } from './config';

export interface Layout {
  portrait: boolean;
  scale: number;
  /** world -> CSS px affine matrix: x' = a x + c y + e ; y' = b x + d y + f */
  m: { a: number; b: number; c: number; d: number; e: number; f: number };
  width: number;
  height: number;
}

const totW = FIELD.L + 2 * FIELD.goalD + 2 * FIELD.frame;
const totH = FIELD.W + 2 * FIELD.frame;

export function computeLayout(width: number, height: number): Layout {
  const sLand = Math.min(width / totW, height / totH);
  const sPort = Math.min(width / totH, height / totW);
  const portrait = sPort > sLand;
  const s = portrait ? sPort : sLand;
  const { frame, goalD, L } = FIELD;
  if (!portrait) {
    const ox = (width - totW * s) / 2, oy = (height - totH * s) / 2;
    return { portrait, scale: s, width, height,
      m: { a: s, b: 0, c: 0, d: s, e: ox + (goalD + frame) * s, f: oy + frame * s } };
  }
  // rotate -90deg so team 0's goal (x = 0) is at the bottom of the screen
  const ox = (width - totH * s) / 2, oy = (height - totW * s) / 2;
  return { portrait, scale: s, width, height,
    m: { a: 0, b: -s, c: s, d: 0, e: ox + frame * s, f: oy + (L + goalD + frame) * s } };
}

export function screenToWorld(l: Layout, sx: number, sy: number): { x: number; y: number } {
  const { a, b, c, d, e, f } = l.m;
  const det = a * d - b * c;
  const px = sx - e, py = sy - f;
  return { x: (d * px - c * py) / det, y: (-b * px + a * py) / det };
}
