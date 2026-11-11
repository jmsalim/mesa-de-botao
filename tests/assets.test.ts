import { existsSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { MAX_GAIN, MIX } from '../src/audio';
import { ASSET_FILES, CROWD_LOOP, DEFAULT_SKINS, SKINS, SKIN_COLORS, SOUND_NAMES, assetUrl } from '../src/assets';

const root = join(__dirname, '..', 'public', 'assets');
const kb = (rel: string) => statSync(join(root, rel)).size / 1024;

function walk(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(join(dir, e.name)) : [join(dir, e.name)]));
}

describe('asset manifest', () => {
  it('every file the game loads exists', () => {
    for (const rel of ASSET_FILES) expect(existsSync(join(root, rel)), rel).toBe(true);
  });

  it('every sound and texture on disk is used by the game (no dead weight shipped)', () => {
    const used = new Set(ASSET_FILES);
    const onDisk = walk(root).map((f) => f.slice(root.length + 1)).filter((f) => !f.endsWith('README.md'));
    expect(onDisk.filter((f) => !used.has(f))).toEqual([]);
  });

  it('urls respect the Pages base path', () => {
    expect(assetUrl('sounds/flick.mp3')).toMatch(/assets\/sounds\/flick\.mp3$/);
  });

  it('skins: four materials, distinct defaults, colours for each', () => {
    expect(SKINS).toHaveLength(4);
    expect(DEFAULT_SKINS[0]).not.toBe(DEFAULT_SKINS[1]);
    for (const s of SKINS) expect(SKIN_COLORS[s].length).toBeGreaterThan(2);
    expect(SOUND_NAMES).toContain('crowd-loop');
  });
});

describe('size budget (keep it playable on a phone)', () => {
  it('textures are small', () => {
    expect(kb('textures/feltro.webp')).toBeLessThanOrEqual(20);
    for (const s of SKINS) expect(kb(`textures/${s}.webp`)).toBeLessThanOrEqual(8);
    expect(kb('textures/papel.webp')).toBeLessThanOrEqual(8);
  });

  it('the table illustration is small', () => {
    expect(kb('images/mesa.webp')).toBeLessThanOrEqual(60);
  });

  it('the crowd loop is small (it is the longest sound)', () => {
    expect(kb('sounds/crowd-loop.mp3')).toBeLessThanOrEqual(60);
  });

  it('each sound is small, and everything together stays under 300 KB', () => {
    for (const n of SOUND_NAMES) expect(kb(`sounds/${n}.mp3`), n).toBeLessThanOrEqual(100);
    const total = ASSET_FILES.reduce((sum, rel) => sum + kb(rel), 0);
    expect(total).toBeLessThanOrEqual(300);
  });
});

describe('mix settings', () => {
  it('every sound has a loudest gain, and none is boosted past clipping territory', () => {
    for (const n of SOUND_NAMES) expect(MAX_GAIN[n], n).toBeGreaterThan(0);
    for (const n of ['flick', 'disc-hit', 'ball-tap', 'wall-bounce', 'net'] as const) expect(MAX_GAIN[n], n).toBeLessThanOrEqual(1.25);
  });

  it('murmur settings are sane (real levels vs hits and whistles are checked on the decoded audio in the browser tests)', () => {
    expect(MIX.crowdBed).toBeGreaterThan(0.05);
    expect(MIX.crowdBed).toBeLessThan(0.4);
    expect(MIX.goalSwell).toBeGreaterThan(1.5);
    expect(MIX.winSwell).toBeGreaterThanOrEqual(MIX.goalSwell);
    expect(MIX.duck).toBeLessThan(1);
    expect(MIX.master).toBeLessThanOrEqual(1);
  });

  it('the loop window fits the file layout (pad before and after a whole-second loop)', () => {
    expect(CROWD_LOOP.pad).toBeGreaterThan(0.05);
    expect(CROWD_LOOP.length).toBeGreaterThanOrEqual(6);
  });
});
