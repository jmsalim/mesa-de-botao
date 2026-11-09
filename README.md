# Mesa de Botão

Futebol de botão in the browser: two players share one phone or laptop and take turns flicking buttons at a small ball.

**Play:** https://jmsalim.github.io/mesa-de-botao/

## How to play

- Drag **back** on one of your buttons to aim and set power, then release to flick it.
- If your flick touches the ball you play again, up to 3 flicks in a row. Miss the ball and the turn passes.
- Hit an opponent's button before the ball and it's a **foul**: the turn passes.
- To score, tap **Chutar ao gol / Shoot!** first. Your opponent then gets a few seconds to slide their keeper along the goal line, and you flick. Goals that weren't called don't count (goal kick for the defender). Own goals always count for the opponent.
- First to 3 goals wins. The team that conceded kicks off.
- Ball stuck on a rail or in a corner? A **Reposicionar bola / Reposition ball** button appears and puts it back on the nearest free spot. Balls jammed in a corner are repositioned automatically.
- When a goal is scored the ball rolls into the net and the netting wraps around it.
- **⚡ Super Flick:** every flick that touches the ball charges a bolt. At 3 bolts your buttons glow and your next flick is a heavy, faster fireball.
- While dragging, a dotted line shows how far the button will slide, where the ball will be sent, and turns red if you'd foul.
- **Vs computer:** pick it on the start screen to play alone against the CPU (red).
- Sound effects are synthesized in code (mute with the speaker chip); phones also get small vibrations on big hits and goals.
- Portuguese and English UI, switch with the chip at the bottom right.

## Develop

```bash
npm install
npm run dev        # http://localhost:5173/mesa-de-botao/
npm test           # rules + physics unit tests (Vitest)
npm run test:e2e   # headless Chromium smoke tests (Playwright)
npm run build      # type-check and build to dist/
```

If Playwright can't find its browser locally, run `npx playwright install chromium`, or set `CHROMIUM_PATH` to an existing Chromium binary.

## How it's built

- Vite + TypeScript, no framework. All art is drawn with Canvas 2D (no image assets).
- [Planck.js](https://github.com/piqnt/planck.js) (a Box2D port) for physics: continuous collision detection keeps hard flicks from tunnelling through the ball or walls.
- `src/rules.ts` is a pure state machine (turns, fouls, called shots, goals) with no physics or DOM, so it is unit-tested on its own.
- `src/ai.ts` is the CPU opponent (pure function, unit-tested); `src/fx.ts` and `src/audio.ts` are the particles, shake and synthesized sound.
- Field is simulated in landscape; portrait screens rotate the view and input.

## Deployment

`.github/workflows/deploy.yml` runs the tests and deploys `dist/` to GitHub Pages on every push to `main`. In the repo settings, **Pages → Source** must be set to **GitHub Actions**.
