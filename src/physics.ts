import * as planck from 'planck';
import {
  BALL_R, BUTTON_R, FIELD, KEEPER_RANGE, KEEPER_SIZE, KEEPER_X, MAX_BALL_SPEED, other, type Team,
} from './config';
import type { ContactInfo } from './rules';

const { Vec2 } = planck;

const CAT = { BUTTON: 1, BALL: 2, WALL: 4, BARRIER: 8, KEEPER: 16 };
const STEP = 1 / 120;

export const BUTTONS_PER_TEAM = 4;

/** Formation for team 0 in landscape coordinates; team 1 is mirrored. */
const FORMATION: [number, number][] = [
  [1.9, FIELD.W / 2 - 1.4],
  [1.9, FIELD.W / 2 + 1.4],
  [3.2, FIELD.W / 2 - 0.8],
  [3.2, FIELD.W / 2 + 0.8],
];

export class Physics {
  world = new planck.World({ gravity: Vec2(0, 0) });
  buttons: planck.Body[][] = [[], []];
  keepers: planck.Body[] = [];
  ball!: planck.Body;
  onContact: (a: ContactInfo, b: ContactInfo) => void = () => {};
  private acc = 0;
  /** Seconds all bodies have been (almost) still. */
  stillFor = 0;

  constructor() {
    this.buildWalls();
    for (const team of [0, 1] as Team[]) {
      for (let i = 0; i < BUTTONS_PER_TEAM; i++) this.buttons[team].push(this.makeButton(team, i));
      this.keepers.push(this.makeKeeper(team));
    }
    this.ball = this.makeBall();
    this.world.on('begin-contact', (c) => {
      const a = c.getFixtureA().getBody().getUserData() as ContactInfo | null;
      const b = c.getFixtureB().getBody().getUserData() as ContactInfo | null;
      if (a && b) this.onContact(a, b);
    });
    this.resetKickoff();
  }

  private buildWalls(): void {
    const { L, W, goalW, goalD } = FIELD;
    const t = 0.5; // wall half-thickness
    const body = this.world.createBody({ type: 'static', position: Vec2(0, 0) });
    const opt = { friction: 0, restitution: 0.65, filterCategoryBits: CAT.WALL };
    const box = (hx: number, hy: number, cx: number, cy: number) =>
      body.createFixture(planck.Box(hx, hy, Vec2(cx, cy), 0), opt);
    const midX = L / 2;
    // top and bottom rails (span the goal pockets as well)
    box(midX + goalD + t, t, midX, -t);
    box(midX + goalD + t, t, midX, W + t);
    // pocket back walls
    box(t, W / 2 + t, -goalD - t, W / 2);
    box(t, W / 2 + t, L + goalD + t, W / 2);
    // end walls with the goal mouth left open
    const seg = (W - goalW) / 2;
    for (const x of [0, L]) {
      box(0.04, seg / 2, x, seg / 2);
      box(0.04, seg / 2, x, W - seg / 2);
    }
    // invisible barriers: stop *buttons* (not the ball) from entering the goals
    const barrier = this.world.createBody({ type: 'static' });
    const bOpt = { friction: 0, restitution: 0.2, filterCategoryBits: CAT.BARRIER, filterMaskBits: CAT.BUTTON };
    for (const x of [-0.03, L + 0.03]) {
      barrier.createFixture(planck.Box(0.05, goalW / 2, Vec2(x, W / 2), 0), bOpt);
    }
  }

  private makeButton(team: Team, idx: number): planck.Body {
    const b = this.world.createBody({
      type: 'dynamic', bullet: true, linearDamping: 4.2, fixedRotation: true,
      userData: { kind: 'button', team, idx } satisfies ContactInfo,
    });
    b.createFixture(planck.Circle(BUTTON_R), {
      density: 1, friction: 0, restitution: 0.55,
      filterCategoryBits: CAT.BUTTON,
      filterMaskBits: CAT.BUTTON | CAT.BALL | CAT.WALL | CAT.BARRIER | CAT.KEEPER,
    });
    return b;
  }

  private makeKeeper(team: Team): planck.Body {
    const x = team === 0 ? KEEPER_X : FIELD.L - KEEPER_X;
    const b = this.world.createBody({
      type: 'kinematic', position: Vec2(x, FIELD.W / 2),
      userData: { kind: 'keeper', team } satisfies ContactInfo,
    });
    b.createFixture(planck.Box(KEEPER_SIZE.d / 2, KEEPER_SIZE.w / 2), {
      friction: 0, restitution: 0.5,
      filterCategoryBits: CAT.KEEPER, filterMaskBits: CAT.BUTTON | CAT.BALL,
    });
    return b;
  }

  private makeBall(): planck.Body {
    const b = this.world.createBody({
      type: 'dynamic', bullet: true, linearDamping: 1.5, fixedRotation: true,
      userData: { kind: 'ball' } satisfies ContactInfo,
    });
    b.createFixture(planck.Circle(BALL_R), {
      density: 0.9, friction: 0, restitution: 0.75,
      filterCategoryBits: CAT.BALL,
      filterMaskBits: CAT.BUTTON | CAT.WALL | CAT.KEEPER,
    });
    return b;
  }

  private stop(b: planck.Body, x: number, y: number): void {
    b.setPosition(Vec2(x, y));
    b.setLinearVelocity(Vec2(0, 0));
    b.setAwake(true);
  }

  /** Put every piece back on the kickoff formation. */
  resetKickoff(): void {
    for (const team of [0, 1] as Team[]) {
      FORMATION.forEach(([x, y], i) => {
        this.stop(this.buttons[team][i], team === 0 ? x : FIELD.L - x, y);
      });
      this.setKeeperY(team, FIELD.W / 2);
    }
    this.stop(this.ball, FIELD.L / 2, FIELD.W / 2);
    this.stillFor = 0;
  }

  /** Ball goes in front of `defender`'s goal (free spot), formation stays. */
  resetGoalKick(defender: Team): void {
    const dir = defender === 0 ? 1 : -1;
    const gx = defender === 0 ? 0 : FIELD.L;
    const clear = (x: number, y: number) =>
      this.allButtons().every((b) => Vec2.distance(b.getPosition(), Vec2(x, y)) > BUTTON_R + BALL_R + 0.1);
    for (const dx of [1.3, 1.9, 2.5, 3.1]) {
      for (const dy of [0, 0.7, -0.7, 1.4, -1.4]) {
        const x = gx + dir * dx, y = FIELD.W / 2 + dy;
        if (clear(x, y)) { this.stop(this.ball, x, y); this.stillFor = 0; return; }
      }
    }
    this.stop(this.ball, FIELD.L / 2, FIELD.W / 2);
    this.stillFor = 0;
  }

  allButtons(): planck.Body[] {
    return [...this.buttons[0], ...this.buttons[1]];
  }

  setKeeperY(team: Team, y: number): void {
    const c = FIELD.W / 2;
    const clamped = Math.max(c - KEEPER_RANGE, Math.min(c + KEEPER_RANGE, y));
    const k = this.keepers[team];
    k.setPosition(Vec2(k.getPosition().x, clamped));
  }

  keeperY(team: Team): number {
    return this.keepers[team].getPosition().y;
  }

  flick(team: Team, idx: number, vx: number, vy: number): void {
    const b = this.buttons[team][idx];
    b.setLinearVelocity(Vec2(vx, vy));
    b.setAwake(true);
    this.stillFor = 0;
  }

  step(dt: number): void {
    this.acc += dt;
    while (this.acc >= STEP) {
      this.acc -= STEP;
      this.world.step(STEP, 8, 3);
      this.postStep();
    }
  }

  private postStep(): void {
    // extra sliding friction at low speed so pieces come to rest crisply
    const bodies = [...this.allButtons(), this.ball];
    let moving = false;
    for (const b of bodies) {
      const v = b.getLinearVelocity();
      const sp = v.length();
      if (b === this.ball && sp > MAX_BALL_SPEED) b.setLinearVelocity(v.mul(MAX_BALL_SPEED / sp));
      else if (sp < 0.5) b.setLinearVelocity(v.mul(0.95));
      if (sp < 0.06) b.setLinearVelocity(Vec2(0, 0));
      else moving = true;
    }
    this.stillFor = moving ? 0 : this.stillFor + STEP;
  }

  isSettled(): boolean {
    return this.stillFor > 0.2;
  }

  /** Stop everything (safety net if something keeps jittering). */
  freeze(): void {
    for (const b of [...this.allButtons(), this.ball]) b.setLinearVelocity(Vec2(0, 0));
  }

  /** Team whose goal the ball has fully crossed into, if any. */
  ballInGoal(): Team | null {
    const p = this.ball.getPosition();
    if (Math.abs(p.y - FIELD.W / 2) > FIELD.goalW / 2) return null;
    if (p.x < -BALL_R) return 0;
    if (p.x > FIELD.L + BALL_R) return 1;
    return null;
  }

  ballPos(): { x: number; y: number } {
    const p = this.ball.getPosition();
    return { x: p.x, y: p.y };
  }
}

export { other };
