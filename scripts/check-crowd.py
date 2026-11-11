#!/usr/bin/env python3
"""Measure a looping ambience file: loudness, spectrum, breathing, and the loop seam.

    python3 scripts/check-crowd.py public/assets/sounds/crowd-loop.mp3 --pad 0.2 --length 8
    python3 scripts/check-crowd.py old.mp3 --trim 0.04        # a file with no pre/post-roll

Needs numpy and ffmpeg. Exits 1 if the file fails the limits at the bottom.
The seam test replays what the game does: play to the end of the loop window, jump to its start.
It is repeated for several window offsets, because a browser's decoder may shift the audio by the
encoder delay (a few ms) and the loop must be seamless wherever the window lands.
"""
import argparse
import re
import subprocess
import sys
import tempfile
import wave
from pathlib import Path

import numpy as np


def decode(path):
    with tempfile.TemporaryDirectory() as d:
        wav = Path(d) / "x.wav"
        subprocess.run(["ffmpeg", "-hide_banner", "-loglevel", "error", "-y", "-i", str(path), "-ac", "1", "-c:a", "pcm_s16le", str(wav)], check=True)
        with wave.open(str(wav)) as w:
            return np.frombuffer(w.readframes(w.getnframes()), dtype="<i2").astype(float) / 32768, w.getframerate()


def lufs(path):
    out = subprocess.run(["ffmpeg", "-hide_banner", "-nostats", "-i", str(path), "-af", "ebur128=peak=true", "-f", "null", "-"], capture_output=True, text=True).stderr
    summary = out[out.rfind("Summary:"):]
    return float(re.search(r"I:\s+(-?[\d.]+) LUFS", summary).group(1)), float(re.search(r"LRA:\s+([\d.]+) LU", summary).group(1)), float(re.search(r"Peak:\s+(-?[\d.]+) dBFS", summary).group(1))


db = lambda v: 20 * np.log10(max(v, 1e-9))


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("file")
    ap.add_argument("--pad", type=float, help="seconds of pre/post-roll around the loop window")
    ap.add_argument("--length", type=float, help="loop window length in seconds")
    ap.add_argument("--trim", type=float, default=0.0, help="no pre-roll: loop the file minus this many seconds at each end")
    a = ap.parse_args()

    x, sr = decode(a.file)
    start = int((a.pad if a.pad is not None else a.trim) * sr)
    end = start + int(a.length * sr) if a.length else len(x) - int(a.trim * sr)
    win = x[start:end]
    L = len(win)
    I, LRA, peak = lufs(a.file)
    rms = np.sqrt(np.mean(win ** 2))
    print(f"{a.file}: {len(x) / sr:.2f} s at {sr} Hz, loop window {L / sr:.2f} s, file {Path(a.file).stat().st_size / 1024:.1f} KB")
    print(f"loudness  integrated {I:.1f} LUFS, range {LRA:.1f} LU, true peak {peak:.1f} dBFS, window RMS {db(rms):.1f} dBFS")

    N = 4096
    acc = np.zeros(N // 2 + 1)
    for i in range(0, L - N, N // 2):
        acc += np.abs(np.fft.rfft(win[i:i + N] * np.hanning(N))) ** 2
    f = np.fft.rfftfreq(N, 1 / sr)
    share = lambda lo, hi: 100 * acc[(f >= lo) & (f < hi)].sum() / acc.sum()
    centroid = (f * acc).sum() / acc.sum()
    harsh = share(2000, 6000)
    print(f"spectrum  centroid {centroid:.0f} Hz | 100-1000 Hz {share(100, 1000):.0f}% | 2-6 kHz {harsh:.1f}% | above 6 kHz {share(6000, sr):.1f}%")
    fr = int(0.1 * sr)
    lv = np.array([db(np.sqrt(np.mean(win[i:i + fr] ** 2))) for i in range(0, L - fr, fr)])
    print(f"breathing 100 ms level std {lv.std():.2f} dB (range {lv.min():.0f} to {lv.max():.0f} dB)")

    # The seam. "excess" = biggest sample step within 50 ms of the seam, relative to the biggest step in
    # ordinary seam-free stretches of the same file (1.0 = indistinguishable from the rest of the audio).
    rng = np.random.default_rng(1)

    def ordinary(seconds):
        """Average biggest sample step over seam-free stretches as long as the stretch being tested."""
        span = int(seconds * sr)
        return np.mean([np.abs(np.diff(x[i:i + span])).max() for i in rng.integers(int(0.3 * sr), len(x) - span - int(0.3 * sr), 60)])

    worst_hard = worst_xf = worst_dip = 0.0
    if a.length:
        xf = start                                   # post-roll length == pad
        ord_hard, ord_xf = ordinary(0.1), ordinary(0.1 + xf / sr)
        w = np.linspace(0, 1, xf)
        for off in np.arange(-0.03, 0.0301, 0.01):  # a decoder may shift the audio a few ms
            s0 = start + int(off * sr)
            if s0 < 0 or s0 + L + xf > len(x):
                continue
            seg = x[s0:s0 + L + xf]
            half = int(0.05 * sr)
            hard = np.concatenate([seg[L - half:L], seg[:half]])                    # plain loop: jump from end to start
            worst_hard = max(worst_hard, np.abs(np.diff(hard)).max() / ord_hard)
            mix = seg[L:L + xf] * (1 - w) + seg[:xf] * w                            # crossfade into the next playback
            played = np.concatenate([seg[L - half:L], mix, seg[xf:xf + half]])
            worst_xf = max(worst_xf, np.abs(np.diff(played)).max() / ord_xf)
            worst_dip = max(worst_dip, abs(db(np.sqrt(np.mean(mix ** 2))) - db(np.sqrt(np.mean(seg[:xf] ** 2)))))   # vs the audio it should equal
        print(f"loop seam  plain loop {worst_hard:.2f}x | crossfaded loop {worst_xf:.2f}x (1.00 = like ordinary audio), level dip in the crossfade {worst_dip:.1f} dB")
    else:
        hard = np.concatenate([win[-int(0.05 * sr):], win[:int(0.05 * sr)]])
        worst_hard = np.abs(np.diff(hard)).max() / ordinary(0.1)
        print(f"loop seam  plain hard splice {worst_hard:.2f}x (1.00 = like ordinary audio); last 50 ms "
              f"{db(np.sqrt(np.mean(win[-int(.05 * sr):] ** 2))):.1f} dB vs first 50 ms {db(np.sqrt(np.mean(win[:int(.05 * sr)] ** 2))):.1f} dB")

    bad = []
    if centroid > 900: bad.append(f"centroid {centroid:.0f} Hz > 900 (too bright for a murmur)")
    if harsh > 3: bad.append(f"{harsh:.1f}% of power in 2-6 kHz > 3%")
    if I > -22: bad.append(f"{I:.1f} LUFS > -22 (too loud for a background bed)")
    if peak > -6: bad.append(f"peak {peak:.1f} dBFS > -6")
    if lv.std() < 1.5: bad.append(f"level std {lv.std():.2f} dB < 1.5 (flat, does not breathe)")
    if a.length and worst_xf > 1.25: bad.append(f"crossfaded seam {worst_xf:.2f}x > 1.25")
    if a.length and worst_dip > 1.5: bad.append(f"crossfade level dip {worst_dip:.1f} dB > 1.5")
    print("PASS" if not bad else "FAIL: " + "; ".join(bad))
    return 1 if bad else 0


if __name__ == "__main__":
    sys.exit(main())
