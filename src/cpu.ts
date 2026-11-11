import { planBasic, planHeuristic, LEVELS, withExecutionError, type AIView, type Level, type Plan } from './ai';
import { Lookahead } from './lookahead';
import type { Snapshot } from './physics';

/** Synchronous planning for any level (used by tests and balance simulations). */
export function planForLevel(view: AIView, level: Level, rnd: () => number, snap?: Snapshot): Plan {
  if (LEVELS[level].planner !== 'lookahead' || !snap) return planBasic(view, level, rnd);
  const s = new Lookahead(view, snap, rnd, level);
  s.runAll();
  return withExecutionError(s.best() ?? planHeuristic(view, rnd, LEVELS[level]), level, rnd);
}
