// Cursor do mouse para o Playwright: curvas com aceleração (a matemática do ghost-cursor),
// às vezes passa do alvo e corrige, e clica num ponto variado do elemento, não sempre no centro.
// (O createCursor do ghost-cursor é do Puppeteer: no Playwright ele quebra em todo clique.)
const { path } = require('ghost-cursor');
const human = require('./human');

const realSleep = (ms) => new Promise((r) => setTimeout(r, ms));

function createCursor(page, { rng = Math.random, sleep = realSleep, start = null } = {}) {
  const vp = () => page.viewportSize() || { width: 1280, height: 800 };
  const r = (a, b) => a + Math.floor(rng() * (b - a + 1));
  let pos = start || { x: r(300, 700), y: r(200, 500) };

  // Percorre a curva até o ponto: menos passos em movimentos curtos, mais nos longos
  async function glide(to) {
    const dist = Math.hypot(to.x - pos.x, to.y - pos.y);
    if (dist < 1) return;
    const pts = path(pos, to);
    const steps = Math.max(4, Math.min(pts.length, Math.round(dist / 14)));
    for (let i = 1; i <= steps; i++) {
      const p = pts[Math.min(pts.length - 1, Math.round((i * (pts.length - 1)) / steps))];
      await page.mouse.move(p.x, p.y);
      await sleep(r(4, 14));
    }
    pos = { x: to.x, y: to.y };
  }

  async function moveTo({ x, y }) {
    const { width, height } = vp();
    const to = { x: Math.max(1, Math.min(width - 1, Math.round(x))), y: Math.max(1, Math.min(height - 1, Math.round(y))) };
    // Movimento longo: às vezes passa um pouco do alvo e volta
    if (Math.hypot(to.x - pos.x, to.y - pos.y) > 450 && rng() < 0.5) {
      const a = rng() * Math.PI * 2;
      const d = r(15, 45);
      await glide({
        x: Math.max(1, Math.min(width - 1, to.x + Math.cos(a) * d)),
        y: Math.max(1, Math.min(height - 1, to.y + Math.sin(a) * d)),
      });
      await sleep(r(40, 140));
    }
    await glide(to);
  }

  // Ponto do clique: perto do meio, mas nunca o mesmo pixel, e longe das bordas do elemento
  function pointIn(box) {
    const f = () => Math.min(0.8, Math.max(0.2, 0.5 + (rng() + rng() + rng() - 1.5) * 0.2));
    return { x: box.x + box.width * f(), y: box.y + box.height * f() };
  }

  async function click(el) {
    const box = await el.boundingBox();
    if (!box) throw new Error('Elemento fora da tela, sem como clicar');
    await moveTo(pointIn(box));
    await sleep(Math.round(human.bounded(rng, 120, 0.5, 40, 600))); // mira antes de clicar
    await page.mouse.down();
    await sleep(r(45, 120));
    await page.mouse.up();
  }

  return {
    moveTo,
    click,
    get position() {
      return { ...pos };
    },
  };
}

module.exports = { createCursor };
