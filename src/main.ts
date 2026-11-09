import './style.css';
import {
  CHARGE_MAX, FIELD, KEEPER_PAUSE_S, MAX_SPEED, SUPER_SPEED_MUL, other, type Team,
} from './config';
import { Input, KEEPER_PICK, PICK_RADIUS, type Controller } from './input';
import { computeLayout, type Layout } from './layout';
import { Physics } from './physics';
import { render, type Drag } from './render';
import * as rules from './rules';
import { getLang, setLang, t } from './i18n';
import * as audio from './audio';
import { Fx } from './fx';
import { keeperTarget, planShot, type Plan } from './ai';

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const canvas = $<HTMLCanvasElement>('board');
const ctx = canvas.getContext('2d')!;
const toast = $('toast');
const overlay = $('overlay');
const shootBtn = $<HTMLButtonElement>('shoot');

const phys = new Physics();
const fx = new Fx();
let state = rules.newGame(0);
rules.consumeReset(state);
let started = false;
let vsCpu = false;
const CPU_TEAM: Team = 1;
let layout: Layout = computeLayout(360, 640);
let dpr = 1;
let keeperTimer = 0;
let keeperElapsed = 0;
let goalTimer = 0;
let moveTime = 0;
let timeScale = 1;
let superIdx = -1;
let lastNotice: rules.Notice | null = null;
let toastTimer = 0;

const cpuTurn = () => vsCpu && state.turn === CPU_TEAM;
const teamName = (team: Team) =>
  (team === 0 ? t().team0 : t().team1) + (vsCpu && team === CPU_TEAM ? ` (${t().cpu})` : '');

// ---------- physics feedback: sound, sparks, shake, haptics ----------
phys.onContact = (a, b) => {
  const wasFoul = state.foul;
  rules.contact(state, a, b);
  if (state.foul && !wasFoul) {
    audio.whistle();
    fx.doFlash(0.5, '255,70,70');
    audio.buzz([40, 30, 40]);
  }
};

phys.onImpact = (a, b, speed, x, y) => {
  if (speed < 0.8) return;
  const power = Math.min(1, speed / 14);
  const hasBall = a.kind === 'ball' || b.kind === 'ball';
  const hasWall = a.kind === 'wall' || b.kind === 'wall';
  const hasKeeper = a.kind === 'keeper' || b.kind === 'keeper';
  audio.hit(hasKeeper ? 'keeper' : hasWall ? 'wall' : hasBall ? 'ball' : 'button', power);
  if (speed > 2.5) fx.spark(x, y, Math.min(16, Math.round(speed * 1.2)), speed * 0.55, hasBall ? '#fff6c2' : '#ffffff');
  if (speed > 6) fx.ring(x, y, 0.3 + power * 0.5);
  if (speed > 7) fx.addShake((hasBall ? 0.04 : 0.025) + power * 0.07);
  if (speed > 9 && !hasWall) audio.buzz(14);
};

const ctl: Controller = {
  layout: () => layout,
  pickButton(x, y) {
    if (!started || state.phase !== 'aim' || cpuTurn()) return null;
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
    if (vsCpu && team === CPU_TEAM) return null;
    const k = phys.keepers[team].getPosition();
    return Math.abs(k.x - x) < KEEPER_PICK.x && Math.abs(k.y - y) < KEEPER_PICK.y ? team : null;
  },
  buttonPos: (team, idx) => phys.buttons[team][idx].getPosition(),
  flick(team, idx, vx, vy) {
    if (!rules.startFlick(state)) return;
    moveTime = 0;
    const sup = state.superActive;
    if (sup) {
      vx *= SUPER_SPEED_MUL; vy *= SUPER_SPEED_MUL;
      superIdx = idx;
      audio.superFlick();
      fx.addShake(0.14);
      fx.doFlash(0.45, '255,200,80');
      audio.buzz(35);
      showToast(t().superTag, true, 900);
    } else {
      audio.flick(Math.hypot(vx, vy) / MAX_SPEED);
    }
    phys.flick(team, idx, vx, vy, sup);
  },
  moveKeeper: (team, y) => phys.setKeeperY(team, y),
};
const input = new Input(canvas, ctl);

// ---------- UI ----------
function showToast(text: string, big = false, ms = 2400): void {
  toast.textContent = text;
  toast.className = (big ? 'big ' : '') + 'show';
  clearTimeout(toastTimer);
  if (ms > 0) toastTimer = window.setTimeout(() => (toast.className = ''), ms);
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
    case 'superReady': return s.superReady(teamName(n.team));
  }
}

function showOverlay(kind: 'start' | 'over'): void {
  const s = t();
  $('ov-title').textContent = kind === 'start' ? s.title : s.win(teamName(state.winner ?? 0));
  $('ov-sub').textContent = kind === 'start' ? s.subtitle : `${state.score[0]} – ${state.score[1]}`;
  const list = $('ov-list');
  list.replaceChildren();
  if (kind === 'start') for (const line of s.howto) list.append(Object.assign(document.createElement('li'), { textContent: line }));
  $('ov-btn').textContent = kind === 'start' ? s.twoPlayers : s.playAgain;
  $('ov-btn2').textContent = s.vsCpu;
  $('ov-btn2').hidden = kind !== 'start';
  $('ov-btn').dataset.kind = kind;
  overlay.hidden = false;
}

function bolts(el: HTMLElement, n: number): void {
  if (el.childElementCount !== CHARGE_MAX) {
    el.replaceChildren(...Array.from({ length: CHARGE_MAX }, () => Object.assign(document.createElement('span'), { className: 'bolt' })));
  }
  Array.from(el.children).forEach((c, i) => c.classList.toggle('on', i < n));
  el.classList.toggle('full', n >= CHARGE_MAX);
}

let hudSig = '';
function updateHud(): void {
  const s = t();
  const sig = [getLang(), state.phase, state.turn, state.score.join(), state.flicksLeft, state.declared, state.charge.join(), vsCpu, Math.ceil(keeperTimer), audio.isMuted()].join('|');
  if (sig === hudSig) return;
  hudSig = sig;
  $('name0').textContent = teamName(0);
  $('name1').textContent = teamName(1);
  $('s0').textContent = String(state.score[0]);
  $('s1').textContent = String(state.score[1]);
  $('lang').textContent = s.lang;
  $('mute').textContent = audio.isMuted() ? '🔇' : '🔊';
  bolts($('ch0'), state.charge[0]);
  bolts($('ch1'), state.charge[1]);
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
    shootBtn.disabled = vsCpu && other(state.turn) === CPU_TEAM;
  } else {
    shootBtn.textContent = s.shoot;
    shootBtn.disabled = !(started && state.phase === 'aim' && !state.declared && !cpuTurn());
  }
  shootBtn.dataset.mode = state.phase === 'keeper' ? 'ready' : 'shoot';
  document.documentElement.lang = getLang() === 'pt' ? 'pt-BR' : 'en';
}

function declare(): void {
  if (rules.declareShot(state)) {
    input.abort();
    keeperTimer = KEEPER_PAUSE_S;
    keeperElapsed = 0;
    audio.click();
  }
}
function confirmKeeper(): void {
  if (rules.confirmKeeper(state)) input.abort();
}

shootBtn.addEventListener('click', () => {
  if (state.phase === 'keeper') {
    if (!(vsCpu && other(state.turn) === CPU_TEAM)) confirmKeeper();
  } else if (!cpuTurn()) declare();
});

$('lang').addEventListener('click', () => {
  setLang(getLang() === 'pt' ? 'en' : 'pt');
  hudSig = '';
  if (!overlay.hidden) showOverlay($('ov-btn').dataset.kind === 'over' ? 'over' : 'start');
  if (lastNotice) toast.textContent = noticeText(lastNotice);
});
$('mute').addEventListener('click', () => {
  audio.setMuted(!audio.isMuted());
  audio.click();
  hudSig = '';
});

function begin(cpu: boolean): void {
  if ($('ov-btn').dataset.kind === 'over') restart();
  else vsCpu = cpu;
  started = true;
  overlay.hidden = true;
  hudSig = '';
  cpuPlan = null;
}
$('ov-btn').addEventListener('click', () => begin(false));
$('ov-btn2').addEventListener('click', () => begin(true));
window.addEventListener('pointerdown', () => audio.unlock(), { capture: true });

function restart(): void {
  state = rules.newGame(state.winner === null ? 0 : other(state.winner));
  rules.consumeReset(state);
  phys.resetKickoff();
  lastNotice = null;
  goalTimer = 0;
  timeScale = 1;
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

// ---------- CPU opponent ----------
let cpuPlan: Plan | null = null;
let cpuThink = 0;
let cpuAim = 0;
let cpuDrag: Drag | null = null;

function cpuTick(dt: number): void {
  if (!vsCpu || !started) return;
  if (state.phase === 'keeper' && other(state.turn) === CPU_TEAM) {
    // CPU keeper: slide towards where the ball is, then say "ready"
    const ty = keeperTarget(phys.ballPos().y);
    const cur = phys.keeperY(CPU_TEAM);
    phys.setKeeperY(CPU_TEAM, cur + Math.max(-4 * dt, Math.min(4 * dt, ty - cur)));
    keeperElapsed += dt;
    if (keeperElapsed > 1.6) confirmKeeper();
    return;
  }
  if (state.phase !== 'aim' || state.turn !== CPU_TEAM) {
    cpuPlan = null; cpuDrag = null; cpuThink = 0; cpuAim = 0;
    return;
  }
  if (!cpuPlan) {
    cpuPlan = planShot({
      me: CPU_TEAM,
      buttons: phys.buttons.map((team) => team.map((b) => ({ x: b.getPosition().x, y: b.getPosition().y }))),
      ball: phys.ballPos(),
      keeper: { x: 0, y: phys.keeperY(other(CPU_TEAM)) },
    });
    cpuThink = 0; cpuAim = 0;
  }
  cpuThink += dt;
  if (cpuThink < 0.9) return;
  if (cpuPlan.declare && !state.declared) { declare(); return; }
  // show the "pull back" so the human can see what the CPU is doing, then flick
  cpuAim += dt;
  const b = phys.buttons[CPU_TEAM][cpuPlan.idx].getPosition();
  const pull = cpuPlan.power * 2.0 * Math.min(1, cpuAim / 0.7);
  cpuDrag = { kind: 'aim', team: CPU_TEAM, idx: cpuPlan.idx, px: b.x - cpuPlan.dx * pull, py: b.y - cpuPlan.dy * pull };
  if (cpuAim >= 0.9) {
    const p = cpuPlan;
    cpuPlan = null; cpuDrag = null;
    ctl.flick(CPU_TEAM, p.idx, p.dx * p.power * MAX_SPEED, p.dy * p.power * MAX_SPEED);
  }
}

// ---------- loop ----------
function celebrate(scorer: Team): void {
  const gx = scorer === 0 ? FIELD.L : 0;
  const colors = scorer === 0
    ? ['#2b6fd6', '#8ec0ff', '#ffffff', '#ffd75e']
    : ['#d63b3b', '#ffa593', '#ffffff', '#ffd75e'];
  fx.confetti(gx, FIELD.W / 2, 90, colors, scorer === 0 ? -1 : 1);
  fx.ring(gx, FIELD.W / 2, 1.4, '255,215,94');
  fx.addShake(0.24);
  fx.doFlash(0.9, '255,230,150');
  audio.goal();
  audio.buzz([30, 40, 60, 40, 120]);
}

function afterRules(): void {
  const n = state.notice;
  if (n && n !== lastNotice) {
    lastNotice = n;
    const big = n.key === 'goal' || n.key === 'ownGoal';
    showToast(noticeText(n), big, big ? 0 : 2600);
    if (big) celebrate(n.team);
    else if (n.key === 'noGoal') audio.whistle();
    else if (n.key === 'superReady') { audio.superReady(); fx.doFlash(0.35, '255,215,94'); audio.buzz([20, 30, 20]); }
  }
}

function slowMotionTarget(): number {
  const p = phys.ballPos(), v = phys.ball.getLinearVelocity();
  if (Math.abs(v.x) < 5) return 1;
  const goalX = v.x > 0 ? FIELD.L : 0;
  const approaching = (goalX - p.x) * v.x > 0 && Math.abs(goalX - p.x) < 2.8;
  const lined = Math.abs(p.y - FIELD.W / 2) < FIELD.goalW / 2 + 0.2;
  return approaching && lined ? 0.28 : 1;
}

let last = performance.now();
let clock = 0;
let lastTickSecond = -1;
function frame(now: number): void {
  const dt = Math.min(0.05, (now - last) / 1000);
  last = now;
  clock += dt;

  if (state.phase === 'moving') {
    timeScale += (slowMotionTarget() - timeScale) * Math.min(1, dt * 14);
    const sdt = dt * timeScale;
    phys.step(sdt);
    moveTime += sdt;
    const bp = phys.ballPos();
    fx.trail(fx.ballTrail, bp.x, bp.y, phys.ball.getLinearVelocity().length() > 3);
    if (state.superActive && superIdx >= 0) {
      const sp = phys.buttons[state.turn][superIdx];
      if (sp.getLinearVelocity().length() > 1) {
        const p = sp.getPosition();
        fx.fire(p.x, p.y);
        fx.trail(fx.fireTrail, p.x, p.y, true);
      }
    }
    const g = phys.ballInGoal();
    if (g !== null) {
      rules.goalReached(state, g);
      phys.freeze();
      goalTimer = 0;
    } else if (phys.isSettled() || moveTime > 10) {
      phys.freeze();
      rules.settle(state);
    }
  } else {
    timeScale += (1 - timeScale) * Math.min(1, dt * 8);
    if (state.phase === 'keeper') {
      keeperTimer -= dt;
      const sec = Math.ceil(keeperTimer);
      if (sec <= 3 && sec > 0 && sec !== lastTickSecond && !(vsCpu && other(state.turn) === CPU_TEAM)) { lastTickSecond = sec; audio.tick(); }
      if (keeperTimer <= 0) confirmKeeper();
    } else if (state.phase === 'goal') {
      goalTimer += dt;
      if (goalTimer > 2.4) {
        phys.resetKickoff();
        rules.consumeReset(state);
        rules.resumeAfterGoal(state);
        hideToast();
        fx.ballTrail.length = 0;
      }
    } else if (state.phase === 'over') {
      if (overlay.hidden) {
        goalTimer += dt;
        if (goalTimer > 2.4) { showOverlay('over'); hideToast(); audio.win(); }
      }
    }
  }

  cpuTick(dt);

  if (state.reset === 'goalkick') {
    phys.resetGoalKick(state.resetDefender);
    rules.consumeReset(state);
    fx.ballTrail.length = 0;
  }
  afterRules();
  updateHud();
  fx.update(dt);
  render(ctx, layout, dpr, { phys, state, drag: input.drag ?? cpuDrag, time: clock, fx, timeScale });
  requestAnimationFrame(frame);
}

resize();
showOverlay('start');
requestAnimationFrame(frame);

// Handy for debugging and the end-to-end tests.
(window as unknown as Record<string, unknown>).__botao = {
  get state() { return state; },
  get vsCpu() { return vsCpu; },
  phys,
  fx,
  get layout() { return layout; },
  field: FIELD,
};
