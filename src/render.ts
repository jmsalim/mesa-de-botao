import { BALL_R, BUTTON_DAMPING, BUTTON_R, CHARGE_MAX, FIELD, KEEPER_SIZE, MAX_PULL, MAX_SPEED, MIN_PULL, SUPER_SPEED_MUL, other, type Team } from './config';
import type { Fx } from './fx';
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
  fx: Fx;
  /** 1 = normal speed, <1 during slow-motion */
  timeScale: number;
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

/** Goal netting: a grid that bulges and wraps around the ball when it is inside. */
function drawNet(ctx: CanvasRenderingContext2D, ball: { x: number; y: number }, time: number): void {
  const { L, W, goalW, goalD } = FIELD;
  const COLS = 8, ROWS = 12;
  for (const side of [0, 1]) {
    const out = side === 0 ? -1 : 1; // direction pointing out of the field
    const lineX = side === 0 ? 0 : L;
    const depth = (ball.x - lineX) * out; // how far the ball is past the goal line
    const push = Math.max(0, Math.min(1, (depth + 0.05) / goalD));
    const pt = (c: number, r: number) => {
      let x = lineX + out * (goalD * c) / COLS;
      let y = (W - goalW) / 2 + (goalW * r) / ROWS;
      if (push > 0 && c > 0) {
        const dx = x - ball.x, dy = y - ball.y;
        const w = Math.exp(-(dx * dx + dy * dy) / 0.28) * push;
        x += out * w * 0.22 + (ball.x - x) * w * 0.35;
        y += (ball.y - y) * w * 0.45 + Math.sin(time * 26 + r) * w * 0.012;
      }
      return { x, y };
    };
    ctx.strokeStyle = 'rgba(255,255,255,0.4)'; ctx.lineWidth = 0.016; ctx.lineJoin = 'round';
    ctx.beginPath();
    for (let c = 0; c <= COLS; c++) {
      for (let r = 0; r <= ROWS; r++) { const q = pt(c, r); if (r === 0) ctx.moveTo(q.x, q.y); else ctx.lineTo(q.x, q.y); }
    }
    for (let r = 0; r <= ROWS; r++) {
      for (let c = 0; c <= COLS; c++) { const q = pt(c, r); if (c === 0) ctx.moveTo(q.x, q.y); else ctx.lineTo(q.x, q.y); }
    }
    ctx.stroke();
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

interface Prediction {
  /** where the button's centre ends up (first hit, or where it runs out of steam) */
  endX: number; endY: number;
  hit: 'ball' | 'foul' | 'own' | 'wall' | null;
  /** ball launch direction if the first thing hit is the ball */
  ballDir: { x: number; y: number } | null;
  bounce: { x: number; y: number } | null;
}

/** Ray-march the flick: first thing the button would touch within its reach. */
function predict(scene: Scene, drag: Drag, ux: number, uy: number, reach: number): Prediction {
  const { phys } = scene;
  const b = phys.buttons[drag.team][drag.idx].getPosition();
  let bestT = reach;
  let hit: Prediction['hit'] = null;
  let ballDir: Prediction['ballDir'] = null;
  const circle = (cx: number, cy: number, r: number): number | null => {
    const mx = b.x - cx, my = b.y - cy;
    const bb = mx * ux + my * uy, c = mx * mx + my * my - r * r;
    if (c > 0 && bb > 0) return null;
    const disc = bb * bb - c;
    if (disc < 0) return null;
    const t = -bb - Math.sqrt(disc);
    return t >= 0 ? t : null;
  };
  const bp = phys.ballPos();
  const tBall = circle(bp.x, bp.y, BUTTON_R + BALL_R);
  if (tBall !== null && tBall < bestT) { bestT = tBall; hit = 'ball'; }
  for (const team of [0, 1] as Team[]) {
    phys.buttons[team].forEach((o, i) => {
      if (team === drag.team && i === drag.idx) return;
      const p = o.getPosition();
      const t = circle(p.x, p.y, BUTTON_R * 2);
      if (t !== null && t < bestT) { bestT = t; hit = team === drag.team ? 'own' : 'foul'; }
    });
  }
  const { L, W } = FIELD;
  const tx = ux > 1e-6 ? (L - BUTTON_R - b.x) / ux : ux < -1e-6 ? (BUTTON_R - b.x) / ux : Infinity;
  const ty = uy > 1e-6 ? (W - BUTTON_R - b.y) / uy : uy < -1e-6 ? (BUTTON_R - b.y) / uy : Infinity;
  const tw = Math.min(tx, ty);
  let bounce: Prediction['bounce'] = null;
  if (tw < bestT) {
    bestT = tw; hit = 'wall';
    bounce = tx < ty ? { x: -ux, y: uy } : { x: ux, y: -uy };
  }
  const ex = b.x + ux * bestT, ey = b.y + uy * bestT;
  if (hit === 'ball') {
    const dx = bp.x - ex, dy = bp.y - ey, l = Math.hypot(dx, dy) || 1;
    ballDir = { x: dx / l, y: dy / l };
  }
  return { endX: ex, endY: ey, hit, ballDir, bounce };
}

function drawAim(ctx: CanvasRenderingContext2D, scene: Scene, drag: Drag): void {
  const b = scene.phys.buttons[drag.team][drag.idx].getPosition();
  let dx = b.x - drag.px, dy = b.y - drag.py;
  const len = Math.hypot(dx, dy);
  const clamped = Math.min(len, MAX_PULL);
  const power = clamped / MAX_PULL;
  const live = len >= MIN_PULL;
  if (len > 1e-6) { dx /= len; dy /= len; }
  const hue = 120 - 120 * power;
  const sup = scene.state.charge[drag.team] >= CHARGE_MAX;

  // elastic band back to the finger
  ctx.save();
  ctx.setLineDash([0.08, 0.1]); ctx.lineCap = 'round';
  ctx.strokeStyle = 'rgba(255,255,255,0.7)'; ctx.lineWidth = 0.05;
  ctx.beginPath(); ctx.moveTo(b.x, b.y); ctx.lineTo(b.x - dx * clamped, b.y - dy * clamped); ctx.stroke();
  ctx.restore();
  if (!live) return;

  ctx.lineCap = 'round';
  ctx.strokeStyle = `hsl(${hue},85%,58%)`; ctx.lineWidth = 0.07;
  ctx.beginPath(); ctx.arc(b.x, b.y, BUTTON_R + 0.12, -Math.PI / 2, -Math.PI / 2 + power * Math.PI * 2); ctx.stroke();

  // preview: how far this flick slides, and what it would hit first
  const speed = power * MAX_SPEED * (sup ? SUPER_SPEED_MUL : 1);
  const reach = (speed / BUTTON_DAMPING) * 0.93;
  const pr = predict(scene, drag, dx, dy, reach);
  const warn = pr.hit === 'foul';
  const col = warn ? '#ff4d4d' : `hsl(${hue},90%,62%)`;
  ctx.save();
  ctx.setLineDash([0.07, 0.13]); ctx.strokeStyle = col; ctx.lineWidth = 0.065; ctx.globalAlpha = 0.95;
  ctx.beginPath(); ctx.moveTo(b.x + dx * (BUTTON_R + 0.1), b.y + dy * (BUTTON_R + 0.1)); ctx.lineTo(pr.endX, pr.endY); ctx.stroke();
  if (pr.bounce) {
    const rest = Math.max(0, reach - Math.hypot(pr.endX - b.x, pr.endY - b.y)) * 0.6;
    ctx.globalAlpha = 0.45;
    ctx.beginPath(); ctx.moveTo(pr.endX, pr.endY); ctx.lineTo(pr.endX + pr.bounce.x * Math.min(rest, 1.4), pr.endY + pr.bounce.y * Math.min(rest, 1.4)); ctx.stroke();
  }
  ctx.restore();
  // ghost button where it will stop or collide
  ctx.strokeStyle = col; ctx.lineWidth = 0.05; ctx.globalAlpha = 0.9;
  ctx.beginPath(); ctx.arc(pr.endX, pr.endY, BUTTON_R, 0, Math.PI * 2); ctx.stroke();
  ctx.globalAlpha = 1;
  if (warn) { // red cross: you would hit an opponent first (foul)
    ctx.strokeStyle = '#ff4d4d'; ctx.lineWidth = 0.09;
    const c = BUTTON_R * 0.5;
    ctx.beginPath(); ctx.moveTo(pr.endX - c, pr.endY - c); ctx.lineTo(pr.endX + c, pr.endY + c);
    ctx.moveTo(pr.endX + c, pr.endY - c); ctx.lineTo(pr.endX - c, pr.endY + c); ctx.stroke();
  }
  if (pr.hit === 'ball' && pr.ballDir) { // where the ball will be sent
    const bp = scene.phys.ballPos(), l = 0.7 + power * 1.8;
    const ex = bp.x + pr.ballDir.x * l, ey = bp.y + pr.ballDir.y * l, a = pr.ballDir;
    ctx.strokeStyle = '#fff3c4'; ctx.fillStyle = '#fff3c4'; ctx.lineWidth = 0.06;
    ctx.beginPath(); ctx.moveTo(bp.x + a.x * 0.2, bp.y + a.y * 0.2); ctx.lineTo(ex, ey); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(ex + a.x * 0.2, ey + a.y * 0.2);
    ctx.lineTo(ex - a.y * 0.13, ey + a.x * 0.13); ctx.lineTo(ex + a.y * 0.13, ey - a.x * 0.13); ctx.closePath(); ctx.fill();
  }
}

function drawAura(ctx: CanvasRenderingContext2D, x: number, y: number, time: number): void {
  ctx.save();
  ctx.translate(x, y); ctx.rotate(time * 1.6);
  ctx.strokeStyle = 'rgba(255,215,94,0.9)'; ctx.lineWidth = 0.05; ctx.lineCap = 'round';
  for (let i = 0; i < 8; i++) {
    ctx.rotate(Math.PI / 4);
    const r0 = BUTTON_R + 0.1 + 0.03 * Math.sin(time * 8 + i), r1 = r0 + 0.14;
    ctx.beginPath(); ctx.moveTo(r0, 0); ctx.lineTo(r1, 0); ctx.stroke();
  }
  ctx.restore();
}

export function render(ctx: CanvasRenderingContext2D, l: Layout, dpr: number, scene: Scene): void {
  const { a, b, c, d, e, f } = l.m;
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.clearRect(0, 0, ctx.canvas.width, ctx.canvas.height);
  ctx.setTransform(a * dpr, b * dpr, c * dpr, d * dpr, e * dpr, f * dpr);

  const { phys, state, drag, time, fx } = scene;
  const sh = fx.shakeOffset(time);
  ctx.translate(sh.x, sh.y);
  drawTable(ctx);
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
  // super-charged team: spinning golden aura on its buttons
  for (const team of [0, 1] as Team[]) {
    if (state.charge[team] >= CHARGE_MAX && !(state.phase === 'moving' && state.turn === team && state.superActive)) {
      for (const body of phys.buttons[team]) { const p = body.getPosition(); drawAura(ctx, p.x, p.y, time); }
    }
  }
  fx.drawTrails(ctx);
  const bp = phys.ballPos();
  drawBall(ctx, bp.x, bp.y);
  drawNet(ctx, bp, time); // over the ball, so a scored ball sits inside the netting
  if (drag && drag.kind === 'aim') drawAim(ctx, scene, drag);
  fx.drawParticles(ctx);

  // screen-space overlays: impact flash and slow-motion vignette
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  if (fx.flash > 0) {
    ctx.fillStyle = `rgba(${fx.flashColor},${Math.min(0.6, fx.flash * 0.6)})`;
    ctx.fillRect(0, 0, ctx.canvas.width, ctx.canvas.height);
  }
  if (scene.timeScale < 0.9) {
    const w = ctx.canvas.width, h = ctx.canvas.height;
    const g = ctx.createRadialGradient(w / 2, h / 2, Math.min(w, h) * 0.25, w / 2, h / 2, Math.max(w, h) * 0.75);
    g.addColorStop(0, 'rgba(0,0,0,0)'); g.addColorStop(1, `rgba(0,0,0,${(1 - scene.timeScale) * 0.7})`);
    ctx.fillStyle = g; ctx.fillRect(0, 0, w, h);
  }
}
