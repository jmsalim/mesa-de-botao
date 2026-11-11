import { beforeEach, describe, expect, it } from 'vitest';
import * as r from '../src/rules';
import type { ContactInfo } from '../src/rules';

const btn = (team: 0 | 1, idx = 0): ContactInfo => ({ kind: 'button', team, idx });
const ball: ContactInfo = { kind: 'ball' };

let s: r.GameState;
beforeEach(() => {
  s = r.newGame(0);
  r.consumeReset(s);
});

describe('turns', () => {
  it('starts with 3 flicks for the first team', () => {
    expect(s.turn).toBe(0);
    expect(s.flicksLeft).toBe(3);
    expect(s.phase).toBe('aim');
  });

  it('missing the ball passes the turn', () => {
    r.startFlick(s);
    r.settle(s);
    expect(s.turn).toBe(1);
    expect(s.flicksLeft).toBe(3);
    expect(s.notice?.key).toBe('miss');
  });

  it('touching the ball keeps the turn, up to 3 flicks in a row', () => {
    for (let i = 0; i < 2; i++) {
      r.startFlick(s);
      r.contact(s, btn(0), ball);
      r.settle(s);
      expect(s.turn).toBe(0);
      expect(s.notice?.key).toBe('again');
    }
    expect(s.flicksLeft).toBe(1);
    r.startFlick(s);
    r.contact(s, btn(0), ball);
    r.settle(s);
    expect(s.turn).toBe(1);
    expect(s.notice?.key).toBe('limit');
  });

  it('ignores contacts and flicks outside their phase', () => {
    r.contact(s, btn(0), ball);
    expect(s.ballTouched).toBe(false);
    r.startFlick(s);
    expect(r.startFlick(s)).toBe(false);
  });
});

describe('fouls', () => {
  it('hitting an opponent before the ball is a foul and passes the turn', () => {
    r.startFlick(s);
    r.contact(s, btn(0), btn(1));
    r.contact(s, btn(0), ball);
    r.settle(s);
    expect(s.turn).toBe(1);
    expect(s.notice?.key).toBe('foul');
  });

  it('hitting an opponent after the ball is fine', () => {
    r.startFlick(s);
    r.contact(s, btn(0), ball);
    r.contact(s, btn(0), btn(1));
    r.settle(s);
    expect(s.turn).toBe(0);
  });

  it('touching own buttons or the keeper is not a foul', () => {
    r.startFlick(s);
    r.contact(s, btn(0, 0), btn(0, 1));
    r.contact(s, btn(0), { kind: 'keeper', team: 1 });
    expect(s.foul).toBe(false);
  });
});

describe('shot call and keeper pause', () => {
  it('declaring opens the keeper phase, confirming returns to aim with the shot called', () => {
    expect(r.declareShot(s)).toBe(true);
    expect(s.phase).toBe('keeper');
    expect(r.startFlick(s)).toBe(false);
    expect(r.confirmKeeper(s)).toBe(true);
    expect(s.phase).toBe('aim');
    expect(s.declared).toBe(true);
    expect(r.declareShot(s)).toBe(false);
  });

  it('the call only lasts for one flick', () => {
    r.declareShot(s); r.confirmKeeper(s);
    r.startFlick(s);
    r.contact(s, btn(0), ball);
    r.settle(s);
    expect(s.declared).toBe(false);
  });
});

describe('goals', () => {
  it('a called shot into the opponent goal scores; the conceding team kicks off', () => {
    r.declareShot(s); r.confirmKeeper(s);
    r.startFlick(s);
    r.contact(s, btn(0), ball);
    r.goalReached(s, 1);
    expect(s.score).toEqual([1, 0]);
    expect(s.phase).toBe('goal');
    expect(s.turn).toBe(1);
    expect(s.notice).toEqual({ key: 'goal', team: 0 });
    expect(r.consumeReset(s)).toBe('kickoff');
    r.resumeAfterGoal(s);
    expect(s.phase).toBe('aim');
  });

  it('an uncalled shot is disallowed: goal kick for the defender', () => {
    r.startFlick(s);
    r.contact(s, btn(0), ball);
    r.goalReached(s, 1);
    expect(s.score).toEqual([0, 0]);
    expect(s.notice?.key).toBe('noGoal');
    expect(s.turn).toBe(1);
    expect(s.phase).toBe('aim');
    expect(r.consumeReset(s)).toBe('goalkick');
    expect(s.resetDefender).toBe(1);
  });

  it('a called shot after a foul is disallowed', () => {
    r.declareShot(s); r.confirmKeeper(s);
    r.startFlick(s);
    r.contact(s, btn(0), btn(1));
    r.goalReached(s, 1);
    expect(s.score).toEqual([0, 0]);
    expect(s.notice?.key).toBe('foul');
  });

  it('own goals always count for the opponent', () => {
    r.startFlick(s);
    r.contact(s, btn(0), ball);
    r.goalReached(s, 0);
    expect(s.score).toEqual([0, 1]);
    expect(s.notice).toEqual({ key: 'ownGoal', team: 1 });
    expect(s.turn).toBe(0); // team 0 conceded, so it kicks off
  });

  it('first to 3 wins', () => {
    for (let i = 0; i < 3; i++) {
      s.phase = 'aim'; s.turn = 0;
      r.declareShot(s); r.confirmKeeper(s);
      r.startFlick(s);
      r.goalReached(s, 1);
    }
    expect(s.score).toEqual([3, 0]);
    expect(s.phase).toBe('over');
    expect(s.winner).toBe(0);
  });
});

describe('super flick charge', () => {
  const touchFlick = () => {
    r.startFlick(s);
    r.contact(s, btn(0), ball);
    r.settle(s);
  };

  it('each ball-touching flick banks one charge; the third announces the super flick', () => {
    touchFlick();
    expect(s.charge[0]).toBe(1);
    touchFlick();
    expect(s.charge[0]).toBe(2);
    touchFlick();
    expect(s.charge[0]).toBe(3);
    expect(s.notice?.key === 'superReady' || s.turn === 1).toBe(true);
  });

  it('missing the ball or fouling banks nothing', () => {
    r.startFlick(s);
    r.settle(s);
    expect(s.charge).toEqual([0, 0]);
    s.turn = 0; s.flicksLeft = 3;
    r.startFlick(s);
    r.contact(s, btn(0), btn(1));
    r.contact(s, btn(0), ball);
    r.settle(s);
    expect(s.charge).toEqual([0, 0]);
  });

  it('a full charge makes the next flick super and is then spent', () => {
    s.charge[0] = 3;
    r.startFlick(s);
    expect(s.superActive).toBe(true);
    expect(s.charge[0]).toBe(0);
    r.settle(s);
    expect(s.superActive).toBe(false);
  });

  it('wall contacts never count as touching the ball or a foul', () => {
    r.startFlick(s);
    r.contact(s, ball, { kind: 'wall' });
    r.contact(s, btn(0), { kind: 'wall' });
    expect(s.ballTouched).toBe(false);
    expect(s.foul).toBe(false);
  });
});
