import { BALL_R, BUTTON_R, FIELD, KEEPER_RANGE, MAX_SPEED, SUPER_SPEED_MUL, other, type Team } from './config';
import { LEVELS, MAX_TRAVEL, pathClear, planHeuristic, travelFor, type AIView, type Level, type Plan, type Pt } from './ai';
import { Physics, type Snapshot } from './physics';
import * as rules from './rules';

interface Cand { idx: number; angle: number; power: number }
interface Result { touched: boolean; foul: boolean; goal: Team | null; ball: Pt; mine: Pt[]; opp: Pt[] }

let scratch: Physics | null = null;

/**
 * Hard-level brain: privately simulates a set of candidate flicks on a hidden copy of the table
 * and picks the best outcome. It is time-sliced (`step`) so the game stays smooth on a phone.
 */
export class Lookahead {
  private cands: Cand[] = [];
  private results: Result[] = [];
  private i = 0;
  private phase: 'scan' | 'robust' | 'done' = 'scan';
  private robustQueue: number[] = [];
  private robustGoal = new Set<number>();
  private best_: Plan | null = null;

  constructor(private view: AIView, private snap: Snapshot, private rnd: () => number, level: Level = 'hard') {
    this.cands = this.generate(LEVELS[level].candidates);
    scratch ??= new Physics();
  }

  get done(): boolean { return this.phase === 'done'; }

  private generate(max: number): Cand[] {
    const v = this.view, me = v.me;
    const goalX = me === 0 ? FIELD.L : 0;
    const out: Cand[] = [];
    v.buttons[me].forEach((b, idx) => {
      const d = Math.hypot(v.ball.x - b.x, v.ball.y - b.y) || 1;
      const base = Math.atan2(v.ball.y - b.y, v.ball.x - b.x);
      if (d - (BUTTON_R + BALL_R) > MAX_TRAVEL) return;
      // aim across the contact cone: thick hits through glancing hits send the ball in different directions
      const cone = Math.asin(Math.min(1, (BUTTON_R + BALL_R) * 0.92 / d));
      for (const f of [-0.85, -0.45, 0, 0.45, 0.85]) {
        const angle = base + f * cone;
        const end = { x: b.x + Math.cos(angle) * (d - BUTTON_R - BALL_R), y: b.y + Math.sin(angle) * (d - BUTTON_R - BALL_R) };
        if (!pathClear(v, b, end, idx)) continue;
        for (const power of [0.6, 1]) {
          if (travelFor(power * MAX_SPEED) < d - BUTTON_R - BALL_R - 0.15) continue;
          out.push({ idx, angle, power });
        }
      }
    });
    // a few straight "shot" candidates from the heuristic planner
    const h = planHeuristic(v, () => 0.5, { ...LEVELS.hard, aimNoise: 0, powerNoise: 0 });
    out.push({ idx: h.idx, angle: Math.atan2(h.dy, h.dx), power: h.power });
    void goalX;
    // deterministic shuffle, then cap
    for (let k = out.length - 1; k > 0; k--) { const j = Math.floor(this.rnd() * (k + 1)); [out[k], out[j]] = [out[j], out[k]]; }
    return out.slice(0, max);
  }

  private simulate(c: Cand, keeperDefY?: number): Result {
    const p = scratch!, v = this.view, me = v.me;
    p.loadSnapshot(this.snap);
    if (keeperDefY !== undefined) p.setKeeperY(other(me), keeperDefY);
    const s = rules.newGame(me); rules.consumeReset(s);
    p.onContact = (a, b) => rules.contact(s, a, b);
    p.onImpact = () => {};
    rules.startFlick(s);
    const sup = v.charge >= 3;
    const m = sup ? SUPER_SPEED_MUL : 1;
    p.flick(me, c.idx, Math.cos(c.angle) * c.power * MAX_SPEED * m, Math.sin(c.angle) * c.power * MAX_SPEED * m, sup);
    let t = 0, goal: Team | null = null;
    while (t < 4) {
      p.step(1 / 60); t += 1 / 60;
      const g = p.ballInGoal();
      if (g !== null) { goal = g; break; }
      if (p.isSettled()) break;
    }
    const pos = (b: { getPosition(): { x: number; y: number } }): Pt => ({ x: b.getPosition().x, y: b.getPosition().y });
    const r: Result = {
      touched: s.ballTouched, foul: s.foul, goal, ball: p.ballPos(),
      mine: p.buttons[me].map(pos), opp: p.buttons[other(me)].map(pos),
    };
    p.freeze();
    return r;
  }

  private value(r: Result, goalCounts: boolean): number {
    const v = this.view, me = v.me, opp = other(me);
    const { L, W } = FIELD;
    const dir = me === 0 ? 1 : -1, oppX = me === 0 ? L : 0, ownX = me === 0 ? 0 : L;
    if (r.goal === me) return -1000;
    if (r.foul) return -300;
    if (r.goal === opp) return goalCounts ? 1000 : -120; // an uncalled goal is disallowed
    if (!r.touched) return -200;
    let val = 100;
    val += 18 * (r.ball.x - v.ball.x) * dir;
    val += 30 * Math.max(0, 1 - Math.hypot(r.ball.x - oppX, r.ball.y - W / 2) / 5);
    val -= 70 * Math.max(0, 1 - Math.hypot(r.ball.x - ownX, r.ball.y - W / 2) / 3); // defend: keep it away from my goal
    if (r.ball.y < 0.4 || r.ball.y > W - 0.4 || r.ball.x < 0.4 || r.ball.x > L - 0.4) val -= 25; // hugging a wall
    const near = (pts: Pt[], d: number) => pts.filter((q) => Math.hypot(q.x - r.ball.x, q.y - r.ball.y) < d).length;
    val += 6 * Math.min(3, near(r.mine, 2.2)); // keep options for the next flick
    val -= 8 * near(r.opp, 1.6); // don't leave the ball next to their buttons
    return val;
  }

  /** Run work for roughly `budgetMs` milliseconds. */
  step(budgetMs: number): void {
    const t0 = performance.now();
    while (this.phase !== 'done' && performance.now() - t0 < budgetMs) {
      if (this.phase === 'scan') {
        if (this.i < this.cands.length) { this.results.push(this.simulate(this.cands[this.i])); this.i++; continue; }
        // shots that scored: would they survive the defender's keeper choice? (only when not yet called)
        if (!this.view.declared) {
          this.robustQueue = this.results
            .map((r, k) => ({ r, k }))
            .filter(({ r }) => r.goal === other(this.view.me) && !r.foul)
            .slice(0, 4).map(({ k }) => k);
        }
        this.phase = 'robust';
      } else {
        const k = this.robustQueue.shift();
        if (k === undefined) { this.finish(); break; }
        const c = this.cands[k], mid = FIELD.W / 2;
        let scored = 0;
        for (const y of [mid - KEEPER_RANGE, mid, mid + KEEPER_RANGE]) {
          const r = this.simulate(c, y);
          if (r.goal === other(this.view.me) && !r.foul) scored++;
        }
        if (scored >= 2) this.robustGoal.add(k);
      }
    }
  }

  private finish(): void {
    let bi = -1, bv = -Infinity, bDecl = false;
    this.results.forEach((r, k) => {
      const robust = this.robustGoal.has(k);
      const val = this.value(r, this.view.declared || robust);
      if (val > bv) { bv = val; bi = k; bDecl = robust && !this.view.declared; }
    });
    if (bi >= 0 && bv > -100) {
      const c = this.cands[bi];
      this.best_ = { idx: c.idx, dx: Math.cos(c.angle), dy: Math.sin(c.angle), power: c.power, declare: bDecl };
    }
    this.phase = 'done';
  }

  /** Run to completion (tests, simulations). */
  runAll(): void { while (!this.done) this.step(1000); }

  /** Best plan found, or null if every candidate was bad (caller falls back to the heuristic). */
  best(): Plan | null { return this.best_; }
}
