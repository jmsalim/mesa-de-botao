/** Visual effects in world coordinates: sparks, shockwaves, confetti, trails, shake. */
interface Particle {
  kind: 'spark' | 'ring' | 'confetti' | 'fire';
  x: number; y: number; vx: number; vy: number;
  life: number; max: number; size: number; color: string; rot: number; vr: number;
}
interface TrailPoint { x: number; y: number; age: number }

const TRAIL_LIFE = 0.45;

export class Fx {
  parts: Particle[] = [];
  ballTrail: TrailPoint[] = [];
  fireTrail: TrailPoint[] = [];
  shake = 0;
  flash = 0;
  flashColor = '255,255,255';

  addShake(a: number): void { this.shake = Math.min(0.28, Math.max(this.shake, a)); }
  doFlash(a: number, color = '255,255,255'): void { this.flash = a; this.flashColor = color; }

  spark(x: number, y: number, n: number, speed: number, color = '#fff6c2'): void {
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2, s = speed * (0.3 + Math.random() * 0.7);
      this.parts.push({ kind: 'spark', x, y, vx: Math.cos(a) * s, vy: Math.sin(a) * s, life: 0, max: 0.25 + Math.random() * 0.25, size: 0.03 + Math.random() * 0.04, color, rot: 0, vr: 0 });
    }
  }

  ring(x: number, y: number, size = 0.5, color = '255,255,255'): void {
    this.parts.push({ kind: 'ring', x, y, vx: 0, vy: 0, life: 0, max: 0.35, size, color, rot: 0, vr: 0 });
  }

  confetti(x: number, y: number, n: number, colors: string[], dirX: number): void {
    for (let i = 0; i < n; i++) {
      const a = (Math.random() - 0.5) * Math.PI * 1.1 + (dirX > 0 ? 0 : Math.PI), s = 3 + Math.random() * 9;
      this.parts.push({
        kind: 'confetti', x, y, vx: Math.cos(a) * s, vy: Math.sin(a) * s, life: 0, max: 1.4 + Math.random() * 1.2,
        size: 0.07 + Math.random() * 0.07, color: colors[i % colors.length], rot: Math.random() * 6, vr: (Math.random() - 0.5) * 18,
      });
    }
  }

  fire(x: number, y: number): void {
    for (let i = 0; i < 2; i++) {
      this.parts.push({
        kind: 'fire', x: x + (Math.random() - 0.5) * 0.2, y: y + (Math.random() - 0.5) * 0.2,
        vx: (Math.random() - 0.5) * 0.8, vy: (Math.random() - 0.5) * 0.8, life: 0, max: 0.35 + Math.random() * 0.2,
        size: 0.1 + Math.random() * 0.1, color: Math.random() < 0.5 ? '255,170,40' : '255,90,30', rot: 0, vr: 0,
      });
    }
  }

  trail(list: TrailPoint[], x: number, y: number, moving: boolean): void {
    if (moving) list.push({ x, y, age: 0 });
  }

  update(dt: number): void {
    for (const p of this.parts) {
      p.life += dt;
      const drag = p.kind === 'confetti' ? 2.2 : p.kind === 'fire' ? 1 : 4;
      const k = Math.exp(-drag * dt);
      p.vx *= k; p.vy *= k;
      p.x += p.vx * dt; p.y += p.vy * dt; p.rot += p.vr * dt;
    }
    this.parts = this.parts.filter((p) => p.life < p.max);
    for (const list of [this.ballTrail, this.fireTrail]) {
      for (const t of list) t.age += dt;
      while (list.length && list[0].age > TRAIL_LIFE) list.shift();
    }
    this.shake = Math.max(0, this.shake - dt * 0.9);
    this.flash = Math.max(0, this.flash - dt * 2.2);
  }

  shakeOffset(time: number): { x: number; y: number } {
    if (this.shake <= 0) return { x: 0, y: 0 };
    return { x: Math.sin(time * 91) * this.shake, y: Math.cos(time * 77) * this.shake };
  }

  drawTrails(ctx: CanvasRenderingContext2D): void {
    const draw = (list: TrailPoint[], rgb: string, width: number) => {
      if (list.length < 2) return;
      ctx.lineCap = 'round'; ctx.lineJoin = 'round';
      for (let i = 1; i < list.length; i++) {
        const a = list[i - 1], b = list[i], f = 1 - b.age / TRAIL_LIFE;
        ctx.strokeStyle = `rgba(${rgb},${0.55 * f})`;
        ctx.lineWidth = width * f;
        ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke();
      }
    };
    draw(this.ballTrail, '255,255,255', 0.15);
    draw(this.fireTrail, '255,150,40', 0.4);
  }

  drawParticles(ctx: CanvasRenderingContext2D): void {
    for (const p of this.parts) {
      const f = 1 - p.life / p.max;
      if (p.kind === 'ring') {
        ctx.strokeStyle = `rgba(${p.color},${0.7 * f})`; ctx.lineWidth = 0.06 * f + 0.01;
        ctx.beginPath(); ctx.arc(p.x, p.y, p.size * (1 - f) * 2.2 + 0.1, 0, Math.PI * 2); ctx.stroke();
      } else if (p.kind === 'spark') {
        ctx.fillStyle = p.color; ctx.globalAlpha = f;
        ctx.beginPath(); ctx.arc(p.x, p.y, p.size * (0.5 + f), 0, Math.PI * 2); ctx.fill();
        ctx.globalAlpha = 1;
      } else if (p.kind === 'fire') {
        ctx.fillStyle = `rgba(${p.color},${0.6 * f})`;
        ctx.beginPath(); ctx.arc(p.x, p.y, p.size * (0.4 + f), 0, Math.PI * 2); ctx.fill();
      } else {
        ctx.save(); ctx.translate(p.x, p.y); ctx.rotate(p.rot);
        ctx.fillStyle = p.color; ctx.globalAlpha = Math.min(1, f * 2);
        ctx.fillRect(-p.size, -p.size * 0.5, p.size * 2, p.size);
        ctx.restore(); ctx.globalAlpha = 1;
      }
    }
  }
}
