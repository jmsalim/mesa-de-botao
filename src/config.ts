export type Team = 0 | 1;

/** Field geometry in "table units" (landscape: team 0 defends the left goal). */
export const FIELD = {
  L: 9,
  W: 5.4,
  goalW: 1.9,
  goalD: 0.7,
  frame: 0.5,
};

export const BUTTON_R = 0.28;
export const BALL_R = 0.115;
export const KEEPER_SIZE = { w: 0.85, d: 0.3 };
/** Keeper box centre sits just in front of the goal line. */
export const KEEPER_X = 0.36;
export const KEEPER_RANGE = (FIELD.goalW - KEEPER_SIZE.w) / 2 - 0.02;

export const MAX_PULL = 2.0;
export const MIN_PULL = 0.2;
export const MAX_SPEED = 13;
export const MAX_BALL_SPEED = 16;
/** Button sliding friction (matches physics linearDamping), used for aim preview. */
export const BUTTON_DAMPING = 4.4;
/** Ball touches needed to charge a super flick. */
export const CHARGE_MAX = 3;
export const SUPER_SPEED_MUL = 1.3;
export const SUPER_DENSITY = 4;

export const WIN_SCORE = 3;
export const FLICKS_PER_TURN = 3;
export const KEEPER_PAUSE_S = 6;

export const other = (t: Team): Team => (t === 0 ? 1 : 0);

/** Ball closer than this to a wall (outside the goal mouth) can be repositioned. */
export const STUCK_MARGIN = 0.4;
/** Playable zone the ball is moved back into (distance from side / end walls). */
export const PLAY_MARGIN = { x: 1.1, y: 1.0 };

/** Measured: a button flicked at speed v slides about SLIDE_K * v - SLIDE_C before stopping. */
export const SLIDE_K = 0.227;
export const SLIDE_C = 0.07;

/** A ball this close to a team's own end wall can't be cleared by that team. */
export const OWN_GOAL_TRAP = 0.8;
