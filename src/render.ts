import { BALL_R, BUTTON_R, FIELD, KEEPER_SIZE, MAX_PULL, MIN_PULL, other, type Team } from './config';
import type { Layout } from './layout';
import type { Physics } from './physics';
import type { GameState } from './rules';

export interface Drag {
  kind: 'aim' | 'keeper';
  team: Team;
  idx: number;
  /** pointer position in world units */
  px: number;
  py: number;
}

export interface Scene {
  phys: Physics;
  state: GameState;
  drag: Drag | null;
  time: number;
}

const PALETTE = {
  0: { light: '#8ec0ff', main: '#2b6fd6', dark: '#123573', ring: '#e3efff' },
  1: { light: '#ffa593', main: '#d63b3b', dark: '#701414', ring: '#ffecb0' },
} as const;

function rng(seed: number): () => number {
  let a = seed;
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Deterministic decoration, generated once.
const rand = rng(7);
const GRAIN = Array.from({ length: 70 }, () => ({
  y: rand(), x0: rand(), len: 0.2 + rand() * 0.8, a: 0.03 + rand() * 0.07, w: 0.01 + rand() * 0.02,
}));
const FELT_SPECKS = Array.from({ length: 260 }, () => ({ x: rand(), y: rand(), a: 0.02 + rand() * 0.05 }));

let ballAngle = 0;
let lastBall: { x: number; y: number } | null = null;

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number): void {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

function drawTable(ctx: CanvasRenderingContext2D): void {
  const { L, W, goalW, goalD, frame } = FIELD;
  const x0 = -goalD - frame, y0 = -frame, w = L + 2 * goalD + 2 * frame, h = W + 2 * frame;

  // wooden frame
  ctx.save();
  ctx.shadowColor = 'rgba(0,0,0,0.5)'; ctx.shadowBlur = 0.35; ctx.shadowOffsetY = 0.12;
  const wood = ctx.createLinearGradient(0, y0, 0, y0 + h);
  wood.addColorStop(0, '#b9783b'); wood.addColorStop(0.5, '#9a5f2c'); wood.addColorStop(1, '#7c4a20');
  ctx.fillStyle = wood;
  roundRect(ctx, x0, y0, w, h, 0.28); ctx.fill();
  ctx.restore();
  ctx.save();
  roundRect(ctx, x0, y0, w, h, 0.28); ctx.clip();
  ctx.lineCap = 'round';
  for (const g of GRAIN) {
    ctx.strokeStyle = `rgba(60,30,10,${g.a})`; ctx.lineWidth = g.w;
    const gy = y0 + g.y * h, gx = x0 + g.x0 * w * 0.6;
    ctx.beginPath(); ctx.moveTo(gx, gy); ctx.lineTo(gx + g.len * w * 0.5, gy + (g.y - 0.5) * 0.1); ctx.stroke();
  }
  // bevel highlight
  ctx.strokeStyle = 'rgba(255,220,170,0.35)'; ctx.lineWidth = 0.05;
  roundRect(ctx, x0 + 0.04, y0 + 0.04, w - 0.08, h - 0.08, 0.26); ctx.stroke();
  ctx.restore();

  // goal pockets (dark, with net)
  for (const side of [0, 1]) {
    const gx = side === 0 ? -goalD : L;
    ctx.fillStyle = '#10241a';
    ctx.fillRect(gx, (W - goalW) / 2, goalD, goalW);
    ctx.strokeStyle = 'rgba(255,255,255,0.22)'; ctx.lineWidth = 0.015;
    ctx.beginPath();
    for (let i = 0; i <= 7; i++) {
      const x = gx + (goalD * i) / 7;
      ctx.moveTo(x, (W - goalW) / 2); ctx.lineTo(x, (W + goalW) / 2);
    }
    for (let i = 0; i <= 10; i++) {
      const y = (W - goalW) / 2 + (goalW * i) / 10;
      ctx.moveTo(gx, y); ctx.lineTo(gx + goalD, y);
    }
    ctx.stroke();
  }

  // felt
  ctx.save();
  ctx.beginPath(); ctx.rect(0, 0, L, W); ctx.clip();
  ctx.fillStyle = '#2f8a43'; ctx.fillRect(0, 0, L, W);
  const stripes = 10;
  for (let i = 0; i < stripes; i++) {
    ctx.fillStyle = i % 2 ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.05)';
    ctx.fillRect((L * i) / stripes, 0, L / stripes, W);
  }
  for (const s of FELT_SPECKS) {
    ctx.fillStyle = `rgba(255,255,255,${s.a})`; ctx.fillRect(s.x * L, s.y * W, 0.025, 0.025);
  }
  // inner shadow along the rails
  const sh = ctx.createLinearGradient(0, 0, 0, 0.35);
  sh.addColorStop(0, 'rgba(0,0,0,0.35)'); sh.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = sh; ctx.fillRect(0, 0, L, 0.35);
  ctx.save(); ctx.translate(0, W); ctx.scale(1, -1); ctx.fillStyle = sh; ctx.fillRect(0, 0, L, 0.35); ctx.restore();
  ctx.restore();

  // markings
  ctx.strokeStyle = 'rgba(255,255,255,0.8)'; ctx.lineWidth = 0.045; ctx.lineJoin = 'round';
  ctx.strokeRect(0.12, 0.12, L - 0.24, W - 0.24);
  ctx.beginPath(); ctx.moveTo(L / 2, 0.12); ctx.lineTo(L / 2, W - 0.12); ctx.stroke();
  ctx.beginPath(); ctx.arc(L / 2, W / 2, 0.85, 0, Math.PI * 2); ctx.stroke();
  ctx.fillStyle = 'rgba(255,255,255,0.8)';
  ctx.beginPath(); ctx.arc(L / 2, W / 2, 0.06, 0, Math.PI * 2); ctx.fill();
  for (const side of [0, 1]) {
    const dir = side === 0 ? 1 : -1, gx = side === 0 ? 0.12 : L - 0.12;
    const bw = 1.7, bh = 3.5, sw = 0.75, sh2 = 2.5;
    ctx.strokeRect(side === 0 ? gx : gx - bw, (W - bh) / 2, bw, bh);
    ctx.strokeRect(side === 0 ? gx : gx - sw, (W - sh2) / 2, sw, sh2);
    ctx.beginPath(); ctx.arc(gx + dir * 1.25, W / 2, 0.05, 0, Math.PI * 2); ctx.fill();
  }

  // goal posts
  for (const gx of [0, L]) {
    for (const gy of [(W - goalW) / 2, (W + goalW) / 2]) {
      ctx.fillStyle = 'rgba(0,0,0,0.35)'; ctx.beginPath(); ctx.arc(gx + 0.03, gy + 0.04, 0.085, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = '#f4f4f0'; ctx.beginPath(); ctx.arc(gx, gy, 0.08, 0, Math.PI * 2); ctx.fill();
    }
  }
}

function drawButton(ctx: CanvasRenderingContext2D, x: number, y: number, team: Team, glow: number): void {
  const p = PALETTE[team], R = BUTTON_R;
  ctx.fillStyle = 'rgba(0,0,0,0.38)';
  ctx.beginPath(); ctx.arc(x + 0.05, y + 0.08, R * 1.02, 0, Math.PI * 2); ctx.fill();
  if (glow > 0) {
    ctx.strokeStyle = `rgba(255,236,140,${0.35 + 0.45 * glow})`; ctx.lineWidth = 0.07;
    ctx.beginPath(); ctx.arc(x, y, R + 0.07 + 0.03 * glow, 0, Math.PI * 2); ctx.stroke();
  }
  const g = ctx.createRadialGradient(x - R * 0.35, y - R * 0.4, R * 0.1, x, y, R);
  g.addColorStop(0, p.light); g.addColorStop(0.55, p.main); g.addColorStop(1, p.dark);
  ctx.fillStyle = g; ctx.beginPath(); ctx.arc(x, y, R, 0, Math.PI * 2); ctx.fill();
  ctx.strokeStyle = p.dark; ctx.lineWidth = 0.05;
  ctx.beginPath(); ctx.arc(x, y, R - 0.025, 0, Math.PI * 2); ctx.stroke();
  ctx.strokeStyle = p.ring; ctx.lineWidth = 0.035; ctx.globalAlpha = 0.9;
  ctx.beginPath(); ctx.arc(x, y, R * 0.62, 0, Math.PI * 2); ctx.stroke();
  ctx.globalAlpha = 1;
  ctx.fillStyle = p.ring; ctx.globalAlpha = 0.85;
  ctx.beginPath(); ctx.arc(x, y, R * 0.16, 0, Math.PI * 2); ctx.fill();
  ctx.globalAlpha = 1;
  ctx.strokeStyle = 'rgba(255,255,255,0.4)'; ctx.lineWidth = 0.04; ctx.lineCap = 'round';
  ctx.beginPath(); ctx.arc(x, y, R * 0.82, Math.PI * 1.08, Math.PI * 1.55); ctx.stroke();
}

function drawKeeper(ctx: CanvasRenderingContext2D, x: number, y: number, team: Team, glow: number): void {
  const p = PALETTE[team], w = KEEPER_SIZE.d, h = KEEPER_SIZE.w;
  ctx.fillStyle = 'rgba(0,0,0,0.35)';
  roundRect(ctx, x - w / 2 + 0.05, y - h / 2 + 0.07, w, h, 0.08); ctx.fill();
  if (glow > 0) {
    ctx.strokeStyle = `rgba(255,236,140,${0.35 + 0.45 * glow})`; ctx.lineWidth = 0.07;
    roundRect(ctx, x - w / 2 - 0.07, y - h / 2 - 0.07, w + 0.14, h + 0.14, 0.13); ctx.stroke();
  }
  const g = ctx.createLinearGradient(x - w / 2, 0, x + w / 2, 0);
  g.addColorStop(0, p.light); g.addColorStop(0.5, p.main); g.addColorStop(1, p.dark);
  ctx.fillStyle = g; roundRect(ctx, x - w / 2, y - h / 2, w, h, 0.08); ctx.fill();
  ctx.strokeStyle = p.dark; ctx.lineWidth = 0.04; ctx.stroke();
  ctx.strokeStyle = p.ring; ctx.lineWidth = 0.03;
  ctx.beginPath(); ctx.moveTo(x, y - h / 2 + 0.1); ctx.lineTo(x, y + h / 2 - 0.1); ctx.stroke();
  ctx.fillStyle = p.ring;
  for (const k of [-1, 0, 1]) { ctx.beginPath(); ctx.arc(x, y + k * h * 0.28, 0.04, 0, Math.PI * 2); ctx.fill(); }
}

function drawBall(ctx: CanvasRenderingContext2D, x: number, y: number): void {
  const R = BALL_R;
  if (lastBall) {
    const dx = x - lastBall.x, dy = y - lastBall.y;
    ballAngle += Math.hypot(dx, dy) / R * (dx >= 0 ? 1 : -1);
  }
  lastBall = { x, y };
  ctx.fillStyle = 'rgba(0,0,0,0.4)';
  ctx.beginPath(); ctx.arc(x + 0.04, y + 0.06, R * 1.05, 0, Math.PI * 2); ctx.fill();
  const g = ctx.createRadialGradient(x - R * 0.35, y - R * 0.4, R * 0.1, x, y, R);
  g.addColorStop(0, '#f6dcaa'); g.addColorStop(0.6, '#c9975a'); g.addColorStop(1, '#7f5427');
  ctx.fillStyle = g; ctx.beginPath(); ctx.arc(x, y, R, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = 'rgba(70,40,15,0.55)';
  for (let i = 0; i < 6; i++) {
    const a = ballAngle + i * 1.05, r = R * (0.25 + 0.5 * ((i * 37) % 10) / 10);
    ctx.beginPath(); ctx.arc(x + Math.cos(a) * r, y + Math.sin(a) * r, R * 0.1, 0, Math.PI * 2); ctx.fill();
  }
  ctx.fillStyle = 'rgba(255,255,255,0.55)';
  ctx.beginPath(); ctx.arc(x - R * 0.35, y - R * 0.38, R * 0.18, 0, Math.PI * 2); ctx.fill();
}

function drawAim(ctx: CanvasRenderingContext2D, scene: Scene, drag: Drag): void {
  const b = scene.phys.buttons[drag.team][drag.idx].getPosition();
  let dx = b.x - drag.px, dy = b.y - drag.py;
  const len = Math.hypot(dx, dy);
  const clamped = Math.min(len, MAX_PULL);
  const power = clamped / MAX_PULL;
  const live = len >= MIN_PULL;
  if (len > 1e-6) { dx /= len; dy /= len; }
  // pull line to finger
  ctx.save();
  ctx.setLineDash([0.08, 0.1]); ctx.lineCap = 'round';
  ctx.strokeStyle = 'rgba(255,255,255,0.7)'; ctx.lineWidth = 0.05;
  ctx.beginPath(); ctx.moveTo(b.x, b.y); ctx.lineTo(b.x - dx * clamped, b.y - dy * clamped); ctx.stroke();
  ctx.restore();
  if (!live) return;
  // power ring
  ctx.strokeStyle = `hsl(${120 - 120 * power},85%,58%)`; ctx.lineWidth = 0.07; ctx.lineCap = 'round';
  ctx.beginPath(); ctx.arc(b.x, b.y, BUTTON_R + 0.12, -Math.PI / 2, -Math.PI / 2 + power * Math.PI * 2); ctx.stroke();
  // direction arrow
  const start = BUTTON_R + 0.2, alen = start + 0.5 + power * 2.2;
  const ex = b.x + dx * alen, ey = b.y + dy * alen, sx = b.x + dx * start, sy = b.y + dy * start;
  ctx.strokeStyle = `hsl(${120 - 120 * power},90%,60%)`; ctx.fillStyle = ctx.strokeStyle;
  ctx.lineWidth = 0.09;
  ctx.beginPath(); ctx.moveTo(sx, sy); ctx.lineTo(ex - dx * 0.1, ey - dy * 0.1); ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(ex, ey);
  ctx.lineTo(ex - dx * 0.28 - dy * 0.17, ey - dy * 0.28 + dx * 0.17);
  ctx.lineTo(ex - dx * 0.28 + dy * 0.17, ey - dy * 0.28 - dx * 0.17);
  ctx.closePath(); ctx.fill();
}

export function render(ctx: CanvasRenderingContext2D, l: Layout, dpr: number, scene: Scene): void {
  const { a, b, c, d, e, f } = l.m;
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.clearRect(0, 0, ctx.canvas.width, ctx.canvas.height);
  ctx.setTransform(a * dpr, b * dpr, c * dpr, d * dpr, e * dpr, f * dpr);

  drawTable(ctx);

  const { phys, state, drag, time } = scene;
  const pulse = 0.5 + 0.5 * Math.sin(time * 5);

  // goal being shot at glows once the shot has been called
  if (state.declared || state.phase === 'keeper') {
    const defender = other(state.turn);
    const gx = defender === 0 ? 0 : FIELD.L;
    ctx.strokeStyle = `rgba(255,224,102,${0.5 + 0.4 * pulse})`; ctx.lineWidth = 0.1; ctx.lineCap = 'round';
    ctx.beginPath(); ctx.moveTo(gx, (FIELD.W - FIELD.goalW) / 2); ctx.lineTo(gx, (FIELD.W + FIELD.goalW) / 2); ctx.stroke();
  }

  const canAim = state.phase === 'aim';
  const keeperTeam = state.phase === 'keeper' ? other(state.turn) : null;

  for (const team of [0, 1] as Team[]) {
    const k = phys.keepers[team].getPosition();
    drawKeeper(ctx, k.x, k.y, team, keeperTeam === team ? pulse : 0);
  }
  for (const team of [0, 1] as Team[]) {
    phys.buttons[team].forEach((body, idx) => {
      const p = body.getPosition();
      const active = canAim && team === state.turn && !(drag && drag.kind === 'aim' && drag.idx !== idx);
      drawButton(ctx, p.x, p.y, team, active ? pulse : 0);
    });
  }
  const bp = phys.ballPos();
  drawBall(ctx, bp.x, bp.y);
  if (drag && drag.kind === 'aim') drawAim(ctx, scene, drag);
}
