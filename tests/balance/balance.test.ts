import { describe, expect, it } from 'vitest';
import { describe as summary, pct, playSeries, type SeriesResult } from '../helpers/sim';

/**
 * CPU-vs-CPU balance checks through the real physics and rules, headless and deterministic (fixed seeds).
 * Slow (about 2 minutes), so it lives in its own suite: `npm run test:balance`.
 * Goals are compared instead of wins alone, because many matches don't finish within the flick cap.
 */
const SEED = 7000;
const CAP = 250;
const log = (label: string, r: SeriesResult) => console.log(summary(label, r));

describe('difficulty ladder', () => {
  it('Médio clearly beats Fácil', () => {
    const r = playSeries('easy', 'medium', 16, SEED, CAP);
    log('easy vs medium', r);
    expect(r.goalsB).toBeGreaterThanOrEqual(2 * Math.max(1, r.goalsA));
    expect(r.winsB).toBeGreaterThan(r.winsA);
  }, 300_000);

  it('Difícil clearly beats Médio', () => {
    const r = playSeries('medium', 'hard', 8, SEED, CAP);
    log('medium vs hard', r);
    expect(r.goalsB).toBeGreaterThanOrEqual(2 * Math.max(1, r.goalsA));
    expect(r.winsB).toBeGreaterThan(r.winsA);
  }, 600_000);

  it('Difícil crushes Fácil', () => {
    const r = playSeries('easy', 'hard', 6, SEED, CAP);
    log('easy vs hard', r);
    expect(r.goalsB).toBeGreaterThanOrEqual(3 * Math.max(1, r.goalsA));
    expect(r.winsA).toBe(0);
  }, 600_000);

  it('the same level against itself is balanced (no side or kickoff bias)', () => {
    const r = playSeries('medium', 'medium', 16, SEED, CAP);
    log('medium vs medium', r);
    const ratio = (r.goalsA + 1) / (r.goalsB + 1);
    expect(ratio).toBeGreaterThan(0.5);
    expect(ratio).toBeLessThan(2);
  }, 300_000);
});

describe('play quality guards', () => {
  it('Médio makes contact, rarely fouls, and own goals do not dominate', () => {
    const r = playSeries('medium', 'medium', 12, SEED + 100, CAP);
    for (const s of [r.a, r.b]) {
      expect(pct(s.touch, s.flicks)).toBeGreaterThanOrEqual(65);
      expect(pct(s.foul, s.flicks)).toBeLessThanOrEqual(20);
    }
    const own = r.a.ownGoals + r.b.ownGoals, called = r.a.goalsCalled + r.b.goalsCalled;
    expect(own).toBeLessThanOrEqual(2 * called + 6);
  }, 300_000);

  it('Difícil rarely fouls and almost never scores own goals', () => {
    const r = playSeries('hard', 'medium', 6, SEED + 200, CAP);
    const h = r.a;
    expect(pct(h.foul, h.flicks)).toBeLessThanOrEqual(15);
    expect(h.ownGoals).toBeLessThanOrEqual(2);
    expect(h.touch).toBeGreaterThan(0);
  }, 600_000);
});
