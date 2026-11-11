# Mesa de Botão

Futebol de botão in the browser: two players share one phone or laptop and take turns flicking buttons at a small ball.

**Play:** https://jmsalim.github.io/mesa-de-botao/

## How to play

- Drag **back** on one of your buttons to aim and set power, then release to flick it.
- If your flick touches the ball you play again, up to 3 flicks in a row. Miss the ball and the turn passes.
- Hit an opponent's button before the ball and it's a **foul**: the turn passes.
- To score, tap **Chutar ao gol / Shoot!** first. Your opponent then gets a few seconds to slide their keeper along the goal line, and you flick. Goals that weren't called don't count (goal kick for the defender). Own goals always count for the opponent.
- First to 3 goals wins. The team that conceded kicks off.
- Ball stuck on a rail, in a corner or against your own goal? A **Reposicionar bola / Reposition ball** button appears and puts it back on the nearest free spot. Balls jammed in a corner are repositioned automatically.
- When a goal is scored the ball rolls into the net and the netting wraps around it.
- **⚡ Super Flick:** every flick that touches the ball charges a bolt. At 3 bolts your buttons glow and your next flick is a heavy, faster fireball.
- While dragging, a dotted line shows how far the button will slide, where the ball will be sent, and turns red if you'd foul.
- **Vs computer:** pick it on the start screen, then a level. The CPU plays red and never cheats: all levels use the same power, physics and rules.
  - **Fácil / Easy:** misses a lot, plays slowly, defends slowly.
  - **Médio / Medium:** plays clean (avoids fouls and its own keeper), calls its shots.
  - **Difícil / Hard:** tries ~30 flicks on a hidden copy of the table and plays the best outcome (defence included), reads shot lines with its keeper, and uses the Super Flick.
- **Real-table look:** felt field, and pieces in your choice of **pérola, tartaruga, acrílico or mármore** (pick on the start screen; teams are named after their material). The menu uses the table illustration on paper.
- **Real-table sound:** recorded flick, disc, ball, wall and net sounds, three whistles, a goal roar and a quiet crowd loop. Mute with the speaker chip; phones also get small vibrations on big hits and goals.
- Portuguese and English UI, switch with the chip at the bottom right.

## Develop

```bash
npm install
npm run dev        # http://localhost:5173/mesa-de-botao/
npm test           # rules + physics unit tests (Vitest)
npm run test:e2e   # headless Chromium smoke tests (Playwright)
npm run test:balance  # ~80 s CPU-vs-CPU simulations: checks Fácil < Médio < Difícil, fouls and own goals
npm run build      # type-check and build to dist/
python3 scripts/optimize-assets.py   # shrink new art dropped in public/assets (only ever downscales)
```

If Playwright can't find its browser locally, run `npx playwright install chromium`, or set `CHROMIUM_PATH` to an existing Chromium binary.

## How it's built

- Vite + TypeScript, no framework. The table, lines, goals, net and effects are drawn with Canvas 2D; felt and piece materials come from small textures in `public/assets` (pieces are pre-rendered once into sprites). Everything has a code-drawn fallback, so the game never waits for a file.
- [Planck.js](https://github.com/piqnt/planck.js) (a Box2D port) for physics: continuous collision detection keeps hard flicks from tunnelling through the ball or walls.
- `src/rules.ts` is a pure state machine (turns, fouls, called shots, goals) with no physics or DOM, so it is unit-tested on its own.
- `src/ai.ts` holds the CPU level profiles and the Fácil/Médio planners (pure, unit-tested); `src/lookahead.ts` is Difícil's time-sliced search on a hidden physics copy; `tests/helpers/sim.ts` plays whole CPU matches headlessly for the balance tests.
- `src/fx.ts` and `src/audio.ts` are the particles, shake and synthesized sound.
- Field is simulated in landscape; portrait screens rotate the view and input.

## Art and sound

Files live in `public/assets` (see its README for credits). They are kept small for phones: textures are 128–256 px WebP (about 10 KB for the felt, 1–4 KB per piece material), the table illustration is 43 KB, and sounds are loaded only after the first tap. A test checks every referenced file exists, that nothing unused is shipped, and the size budget. The first upload's full-size originals are in git history (commit `2f76ca1`).

## Deployment

`.github/workflows/deploy.yml` runs the tests and deploys `dist/` to GitHub Pages on every push to `main`. In the repo settings, **Pages → Source** must be set to **GitHub Actions**.
