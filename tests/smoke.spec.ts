import { expect, test, type Page } from '@playwright/test';

type Dbg = {
  state: { phase: string; turn: number; declared: boolean; score: number[]; flicksLeft: number };
  phys: { buttons: { getPosition(): { x: number; y: number } }[][]; ballPos(): { x: number; y: number }; ball: { setPosition(p: { x: number; y: number }): void } };
  layout: { m: { a: number; b: number; c: number; d: number; e: number; f: number } };
};

const toScreen = (page: Page, x: number, y: number) =>
  page.evaluate(([x, y]) => {
    const d = (window as unknown as { __botao: Dbg }).__botao;
    const { a, b, c, d: dd, e, f } = d.layout.m;
    const r = document.getElementById('board')!.getBoundingClientRect();
    return { x: r.left + a * x + c * y + e, y: r.top + b * x + dd * y + f };
  }, [x, y] as const);

const pos = (page: Page, team: number, idx: number) =>
  page.evaluate(([t, i]) => (window as unknown as { __botao: Dbg }).__botao.phys.buttons[t][i].getPosition(), [team, idx] as const);

const dbg = <T,>(page: Page, fn: (d: Dbg) => T) =>
  page.evaluate(`(${fn.toString()})(window.__botao)`) as Promise<T>;

async function flick(page: Page, team: number, idx: number, dx: number, dy: number) {
  const p = await pos(page, team, idx);
  const from = await toScreen(page, p.x, p.y);
  // pull back opposite to the intended direction, in world units
  const to = await toScreen(page, p.x - dx, p.y - dy);
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move((from.x + to.x) / 2, (from.y + to.y) / 2, { steps: 4 });
  await page.mouse.move(to.x, to.y, { steps: 4 });
  await page.mouse.up();
}

for (const vp of [{ name: 'portrait', width: 390, height: 844 }, { name: 'landscape', width: 1280, height: 720 }]) {
  test.describe(vp.name, () => {
    test.use({ viewport: { width: vp.width, height: vp.height } });

    test('loads, starts, and a flick moves a button', async ({ page }) => {
      const errors: string[] = [];
      page.on('pageerror', (e) => errors.push(String(e)));
      await page.goto('./');
      await expect(page.locator('#ov-title')).toHaveText('Mesa de Botão');
      await page.screenshot({ path: `test-results/${vp.name}-start.png` });
      await page.click('#ov-btn');
      await expect(page.locator('#overlay')).toBeHidden();

      const before = await pos(page, 0, 2);
      // flick team 0's front button towards the opponent (+x) but away from the ball: aim up-right
      await flick(page, 0, 2, 1.2, -1.0);
      await page.waitForTimeout(300);
      await page.screenshot({ path: `test-results/${vp.name}-moving.png` });
      await expect.poll(() => dbg(page, (d) => d.state.phase), { timeout: 15_000 }).toBe('aim');
      const after = await pos(page, 0, 2);
      expect(Math.hypot(after.x - before.x, after.y - before.y)).toBeGreaterThan(0.5);
      // missed the ball, so the turn passes to team 1
      expect(await dbg(page, (d) => d.state.turn)).toBe(1);
      expect(errors).toEqual([]);
    });

    test('shot call triggers the keeper pause', async ({ page }) => {
      await page.goto('./');
      await page.click('#ov-btn');
      await page.click('#shoot');
      expect(await dbg(page, (d) => d.state.phase)).toBe('keeper');
      await page.screenshot({ path: `test-results/${vp.name}-keeper.png` });
      await page.click('#shoot');
      expect(await dbg(page, (d) => d.state.phase)).toBe('aim');
      expect(await dbg(page, (d) => d.state.declared)).toBe(true);
    });
  });
}

test('a called shot into an open goal scores', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 720 });
  await page.goto('./');
  await page.click('#ov-btn');
  // set up a clear shot: ball and button lined up, opponent keeper off to one side
  await page.evaluate(() => {
    const d = (window as unknown as { __botao: Dbg & { phys: { setKeeperY(t: number, y: number): void; buttons: { setPosition(p: { x: number; y: number }): void }[][] } } }).__botao;
    d.phys.buttons[0][3].setPosition({ x: 6.5, y: 2.9 });
    d.phys.ball.setPosition({ x: 7.7, y: 2.9 });
    d.phys.setKeeperY(1, -100); // keeper tucked to the far side of the goal
  });
  await page.click('#shoot'); // call the shot
  await page.click('#shoot'); // keeper ready
  await flick(page, 0, 3, 2, 0);
  await expect.poll(() => dbg(page, (d) => d.state.score.join('-')), { timeout: 10_000 }).toBe('1-0');
  await page.waitForTimeout(700);
  await page.screenshot({ path: 'test-results/goal.png' });
  // the ball rolled into the net behind the goal line and stays there
  const bx = await page.evaluate(() => (window as unknown as { __botao: Dbg }).__botao.phys.ballPos().x);
  expect(bx).toBeGreaterThan(9);
  expect(bx).toBeLessThan(9.7);
  // after the celebration the game resumes from kickoff with team 1 to play
  await expect.poll(() => dbg(page, (d) => d.state.phase), { timeout: 10_000 }).toBe('aim');
  expect(await dbg(page, (d) => d.state.turn)).toBe(1);
});

test.describe('vs computer', () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test('the level picker offers three levels, remembers the choice and labels the CPU', async ({ page }) => {
    await page.goto('./');
    await page.click('#ov-btn2'); // "Contra o computador" -> level picker
    await expect(page.locator('#ov-title')).toHaveText('Escolha a dificuldade');
    await expect(page.locator('#ov-btn')).toHaveText('Fácil');
    await expect(page.locator('#ov-btn2')).toHaveText('Médio');
    await expect(page.locator('#ov-btn3')).toHaveText('Difícil');
    await page.screenshot({ path: 'test-results/level-picker.png' });
    await page.click('#ov-btn'); // Fácil
    await expect(page.locator('#overlay')).toBeHidden();
    await expect(page.locator('#name1')).toContainText('Fácil');
    expect(await dbg(page, (d) => (d as unknown as { cpuLevel: string }).cpuLevel)).toBe('easy');
    expect(await page.evaluate(() => localStorage.getItem('botao-level'))).toBe('easy');
    // reload: the picker highlights the last used level and "back" returns to the menu
    await page.reload();
    await page.click('#ov-btn2');
    await expect(page.locator('#ov-btn')).not.toHaveClass(/alt/); // Fácil is the highlighted one
    await page.click('#ov-back');
    await expect(page.locator('#ov-title')).toHaveText('Mesa de Botão');
  });

  for (const level of [['#ov-btn', 'easy'], ['#ov-btn2', 'medium'], ['#ov-btn3', 'hard']] as const) {
    test(`CPU (${level[1]}) takes its turn on its own and the human gets the board back`, async ({ page }) => {
      test.setTimeout(90_000); // the CPU may take up to 3 flicks in a row
      const errors: string[] = [];
      page.on('pageerror', (e) => errors.push(String(e)));
      await page.goto('./');
      await page.click('#ov-btn2');
      await page.click(level[0]);
      expect(await dbg(page, (d) => (d as unknown as { cpuLevel: string }).cpuLevel)).toBe(level[1]);
      // human misses the ball, so it becomes the CPU's turn
      await flick(page, 0, 0, 0, -1.2);
      await expect.poll(() => dbg(page, (d) => d.state.turn), { timeout: 15_000 }).toBe(1);
      // the human cannot pick up the CPU's buttons
      const p = await pos(page, 1, 2);
      const s = await toScreen(page, p.x, p.y);
      await page.mouse.move(s.x, s.y); await page.mouse.down(); await page.mouse.move(s.x + 40, s.y + 40, { steps: 3 });
      await page.screenshot({ path: `test-results/vs-cpu-${level[1]}-cpu-turn.png` });
      await page.mouse.up();
      // ...and the CPU flicks by itself; the turn comes back to the human after it settles
      await expect.poll(async () => (await dbg(page, (d) => d.state.phase)) === 'aim' && (await dbg(page, (d) => d.state.turn)) === 0, { timeout: 40_000 }).toBe(true);
      expect(errors).toEqual([]);
    });
  }

  test('the hard CPU keeps the page responsive while it thinks', async ({ page }) => {
    await page.goto('./');
    await page.click('#ov-btn2');
    await page.click('#ov-btn3');
    await flick(page, 0, 0, 0, -1.2);
    await expect.poll(() => dbg(page, (d) => d.state.turn), { timeout: 15_000 }).toBe(1);
    // sample frame gaps while the CPU is searching
    const worst = await page.evaluate(() => new Promise<number>((resolve) => {
      let last = performance.now(), worst = 0, frames = 0;
      const tick = (now: number) => { worst = Math.max(worst, now - last); last = now; if (++frames < 45) requestAnimationFrame(tick); else resolve(worst); };
      requestAnimationFrame(tick);
    }));
    expect(worst).toBeLessThan(250); // no long freezes (generous: CI machines are slow)
  });
});

test('aim preview and super charge render without errors', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('./');
  await page.click('#ov-btn');
  await page.evaluate(() => { (window as unknown as { __botao: { state: { charge: number[] } } }).__botao.state.charge[0] = 3; });
  const p = await pos(page, 0, 2);
  const from = await toScreen(page, p.x, p.y);
  const to = await toScreen(page, p.x - 1.2, p.y + 0.9);
  await page.mouse.move(from.x, from.y); await page.mouse.down();
  await page.mouse.move(to.x, to.y, { steps: 6 });
  await page.screenshot({ path: 'test-results/aim-preview.png' });
  await page.mouse.up();
  await page.waitForTimeout(250);
  await page.screenshot({ path: 'test-results/super-flick.png' });
  expect(errors).toEqual([]);
});

test.describe('real-table assets', () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test('all textures and images load with no failed requests, and the samples decode', async ({ page }) => {
    const bad: string[] = [];
    const seen: string[] = [];
    page.on('response', (r) => { if (r.url().includes('/assets/')) { seen.push(r.url()); if (r.status() !== 200) bad.push(`${r.status()} ${r.url()}`); } });
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(String(e)));
    await page.goto('./');
    await expect.poll(() => dbg(page, (d) => (d as unknown as { texturesLoaded: boolean }).texturesLoaded), { timeout: 10_000 }).toBe(true);
    await page.click('#ov-btn'); // the first tap unlocks audio and starts fetching the samples
    await expect.poll(() => page.evaluate(() => (window as any).__botao.audio.samplesLoaded().length), { timeout: 15_000 }).toBe(10);
    expect(bad).toEqual([]);
    expect(seen.some((u) => u.endsWith('feltro.webp'))).toBe(true);
    expect(seen.some((u) => u.endsWith('crowd-loop.mp3'))).toBe(true);
    // the heavy-ish table illustration is only for the menu; sounds only after the first tap
    expect(errors).toEqual([]);
  });

  test('the piece picker changes materials, swaps when you pick the other team\'s, and is remembered', async ({ page }) => {
    await page.goto('./');
    await expect(page.locator('#skins')).toBeVisible();
    expect(await dbg(page, (d) => (d as unknown as { skins: string[] }).skins)).toEqual(['perolado', 'tartaruga']);
    // team 2 picks acrylic
    await page.locator('#sw1 .swatch').nth(2).click();
    expect(await dbg(page, (d) => (d as unknown as { skins: string[] }).skins)).toEqual(['perolado', 'acrilico']);
    // team 1 picks acrylic: taken by team 2, so they swap
    await page.locator('#sw0 .swatch').nth(2).click();
    expect(await dbg(page, (d) => (d as unknown as { skins: string[] }).skins)).toEqual(['acrilico', 'perolado']);
    await expect(page.locator('#name0')).toHaveText('Acrílico');
    await page.reload();
    expect(await dbg(page, (d) => (d as unknown as { skins: string[] }).skins)).toEqual(['acrilico', 'perolado']);
    await page.screenshot({ path: 'test-results/start-picker.png' });
  });

  for (const vp of [{ w: 390, h: 844 }, { w: 375, h: 667 }, { w: 320, h: 568 }]) {
    test(`the start buttons and piece picker are on screen without scrolling (${vp.w}x${vp.h})`, async ({ page }) => {
      await page.setViewportSize({ width: vp.w, height: vp.h });
      await page.goto('./');
      await expect(page.locator('#ov-btn')).toBeInViewport({ ratio: 1 });
      await expect(page.locator('#ov-btn2')).toBeInViewport({ ratio: 1 });
      await expect(page.locator('#skins')).toBeInViewport({ ratio: 1 });
      await expect(page.locator('#ov-sound')).toBeInViewport({ ratio: 1 });
      // nothing makes the layout wider than the screen (it used to on 320 px phones)
      const widths = await page.evaluate(() => ({ app: document.getElementById('app')!.getBoundingClientRect().width, card: document.querySelector('.card')!.getBoundingClientRect().right }));
      expect(widths.app).toBeLessThanOrEqual(vp.w);
      expect(widths.card).toBeLessThanOrEqual(vp.w);
    });
  }

  for (const w of [430, 390, 375, 360]) {
    test(`team names in the score bar are not cut off (${w} px wide)`, async ({ page }) => {
      await page.setViewportSize({ width: w, height: 800 });
      await page.goto('./');
      for (const id of ['#name0', '#name1']) {
        const m = await page.locator(id).evaluate((e) => ({ scroll: e.scrollWidth, client: e.clientWidth }));
        expect(m.scroll, `${id} is truncated at ${w}px`).toBeLessThanOrEqual(m.client);
      }
    });
  }

  test('recorded samples are what plays: flick, collisions, and a looping crowd', async ({ page }) => {
    await page.addInitScript(() => {
      const w = window as unknown as { __starts: { d: number; loop: boolean }[] };
      w.__starts = [];
      const orig = AudioBufferSourceNode.prototype.start;
      AudioBufferSourceNode.prototype.start = function (...a: Parameters<typeof orig>) {
        w.__starts.push({ d: this.buffer ? +this.buffer.duration.toFixed(2) : 0, loop: this.loop });
        return orig.apply(this, a);
      };
    });
    await page.goto('./');
    await page.click('#ov-btn');
    await expect.poll(() => page.evaluate(() => (window as any).__botao.audio.samplesLoaded().length), { timeout: 15_000 }).toBe(10);
    await flick(page, 0, 3, 1.3, -0.8); // team 1's front button at the ball: flick, then a collision
    await expect.poll(() => dbg(page, (d) => d.state.phase), { timeout: 15_000 }).toBe('aim');
    const starts = await page.evaluate(() => (window as any).__starts as { d: number; loop: boolean }[]);
    // the crowd is an 8 s loop
    expect(starts.some((x) => x.loop && x.d > 7 && x.d < 9)).toBe(true);
    // short one-shot samples played (flick / disc-hit / ball-tap / wall-bounce are all under 0.3 s)...
    const shots = starts.filter((x) => !x.loop && x.d > 0.05 && x.d < 0.3);
    expect(shots.length).toBeGreaterThanOrEqual(2);
    // ...and the 1 s synthesized noise fallback was not used for them
    expect(starts.filter((x) => !x.loop && x.d === 1)).toEqual([]);
  });
});

test.describe('crowd sound', () => {
  test.use({ viewport: { width: 390, height: 844 } });

  /** Decode a sound in the browser and return its samples (the real decoder, not ffmpeg). */
  const decodeInPage = (page: Page, name: string) =>
    page.evaluate(async (n) => {
      const res = await fetch(`/mesa-de-botao/assets/sounds/${n}.mp3`);
      const off = new OfflineAudioContext(1, 44100, 44100);
      const buf = await off.decodeAudioData(await res.arrayBuffer());
      const x = buf.getChannelData(0);
      let peak = 0, sum = 0;
      for (let i = 0; i < x.length; i++) { peak = Math.max(peak, Math.abs(x[i])); sum += x[i] * x[i]; }
      return { peak, rms: Math.sqrt(sum / x.length), seconds: buf.duration };
    }, name);

  test('the new crowd loop is a soft, quiet murmur and loops without a seam (real browser decoder)', async ({ page }) => {
    await page.goto('./');
    const r = await page.evaluate(async () => {
      const base = '/mesa-de-botao/assets/sounds/crowd-loop.mp3';
      const PAD = 0.2, LEN = 8;
      const dec = new OfflineAudioContext(1, 22050, 22050);
      const buf = await dec.decodeAudioData(await (await fetch(base)).arrayBuffer());
      const sr = buf.sampleRate;
      // play it the way the game does: loop the window [pad, pad+length], for 26 s
      const secs = 26;
      const off = new OfflineAudioContext(1, Math.ceil(sr * secs), sr);
      const src = off.createBufferSource();
      src.buffer = buf; src.loop = true; src.loopStart = PAD; src.loopEnd = PAD + LEN;
      src.connect(off.destination); src.start(0, PAD);
      const x = (await off.startRendering()).getChannelData(0);
      const db = (v: number) => 20 * Math.log10(Math.max(v, 1e-9));
      // spectrum (average of Hann-windowed 4096 FFTs, naive radix-2)
      const N = 4096;
      const fft = (re: Float64Array, im: Float64Array) => {
        for (let i = 1, j = 0; i < N; i++) { let bit = N >> 1; for (; j & bit; bit >>= 1) j ^= bit; j ^= bit; if (i < j) { [re[i], re[j]] = [re[j], re[i]]; [im[i], im[j]] = [im[j], im[i]]; } }
        for (let len = 2; len <= N; len <<= 1) {
          const ang = (-2 * Math.PI) / len;
          for (let i = 0; i < N; i += len) for (let k = 0; k < len / 2; k++) {
            const wr = Math.cos(ang * k), wi = Math.sin(ang * k);
            const ur = re[i + k], ui = im[i + k];
            const vr = re[i + k + len / 2] * wr - im[i + k + len / 2] * wi, vi = re[i + k + len / 2] * wi + im[i + k + len / 2] * wr;
            re[i + k] = ur + vr; im[i + k] = ui + vi; re[i + k + len / 2] = ur - vr; im[i + k + len / 2] = ui - vi;
          }
        }
      };
      const psd = new Float64Array(N / 2);
      for (let s = sr; s + N < x.length; s += N) {
        const re = new Float64Array(N), im = new Float64Array(N);
        for (let i = 0; i < N; i++) re[i] = x[s + i] * (0.5 - 0.5 * Math.cos((2 * Math.PI * i) / N));
        fft(re, im);
        for (let i = 0; i < N / 2; i++) psd[i] += re[i] * re[i] + im[i] * im[i];
      }
      let tot = 0, cen = 0, harsh = 0, high = 0;
      for (let i = 1; i < N / 2; i++) { const f = (i * sr) / N; tot += psd[i]; cen += f * psd[i]; if (f >= 2000 && f < 6000) harsh += psd[i]; if (f >= 6000) high += psd[i]; }
      // level and "breathing"
      let sum = 0; for (let i = Math.floor(sr); i < x.length; i++) sum += x[i] * x[i];
      const rms = Math.sqrt(sum / (x.length - sr));
      const fr = Math.floor(0.1 * sr), lv: number[] = [];
      for (let i = Math.floor(sr); i + fr < x.length; i += fr) { let q = 0; for (let k = 0; k < fr; k++) q += x[i + k] * x[i + k]; lv.push(db(Math.sqrt(q / fr))); }
      const mean = lv.reduce((a, b) => a + b, 0) / lv.length;
      const std = Math.sqrt(lv.reduce((a, b) => a + (b - mean) ** 2, 0) / lv.length);
      // the seam: biggest sample step within 50 ms of each loop point vs biggest step in ordinary 100 ms stretches
      const maxStep = (a: number, b: number) => { let m = 0; for (let i = a + 1; i < b; i++) m = Math.max(m, Math.abs(x[i] - x[i - 1])); return m; };
      const half = Math.floor(0.05 * sr);
      const seams = [1, 2].map((k) => maxStep(Math.floor(k * LEN * sr) - half, Math.floor(k * LEN * sr) + half));
      const ordinary: number[] = [];
      for (let t0 = 1.0; t0 < 7.0; t0 += 0.37) ordinary.push(maxStep(Math.floor(t0 * sr), Math.floor(t0 * sr) + 2 * half));
      const ordMean = ordinary.reduce((a, b) => a + b, 0) / ordinary.length;
      return { seconds: buf.duration, sr, centroid: cen / tot, harshPct: (100 * harsh) / tot, highPct: (100 * high) / tot, rmsDb: db(rms), std, seamExcess: Math.max(...seams) / ordMean };
    });
    console.log('crowd loop in Chromium:', JSON.stringify(r));
    expect(r.seconds).toBeGreaterThan(8.3);
    expect(r.seconds).toBeLessThan(8.5);
    expect(r.centroid).toBeLessThan(900);        // a murmur, not hiss (the old file: 3.8 kHz)
    expect(r.harshPct).toBeLessThan(3);          // almost nothing in the harsh 2-6 kHz zone (old: 31%)
    expect(r.highPct).toBeLessThan(1);
    expect(r.rmsDb).toBeLessThan(-20);           // quiet file, headroom for the mix (old: -16)
    expect(r.std).toBeGreaterThan(1.5);          // it breathes (old: 0.8 dB)
    expect(r.seamExcess).toBeLessThan(1.3);      // the loop point is indistinguishable from ordinary audio
  });

  test('no sound can clip at its loudest gain, and the murmur sits well under hits, whistles and the roar', async ({ page }) => {
    await page.goto('./');
    const names = ['flick', 'disc-hit', 'ball-tap', 'wall-bounce', 'net', 'whistle-start', 'whistle-foul', 'whistle-end', 'crowd-goal', 'crowd-loop'];
    const decoded: Record<string, { peak: number; rms: number }> = {};
    for (const n of names) decoded[n] = await decodeInPage(page, n);
    const mix = await page.evaluate(() => { const a = (window as any).__botao.audio; return { master: a.MIX.master, bed: a.MIX.crowdBed, swell: a.MIX.goalSwell, win: a.MIX.winSwell, disc: a.MIX.disc, gains: a.MAX_GAIN as Record<string, number> }; });
    for (const n of names) {
      const peak = decoded[n].peak * mix.gains[n] * mix.master;
      expect(peak, `${n} peaks at ${(20 * Math.log10(peak)).toFixed(1)} dBFS`).toBeLessThan(0.9); // headroom: no digital clipping
    }
    const db = (v: number) => 20 * Math.log10(v);
    const bed = db(decoded['crowd-loop'].rms * mix.bed * mix.master);
    const swelled = db(decoded['crowd-loop'].rms * mix.bed * mix.swell * mix.master);
    const gain = (r: [number, number], p: number) => r[0] + (r[1] - r[0]) * p;
    const softHit = db(decoded['disc-hit'].rms * mix.disc[0] * mix.master);                 // the very softest tap
    const hit = db(decoded['disc-hit'].rms * gain(mix.disc, 0.5) * mix.master);             // a typical hit
    const whistle = db(decoded['whistle-foul'].rms * mix.gains['whistle-foul'] * mix.master);
    const roar = db(decoded['crowd-goal'].rms * mix.gains['crowd-goal'] * mix.master);
    console.log(`levels (dBFS RMS): murmur ${bed.toFixed(1)}, swelled ${swelled.toFixed(1)}, softest hit ${softHit.toFixed(1)}, typical hit ${hit.toFixed(1)}, whistle ${whistle.toFixed(1)}, roar ${roar.toFixed(1)}`);
    expect(bed).toBeLessThan(-34);
    expect(softHit - bed).toBeGreaterThan(6);    // even the gentlest tap is audible over the murmur
    expect(hit - bed).toBeGreaterThan(10);       // typical hits stand clearly above it
    expect(whistle - bed).toBeGreaterThan(20);   // whistles cut right through
    expect(roar - swelled).toBeGreaterThan(5);   // the goal roar stays on top of the swelling murmur
  });

  test('the murmur rests quietly, swells on a goal and settles back, and dips under a whistle', async ({ page }) => {
    await page.goto('./');
    await page.click('#ov-btn'); // starts the match: unlocks audio, loads samples, starts the crowd
    await expect.poll(() => page.evaluate(() => (window as any).__botao.audio.samplesLoaded().length), { timeout: 15_000 }).toBe(10);
    const bed = await page.evaluate(() => (window as any).__botao.audio.MIX.crowdBed as number);
    const level = () => page.evaluate(() => (window as any).__botao.audio.crowdLevel() as number);
    await expect.poll(level, { timeout: 8_000 }).toBeGreaterThan(bed * 0.9);
    expect(await level()).toBeLessThan(bed * 1.1);
    await page.evaluate(() => (window as any).__botao.audio.goal());
    await expect.poll(level, { timeout: 4_000 }).toBeGreaterThan(bed * 1.8);      // swells
    await expect.poll(level, { timeout: 15_000 }).toBeLessThan(bed * 1.15);        // and settles back
    // a whistle dips the murmur briefly, then lets it return
    const duck = () => page.evaluate(() => (window as any).__botao.audio.crowdDuckLevel() as number);
    expect(await duck()).toBeGreaterThan(0.95);
    await page.evaluate(() => (window as any).__botao.audio.whistle());
    await expect.poll(duck, { timeout: 2_000 }).toBeLessThan(0.75);
    await expect.poll(duck, { timeout: 6_000 }).toBeGreaterThan(0.95);
  });
});

test.describe('sound switch in the menu', () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test('toggles sound, stays in step with the footer chip, and is remembered', async ({ page }) => {
    await page.goto('./');
    const muted = () => page.evaluate(() => (window as any).__botao.audio.isMuted() as boolean);
    await expect(page.locator('#ov-sound')).toBeVisible();
    await expect(page.locator('#ov-sound')).toContainText('Som ligado');
    expect(await muted()).toBe(false);
    await page.click('#ov-sound');
    await expect(page.locator('#ov-sound')).toContainText('Som desligado');
    await expect(page.locator('#mute')).toHaveText('🔇');
    expect(await muted()).toBe(true);
    expect(await page.evaluate(() => localStorage.getItem('botao-muted'))).toBe('1');
    await page.reload();                                   // remembered
    await expect(page.locator('#ov-sound')).toContainText('Som desligado');
    await page.click('#mute');                             // the footer chip flips the same setting
    await expect(page.locator('#ov-sound')).toContainText('Som ligado');
    expect(await muted()).toBe(false);
    // language follows the switch
    await page.click('#lang');
    await expect(page.locator('#ov-sound')).toContainText('Sound on');
  });

  test('is also on the level picker', async ({ page }) => {
    await page.goto('./');
    await page.click('#ov-btn2');
    await expect(page.locator('#ov-title')).toHaveText('Escolha a dificuldade');
    await expect(page.locator('#ov-sound')).toBeVisible();
    await page.click('#ov-sound');
    await expect(page.locator('#mute')).toHaveText('🔇');
  });
});
