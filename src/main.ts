import './style.css';
import { FIELD, KEEPER_PAUSE_S, other, type Team } from './config';
import { Input, KEEPER_PICK, PICK_RADIUS, type Controller } from './input';
import { computeLayout, type Layout } from './layout';
import { Physics } from './physics';
import { render } from './render';
import * as rules from './rules';
import { getLang, setLang, t } from './i18n';

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const canvas = $<HTMLCanvasElement>('board');
const ctx = canvas.getContext('2d')!;
const toast = $('toast');
const overlay = $('overlay');
const shootBtn = $<HTMLButtonElement>('shoot');

const phys = new Physics();
let state = rules.newGame(0);
rules.consumeReset(state);
let started = false;
let layout: Layout = computeLayout(360, 640);
let dpr = 1;
let keeperTimer = 0;
let goalTimer = 0;
let moveTime = 0;
let lastNotice: rules.Notice | null = null;
let toastTimer = 0;

const teamName = (team: Team) => (team === 0 ? t().team0 : t().team1);

phys.onContact = (a, b) => rules.contact(state, a, b);

const ctl: Controller = {
  layout: () => layout,
  pickButton(x, y) {
    if (!started || state.phase !== 'aim') return null;
    let best: { team: Team; idx: number } | null = null;
    let bestD = PICK_RADIUS;
    phys.buttons[state.turn].forEach((b, idx) => {
      const p = b.getPosition();
      const d = Math.hypot(p.x - x, p.y - y);
      if (d < bestD) { bestD = d; best = { team: state.turn, idx }; }
    });
    return best;
  },
  pickKeeper(x, y) {
    if (!started || state.phase !== 'keeper') return null;
    const team = other(state.turn);
    const k = phys.keepers[team].getPosition();
    return Math.abs(k.x - x) < KEEPER_PICK.x && Math.abs(k.y - y) < KEEPER_PICK.y ? team : null;
  },
  buttonPos: (team, idx) => phys.buttons[team][idx].getPosition(),
  flick(team, idx, vx, vy) {
    if (!rules.startFlick(state)) return;
    moveTime = 0;
    phys.flick(team, idx, vx, vy);
  },
  moveKeeper: (team, y) => phys.setKeeperY(team, y),
};
const input = new Input(canvas, ctl);

// ---------- UI ----------
function showToast(text: string, big = false, ms = 2400): void {
  toast.textContent = text;
  toast.className = (big ? 'big ' : '') + 'show';
  clearTimeout(toastTimer);
  if (ms > 0) toastTimer = window.setTimeout(() => (toast.className = big ? 'big' : ''), ms);
}
function hideToast(): void {
  clearTimeout(toastTimer);
  toast.className = '';
}

function noticeText(n: rules.Notice): string {
  const s = t();
  switch (n.key) {
    case 'goal': return s.goal(teamName(n.team));
    case 'ownGoal': return s.ownGoal(teamName(n.team));
    case 'noGoal': return s.noGoal(teamName(n.team));
    case 'foul': return s.foul(teamName(n.team));
    case 'again': return s.again();
    case 'miss': return s.miss(teamName(n.team));
    case 'limit': return s.limit(teamName(n.team));
  }
}

function showOverlay(kind: 'start' | 'over'): void {
  const s = t();
  $('ov-title').textContent = kind === 'start' ? s.title : s.win(teamName(state.winner ?? 0));
  $('ov-sub').textContent = kind === 'start' ? s.subtitle : `${state.score[0]} – ${state.score[1]}`;
  const list = $('ov-list');
  list.replaceChildren();
  if (kind === 'start') for (const line of s.howto) list.append(Object.assign(document.createElement('li'), { textContent: line }));
  $('ov-btn').textContent = kind === 'start' ? s.start : s.playAgain;
  $('ov-btn').dataset.kind = kind;
  overlay.hidden = false;
}

let hudSig = '';
function updateHud(): void {
  const s = t();
  const sig = [getLang(), state.phase, state.turn, state.score.join(), state.flicksLeft, state.declared, Math.ceil(keeperTimer)].join('|');
  if (sig === hudSig) return;
  hudSig = sig;
  $('name0').textContent = s.team0;
  $('name1').textContent = s.team1;
  $('s0').textContent = String(state.score[0]);
  $('s1').textContent = String(state.score[1]);
  $('lang').textContent = s.lang;
  const turnText = $('turn-text');
  if (state.phase === 'keeper') turnText.textContent = s.keeperPrompt(teamName(other(state.turn)));
  else if (state.phase === 'over') turnText.textContent = s.win(teamName(state.winner ?? 0));
  else turnText.textContent = s.turn(teamName(state.turn));
  const pips = $('pips');
  pips.replaceChildren();
  if (state.phase === 'aim' || state.phase === 'moving' || state.phase === 'keeper') {
    for (let i = 0; i < 3; i++) pips.append(Object.assign(document.createElement('span'), { className: 'pip' + (i < state.flicksLeft ? '' : ' off') }));
  }
  if (state.phase === 'keeper') {
    shootBtn.textContent = `${s.ready} (${Math.max(0, Math.ceil(keeperTimer))})`;
    shootBtn.disabled = false;
  } else {
    shootBtn.textContent = s.shoot;
    shootBtn.disabled = !(started && state.phase === 'aim' && !state.declared);
  }
  shootBtn.dataset.mode = state.phase === 'keeper' ? 'ready' : 'shoot';
  document.documentElement.lang = getLang() === 'pt' ? 'pt-BR' : 'en';
}

shootBtn.addEventListener('click', () => {
  if (state.phase === 'keeper') confirmKeeper();
  else if (rules.declareShot(state)) {
    input.abort();
    keeperTimer = KEEPER_PAUSE_S;
  }
});
function confirmKeeper(): void {
  if (rules.confirmKeeper(state)) input.abort();
}

$('lang').addEventListener('click', () => {
  setLang(getLang() === 'pt' ? 'en' : 'pt');
  hudSig = '';
  if (!overlay.hidden) showOverlay($('ov-btn').dataset.kind === 'over' ? 'over' : 'start');
  if (lastNotice) toast.textContent = noticeText(lastNotice);
});
$('ov-btn').addEventListener('click', () => {
  if ($('ov-btn').dataset.kind === 'over') restart();
  started = true;
  overlay.hidden = true;
  hudSig = '';
});

function restart(): void {
  state = rules.newGame(state.winner === null ? 0 : other(state.winner));
  rules.consumeReset(state);
  phys.resetKickoff();
  lastNotice = null;
  goalTimer = 0;
  hideToast();
}

// ---------- layout ----------
function resize(): void {
  const r = canvas.getBoundingClientRect();
  dpr = Math.min(window.devicePixelRatio || 1, 3);
  canvas.width = Math.max(1, Math.round(r.width * dpr));
  canvas.height = Math.max(1, Math.round(r.height * dpr));
  layout = computeLayout(r.width, r.height);
}
new ResizeObserver(resize).observe(canvas);
window.addEventListener('resize', resize);

// ---------- loop ----------
function afterRules(): void {
  const n = state.notice;
  if (n && n !== lastNotice) {
    lastNotice = n;
    const big = n.key === 'goal' || n.key === 'ownGoal';
    showToast(noticeText(n), big, big ? 0 : 2600);
  }
}

let last = performance.now();
let clock = 0;
function frame(now: number): void {
  const dt = Math.min(0.05, (now - last) / 1000);
  last = now;
  clock += dt;

  if (state.phase === 'moving') {
    phys.step(dt);
    moveTime += dt;
    const g = phys.ballInGoal();
    if (g !== null) {
      rules.goalReached(state, g);
      phys.freeze();
      goalTimer = 0;
    } else if (phys.isSettled() || moveTime > 10) {
      phys.freeze();
      rules.settle(state);
    }
  } else if (state.phase === 'keeper') {
    keeperTimer -= dt;
    if (keeperTimer <= 0) confirmKeeper();
  } else if (state.phase === 'goal') {
    goalTimer += dt;
    if (goalTimer > 2) {
      phys.resetKickoff();
      rules.consumeReset(state);
      rules.resumeAfterGoal(state);
      hideToast();
    }
  } else if (state.phase === 'over') {
    if (overlay.hidden) { goalTimer += dt; if (goalTimer > 1.6) { showOverlay('over'); hideToast(); } }
  }

  if (state.reset === 'goalkick') {
    phys.resetGoalKick(state.resetDefender);
    rules.consumeReset(state);
  }
  afterRules();
  updateHud();
  render(ctx, layout, dpr, { phys, state, drag: input.drag, time: clock });
  requestAnimationFrame(frame);
}

resize();
showOverlay('start');
requestAnimationFrame(frame);

// Handy for debugging and the end-to-end test.
(window as unknown as Record<string, unknown>).__botao = {
  get state() { return state; },
  phys,
  get layout() { return layout; },
  field: FIELD,
};
