#!/usr/bin/env python3
"""Synthesize public/assets/sounds/crowd-loop.mp3: a soft stadium murmur that loops without a seam.

    python3 scripts/make-crowd.py            # needs numpy and ffmpeg

How it is built (everything is deterministic, seed below):
  * ~150 unintelligible "voices": a gliding glottal-style pulse train through two or three random
    formants, each a short soft syllable. Their sum is a babble, not a hiss.
  * a low rumble bed for the sense of distance, and a diffuse room tail (circular convolution).
  * slow swells (whole numbers of cycles per loop) so the crowd breathes a few dB.
  * a gentle low-pass: almost nothing above 3 kHz, where the whistles and hits live.
Every step is circular (FFT filters, wrapped voice placement, whole-cycle modulation), so the signal
repeats EXACTLY every LOOP seconds. The file then carries PAD seconds of the loop's tail in front and
of its head behind, and the player loops the window [PAD, PAD + LOOP]. Any decoder start offset or
encoder padding smaller than PAD lands inside valid audio, so the seam cannot click.
"""
import subprocess
import sys
import tempfile
import wave
from pathlib import Path

import numpy as np

SR = 22050          # a murmur has nothing to say above ~5 kHz
LOOP = 8.0          # seconds in the loop (keep in sync with CROWD_LOOP in src/assets.ts)
PAD = 0.2           # seconds of pre-roll and post-roll (CROWD_LOOP.pad)
BITRATE = "48k"
TARGET_RMS_DB = -24.0   # level of the file; the game turns it down further
SEED = 20261111

N = int(SR * LOOP)
rng = np.random.default_rng(SEED)
freqs = np.fft.rfftfreq(N, 1 / SR)
OUT = Path(__file__).resolve().parent.parent / "public" / "assets" / "sounds" / "crowd-loop.mp3"


def hp(f, fc, order=2):
    return 1 / np.sqrt(1 + (fc / np.maximum(f, 1e-6)) ** (2 * order))


def lp(f, fc, order=2):
    return 1 / np.sqrt(1 + (f / fc) ** (2 * order))


def periodic_noise(mag):
    spec = (rng.standard_normal(len(freqs)) + 1j * rng.standard_normal(len(freqs))) * mag
    spec[0] = 0
    return np.fft.irfft(spec, N)


def voice(dur, f0a, f0b, formants):
    n = int(dur * SR)
    f0 = np.linspace(f0a, f0b, n)
    phase = 2 * np.pi * np.cumsum(f0) / SR
    src = np.zeros(n)
    for h in range(1, int(3200 / max(f0a, f0b)) + 1):        # glottal-like: harmonics roll off as 1/h^1.2
        src += np.sin(h * phase + rng.uniform(0, 2 * np.pi)) / h ** 1.2
    src += 0.25 * rng.standard_normal(n) * (src.std() or 1)  # a little breath
    spec = np.fft.rfft(src)
    f = np.fft.rfftfreq(n, 1 / SR)
    mag = np.zeros_like(f)
    for fc, bw, g in formants:
        mag += g / (1 + ((f - fc) / (bw / 2)) ** 2)
    y = np.fft.irfft(spec * mag, n)
    t = np.linspace(0, 1, n)
    env = np.sin(np.pi * t) ** 1.6                           # soft attack and release
    return y * env / (np.abs(y).max() + 1e-9)


def place(buf, y, start):
    """Add y into the circular buffer at `start`, wrapping past the end (keeps the loop periodic)."""
    idx = (start + np.arange(len(y))) % N
    np.add.at(buf, idx, y)


def build():
    # 1. babble of voices
    babble = np.zeros(N)
    for _ in range(150):
        dur = rng.uniform(0.14, 0.42)
        f0 = rng.uniform(95, 250)
        formants = [
            (rng.uniform(300, 800), rng.uniform(80, 150), 1.0),
            (rng.uniform(900, 2300), rng.uniform(120, 250), 0.55),
            (rng.uniform(2300, 3000), rng.uniform(200, 300), 0.18),
        ]
        y = voice(dur, f0, f0 * rng.uniform(0.85, 1.18), formants)
        place(babble, y * rng.lognormal(-0.2, 0.55), rng.integers(0, N))
    # 2. distant rumble
    rumble = periodic_noise(hp(freqs, 70, 2) * lp(freqs, 650, 2) / np.sqrt(freqs + 60))
    rumble /= rumble.std()
    # 3. breathing: whole cycles per loop so it stays periodic
    t = np.arange(N) / SR
    sw = (1 + 0.20 * np.sin(2 * np.pi * 2 * t / LOOP + 0.7)
            + 0.13 * np.sin(2 * np.pi * 5 * t / LOOP + 2.1)
            + 0.07 * np.sin(2 * np.pi * 13 * t / LOOP + 4.0))
    dry = (babble / babble.std()) * sw + 0.55 * rumble * (1 + 0.1 * np.sin(2 * np.pi * 3 * t / LOOP + 1.3))
    # 4. diffuse room: circular convolution with a decaying noise tail (about 0.7 s)
    tail = np.zeros(N)
    m = int(0.7 * SR)
    tail[:m] = rng.standard_normal(m) * np.exp(-np.arange(m) / (0.22 * SR))
    tail = np.fft.irfft(np.fft.rfft(tail) * lp(freqs, 2500, 1), N)
    wet = np.fft.irfft(np.fft.rfft(dry) * np.fft.rfft(tail), N)
    wet *= dry.std() / (wet.std() + 1e-9)
    mix = 0.68 * dry + 0.42 * wet
    # 5. final tone: soft top end, no sub-bass
    spec = np.fft.rfft(mix) * hp(freqs, 85, 2) * lp(freqs, 2600, 2)
    y = np.fft.irfft(spec, N)
    y *= 10 ** (TARGET_RMS_DB / 20) / y.std()
    y = np.tanh(y * 1.6) / 1.6                                  # catch any rare peak softly
    return y


def write_wav(path, x):
    pcm = (np.clip(x, -1, 1) * 32767).astype("<i2")
    with wave.open(str(path), "wb") as w:
        w.setnchannels(1); w.setsampwidth(2); w.setframerate(SR); w.writeframes(pcm.tobytes())


def main():
    loop = build()
    pad = int(round(PAD * SR))
    file = np.concatenate([loop[-pad:], loop, loop[:pad]])       # tail in front, head behind
    with tempfile.TemporaryDirectory() as d:
        wav = Path(d) / "crowd.wav"
        write_wav(wav, file)
        OUT.parent.mkdir(parents=True, exist_ok=True)
        subprocess.run(["ffmpeg", "-hide_banner", "-loglevel", "error", "-y", "-i", str(wav),
                        "-c:a", "libmp3lame", "-b:a", BITRATE, "-ar", str(SR), "-ac", "1",
                        "-map_metadata", "-1", "-fflags", "+bitexact", "-write_id3v2", "0", str(OUT)], check=True)
    print(f"wrote {OUT} ({OUT.stat().st_size / 1024:.1f} KB, {len(file) / SR:.2f} s = {PAD} + {LOOP} + {PAD})")


if __name__ == "__main__":
    sys.exit(main())
