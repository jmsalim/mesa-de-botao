/**
 * Sound. The recorded samples in public/assets/sounds are fetched after the first tap (phones only
 * allow audio then) and played with WebAudio. Until a sample has decoded, or if it fails to load,
 * the small synthesized versions below play instead, so there is never silence or a wait.
 *
 * Mix, loudest to quietest: whistles and hits, the goal roar, then a soft crowd murmur underneath.
 * The master has a limiter, and every sample's loudest gain is capped (see MIX, checked by a test) so
 * that overlapping sounds cannot clip.
 */
import { CROWD_LOOP, SOUND_NAMES, assetUrl, type SoundName } from './assets';

/** [gain at power 0, gain at power 1] for sounds that scale with how hard something was hit. */
export const MIX = {
  master: 0.9,
  flick: [0.45, 1.1] as [number, number],
  disc: [0.4, 1.15] as [number, number],
  ball: [0.45, 1.1] as [number, number],
  wall: [0.4, 1.15] as [number, number],
  keeper: [0.4, 1.0] as [number, number],
  net: 1.2,
  superFlick: 1.1,
  whistleFoul: 0.6,
  whistleStart: 0.55,
  whistleEnd: 0.6,
  crowdGoal: 0.7,
  /** the murmur's resting level: about -37 dBFS RMS at the output, 13+ dB under a typical hit */
  crowdBed: 0.26,
  /** how far the murmur rises on a goal / at the final whistle, and how far it dips under a whistle */
  goalSwell: 2.8,
  winSwell: 4,
  duck: 0.55,
};

/** The loudest gain each sample is ever played at (a test checks peak x gain x master stays below clipping). */
export const MAX_GAIN: Record<SoundName, number> = {
  flick: Math.max(MIX.flick[1], MIX.superFlick),
  'disc-hit': Math.max(MIX.disc[1], MIX.keeper[1]),
  'ball-tap': MIX.ball[1],
  'wall-bounce': MIX.wall[1],
  net: MIX.net,
  'whistle-start': MIX.whistleStart,
  'whistle-foul': MIX.whistleFoul,
  'whistle-end': MIX.whistleEnd,
  'crowd-goal': MIX.crowdGoal,
  'crowd-loop': MIX.crowdBed * MIX.winSwell,
};

let ac: AudioContext | null = null;
let master: GainNode | null = null;
let noise: AudioBuffer | null = null;
let muted = false;
try { muted = localStorage.getItem('botao-muted') === '1'; } catch { /* storage may be unavailable */ }

const lastPlayed: Record<string, number> = {};
const buffers: Partial<Record<SoundName, AudioBuffer>> = {};
let loadStarted = false;

// ---------- crowd ambience ----------
let crowdWanted = false;
let crowdGain: GainNode | null = null; // resting level and swells
let crowdDuck: GainNode | null = null; // dips under whistles
let crowdSrc: AudioBufferSourceNode | null = null;

/** Must be called from a user gesture (tap) before sounds can play on phones. */
export function unlock(): void {
  if (!ac) {
    try {
      const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      ac = new Ctor();
      master = ac.createGain();
      master.gain.value = muted ? 0 : MIX.master;
      // safety net: if a hit, a whistle and a roar land together, squash the peak instead of clipping
      const limiter = ac.createDynamicsCompressor();
      limiter.threshold.value = -3; limiter.knee.value = 6; limiter.ratio.value = 12;
      limiter.attack.value = 0.002; limiter.release.value = 0.15;
      master.connect(limiter).connect(ac.destination);
      noise = ac.createBuffer(1, ac.sampleRate, ac.sampleRate);
      const d = noise.getChannelData(0);
      for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
      document.addEventListener('visibilitychange', () => {
        if (!ac) return;
        if (document.hidden) void ac.suspend(); else void ac.resume(); // save battery in the background
      });
    } catch { ac = null; }
  }
  void ac?.resume();
  if (ac && !loadStarted) { loadStarted = true; void loadSamples(); }
}

function decode(data: ArrayBuffer): Promise<AudioBuffer> {
  // older Safari only has the callback form
  return new Promise((resolve, reject) => ac!.decodeAudioData(data, resolve, reject));
}

/** Small effects first, so the sounds you hear most are ready within a moment; the crowd last. */
async function loadSamples(): Promise<void> {
  const order: SoundName[] = ['flick', 'disc-hit', 'ball-tap', 'wall-bounce', 'whistle-start', 'whistle-foul', 'net', 'crowd-goal', 'whistle-end', 'crowd-loop'];
  for (const name of order) {
    if (!SOUND_NAMES.includes(name)) continue;
    try {
      const res = await fetch(assetUrl(`sounds/${name}.mp3`));
      if (!res.ok) continue;
      buffers[name] = await decode(await res.arrayBuffer());
      if (name === 'crowd-loop') startCrowd();
    } catch { /* keep the synthesized fallback for this sound */ }
  }
}

export function samplesLoaded(): SoundName[] { return Object.keys(buffers) as SoundName[]; }

export function isMuted(): boolean { return muted; }
export function setMuted(m: boolean): void {
  muted = m;
  try { localStorage.setItem('botao-muted', m ? '1' : '0'); } catch { /* ignore */ }
  if (master) master.gain.value = m ? 0 : MIX.master;
}

function ready(key?: string, gap = 0): boolean {
  if (!ac || !master || muted) return false;
  if (key) {
    const now = ac.currentTime;
    if (now - (lastPlayed[key] ?? -1) < gap) return false;
    lastPlayed[key] = now;
  }
  return true;
}

/** Plays a loaded sample; returns false if it isn't available (caller falls back to the synth). */
function sample(name: SoundName, gain = 1, rate = 1, jitter = 0.05, delay = 0, lowpass?: number): boolean {
  const b = buffers[name];
  if (!b || !ac || !master) return false;
  const src = ac.createBufferSource();
  src.buffer = b;
  src.playbackRate.value = rate * (1 + (Math.random() - 0.5) * 2 * jitter);
  const g = ac.createGain();
  g.gain.value = gain;
  if (lowpass) { // take the hiss off the top so it sits with the soft murmur
    const f = ac.createBiquadFilter();
    f.type = 'lowpass'; f.frequency.value = lowpass; f.Q.value = 0.6;
    src.connect(f).connect(g);
  } else {
    src.connect(g);
  }
  g.connect(master);
  src.start(ac.currentTime + delay);
  return true;
}

export function crowdOn(on: boolean): void {
  crowdWanted = on;
  if (on) startCrowd(); else stopCrowd();
}

/** Current murmur gain (resting level, or higher during a swell). Used by tests. */
export function crowdLevel(): number { return crowdGain?.gain.value ?? 0; }
/** Current duck gain: 1 normally, lower while a whistle dips the murmur. Used by tests. */
export function crowdDuckLevel(): number { return crowdDuck?.gain.value ?? 1; }

function startCrowd(): void {
  const b = buffers['crowd-loop'];
  if (!crowdWanted || !b || !ac || !master || crowdSrc) return;
  const src = ac.createBufferSource();
  src.buffer = b;
  src.loop = true;
  // The file repeats exactly every CROWD_LOOP.length seconds and has CROWD_LOOP.pad of that signal on
  // both sides, so looping the window inside it is seamless even if a decoder shifts the audio a little.
  const wanted = CROWD_LOOP.pad + CROWD_LOOP.length;
  if (b.duration >= wanted - 0.02) { src.loopStart = CROWD_LOOP.pad; src.loopEnd = Math.min(b.duration, wanted); }
  else { src.loopStart = 0.04; src.loopEnd = Math.max(0.5, b.duration - 0.04); } // unexpected file: still loop it
  crowdGain = ac.createGain();
  crowdGain.gain.value = 0;
  crowdGain.gain.setTargetAtTime(MIX.crowdBed, ac.currentTime, 0.6); // fades in over a couple of seconds
  crowdDuck = ac.createGain();
  src.connect(crowdGain).connect(crowdDuck).connect(master);
  src.start(0, src.loopStart);
  crowdSrc = src;
}

function stopCrowd(): void {
  if (!crowdSrc || !crowdGain || !ac) return;
  const src = crowdSrc, g = crowdGain;
  g.gain.cancelScheduledValues(ac.currentTime);
  g.gain.setValueAtTime(g.gain.value, ac.currentTime);
  g.gain.setTargetAtTime(0, ac.currentTime, 0.2);
  src.stop(ac.currentTime + 1.5);
  crowdSrc = null; crowdGain = null; crowdDuck = null;
}

/** The crowd rises for a moment and settles back, the way a real one does. */
function crowdSwell(mul: number, hold = 1.2, release = 2.5): void {
  if (!crowdGain || !ac) return;
  const g = crowdGain.gain, t = ac.currentTime;
  g.cancelScheduledValues(t);
  g.setValueAtTime(g.value, t);
  g.setTargetAtTime(MIX.crowdBed * mul, t, 0.35);
  g.setTargetAtTime(MIX.crowdBed, t + 1 + hold, release / 3);
}

/** Dip the murmur under a loud sound so the whistle cuts through cleanly. */
function crowdDip(seconds = 0.9): void {
  if (!crowdDuck || !ac) return;
  const g = crowdDuck.gain, t = ac.currentTime;
  g.cancelScheduledValues(t);
  g.setValueAtTime(g.value, t);
  g.setTargetAtTime(MIX.duck, t, 0.04);
  g.setTargetAtTime(1, t + seconds, 0.3);
}

// ---------- synthesized fallbacks ----------
function tone(type: OscillatorType, f0: number, f1: number, dur: number, vol: number, delay = 0): void {
  if (!ac || !master) return;
  const t = ac.currentTime + delay;
  const o = ac.createOscillator(), g = ac.createGain();
  o.type = type;
  o.frequency.setValueAtTime(f0, t);
  if (f1 !== f0) o.frequency.exponentialRampToValueAtTime(f1, t + dur);
  g.gain.setValueAtTime(vol, t);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  o.connect(g).connect(master);
  o.start(t); o.stop(t + dur + 0.02);
}

function burst(filter: BiquadFilterType, freq: number, q: number, dur: number, vol: number, delay = 0, freqEnd = freq): void {
  if (!ac || !master || !noise) return;
  const t = ac.currentTime + delay;
  const src = ac.createBufferSource();
  src.buffer = noise;
  src.loop = true;
  const f = ac.createBiquadFilter();
  f.type = filter; f.Q.value = q;
  f.frequency.setValueAtTime(freq, t);
  if (freqEnd !== freq) f.frequency.exponentialRampToValueAtTime(freqEnd, t + dur);
  const g = ac.createGain();
  g.gain.setValueAtTime(vol, t);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  src.connect(f).connect(g).connect(master);
  src.start(t); src.stop(t + dur + 0.02);
}

function synthWhistle(): void {
  for (const d of [0, 0.32]) {
    if (!ac || !master) return;
    const t = ac.currentTime + d;
    const o = ac.createOscillator(), lfo = ac.createOscillator(), lg = ac.createGain(), g = ac.createGain();
    o.type = 'sine'; o.frequency.value = 2700;
    lfo.frequency.value = 38; lg.gain.value = 90;
    lfo.connect(lg).connect(o.frequency);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.35, t + 0.02);
    g.gain.setValueAtTime(0.35, t + 0.22);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.28);
    o.connect(g).connect(master);
    o.start(t); lfo.start(t); o.stop(t + 0.3); lfo.stop(t + 0.3);
  }
}

// ---------- the game's sounds ----------
const lerp = (r: [number, number], p: number) => r[0] + (r[1] - r[0]) * p;

/** `power` is 0..1 (how hard the impact was). */
export function hit(kind: 'button' | 'ball' | 'wall' | 'keeper', power: number): void {
  if (!ready(`hit-${kind}`, 0.035)) return;
  const p = Math.min(1, power);
  const v = 0.15 + 0.6 * p;
  // harder hits are brighter and louder, but never past the capped gain in MIX
  if (kind === 'button' && sample('disc-hit', lerp(MIX.disc, p), 0.94 + 0.12 * p)) return;
  if (kind === 'ball' && sample('ball-tap', lerp(MIX.ball, p), 0.95 + 0.1 * p)) return;
  if (kind === 'wall' && sample('wall-bounce', lerp(MIX.wall, p), 0.96 + 0.08 * p)) return;
  if (kind === 'keeper' && sample('disc-hit', lerp(MIX.keeper, p), 0.78)) return;
  const jitter = 0.92 + Math.random() * 0.16;
  if (kind === 'button') { tone('sine', 950 * jitter, 520, 0.07, v); burst('highpass', 3500, 1, 0.03, v * 0.6); }
  else if (kind === 'ball') { tone('triangle', 1500 * jitter, 900, 0.06, v); burst('bandpass', 2500, 2, 0.04, v * 0.5); }
  else if (kind === 'keeper') { tone('square', 300 * jitter, 180, 0.08, v * 0.5); }
  else { tone('sine', 190 * jitter, 90, 0.12, v); burst('lowpass', 500, 1, 0.1, v * 0.7); }
}

export function flick(power: number): void {
  if (!ready('flick', 0.05)) return;
  if (sample('flick', lerp(MIX.flick, Math.min(1, power)), 0.95 + 0.1 * power)) return;
  burst('bandpass', 700, 1.5, 0.12, 0.15 + 0.3 * power, 0, 2600);
}

export function superFlick(): void {
  if (!ready()) return;
  tone('sawtooth', 160, 40, 0.5, 0.5);
  burst('lowpass', 1800, 0.8, 0.6, 0.6, 0, 200);
  sample('flick', MIX.superFlick, 0.6, 0.02); // a deeper, heavier flick on top
}

export function superReady(): void {
  if (!ready()) return;
  [523, 659, 784, 1047, 1319].forEach((f, i) => tone('triangle', f, f, 0.18, 0.28, i * 0.07));
}

/** Foul or disallowed goal. */
export function whistle(): void {
  if (!ready()) return;
  crowdDip();
  if (!sample('whistle-foul', MIX.whistleFoul, 1, 0.02)) synthWhistle();
}

/** Kickoff: start of the match and after every goal. */
export function whistleStart(): void {
  if (!ready('whistle-start', 0.5)) return;
  crowdDip(0.7);
  sample('whistle-start', MIX.whistleStart, 1, 0.01);
}

export function goal(): void {
  if (!ready()) return;
  const net = sample('net', MIX.net, 1, 0.03);
  // the recorded roar is bright, so it is softened to sit with the new murmur
  const crowd = sample('crowd-goal', MIX.crowdGoal, 1, 0.01, 0.05, 3200);
  crowdSwell(MIX.goalSwell);
  if (!net) tone('sine', 120, 50, 0.4, 0.6);
  if (!crowd) {
    burst('bandpass', 900, 0.7, 2.4, 0.5, 0.05, 1400); // crowd roar
    [523, 659, 784, 1047, 784, 1047, 1319].forEach((f, i) => tone('triangle', f, f, 0.22, 0.32, i * 0.11));
  }
}

export function win(): void {
  if (!ready()) return;
  crowdSwell(MIX.winSwell, 2, 4);
  crowdDip(1.8);
  const w = sample('whistle-end', MIX.whistleEnd, 1, 0.01);
  const c = sample('crowd-goal', MIX.crowdGoal, 0.95, 0.01, 0.2, 3200);
  if (!w || !c) {
    burst('bandpass', 1100, 0.6, 3.2, 0.5, 0, 1800);
    [523, 659, 784, 1047, 1047, 784, 1047, 1319, 1568].forEach((f, i) => tone('square', f, f, 0.26, 0.2, i * 0.13));
  }
}

export function tick(): void {
  if (!ready('tick', 0.2)) return;
  tone('square', 880, 880, 0.05, 0.18);
}

export function click(): void {
  if (!ready('click', 0.05)) return;
  tone('sine', 600, 900, 0.05, 0.25);
}

/** Short vibration on phones that support it. */
export function buzz(pattern: number | number[]): void {
  if (muted) return;
  try { navigator.vibrate?.(pattern); } catch { /* unsupported */ }
}
