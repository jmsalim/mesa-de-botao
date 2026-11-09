import * as planck from 'planck';
import {
  BALL_R, BUTTON_R, FIELD, KEEPER_RANGE, KEEPER_SIZE, KEEPER_X, MAX_BALL_SPEED, BUTTON_DAMPING, PLAY_MARGIN, STUCK_MARGIN, SUPER_DENSITY, other, type Team,
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
  /** Fired for every new contact with the closing speed and contact point (for sound and effects). */
  onImpact: (a: ContactInfo, b: ContactInfo, speed: number, x: number, y: number) => void = () => {};
  private superBody: planck.Body | null = null;
  private barriers: planck.Fixture[] = [];
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
      if (!a || !b) return;
      const bA = c.getFixtureA().getBody(), bB = c.getFixtureB().getBody();
      const speed = Vec2.sub(bA.getLinearVelocity(), bB.getLinearVelocity()).length();
      const wm = c.getWorldManifold(null);
      const pt = wm && wm.points[0] ? wm.points[0] : bA.getPosition();
      this.onContact(a, b);
      this.onImpact(a, b, speed, pt.x, pt.y);
    });
    this.resetKickoff();
  }

  private buildWalls(): void {
    const { L, W, goalW, goalD } = FIELD;
    const t = 0.5; // wall half-thickness
    const body = this.world.createBody({ type: 'static', position: Vec2(0, 0), userData: { kind: 'wall' } satisfies ContactInfo });
    const opt = { friction: 0, restitution: 0.65, filterCategoryBits: CAT.WALL };
    const box = (hx: number, hy: number, cx: number, cy: number) =>
      body.createFixture(planck.Box(hx, hy, Vec2(cx, cy), 0), opt);
    const midX = L / 2;
    // top and bottom rails (span the goal pockets as well)
    box(midX + goalD + t, t, midX, -t);
    box(midX + goalD + t, t, midX, W + t);
    // pocket back walls: the net, so it absorbs the ball instead of bouncing it
    const netOpt = { friction: 0, restitution: 0.08, filterCategoryBits: CAT.WALL };
    for (const cx of [-goalD - t, L + goalD + t]) body.createFixture(planck.Box(t, W / 2 + t, Vec2(cx, W / 2), 0), netOpt);
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
      this.barriers.push(barrier.createFixture(planck.Box(0.05, goalW / 2, Vec2(x, W / 2), 0), bOpt));
    }
  }

  private makeButton(team: Team, idx: number): planck.Body {
    const b = this.world.createBody({
      type: 'dynamic', bullet: true, linearDamping: BUTTON_DAMPING, fixedRotation: true,
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
    this.closeGoals(false);
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

  flick(team: Team, idx: number, vx: number, vy: number, sup = false): void {
    const b = this.buttons[team][idx];
    if (sup) {
      // a super flick is a heavy button: it carries far more momentum into the ball
      b.getFixtureList()!.setDensity(SUPER_DENSITY);
      b.resetMassData();
      this.superBody = b;
    }
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
      if (b === this.ball && (b.getPosition().x < 0 || b.getPosition().x > FIELD.L)) b.setLinearVelocity(v.mul(0.9)); // in the net
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

  /** After a goal the net also holds the ball in; reopened for kickoff. */
  closeGoals(closed: boolean): void {
    for (const f of this.barriers) {
      f.setFilterData({ groupIndex: 0, categoryBits: CAT.BARRIER, maskBits: closed ? CAT.BUTTON | CAT.BALL : CAT.BUTTON });
    }
  }

  /** Freeze the buttons only: the ball keeps rolling into the net. */
  freezeButtons(): void {
    for (const b of this.allButtons()) b.setLinearVelocity(Vec2(0, 0));
    this.endSuper();
  }

  /** Ball hugging a wall (not in front of a goal mouth) where it is hard to play. */
  ballStuck(): boolean {
    const p = this.ball.getPosition();
    const { L, W, goalW } = FIELD;
    const nearSide = p.y < STUCK_MARGIN || p.y > W - STUCK_MARGIN;
    const inMouth = Math.abs(p.y - W / 2) < goalW / 2 + 0.05;
    const nearEnd = (p.x < STUCK_MARGIN || p.x > L - STUCK_MARGIN) && !inMouth;
    return nearSide || nearEnd;
  }

  /** Ball jammed in a corner where no flick can free it. */
  ballInCorner(): boolean {
    const p = this.ball.getPosition();
    const { L, W } = FIELD;
    const side = p.y < 0.55 || p.y > W - 0.55;
    const end = p.x < 0.7 || p.x > L - 0.7;
    return side && end;
  }

  /** Put the ball on the nearest free spot of the playable zone. Returns old and new position. */
  repositionBall(): { from: { x: number; y: number }; to: { x: number; y: number } } {
    const { L, W } = FIELD;
    const cur = this.ball.getPosition();
    const from = { x: cur.x, y: cur.y };
    const clampX = (x: number) => Math.max(PLAY_MARGIN.x, Math.min(L - PLAY_MARGIN.x, x));
    const clampY = (y: number) => Math.max(PLAY_MARGIN.y, Math.min(W - PLAY_MARGIN.y, y));
    const free = (x: number, y: number) =>
      this.allButtons().every((b) => Vec2.distance(b.getPosition(), Vec2(x, y)) > BUTTON_R + BALL_R + 0.2);
    for (const r of [0, 0.4, 0.8, 1.2, 1.6, 2.0]) {
      for (let i = 0; i < (r === 0 ? 1 : 12); i++) {
        const a = (i / 12) * Math.PI * 2;
        const x = clampX(from.x + Math.cos(a) * r), y = clampY(from.y + Math.sin(a) * r);
        if (free(x, y)) { this.stop(this.ball, x, y); this.stillFor = 0; return { from, to: { x, y } }; }
      }
    }
    this.stop(this.ball, L / 2, W / 2);
    this.stillFor = 0;
    return { from, to: { x: L / 2, y: W / 2 } };
  }

  /** Back to normal weight after a super flick. */
  endSuper(): void {
    if (!this.superBody) return;
    this.superBody.getFixtureList()!.setDensity(1);
    this.superBody.resetMassData();
    this.superBody = null;
  }

  /** Stop everything (safety net if something keeps jittering). */
  freeze(): void {
    for (const b of [...this.allButtons(), this.ball]) b.setLinearVelocity(Vec2(0, 0));
    this.endSuper();
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
