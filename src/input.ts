import { BUTTON_R, KEEPER_SIZE, MAX_PULL, MAX_SPEED, MIN_PULL, type Team } from './config';
import { screenToWorld, type Layout } from './layout';
import type { Drag } from './render';

export interface Controller {
  layout(): Layout;
  /** Button of the team to play under the pointer (aim phase only). */
  pickButton(x: number, y: number): { team: Team; idx: number } | null;
  /** Defender's keeper under the pointer (keeper phase only). */
  pickKeeper(x: number, y: number): Team | null;
  buttonPos(team: Team, idx: number): { x: number; y: number };
  flick(team: Team, idx: number, vx: number, vy: number): void;
  moveKeeper(team: Team, y: number): void;
}

/** Pointer handling: drag back on a button to aim, release to flick. */
export class Input {
  drag: Drag | null = null;
  private pointerId: number | null = null;

  constructor(private canvas: HTMLCanvasElement, private ctl: Controller) {
    canvas.addEventListener('pointerdown', this.down);
    canvas.addEventListener('pointermove', this.move);
    canvas.addEventListener('pointerup', this.up);
    canvas.addEventListener('pointercancel', this.cancel);
  }

  private world(e: PointerEvent): { x: number; y: number } {
    const r = this.canvas.getBoundingClientRect();
    return screenToWorld(this.ctl.layout(), e.clientX - r.left, e.clientY - r.top);
  }

  private down = (e: PointerEvent): void => {
    if (this.pointerId !== null) return;
    const w = this.world(e);
    const kt = this.ctl.pickKeeper(w.x, w.y);
    const hit = kt === null ? this.ctl.pickButton(w.x, w.y) : null;
    if (kt !== null) this.drag = { kind: 'keeper', team: kt, idx: 0, px: w.x, py: w.y };
    else if (hit) this.drag = { kind: 'aim', team: hit.team, idx: hit.idx, px: w.x, py: w.y };
    else return;
    this.pointerId = e.pointerId;
    this.canvas.setPointerCapture(e.pointerId);
    if (this.drag.kind === 'keeper') this.ctl.moveKeeper(this.drag.team, w.y);
    e.preventDefault();
  };

  private move = (e: PointerEvent): void => {
    if (e.pointerId !== this.pointerId || !this.drag) return;
    const w = this.world(e);
    this.drag.px = w.x; this.drag.py = w.y;
    if (this.drag.kind === 'keeper') this.ctl.moveKeeper(this.drag.team, w.y);
  };

  private up = (e: PointerEvent): void => {
    if (e.pointerId !== this.pointerId || !this.drag) return;
    const d = this.drag;
    this.cancel(e);
    if (d.kind !== 'aim') return;
    const b = this.ctl.buttonPos(d.team, d.idx);
    const dx = b.x - d.px, dy = b.y - d.py;
    const len = Math.hypot(dx, dy);
    if (len < MIN_PULL) return; // tiny drag: treated as a cancelled aim
    const power = Math.min(len, MAX_PULL) / MAX_PULL;
    this.ctl.flick(d.team, d.idx, (dx / len) * power * MAX_SPEED, (dy / len) * power * MAX_SPEED);
  };

  private cancel = (e: PointerEvent): void => {
    if (e.pointerId !== this.pointerId) return;
    this.pointerId = null;
    this.drag = null;
    try { this.canvas.releasePointerCapture(e.pointerId); } catch { /* already released */ }
  };

  /** Abort any drag in progress (e.g. when the phase changes under the finger). */
  abort(): void {
    this.drag = null;
    this.pointerId = null;
  }
}

export const PICK_RADIUS = BUTTON_R + 0.36;
export const KEEPER_PICK = { x: KEEPER_SIZE.d / 2 + 0.45, y: KEEPER_SIZE.w / 2 + 0.3 };
