import { describe, expect, it } from 'vitest';
import {
  LEVELS, LEVEL_ORDER, keeperTarget, pathClear, planBasic, planHeuristic, speedFor, travelFor, type AIView,
} from '../src/ai';
import { BUTTON_R, FIELD, MAX_SPEED } from '../src/config';
import { Lookahead } from '../src/lookahead';
import { Physics } from '../src/physics';

const mid = FIELD.W / 2;
const noRand = () => 0.5; // no noise

function view(over: Partial<AIView> = {}): AIView {
  return {
    me: 1, charge: 0, declared: false, keepers: [mid, mid],
    // team 1 attacks the left goal (x = 0)
    buttons: [
      [{ x: 1.9, y: mid - 1.4 }, { x: 1.9, y: mid + 1.4 }, { x: 3.2, y: mid - 0.8 }, { x: 3.2, y: mid + 0.8 }],
      [{ x: 7.1, y: mid - 1.4 }, { x: 7.1, y: mid + 1.4 }, { x: 5.8, y: mid - 0.8 }, { x: 5.8, y: mid + 0.8 }],
    ],
    ball: { x: FIELD.L / 2, y: mid },
    ...over,
  };
}
const exact = { ...LEVELS.medium, aimNoise: 0, powerNoise: 0 };

describe('level profiles', () => {
  it('get steadily more precise, faster and smarter, but never perfect', () => {
    const [e, m, h] = LEVEL_ORDER.map((l) => LEVELS[l]);
    expect(e.aimNoise).toBeGreaterThan(m.aimNoise);
    expect(m.aimNoise).toBeGreaterThan(h.aimNoise);
    expect(h.aimNoise).toBeGreaterThan(0);
    expect(e.thinkMin).toBeGreaterThan(h.thinkMin);
    expect(e.keeperSpeed).toBeLessThan(h.keeperSpeed);
    expect([e.planner, m.planner, h.planner]).toEqual(['naive', 'heuristic', 'lookahead']);
  });
});

describe('slide model', () => {
  it('speedFor and travelFor are inverses', () => {
    for (const d of [0.5, 1, 2, 2.8]) expect(travelFor(speedFor(d))).toBeCloseTo(d, 6);
  });

  it('matches the real physics: a button slides as far as the model says', () => {
    for (const v of [5, 8, 11, MAX_SPEED]) {
      const p = new Physics();
      for (const t of [0, 1] as const) p.buttons[t].forEach((b, i) => b.setPosition({ x: 50 + i, y: 50 + t * 5 }));
      p.ball.setPosition({ x: 50, y: 40 });
      const b = p.buttons[0][0];
      b.setPosition({ x: 1.0, y: mid });
      p.flick(0, 0, v, 0);
      for (let t = 0; t < 8 && !p.isSettled(); t += 1 / 60) p.step(1 / 60);
      expect(Math.abs(b.getPosition().x - 1.0 - travelFor(v))).toBeLessThan(0.12);
    }
  });
});

describe('medium planner', () => {
  it('flicks towards the ball from the kickoff formation', () => {
    const v = view();
    const p = planHeuristic(v, noRand, exact);
    const b = v.buttons[1][p.idx];
    const toBall = { x: v.ball.x - b.x, y: v.ball.y - b.y };
    const l = Math.hypot(toBall.x, toBall.y);
    expect((p.dx * toBall.x + p.dy * toBall.y) / l).toBeGreaterThan(0.9);
    expect(p.power).toBeGreaterThan(0.3);
    expect(p.power).toBeLessThanOrEqual(1);
  });

  it('pushes the ball towards the goal it attacks', () => {
    expect(planHeuristic(view({ ball: { x: 5.2, y: mid } }), noRand, exact).dx).toBeLessThan(0);
  });

  it('calls the shot when lined up close to goal, and not from midfield', () => {
    const v = view({
      ball: { x: 2.8, y: mid + 0.2 },
      buttons: [
        [{ x: 0.9, y: 1 }, { x: 0.9, y: 4.4 }, { x: 1.5, y: 0.9 }, { x: 1.5, y: 4.6 }],
        [{ x: 4.2, y: mid + 0.2 }, { x: 7.1, y: 1 }, { x: 7.1, y: 4.4 }, { x: 6.4, y: 2.7 }],
      ],
    });
    const p = planHeuristic(v, noRand, exact);
    expect(p.idx).toBe(0);
    expect(p.declare).toBe(true);
    expect(p.power).toBe(1);
    expect(planHeuristic(view(), noRand, exact).declare).toBe(false);
  });

  it('chooses a path that avoids opponents (no foul) and the keeper boxes', () => {
    const v = view({ ball: { x: 4.5, y: mid } });
    v.buttons[0][2] = { x: 5.0, y: mid - 0.8 }; // an opponent right in front of the obvious attacker
    const p = planHeuristic(v, noRand, exact);
    const b = v.buttons[1][p.idx];
    const reach = Math.hypot(v.ball.x - b.x, v.ball.y - b.y) - (BUTTON_R + 0.115);
    const end = { x: b.x + p.dx * reach, y: b.y + p.dy * reach };
    expect(pathClear(v, b, end, p.idx)).toBe(true);
  });

  it('treats a keeper box as an obstacle', () => {
    const v = view();
    v.buttons = [v.buttons[0].map(() => ({ x: 5, y: 0.4 })), v.buttons[1].map(() => ({ x: 6, y: 5 }))]; // clear the table
    // a straight path into the middle of team 0's keeper box is not clear
    expect(pathClear(v, { x: 2, y: mid }, { x: 0.5, y: mid }, 99)).toBe(false);
    expect(pathClear(v, { x: 2, y: mid - 1.6 }, { x: 0.9, y: mid - 1.6 }, 99)).toBe(true);
  });
});

describe('easy planner', () => {
  it('aims roughly at the ball even if the way is blocked', () => {
    const v = view();
    for (let i = 0; i < 20; i++) {
      const p = planBasic(v, 'easy', Math.random);
      const b = v.buttons[1][p.idx];
      const ang = Math.atan2(v.ball.y - b.y, v.ball.x - b.x);
      let diff = Math.abs(Math.atan2(p.dy, p.dx) - ang); diff = Math.min(diff, 2 * Math.PI - diff);
      expect(diff).toBeLessThanOrEqual(LEVELS.easy.aimNoise + 1e-9);
    }
  });
});

describe('cpu keeper', () => {
  const rnd = noRand;
  it('easy and medium follow the ball; the error is bounded by the level', () => {
    const v = view({ me: 0, ball: { x: 2, y: mid + 0.4 } });
    expect(Math.abs(keeperTarget(v, 'medium', rnd) - (mid + 0.4))).toBeLessThanOrEqual(LEVELS.medium.keeperNoise + 1e-9);
    expect(Math.abs(keeperTarget(v, 'easy', () => 1) - (mid + 0.4))).toBeLessThanOrEqual(LEVELS.easy.keeperNoise + 1e-9);
  });

  it('hard anticipates the shot line from the attacker through the ball', () => {
    // attacker (team 1) is up and to the right of the ball: the line carries the ball down towards larger y
    const v = view({ me: 0, ball: { x: 2.0, y: 2.0 } });
    v.buttons[1][0] = { x: 3.5, y: 1.0 };
    const y = keeperTarget(v, 'hard', rnd);
    expect(y).toBeGreaterThan(2.3);
    expect(y).toBeLessThanOrEqual(mid + 0.52);
  });
});

describe('hard lookahead', () => {
  function setup(attackerFirst = true) {
    const p = new Physics();
    p.ball.setPosition({ x: 7.7, y: 2.0 });
    p.buttons[0][3].setPosition({ x: 6.5, y: 2.0 });
    p.setKeeperY(1, 2.7);
    void attackerFirst;
    const v: AIView = {
      me: 0, charge: 0, declared: false, keepers: [p.keeperY(0), p.keeperY(1)],
      ball: p.ballPos(),
      buttons: p.buttons.map((tm) => tm.map((b) => ({ x: b.getPosition().x, y: b.getPosition().y }))),
    };
    return { p, v };
  }

  it('finds the scoring shot and calls it when it beats most keeper positions', () => {
    const { p, v } = setup();
    const s = new Lookahead(v, p.snapshot(), () => 0.5);
    s.runAll();
    const best = s.best()!;
    expect(best).not.toBeNull();
    expect(best.idx).toBe(3);
    expect(best.declare).toBe(true);
    expect(best.dx).toBeGreaterThan(0.9); // straight at the goal
  });

  it('does not change the real table while thinking', () => {
    const { p, v } = setup();
    const before = JSON.stringify(p.snapshot());
    new Lookahead(v, p.snapshot(), () => 0.5).runAll();
    expect(JSON.stringify(p.snapshot())).toBe(before);
  });

  it('is time-sliced: a tiny budget does a little work and can be resumed', () => {
    const { p, v } = setup();
    const s = new Lookahead(v, p.snapshot(), () => 0.5);
    s.step(0.01);
    expect(s.done).toBe(false);
    s.runAll();
    expect(s.done).toBe(true);
  });
});
