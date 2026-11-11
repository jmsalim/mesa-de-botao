/**
 * Sound. The recorded samples in public/assets/sounds are fetched after the first tap (phones only
 * allow audio then) and played with WebAudio. Until a sample has decoded, or if it fails to load,
 * the small synthesized versions below play instead, so there is never silence or a wait.
 */
import { SOUND_NAMES, assetUrl, type SoundName } from './assets';

let ac: AudioContext | null = null;
let master: GainNode | null = null;
let noise: AudioBuffer | null = null;
let muted = false;
try { muted = localStorage.getItem('botao-muted') === '1'; } catch { /* storage may be unavailable */ }

const lastPlayed: Record<string, number> = {};
const buffers: Partial<Record<SoundName, AudioBuffer>> = {};
let loadStarted = false;

// ---------- crowd ambience ----------
const CROWD_LEVEL = 0.16;
let crowdWanted = false;
let crowdGain: GainNode | null = null;
let crowdSrc: AudioBufferSourceNode | null = null;

/** Must be called from a user gesture (tap) before sounds can play on phones. */
export function unlock(): void {
  if (!ac) {
    try {
      const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      ac = new Ctor();
      master = ac.createGain();
      master.gain.value = muted ? 0 : 0.8;
      master.connect(ac.destination);
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
  if (master) master.gain.value = m ? 0 : 0.8;
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
function sample(name: SoundName, gain = 1, rate = 1, jitter = 0.05, delay = 0): boolean {
  const b = buffers[name];
  if (!b || !ac || !master) return false;
  const src = ac.createBufferSource();
  src.buffer = b;
  src.playbackRate.value = rate * (1 + (Math.random() - 0.5) * 2 * jitter);
  const g = ac.createGain();
  g.gain.value = gain;
  src.connect(g).connect(master);
  src.start(ac.currentTime + delay);
  return true;
}

export function crowdOn(on: boolean): void {
  crowdWanted = on;
  if (on) startCrowd(); else stopCrowd();
}

function startCrowd(): void {
  const b = buffers['crowd-loop'];
  if (!crowdWanted || !b || !ac || !master || crowdSrc) return;
  crowdGain = ac.createGain();
  crowdGain.gain.value = 0;
  crowdGain.gain.linearRampToValueAtTime(CROWD_LEVEL, ac.currentTime + 1.5);
  const src = ac.createBufferSource();
  src.buffer = b; src.loop = true;
  // mp3 decoding leaves a few ms of padding at both ends: loop just inside them
  src.loopStart = 0.04; src.loopEnd = Math.max(0.5, b.duration - 0.04);
  src.connect(crowdGain).connect(master);
  src.start();
  crowdSrc = src;
}

function stopCrowd(): void {
  if (!crowdSrc || !crowdGain || !ac) return;
  const src = crowdSrc, g = crowdGain;
  g.gain.cancelScheduledValues(ac.currentTime);
  g.gain.setValueAtTime(g.gain.value, ac.currentTime);
  g.gain.linearRampToValueAtTime(0, ac.currentTime + 0.6);
  src.stop(ac.currentTime + 0.7);
  crowdSrc = null; crowdGain = null;
}

/** The crowd rises for a moment (goal) and settles back. */
function crowdSwell(peak = 0.5, seconds = 3): void {
  if (!crowdGain || !ac) return;
  const t = ac.currentTime;
  crowdGain.gain.cancelScheduledValues(t);
  crowdGain.gain.setValueAtTime(crowdGain.gain.value, t);
  crowdGain.gain.linearRampToValueAtTime(peak, t + 0.35);
  crowdGain.gain.linearRampToValueAtTime(CROWD_LEVEL, t + seconds);
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
/** `power` is 0..1 (how hard the impact was). */
export function hit(kind: 'button' | 'ball' | 'wall' | 'keeper', power: number): void {
  if (!ready(`hit-${kind}`, 0.035)) return;
  const p = Math.min(1, power);
  const v = 0.15 + 0.6 * p;
  // recorded files are quiet (about -18 dB), so they get a lift; harder hits are brighter and louder
  if (kind === 'button' && sample('disc-hit', 0.55 + 1.6 * p, 0.94 + 0.12 * p)) return;
  if (kind === 'ball' && sample('ball-tap', 0.6 + 1.7 * p, 0.95 + 0.1 * p)) return;
  if (kind === 'wall' && sample('wall-bounce', 0.5 + 1.6 * p, 0.96 + 0.08 * p)) return;
  if (kind === 'keeper' && sample('disc-hit', 0.5 + 1.1 * p, 0.78)) return;
  const jitter = 0.92 + Math.random() * 0.16;
  if (kind === 'button') { tone('sine', 950 * jitter, 520, 0.07, v); burst('highpass', 3500, 1, 0.03, v * 0.6); }
  else if (kind === 'ball') { tone('triangle', 1500 * jitter, 900, 0.06, v); burst('bandpass', 2500, 2, 0.04, v * 0.5); }
  else if (kind === 'keeper') { tone('square', 300 * jitter, 180, 0.08, v * 0.5); }
  else { tone('sine', 190 * jitter, 90, 0.12, v); burst('lowpass', 500, 1, 0.1, v * 0.7); }
}

export function flick(power: number): void {
  if (!ready('flick', 0.05)) return;
  if (sample('flick', 0.7 + 1.1 * power, 0.95 + 0.1 * power)) return;
  burst('bandpass', 700, 1.5, 0.12, 0.15 + 0.3 * power, 0, 2600);
}

export function superFlick(): void {
  if (!ready()) return;
  tone('sawtooth', 160, 40, 0.5, 0.5);
  burst('lowpass', 1800, 0.8, 0.6, 0.6, 0, 200);
  sample('flick', 1.8, 0.6, 0.02); // a deeper, heavier flick on top
}

export function superReady(): void {
  if (!ready()) return;
  [523, 659, 784, 1047, 1319].forEach((f, i) => tone('triangle', f, f, 0.18, 0.28, i * 0.07));
}

/** Foul or disallowed goal. */
export function whistle(): void {
  if (!ready()) return;
  if (!sample('whistle-foul', 0.6, 1, 0.02)) synthWhistle();
}

/** Kickoff: start of the match and after every goal. */
export function whistleStart(): void {
  if (!ready('whistle-start', 0.5)) return;
  sample('whistle-start', 0.55, 1, 0.01);
}

export function goal(): void {
  if (!ready()) return;
  const net = sample('net', 1.4, 1, 0.03);
  const crowd = sample('crowd-goal', 0.9, 1, 0.01, 0.05);
  crowdSwell();
  if (!net) tone('sine', 120, 50, 0.4, 0.6);
  if (!crowd) {
    burst('bandpass', 900, 0.7, 2.4, 0.5, 0.05, 1400); // crowd roar
    [523, 659, 784, 1047, 784, 1047, 1319].forEach((f, i) => tone('triangle', f, f, 0.22, 0.32, i * 0.11));
  }
}

export function win(): void {
  if (!ready()) return;
  crowdSwell(0.6, 5);
  const w = sample('whistle-end', 0.6, 1, 0.01);
  const c = sample('crowd-goal', 1, 0.95, 0.01, 0.2);
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
