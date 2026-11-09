/** Tiny WebAudio synth: every sound is generated in code, no audio files. */
let ac: AudioContext | null = null;
let master: GainNode | null = null;
let noise: AudioBuffer | null = null;
let muted = false;
try { muted = localStorage.getItem('botao-muted') === '1'; } catch { /* storage may be unavailable */ }

const lastPlayed: Record<string, number> = {};

/** Must be called from a user gesture (tap) before sounds can play on phones. */
export function unlock(): void {
  if (!ac) {
    try {
      const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      ac = new Ctor();
      master = ac.createGain();
      master.gain.value = muted ? 0 : 0.7;
      master.connect(ac.destination);
      noise = ac.createBuffer(1, ac.sampleRate, ac.sampleRate);
      const d = noise.getChannelData(0);
      for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    } catch { ac = null; }
  }
  void ac?.resume();
}

export function isMuted(): boolean { return muted; }
export function setMuted(m: boolean): void {
  muted = m;
  try { localStorage.setItem('botao-muted', m ? '1' : '0'); } catch { /* ignore */ }
  if (master) master.gain.value = m ? 0 : 0.7;
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

/** `power` is 0..1 (how hard the impact was). */
export function hit(kind: 'button' | 'ball' | 'wall' | 'keeper', power: number): void {
  if (!ready(`hit-${kind}`, 0.035)) return;
  const v = 0.15 + 0.6 * Math.min(1, power);
  const jitter = 0.92 + Math.random() * 0.16;
  if (kind === 'button') { tone('sine', 950 * jitter, 520, 0.07, v); burst('highpass', 3500, 1, 0.03, v * 0.6); }
  else if (kind === 'ball') { tone('triangle', 1500 * jitter, 900, 0.06, v); burst('bandpass', 2500, 2, 0.04, v * 0.5); }
  else if (kind === 'keeper') { tone('square', 300 * jitter, 180, 0.08, v * 0.5); }
  else { tone('sine', 190 * jitter, 90, 0.12, v); burst('lowpass', 500, 1, 0.1, v * 0.7); }
}

export function flick(power: number): void {
  if (!ready('flick', 0.05)) return;
  burst('bandpass', 700, 1.5, 0.12, 0.15 + 0.3 * power, 0, 2600);
}

export function superFlick(): void {
  if (!ready()) return;
  tone('sawtooth', 160, 40, 0.5, 0.5);
  burst('lowpass', 1800, 0.8, 0.6, 0.6, 0, 200);
}

export function superReady(): void {
  if (!ready()) return;
  [523, 659, 784, 1047, 1319].forEach((f, i) => tone('triangle', f, f, 0.18, 0.28, i * 0.07));
}

export function whistle(): void {
  if (!ready()) return;
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

export function goal(): void {
  if (!ready()) return;
  burst('bandpass', 900, 0.7, 2.4, 0.5, 0.05, 1400); // crowd roar
  [523, 659, 784, 1047, 784, 1047, 1319].forEach((f, i) => tone('triangle', f, f, 0.22, 0.32, i * 0.11));
  tone('sine', 120, 50, 0.4, 0.6);
}

export function win(): void {
  if (!ready()) return;
  burst('bandpass', 1100, 0.6, 3.2, 0.5, 0, 1800);
  [523, 659, 784, 1047, 1047, 784, 1047, 1319, 1568].forEach((f, i) => tone('square', f, f, 0.26, 0.2, i * 0.13));
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
