import { CHARGE_MAX, FLICKS_PER_TURN, WIN_SCORE, other, type Team } from './config';

export type Phase = 'aim' | 'keeper' | 'moving' | 'goal' | 'over';
export type ResetKind = 'none' | 'kickoff' | 'goalkick';
export type NoticeKey = 'goal' | 'ownGoal' | 'noGoal' | 'foul' | 'again' | 'miss' | 'limit' | 'superReady';

export interface Notice {
  key: NoticeKey;
  /** Team the message is about (scorer, or the team now to play). */
  team: Team;
}

export type ContactInfo =
  | { kind: 'button'; team: Team; idx: number }
  | { kind: 'keeper'; team: Team }
  | { kind: 'wall' }
  | { kind: 'ball' };

export interface GameState {
  phase: Phase;
  turn: Team;
  score: [number, number];
  flicksLeft: number;
  /** Attacker has called the shot ("Chutar ao gol") for the current flick. */
  declared: boolean;
  ballTouched: boolean;
  foul: boolean;
  /** Ball touches banked per team; at CHARGE_MAX the next flick is a super flick. */
  charge: [number, number];
  /** The flick currently in motion is a super flick. */
  superActive: boolean;
  winner: Team | null;
  reset: ResetKind;
  /** Team whose goal the ball is reset in front of on a goal kick. */
  resetDefender: Team;
  notice: Notice | null;
}

export function newGame(first: Team = 0): GameState {
  return {
    phase: 'aim',
    turn: first,
    score: [0, 0],
    flicksLeft: FLICKS_PER_TURN,
    declared: false,
    ballTouched: false,
    foul: false,
    charge: [0, 0],
    superActive: false,
    winner: null,
    reset: 'kickoff',
    resetDefender: first,
    notice: null,
  };
}

/** Attacker calls the shot: defender gets the keeper pause. */
export function declareShot(s: GameState): boolean {
  if (s.phase !== 'aim' || s.declared) return false;
  s.phase = 'keeper';
  return true;
}

/** Defender is done placing the keeper. */
export function confirmKeeper(s: GameState): boolean {
  if (s.phase !== 'keeper') return false;
  s.phase = 'aim';
  s.declared = true;
  return true;
}

export function startFlick(s: GameState): boolean {
  if (s.phase !== 'aim') return false;
  s.phase = 'moving';
  s.flicksLeft -= 1;
  s.superActive = s.charge[s.turn] >= CHARGE_MAX;
  if (s.superActive) s.charge[s.turn] = 0;
  s.ballTouched = false;
  s.foul = false;
  s.notice = null;
  return true;
}

/** Physics reports a new contact while the buttons are moving. */
export function contact(s: GameState, a: ContactInfo, b: ContactInfo): void {
  if (s.phase !== 'moving') return;
  const hasBall = a.kind === 'ball' || b.kind === 'ball';
  if (hasBall) {
    const o = a.kind === 'ball' ? b : a;
    if (o.kind === 'button') s.ballTouched = true;
    return;
  }
  if (a.kind === 'button' && b.kind === 'button' && a.team !== b.team) {
    // A button touched an opponent's button before anyone touched the ball.
    if (!s.ballTouched) s.foul = true;
  }
}

function passTurn(s: GameState, key: NoticeKey): void {
  s.turn = other(s.turn);
  s.flicksLeft = FLICKS_PER_TURN;
  s.notice = { key, team: s.turn };
}

/** The ball fully crossed the line of `defender`'s goal. */
export function goalReached(s: GameState, defender: Team): void {
  if (s.phase !== 'moving') return;
  s.superActive = false;
  const attacker = other(defender);
  const own = defender === s.turn;
  const valid = own || (s.declared && !s.foul);
  if (valid) {
    s.score[attacker] += 1;
    s.notice = { key: own ? 'ownGoal' : 'goal', team: attacker };
    s.declared = false;
    s.reset = 'kickoff';
    s.turn = defender;
    s.flicksLeft = FLICKS_PER_TURN;
    if (s.score[attacker] >= WIN_SCORE) {
      s.phase = 'over';
      s.winner = attacker;
    } else {
      s.phase = 'goal';
    }
  } else {
    const key: NoticeKey = s.declared ? 'foul' : 'noGoal';
    s.declared = false;
    s.reset = 'goalkick';
    s.resetDefender = defender;
    s.turn = defender;
    s.flicksLeft = FLICKS_PER_TURN;
    s.notice = { key, team: defender };
    s.phase = 'aim';
  }
}

/** Everything stopped moving: decide who plays next. */
export function settle(s: GameState): void {
  if (s.phase !== 'moving') return;
  s.declared = false;
  s.superActive = false;
  if (s.ballTouched && !s.foul) {
    const before = s.charge[s.turn];
    s.charge[s.turn] = Math.min(CHARGE_MAX, before + 1);
  }
  const justCharged = s.charge[s.turn] >= CHARGE_MAX && s.ballTouched && !s.foul;
  if (s.foul) passTurn(s, 'foul');
  else if (s.ballTouched && s.flicksLeft > 0) s.notice = { key: justCharged ? 'superReady' : 'again', team: s.turn };
  else passTurn(s, s.ballTouched ? 'limit' : 'miss');
  s.phase = 'aim';
}

/** After the goal celebration, play resumes from kickoff. */
export function resumeAfterGoal(s: GameState): void {
  if (s.phase === 'goal') s.phase = 'aim';
}

/** Main loop calls this to learn (once) whether positions must be reset. */
export function consumeReset(s: GameState): ResetKind {
  const r = s.reset;
  s.reset = 'none';
  return r;
}
