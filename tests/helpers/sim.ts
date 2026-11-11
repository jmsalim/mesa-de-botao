import { keeperTarget, type AIView, type Level } from '../../src/ai';
import { MAX_SPEED, SUPER_SPEED_MUL, other, type Team } from '../../src/config';
import { planForLevel } from '../../src/cpu';
import { Physics } from '../../src/physics';
import * as rules from '../../src/rules';

export const mulberry = (a: number) => () => {
  a |= 0; a = (a + 0x6d2b79f5) | 0;
  let t = Math.imul(a ^ (a >>> 15), 1 | a);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};

/** Dev aid: descriptions of own goals from the last matches (cleared by callers). */
export const ownGoalLog: string[] = [];

export interface SideStats {
  flicks: number; touch: number; foul: number; declared: number; goalsCalled: number; disallowed: number;
  ownGoals: number; repositions: number; supers: number;
}
export interface MatchResult { winner: Team | null; score: number[]; flicks: number; sides: [SideStats, SideStats] }

const blank = (): SideStats => ({ flicks: 0, touch: 0, foul: 0, declared: 0, goalsCalled: 0, disallowed: 0, ownGoals: 0, repositions: 0, supers: 0 });
const phaseOf = (s: rules.GameState): rules.Phase => s.phase;

/** Plays a whole match CPU vs CPU through the real physics and rules, headless. */
export function playMatch(levels: [Level, Level], seed: number, maxFlicks = 300): MatchResult {
  const rnd = mulberry(seed);
  const phys = new Physics();
  const s = rules.newGame(0); rules.consumeReset(s);
  phys.onContact = (a, b) => rules.contact(s, a, b);
  const sides: [SideStats, SideStats] = [blank(), blank()];
  let total = 0;
  let afterGoalKick = false;

  const view = (me: Team, declared: boolean): AIView => ({
    me, ball: phys.ballPos(), declared, charge: s.charge[me],
    keepers: [phys.keeperY(0), phys.keeperY(1)],
    buttons: phys.buttons.map((tm) => tm.map((b) => ({ x: b.getPosition().x, y: b.getPosition().y }))),
  });

  while (phaseOf(s) !== 'over' && total < maxFlicks) {
    const me = s.turn as Team, st = sides[me];
    if (phys.ballTrapped(me)) { phys.repositionBall(); st.repositions++; }
    let plan = planForLevel(view(me, false), levels[me], rnd, phys.snapshot());
    if (plan.declare && !s.declared) {
      rules.declareShot(s); st.declared++;
      const def = other(me);
      phys.setKeeperY(def, keeperTarget(view(def, false), levels[def], rnd));
      rules.confirmKeeper(s);
      plan = planForLevel(view(me, true), levels[me], rnd, phys.snapshot());
    }
    const called = s.declared;
    const ballBefore = phys.ballPos();
    const wasGoalKick = afterGoalKick; afterGoalKick = false;
    rules.startFlick(s); total++; st.flicks++;
    const sup = s.superActive; if (sup) st.supers++;
    const m = sup ? SUPER_SPEED_MUL : 1;
    phys.flick(me, plan.idx, plan.dx * plan.power * MAX_SPEED * m, plan.dy * plan.power * MAX_SPEED * m, sup);
    let t = 0, goal: Team | null = null;
    for (;;) {
      phys.step(1 / 60); t += 1 / 60;
      const g = phys.ballInGoal();
      if (g !== null) { goal = g; break; }
      if (phys.isSettled() || t > 10) break;
    }
    if (goal !== null) {
      rules.goalReached(s, goal);
      phys.freeze();
      if (phaseOf(s) === 'goal' || phaseOf(s) === 'over') {
        if (goal === me) { st.ownGoals++; ownGoalLog.push(`${wasGoalKick ? 'GOALKICK ' : ''}ball before (${ballBefore.x.toFixed(1)},${ballBefore.y.toFixed(1)}) me=${me} idx=${plan.idx} power=${plan.power.toFixed(2)}`); } else if (called) st.goalsCalled++;
        phys.resetKickoff(); rules.consumeReset(s); rules.resumeAfterGoal(s);
      } else {
        st.disallowed++;
        phys.resetGoalKick(s.resetDefender); rules.consumeReset(s);
        afterGoalKick = true;
      }
    } else {
      phys.freeze();
      if (s.ballTouched) st.touch++;
      if (s.foul) st.foul++;
      rules.settle(s);
      if (phys.ballInCorner()) { phys.repositionBall(); st.repositions++; }
    }
  }
  return { winner: phaseOf(s) === 'over' ? s.winner : null, score: [...s.score], flicks: total, sides };
}

export interface SeriesResult {
  winsA: number; winsB: number; unfinished: number; matches: number; avgFlicks: number;
  /** goals scored by A and by B across all matches, finished or not */
  goalsA: number; goalsB: number;
  a: SideStats; b: SideStats;
}

/** A plays as `a`, B as `b`; sides alternate every other match so kickoff and side don't bias it. */
export function playSeries(a: Level, b: Level, matches: number, seed0 = 1000, maxFlicks = 300): SeriesResult {
  const out: SeriesResult = { winsA: 0, winsB: 0, unfinished: 0, matches, avgFlicks: 0, goalsA: 0, goalsB: 0, a: blank(), b: blank() };
  for (let i = 0; i < matches; i++) {
    const swap = i % 2 === 1;
    const r = playMatch(swap ? [b, a] : [a, b], seed0 + i, maxFlicks);
    const aSide = swap ? 1 : 0;
    if (r.winner === null) out.unfinished++; else if (r.winner === aSide) out.winsA++; else out.winsB++;
    out.avgFlicks += r.flicks / matches;
    out.goalsA += r.score[aSide]; out.goalsB += r.score[1 - aSide];
    for (const k of Object.keys(out.a) as (keyof SideStats)[]) { out.a[k] += r.sides[aSide][k]; out.b[k] += r.sides[1 - aSide][k]; }
  }
  return out;
}

export const pct = (n: number, d: number) => (d ? Math.round((100 * n) / d) : 0);
export const describe = (label: string, r: SeriesResult) =>
  `${label}: A ${r.winsA} - B ${r.winsB} (goals ${r.goalsA}-${r.goalsB}), unfinished ${r.unfinished}/${r.matches}, avg ${r.avgFlicks.toFixed(0)} flicks\n` +
  [['A', r.a], ['B', r.b]].map(([n, s]) => { const x = s as SideStats; return `   ${n}: touch ${pct(x.touch, x.flicks)}% foul ${pct(x.foul, x.flicks)}% called ${x.declared} (goals ${x.goalsCalled}) disallowed ${x.disallowed} own ${x.ownGoals} repos ${x.repositions} super ${x.supers}`; }).join('\n');
