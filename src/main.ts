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
import { DEFAULT_SKINS, SKINS, SKIN_COLORS, assetUrl, loaded, loadTextures, type Skin } from './assets';
import { Fx } from './fx';
import {
  LEVELS, LEVEL_ORDER, keeperTarget, planBasic, planHeuristic, withExecutionError, type AIView, type Level, type Plan,
} from './ai';
import { Lookahead } from './lookahead';

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const canvas = $<HTMLCanvasElement>('board');
const ctx = canvas.getContext('2d')!;
const toast = $('toast');
const overlay = $('overlay');
const shootBtn = $<HTMLButtonElement>('shoot');
const freeBtn = $<HTMLButtonElement>('free');

const phys = new Physics();
const fx = new Fx();
let state = rules.newGame(0);
rules.consumeReset(state);
let started = false;
let vsCpu = false;
const CPU_TEAM: Team = 1;
let overlayKind: 'start' | 'level' | 'over' = 'start';
let cpuLevel: Level = 'medium';
try {
  const saved = localStorage.getItem('botao-level');
  if (saved === 'easy' || saved === 'medium' || saved === 'hard') cpuLevel = saved;
} catch { /* storage may be unavailable */ }
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

/** Current phase, typed wide so TypeScript doesn't narrow it across rules calls. */
const phaseNow = (): rules.Phase => state.phase;
const cpuTurn = () => vsCpu && state.turn === CPU_TEAM;
// ---------- piece materials ----------
let skins: [Skin, Skin] = [...DEFAULT_SKINS];
try {
  const saved = JSON.parse(localStorage.getItem('botao-skins') ?? 'null') as unknown;
  if (Array.isArray(saved) && saved.length === 2 && saved.every((x) => SKINS.includes(x as Skin)) && saved[0] !== saved[1]) skins = [saved[0] as Skin, saved[1] as Skin];
} catch { /* storage may be unavailable */ }

/** Teams are named after their pieces: Pérola, Tartaruga, Acrílico, Mármore. */
const teamName = (team: Team) =>
  t().skins[skins[team]] + (vsCpu && team === CPU_TEAM ? ` (${t().cpu} · ${t().levels[cpuLevel]})` : '');

function applySkinVars(): void {
  const root = document.documentElement.style;
  root.setProperty('--paper', `url(${assetUrl('textures/papel.webp')})`);
  root.setProperty('--hero', `url(${assetUrl('images/mesa.webp')})`);
  skins.forEach((sk, i) => document.documentElement.style.setProperty(`--skin${i}`, `url(${assetUrl(`textures/${sk}.webp`)})`));
}

function renderSkinPicker(): void {
  const box = $('skins');
  box.hidden = overlayKind !== 'start';
  $('hero').hidden = overlayKind !== 'start';
  $('skins-title').textContent = t().pieces;
  ([0, 1] as Team[]).forEach((team) => {
    const row = $(`sw${team}`);
    row.replaceChildren();
    $(`skin-l${team}`).textContent = t().teamN(team + 1);
    for (const sk of SKINS) {
      const b = document.createElement('button');
      b.className = 'swatch' + (skins[team] === sk ? ' sel' : '') + (skins[other(team)] === sk ? ' taken' : '');
      b.style.backgroundImage = `url(${assetUrl(`textures/${sk}.webp`)})`;
      b.setAttribute('aria-label', t().skins[sk]);
      b.setAttribute('aria-pressed', String(skins[team] === sk));
      b.title = t().skins[sk];
      b.addEventListener('click', () => {
        if (skins[team] === sk) return;
        if (skins[other(team)] === sk) skins[other(team)] = skins[team]; // picking the other team's material swaps them
        skins[team] = sk;
        try { localStorage.setItem('botao-skins', JSON.stringify(skins)); } catch { /* ignore */ }
        applySkinVars(); hudSig = '';
        audio.click();
        renderSkinPicker();
      });
      row.append(b);
    }
  });
}

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

function showOverlay(kind: 'start' | 'level' | 'over'): void {
  const s = t();
  overlayKind = kind;
  $('ov-title').textContent = kind === 'start' ? s.title : kind === 'level' ? s.chooseLevel : s.win(teamName(state.winner ?? 0));
  $('ov-sub').textContent = kind === 'start' ? s.subtitle : kind === 'level' ? s.vsCpu : `${state.score[0]} – ${state.score[1]}`;
  const list = $('ov-list');
  list.replaceChildren();
  const lines = kind === 'start' ? s.howto : kind === 'level' ? s.levelHelp : [];
  const details = $<HTMLDetailsElement>('ov-details');
  details.hidden = lines.length === 0;
  details.open = kind === 'level'; // the how-to stays folded away so the buttons are always on screen
  $('ov-summary').textContent = kind === 'level' ? s.levelsTitle : s.howToTitle;
  for (const line of lines) list.append(Object.assign(document.createElement('li'), { textContent: line }));
  const btn = [$('ov-btn'), $('ov-btn2'), $('ov-btn3')];
  if (kind === 'level') {
    LEVEL_ORDER.forEach((lv, i) => {
      btn[i].textContent = s.levels[lv];
      btn[i].hidden = false;
      btn[i].classList.toggle('alt', lv !== cpuLevel); // the last-used level is highlighted
    });
  } else {
    btn[0].textContent = kind === 'start' ? s.twoPlayers : s.playAgain;
    btn[1].textContent = kind === 'start' ? s.vsCpu : s.menu;
    btn[2].hidden = true;
    btn[0].classList.remove('alt'); btn[1].classList.add('alt');
    btn[1].hidden = false;
  }
  $('ov-back').textContent = '← ' + s.back;
  $('ov-back').hidden = kind !== 'level';
  overlay.hidden = false;
  renderSkinPicker();
  audio.crowdOn(false);
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
  const canFree = started && state.phase === 'aim' && !cpuTurn() && phys.ballStuck(state.turn);
  const sig = [canFree, getLang(), state.phase, state.turn, state.score.join(), state.flicksLeft, state.declared, state.charge.join(), vsCpu, cpuLevel, Math.ceil(keeperTimer), audio.isMuted()].join('|');
  if (sig === hudSig) return;
  hudSig = sig;
  $('name0').textContent = teamName(0);
  $('name1').textContent = teamName(1);
  $('s0').textContent = String(state.score[0]);
  $('s1').textContent = String(state.score[1]);
  $('lang').textContent = s.lang;
  freeBtn.textContent = '↻ ' + s.freeBall;
  freeBtn.hidden = !canFree;
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

function repositionBall(auto = false): void {
  const { from, to } = phys.repositionBall();
  fx.ballTrail.length = 0;
  fx.ring(from.x, from.y, 0.5, '255,215,94');
  fx.ring(to.x, to.y, 0.9, '255,255,255');
  fx.spark(to.x, to.y, 14, 3, '#fff6c2');
  audio.click();
  showToast(t().ballReset + (auto ? '' : ''), false, 1600);
}
freeBtn.addEventListener('click', () => { if (state.phase === 'aim' && !cpuTurn() && phys.ballStuck(state.turn)) repositionBall(); });

function declare(): void {
  if (rules.declareShot(state)) {
    input.abort();
    keeperTimer = KEEPER_PAUSE_S;
    keeperElapsed = 0;
    cpuKeeperGoal = null;
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
  if (!overlay.hidden) showOverlay(overlayKind);
  if (lastNotice) toast.textContent = noticeText(lastNotice);
});
$('mute').addEventListener('click', () => {
  audio.setMuted(!audio.isMuted());
  audio.click();
  hudSig = '';
});

function startGame(cpu: boolean, level?: Level): void {
  if (state.phase === 'over' || overlayKind === 'over') restart();
  vsCpu = cpu;
  if (level) {
    cpuLevel = level;
    try { localStorage.setItem('botao-level', level); } catch { /* ignore */ }
  }
  started = true;
  overlay.hidden = true;
  hudSig = '';
  cpuReset();
  audio.crowdOn(true);
  audio.whistleStart();
}
$('ov-btn').addEventListener('click', () => {
  if (overlayKind === 'level') startGame(true, 'easy');
  else startGame(vsCpu && overlayKind === 'over', undefined);
});
$('ov-btn2').addEventListener('click', () => {
  if (overlayKind === 'start') showOverlay('level');
  else if (overlayKind === 'level') startGame(true, 'medium');
  else showOverlay('start'); // from the end screen: back to the menu
});
$('ov-btn3').addEventListener('click', () => startGame(true, 'hard'));
$('ov-back').addEventListener('click', () => showOverlay('start'));
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
let cpuSearch: Lookahead | null = null;
let cpuSearchDeclared = false;
let cpuThink = 0;
let cpuAim = 0;
let cpuDrag: Drag | null = null;
let cpuKeeperGoal: number | null = null;

function cpuView(me: Team, declared: boolean): AIView {
  return {
    me, declared, charge: state.charge[me], ball: phys.ballPos(),
    keepers: [phys.keeperY(0), phys.keeperY(1)],
    buttons: phys.buttons.map((team) => team.map((b) => ({ x: b.getPosition().x, y: b.getPosition().y }))),
  };
}

function cpuReset(): void {
  cpuPlan = null; cpuSearch = null; cpuDrag = null; cpuThink = 0; cpuAim = 0; cpuKeeperGoal = null;
}

function cpuTick(dt: number): void {
  if (!vsCpu || !started) return;
  const cfg = LEVELS[cpuLevel];
  if (state.phase === 'keeper' && other(state.turn) === CPU_TEAM) {
    // CPU keeper: slide to where this level thinks the shot is coming, then say "ready"
    cpuKeeperGoal ??= keeperTarget(cpuView(CPU_TEAM, false), cpuLevel);
    const cur = phys.keeperY(CPU_TEAM);
    phys.setKeeperY(CPU_TEAM, cur + Math.max(-cfg.keeperSpeed * dt, Math.min(cfg.keeperSpeed * dt, cpuKeeperGoal - cur)));
    keeperElapsed += dt;
    if (keeperElapsed > cfg.keeperReady) confirmKeeper();
    return;
  }
  if (state.phase !== 'aim' || state.turn !== CPU_TEAM) { cpuReset(); return; }

  // ball jammed in a corner or against its own goal: use the free reposition, like a human could
  if (!cpuPlan && !cpuSearch && phys.ballTrapped(CPU_TEAM)) {
    cpuThink += dt;
    if (cpuThink > 1.0) { repositionBall(); cpuThink = 0; }
    return;
  }

  cpuThink += dt; // "thinking" time counts every frame of the CPU's turn, planning or not
  if (!cpuPlan) {
    const view = cpuView(CPU_TEAM, state.declared);
    if (cfg.planner === 'lookahead') {
      // think on a hidden copy of the table, a few milliseconds per frame so the game stays smooth
      if (!cpuSearch || cpuSearchDeclared !== state.declared) {
        cpuSearch = new Lookahead(view, phys.snapshot(), Math.random, cpuLevel);
        cpuSearchDeclared = state.declared;
      }
      cpuSearch.step(5);
      if (!cpuSearch.done || cpuThink < cfg.thinkMin) return;
      cpuPlan = withExecutionError(cpuSearch.best() ?? planHeuristic(view, Math.random, cfg), cpuLevel);
      cpuSearch = null;
    } else {
      cpuPlan = planBasic(view, cpuLevel);
    }
    cpuAim = 0;
  }
  if (cpuThink < cfg.thinkMin) return;
  if (cpuPlan.declare && !state.declared) {
    declare();
    cpuPlan = null; cpuSearch = null;
    cpuThink = Math.max(0, cfg.thinkMin - 0.3); // after the keeper is set, look again quickly
    return;
  }
  // show the "pull back" so the human can see what the CPU is doing, then flick
  cpuAim += dt;
  const b = phys.buttons[CPU_TEAM][cpuPlan.idx].getPosition();
  const pull = cpuPlan.power * 2.0 * Math.min(1, cpuAim / 0.7);
  cpuDrag = { kind: 'aim', team: CPU_TEAM, idx: cpuPlan.idx, px: b.x - cpuPlan.dx * pull, py: b.y - cpuPlan.dy * pull };
  if (cpuAim >= 0.9) {
    const p = cpuPlan;
    cpuPlan = null; cpuDrag = null; cpuThink = 0;
    ctl.flick(CPU_TEAM, p.idx, p.dx * p.power * MAX_SPEED, p.dy * p.power * MAX_SPEED);
  }
}

// ---------- loop ----------
function celebrate(scorer: Team): void {
  const gx = scorer === 0 ? FIELD.L : 0;
  const colors = SKIN_COLORS[skins[scorer]];
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
      if (phaseNow() === 'goal' || phaseNow() === 'over') {
        phys.freezeButtons(); // the ball keeps rolling into the net
      } else phys.freeze();
      goalTimer = 0;
    } else if (phys.isSettled() || moveTime > 10) {
      phys.freeze();
      rules.settle(state);
      if (phaseNow() === 'aim' && phys.ballInCorner()) repositionBall(true); // nobody can free it from there
    }
  } else {
    timeScale += (1 - timeScale) * Math.min(1, dt * 8);
    if (state.phase === 'keeper') {
      keeperTimer -= dt;
      const sec = Math.ceil(keeperTimer);
      if (sec <= 3 && sec > 0 && sec !== lastTickSecond && !(vsCpu && other(state.turn) === CPU_TEAM)) { lastTickSecond = sec; audio.tick(); }
      if (keeperTimer <= 0) confirmKeeper();
    } else if (state.phase === 'goal') {
      phys.step(dt * timeScale);
      goalTimer += dt;
      if (goalTimer > 2.4) {
        phys.resetKickoff();
        rules.consumeReset(state);
        rules.resumeAfterGoal(state);
        hideToast();
        fx.ballTrail.length = 0;
        audio.whistleStart();
      }
    } else if (state.phase === 'over') {
      phys.step(dt * timeScale);
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
  render(ctx, layout, dpr, {
    phys, state, drag: input.drag ?? cpuDrag, time: clock, fx, timeScale,
    skins, pxPerUnit: layout.scale * dpr, screenRot: layout.portrait ? Math.PI / 2 : 0,
  });
  requestAnimationFrame(frame);
}

applySkinVars();
void loadTextures(); // small, and the game draws a code-made look until they arrive
resize();
showOverlay('start');
requestAnimationFrame(frame);

// Handy for debugging and the end-to-end tests.
(window as unknown as Record<string, unknown>).__botao = {
  get state() { return state; },
  get vsCpu() { return vsCpu; },
  get cpuLevel() { return cpuLevel; },
  get skins() { return skins; },
  get texturesLoaded() { return !!loaded.felt && SKINS.every((k) => !!loaded.skins[k]); },
  audio,
  phys,
  fx,
  get layout() { return layout; },
  field: FIELD,
};
