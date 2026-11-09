import { BALL_R, BUTTON_DAMPING, BUTTON_R, FIELD, MAX_SPEED, type Team } from './config';

export interface Pt { x: number; y: number }

export interface AIView {
  me: Team;
  buttons: Pt[][];
  ball: Pt;
  /** Opponent keeper position (the CPU aims away from it). */
  keeper: Pt;
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

const dist = (a: Pt, b: Pt) => Math.hypot(a.x - b.x, a.y - b.y);

function segDist(p: Pt, a: Pt, b: Pt): number {
  const abx = b.x - a.x, aby = b.y - a.y, len2 = abx * abx + aby * aby;
  const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, ((p.x - a.x) * abx + (p.y - a.y) * aby) / len2));
  return Math.hypot(p.x - (a.x + t * abx), p.y - (a.y + t * aby));
}

/**
 * Pick which button to flick and how. Pure function so it can be unit-tested.
 * The CPU lines a button up behind the ball on the line to the goal, avoids paths
 * that would clip an opponent's button first (a foul), and adds a little human error.
 */
export function planShot(v: AIView, rnd: () => number = Math.random, noise = 0.05): Plan {
  const { L, W } = FIELD;
  const goalX = v.me === 0 ? L : 0;
  const ty = W / 2 + (v.keeper.y >= W / 2 ? -0.55 : 0.55);
  const target: Pt = { x: goalX, y: ty };
  const ux = target.x - v.ball.x, uy = target.y - v.ball.y;
  const ul = Math.hypot(ux, uy) || 1;
  const u = { x: ux / ul, y: uy / ul };
  const ghost: Pt = { x: v.ball.x - u.x * (BUTTON_R + BALL_R), y: v.ball.y - u.y * (BUTTON_R + BALL_R) };
  const ghostOk = ghost.x > BUTTON_R && ghost.x < L - BUTTON_R && ghost.y > BUTTON_R && ghost.y < W - BUTTON_R;

  const mine = v.buttons[v.me];
  const others = (self: number) => [
    ...mine.filter((_, i) => i !== self),
    ...v.buttons[v.me === 0 ? 1 : 0],
  ];
  const clear = (from: Pt, to: Pt, self: number) =>
    others(self).every((o) => segDist(o, from, to) > BUTTON_R * 2 * 1.04);

  type Cand = { idx: number; dir: Pt; len: number; align: number; clear: boolean; score: number };
  const direct: Cand[] = [];
  const aimed: Cand[] = [];
  mine.forEach((b, idx) => {
    // straight at the ball (just touch it)
    const dl = dist(b, v.ball) || 1;
    const dd = { x: (v.ball.x - b.x) / dl, y: (v.ball.y - b.y) / dl };
    const dAlign = dd.x * u.x + dd.y * u.y;
    const dClear = clear(b, v.ball, idx);
    direct.push({ idx, dir: dd, len: dl, align: dAlign, clear: dClear, score: (dClear ? 2 : -2) + dAlign - dl * 0.1 });
    // lined up behind the ball, pushing it toward the goal
    if (ghostOk) {
      const gl = dist(b, ghost) || 1;
      const gd = { x: (ghost.x - b.x) / gl, y: (ghost.y - b.y) / gl };
      const align = gd.x * u.x + gd.y * u.y;
      const c = clear(b, ghost, idx);
      aimed.push({ idx, dir: gd, len: gl, align, clear: c, score: align * 3 + (c ? 1.5 : -3) - gl * 0.3 });
    }
  });

  const bestAimed = aimed.sort((a, b) => b.score - a.score)[0];
  const useAimed = bestAimed && bestAimed.clear && bestAimed.align > 0.45;
  const best = useAimed ? bestAimed : direct.sort((a, b) => b.score - a.score)[0];

  const strong = useAimed && best.align > 0.8;
  let power = strong ? 1 : Math.max(0.35, Math.min(1, (best.len * BUTTON_DAMPING * 1.1 + 3.5) / MAX_SPEED));
  const ang = Math.atan2(best.dir.y, best.dir.x) + (rnd() - 0.5) * 2 * noise;
  power = Math.min(1, power * (1 + (rnd() - 0.5) * 0.16));

  const nearGoal = Math.abs(v.ball.x - goalX) < 4.2;
  return {
    idx: best.idx, dx: Math.cos(ang), dy: Math.sin(ang), power,
    declare: !!strong && nearGoal && best.clear,
  };
}

/** Where the CPU keeper wants to stand: follow the ball, a touch late. */
export function keeperTarget(ballY: number): number {
  return ballY + (Math.sin(ballY * 7) * 0.12);
}
