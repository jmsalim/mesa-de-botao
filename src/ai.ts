import {
  BALL_R, BUTTON_R, FIELD, KEEPER_RANGE, KEEPER_SIZE, KEEPER_X, MAX_SPEED, SLIDE_C, SLIDE_K, other, type Team,
} from './config';

export type Level = 'easy' | 'medium' | 'hard';
export const LEVEL_ORDER: Level[] = ['easy', 'medium', 'hard'];

/**
 * The CPU never cheats: every level plays with the same power, physics and rules as a human.
 * Levels differ only in how well it decides, how precisely it executes, and how fast it reacts.
 */
export interface LevelCfg {
  /** max aim error in radians (uniform, +/-). Never zero, even on hard. */
  aimNoise: number;
  /** relative power error (+/-) */
  powerNoise: number;
  /** minimum seconds of "thinking" before it flicks */
  thinkMin: number;
  planner: 'naive' | 'heuristic' | 'lookahead';
  /** chance of calling the shot when it has a good one */
  callRate: number;
  /** keeper slide speed (units/s) */
  keeperSpeed: number;
  /** keeper placement error (+/- units) */
  keeperNoise: number;
  /** seconds before the CPU keeper says "ready" */
  keeperReady: number;
  keeperMode: 'ball' | 'line';
  /** candidate flicks tried in the hidden-copy search (lookahead only) */
  candidates: number;
}

export const LEVELS: Record<Level, LevelCfg> = {
  easy: { aimNoise: 0.2, powerNoise: 0.3, thinkMin: 1.5, planner: 'naive', callRate: 0.2, keeperSpeed: 2, keeperNoise: 0.45, keeperReady: 2.4, keeperMode: 'ball', candidates: 0 },
  medium: { aimNoise: 0.08, powerNoise: 0.15, thinkMin: 1.1, planner: 'heuristic', callRate: 1, keeperSpeed: 4, keeperNoise: 0.15, keeperReady: 1.6, keeperMode: 'ball', candidates: 0 },
  hard: { aimNoise: 0.03, powerNoise: 0.08, thinkMin: 0.9, planner: 'lookahead', callRate: 1, keeperSpeed: 6, keeperNoise: 0.05, keeperReady: 1.2, keeperMode: 'line', candidates: 30 },
};

export interface Pt { x: number; y: number }

export interface AIView {
  me: Team;
  buttons: Pt[][];
  ball: Pt;
  /** keeper y per team */
  keepers: [number, number];
  /** ball touches banked by the CPU (3 = super flick available) */
  charge: number;
  /** the shot has already been called, keeper pause done */
  declared: boolean;
}

export interface Plan {
  idx: number;
  /** unit direction of the flick */
  dx: number;
  dy: number;
  /** 0..1 fraction of the maximum pull */
  power: number;
  /** worth calling the shot ("Chutar ao gol") before flicking */
  declare: boolean;
}

/** Flick speed needed to slide `travel` units, and the inverse (see SLIDE_K / SLIDE_C). */
export const speedFor = (travel: number): number => (travel + SLIDE_C) / SLIDE_K;
export const travelFor = (speed: number): number => Math.max(0, SLIDE_K * speed - SLIDE_C);
export const MAX_TRAVEL = travelFor(MAX_SPEED);

const dist = (a: Pt, b: Pt) => Math.hypot(a.x - b.x, a.y - b.y);

function segDist(p: Pt, a: Pt, b: Pt): number {
  const abx = b.x - a.x, aby = b.y - a.y, len2 = abx * abx + aby * aby;
  const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, ((p.x - a.x) * abx + (p.y - a.y) * aby) / len2));
  return Math.hypot(p.x - (a.x + t * abx), p.y - (a.y + t * aby));
}

/** Distance from a point to a keeper box (0 inside). */
function keeperDist(p: Pt, team: Team, y: number): number {
  const kx = team === 0 ? KEEPER_X : FIELD.L - KEEPER_X;
  const dx = Math.max(0, Math.abs(p.x - kx) - KEEPER_SIZE.d / 2), dy = Math.max(0, Math.abs(p.y - y) - KEEPER_SIZE.w / 2);
  return Math.hypot(dx, dy);
}

/** Can a button slide from `from` to `to` without touching another button or a keeper box? */
export function pathClear(v: AIView, from: Pt, to: Pt, selfIdx: number, opts: { opponents?: boolean } = {}): boolean {
  const checkOpp = opts.opponents ?? true;
  v.buttons[v.me].forEach(() => {});
  for (const team of [0, 1] as Team[]) {
    if (team !== v.me && !checkOpp) continue;
    for (let i = 0; i < v.buttons[team].length; i++) {
      if (team === v.me && i === selfIdx) continue;
      if (segDist(v.buttons[team][i], from, to) < BUTTON_R * 2 * 1.04) return false;
    }
  }
  const len = dist(from, to), n = Math.max(1, Math.ceil(len / 0.12));
  for (let k = 0; k <= n; k++) {
    const p = { x: from.x + ((to.x - from.x) * k) / n, y: from.y + ((to.y - from.y) * k) / n };
    for (const team of [0, 1] as Team[]) if (keeperDist(p, team, v.keepers[team]) < BUTTON_R + 0.03) return false;
  }
  return true;
}

function applyNoise(p: Plan, rnd: () => number, cfg: LevelCfg): Plan {
  const ang = Math.atan2(p.dy, p.dx) + (rnd() - 0.5) * 2 * cfg.aimNoise;
  const power = Math.max(0.2, Math.min(1, p.power * (1 + (rnd() - 0.5) * 2 * cfg.powerNoise)));
  return { ...p, dx: Math.cos(ang), dy: Math.sin(ang), power };
}

/** Easy: nearest button, straight at the ball, no foul or obstacle checks, rarely calls shots. */
function planNaive(v: AIView, rnd: () => number, cfg: LevelCfg): Plan {
  const mine = v.buttons[v.me];
  let idx = 0, bd = Infinity;
  mine.forEach((b, i) => { const d = dist(b, v.ball); if (d < bd) { bd = d; idx = i; } });
  if (rnd() < 0.25) idx = Math.floor(rnd() * mine.length);
  const b = mine[idx], d = dist(b, v.ball) || 1;
  const goalX = v.me === 0 ? FIELD.L : 0;
  const near = Math.abs(v.ball.x - goalX) < 3.5;
  return {
    idx, dx: (v.ball.x - b.x) / d, dy: (v.ball.y - b.y) / d,
    power: Math.max(0.35, Math.min(0.9, speedFor(d * 1.2 + 0.5) / MAX_SPEED)),
    declare: near && rnd() < cfg.callRate,
  };
}

/**
 * Medium: lines a button up behind the ball on the line to the goal, picks the cleanest approach
 * (no teammate, opponent or keeper in the way, so no foul), avoids knocking the ball towards its
 * own goal, and sizes the power from the measured slide distance.
 */
export function planHeuristic(v: AIView, rnd: () => number, cfg: LevelCfg): Plan {
  const { L, W } = FIELD;
  const goalX = v.me === 0 ? L : 0;
  const ownX = v.me === 0 ? 0 : L;
  const ty = W / 2 + (v.keepers[other(v.me)] >= W / 2 ? -0.55 : 0.55);
  const ux = goalX - v.ball.x, uy = ty - v.ball.y;
  const ul = Math.hypot(ux, uy) || 1;
  const u = { x: ux / ul, y: uy / ul };
  const contact = BUTTON_R + BALL_R;
  const ghost: Pt = { x: v.ball.x - u.x * contact, y: v.ball.y - u.y * contact };
  const ghostOk = ghost.x > BUTTON_R && ghost.x < L - BUTTON_R && ghost.y > BUTTON_R && ghost.y < W - BUTTON_R;
  const ownDanger = Math.abs(v.ball.x - ownX) < 3.2;

  type Cand = { idx: number; dir: Pt; len: number; align: number; clear: boolean; reach: boolean; score: number; aimed: boolean };
  const cands: Cand[] = [];
  v.buttons[v.me].forEach((b, idx) => {
    const dl = dist(b, v.ball) || 1;
    const dd = { x: (v.ball.x - b.x) / dl, y: (v.ball.y - b.y) / dl };
    // straight at the ball: stop where the button would touch it
    const touchPt = { x: v.ball.x - dd.x * contact, y: v.ball.y - dd.y * contact };
    const dAlign = dd.x * u.x + dd.y * u.y;
    const dClear = pathClear(v, b, touchPt, idx);
    const dReach = dl - contact < MAX_TRAVEL;
    const towardOwn = (ownX - v.ball.x) * dd.x > 0 && ownDanger && Math.abs(dd.x) > 0.5;
    cands.push({
      idx, dir: dd, len: dl, align: dAlign, clear: dClear, reach: dReach, aimed: false,
      score: (dClear ? 2 : -2) + dAlign + (dReach ? 0 : -4) - dl * 0.1 - (towardOwn ? 3 : 0),
    });
    if (ghostOk) {
      const gl = dist(b, ghost) || 1;
      const gd = { x: (ghost.x - b.x) / gl, y: (ghost.y - b.y) / gl };
      const align = gd.x * u.x + gd.y * u.y;
      const c = pathClear(v, b, ghost, idx);
      const r = gl < MAX_TRAVEL;
      cands.push({ idx, dir: gd, len: gl, align, clear: c, reach: r, aimed: true, score: align * 3 + (c ? 1.5 : -3) + (r ? 0 : -4) - gl * 0.3 });
    }
  });
  cands.sort((a, b) => b.score - a.score);
  const aimed = cands.find((c) => c.aimed && c.clear && c.reach && c.align > 0.45);
  const best = aimed ?? cands.find((c) => !c.aimed) ?? cands[0];
  const strong = !!aimed && best.align > 0.8;
  const nearGoal = Math.abs(v.ball.x - goalX) < 4.2;
  const travel = best.aimed ? best.len * 1.1 + 0.3 : best.len - contact + 0.55;
  const power = strong ? 1 : Math.max(0.3, Math.min(1, speedFor(travel) / MAX_SPEED));
  return applyNoise({
    idx: best.idx, dx: best.dir.x, dy: best.dir.y, power,
    declare: strong && nearGoal && best.clear && rnd() < cfg.callRate,
  }, rnd, cfg);
}

/** Heuristic planners for the non-lookahead levels. */
export function planBasic(v: AIView, level: Level, rnd: () => number = Math.random): Plan {
  const cfg = LEVELS[level];
  if (cfg.planner === 'naive') return applyNoise(planNaive(v, rnd, cfg), rnd, cfg);
  return planHeuristic(v, rnd, cfg);
}

/** Add the level's execution error to a plan found by another method (e.g. the lookahead). */
export function withExecutionError(p: Plan, level: Level, rnd: () => number = Math.random): Plan {
  return applyNoise(p, rnd, LEVELS[level]);
}

/**
 * Where the CPU keeper wants to stand while defending. `v.me` is the defender.
 * Easy/Medium follow the ball; Hard extends the likeliest shot line to the goal.
 */
export function keeperTarget(v: AIView, level: Level, rnd: () => number = Math.random): number {
  const cfg = LEVELS[level];
  const err = (rnd() - 0.5) * 2 * cfg.keeperNoise;
  let y = v.ball.y;
  if (cfg.keeperMode === 'line') {
    const att = v.buttons[other(v.me)];
    let bi = 0, bd = Infinity;
    att.forEach((b, i) => { const d = dist(b, v.ball); if (d < bd) { bd = d; bi = i; } });
    const b = att[bi];
    const lineX = v.me === 0 ? 0 : FIELD.L;
    const dx = v.ball.x - b.x, dy = v.ball.y - b.y;
    if (Math.abs(dx) > 1e-3 && (lineX - v.ball.x) * dx > 0) y = 0.65 * (v.ball.y + (dy / Math.abs(dx)) * Math.abs(lineX - v.ball.x)) + 0.35 * v.ball.y;
  }
  const c = FIELD.W / 2;
  return Math.max(c - KEEPER_RANGE, Math.min(c + KEEPER_RANGE, y + err));
}
