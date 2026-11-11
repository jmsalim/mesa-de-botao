import { describe, expect, it } from 'vitest';
import { Physics } from '../src/physics';
import { BALL_R, BUTTON_R, FIELD, MAX_SPEED } from '../src/config';

function run(p: Physics, seconds: number) {
  for (let t = 0; t < seconds; t += 1 / 60) p.step(1 / 60);
}

describe('physics', () => {
  it('a full-power flick slides a sensible distance and stops', () => {
    const p = new Physics();
    const b = p.buttons[0][2];
    const x0 = b.getPosition().x;
    p.flick(0, 2, 0, -MAX_SPEED); // straight up (towards wall), measure travel
    run(p, 6);
    const y = b.getPosition().y;
    console.log('button travel y:', FIELD.W / 2 - 0.8, '->', y);
    expect(p.isSettled()).toBe(true);
    expect(b.getPosition().x).toBeCloseTo(x0, 1);
  });

  it('button hitting the ball sends it a good way without tunnelling', () => {
    const p = new Physics();
    p.ball.setPosition({ x: 5, y: 2.7 });
    const b = p.buttons[0][3];
    b.setPosition({ x: 3.5, y: 2.7 });
    p.flick(0, 3, MAX_SPEED, 0);
    run(p, 0.6);
    const bp = p.ballPos();
    console.log('ball after 0.6s', bp, 'speed', p.ball.getLinearVelocity().length());
    run(p, 8);
    console.log('ball rest', p.ballPos(), 'goal?', p.ballInGoal());
    expect(p.ballPos().x).toBeGreaterThan(5);
  });

  it('ball rolling into an open goal is detected', () => {
    const p = new Physics();
    p.ball.setPosition({ x: 2, y: 2.1 });
    p.ball.setLinearVelocity({ x: -9, y: 0 });
    // keeper is centred, so aim past it: move keeper aside
    p.setKeeperY(0, FIELD.W / 2 + 10);
    let goal: number | null = null;
    for (let i = 0; i < 300 && goal === null; i++) { p.step(1 / 60); goal = p.ballInGoal(); }
    expect(goal).toBe(0);
  });

  it('keeper blocks a centred shot', () => {
    const p = new Physics();
    p.ball.setPosition({ x: 2, y: 2.7 });
    p.ball.setLinearVelocity({ x: -9, y: 0 });
    let goal: number | null = null;
    for (let i = 0; i < 300 && goal === null; i++) { p.step(1 / 60); goal = p.ballInGoal(); }
    expect(goal).toBeNull();
  });

  it('buttons cannot enter the goal', () => {
    const p = new Physics();
    const b = p.buttons[0][2];
    b.setPosition({ x: 1.2, y: 2.7 });
    p.setKeeperY(0, 100);
    p.flick(0, 2, -MAX_SPEED, 0);
    run(p, 3);
    expect(b.getPosition().x).toBeGreaterThan(0);
  });

  it('detects a ball hugging a wall, but not one in the open or in front of a goal mouth', () => {
    const p = new Physics();
    p.ball.setPosition({ x: 4.5, y: 2.7 });
    expect(p.ballStuck()).toBe(false);
    p.ball.setPosition({ x: 4.5, y: 0.3 });
    expect(p.ballStuck()).toBe(true);
    p.ball.setPosition({ x: 0.4, y: 2.7 }); // in front of the goal mouth
    expect(p.ballStuck()).toBe(false);
    p.ball.setPosition({ x: 0.3, y: 0.4 });
    expect(p.ballStuck()).toBe(true);
    expect(p.ballInCorner()).toBe(true);
  });

  it('a ball against a team\'s own goal line is stuck for that team only', () => {
    const p = new Physics();
    p.ball.setPosition({ x: 0.5, y: 2.7 });
    expect(p.ballStuck(0)).toBe(true); // team 0 defends the left goal and can't clear it
    expect(p.ballStuck(1)).toBe(false); // team 1 attacks it: leave the chance alone
    expect(p.ballTrapped(0)).toBe(true);
    p.ball.setPosition({ x: 0.5, y: 4.4 }); // beside the mouth, still against its own end wall
    expect(p.ballStuck(0)).toBe(true);
    p.ball.setPosition({ x: 8.5, y: 2.7 });
    expect(p.ballStuck(1)).toBe(true);
    expect(p.ballStuck(0)).toBe(false);
  });

  it('repositionBall moves a stuck ball to a free, playable spot', () => {
    const p = new Physics();
    p.ball.setPosition({ x: 0.25, y: 0.25 });
    const { to } = p.repositionBall();
    expect(to.x).toBeGreaterThanOrEqual(1.1 - 1e-6);
    expect(to.y).toBeGreaterThanOrEqual(1.0 - 1e-6);
    expect(p.ballStuck()).toBe(false);
    for (const b of p.allButtons()) {
      expect(Math.hypot(b.getPosition().x - to.x, b.getPosition().y - to.y)).toBeGreaterThan(BUTTON_R + BALL_R);
    }
  });

  it('a scored ball settles inside the net and does not come back out', () => {
    const p = new Physics();
    p.setKeeperY(0, 100);
    p.ball.setPosition({ x: 2, y: 2.1 });
    p.ball.setLinearVelocity({ x: -14, y: 0 });
    let goal: number | null = null;
    for (let i = 0; i < 120 && goal === null; i++) { p.step(1 / 60); goal = p.ballInGoal(); }
    expect(goal).toBe(0);
    p.freezeButtons();
    run(p, 3);
    const x = p.ballPos().x;
    expect(x).toBeLessThan(0);
    expect(x).toBeGreaterThan(-FIELD.goalD);
  });
});
