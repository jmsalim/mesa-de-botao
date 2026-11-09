import { describe, expect, it } from 'vitest';
import { planShot, type AIView } from '../src/ai';
import { BUTTON_R, FIELD } from '../src/config';

const mid = FIELD.W / 2;
const noRand = () => 0.5; // no noise

function view(over: Partial<AIView> = {}): AIView {
  return {
    me: 1,
    // team 1 attacks the left goal (x = 0)
    buttons: [
      [{ x: 1.9, y: mid - 1.4 }, { x: 1.9, y: mid + 1.4 }, { x: 3.2, y: mid - 0.8 }, { x: 3.2, y: mid + 0.8 }],
      [{ x: 7.1, y: mid - 1.4 }, { x: 7.1, y: mid + 1.4 }, { x: 5.8, y: mid - 0.8 }, { x: 5.8, y: mid + 0.8 }],
    ],
    ball: { x: FIELD.L / 2, y: mid },
    keeper: { x: 0.36, y: mid },
    ...over,
  };
}

describe('CPU planning', () => {
  it('flicks towards the ball from the kickoff formation', () => {
    const v = view();
    const p = planShot(v, noRand, 0);
    const b = v.buttons[1][p.idx];
    const toBall = { x: v.ball.x - b.x, y: v.ball.y - b.y };
    const l = Math.hypot(toBall.x, toBall.y);
    expect((p.dx * toBall.x + p.dy * toBall.y) / l).toBeGreaterThan(0.9);
    expect(p.power).toBeGreaterThan(0.3);
    expect(p.power).toBeLessThanOrEqual(1);
  });

  it('pushes the ball towards the goal it attacks', () => {
    const v = view({ ball: { x: 5.2, y: mid } });
    const p = planShot(v, noRand, 0);
    expect(p.dx).toBeLessThan(0); // team 1 attacks x = 0
  });

  it('calls the shot when lined up close to goal', () => {
    const v = view({
      ball: { x: 2.8, y: mid + 0.2 },
      buttons: [
        [{ x: 0.9, y: 1 }, { x: 0.9, y: 4.4 }, { x: 1.5, y: 0.9 }, { x: 1.5, y: 4.6 }],
        [{ x: 4.2, y: mid + 0.2 }, { x: 7.1, y: 1 }, { x: 7.1, y: 4.4 }, { x: 6.4, y: 2.7 }],
      ],
    });
    const p = planShot(v, noRand, 0);
    expect(p.idx).toBe(0);
    expect(p.declare).toBe(true);
    expect(p.power).toBe(1);
  });

  it('does not call the shot from midfield', () => {
    expect(planShot(view(), noRand, 0).declare).toBe(false);
  });

  it('avoids a path that would clip an opponent button first (foul)', () => {
    const v = view({ ball: { x: 4.5, y: mid } });
    // park an opponent button right in front of the otherwise-best attacker
    v.buttons[0][2] = { x: 5.0, y: mid - 0.8 };
    const p = planShot(v, noRand, 0);
    const b = v.buttons[1][p.idx];
    for (const o of v.buttons[0]) {
      // distance from opponent to the flick ray, only for ahead-of-button opponents
      const ox = o.x - b.x, oy = o.y - b.y;
      const along = ox * p.dx + oy * p.dy;
      const off = Math.abs(ox * p.dy - oy * p.dx);
      const hitsBall = Math.hypot(v.ball.x - b.x, v.ball.y - b.y);
      if (along > 0 && along < hitsBall) expect(off).toBeGreaterThan(BUTTON_R * 2 * 0.95);
    }
  });
});
