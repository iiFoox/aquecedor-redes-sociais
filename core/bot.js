const rand = (a, b) => Math.floor(Math.random() * (b - a + 1)) + a;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];

function weighted(options) {
  const total = options.reduce((s, [, w]) => s + w, 0);
  let r = Math.random() * total;
  for (const [v, w] of options) if ((r -= w) <= 0) return v;
  return options[0][0];
}

class StopError extends Error {
  constructor() { super('Sessão interrompida'); this.code = 'STOPPED'; }
}
class AbortError extends Error {
  constructor(msg, code) { super(msg); this.code = code; }
}
const isFatal = (e) => e instanceof StopError || e instanceof AbortError;

const { createCursor } = require('ghost-cursor');

/**
 * Cria o "bot humano": todas as interações passam por aqui para
 * parecerem naturais (mouse em curva, pausas aleatórias, rolagem em passos).
 */
function createBot(page, ctl) {
  const cursor = createCursor(page);
  const pos = { x: rand(400, 800), y: rand(250, 550) };
  const vp = () => page.viewportSize() || { width: 1280, height: 800 };
  let fatigue = 1.0;

  // Gaussiana para gerar tempo de espera orgânico tendendo para a média
  function gaussianRand(min, max) {
    let u = 0, v = 0;
    while(u === 0) u = Math.random();
    while(v === 0) v = Math.random();
    let num = Math.sqrt(-2.0 * Math.log(u)) * Math.cos(2.0 * Math.PI * v);
    num = num / 10.0 + 0.5; // Aproxima de 0 a 1 (média em 0.5)
    if (num < 0 || num > 1) return gaussianRand(min, max);
    return Math.floor(num * (max - min) + min);
  }

  // Espera aleatória, interrompível, que informa ao painel o que está acontecendo
  // Fadiga limitada a 1.6x (antes ia até 2.5x e deixava toda pausa gigante)
  const FATIGUE_MAX = 1.6;
  const rest = () => { fatigue = 1.0; };

  async function wait(min, max = min, label) {
    const ms = gaussianRand(min, max) * Math.min(fatigue, FATIGUE_MAX);
    if (label) ctl.status(label, ms);
    const end = Date.now() + ms;
    while (Date.now() < end) {
      if (ctl.shouldStop()) throw new StopError();
      await sleep(Math.min(400, end - Date.now()));
    }
  }

  // Movimento de mouse gerado pelo ghost-cursor (Curvas fluidas baseadas em Fitts)
  async function moveTo(x, y) {
    await cursor.moveTo({ x, y });
    pos.x = x;
    pos.y = y;
  }

  async function click(el, scroll = true) {
    if (scroll) await el.scrollIntoViewIfNeeded({ timeout: 4000 }).catch(() => {});
    // O ghost-cursor implementa overshoot natural e hesitação antes do clique
    await cursor.click(el);
    return true;
  }

  // Elementos realmente visíveis na tela atual
  async function visible(selector, { minSize = 0, max = 30 } = {}) {
    const loc = page.locator(selector);
    const n = Math.min(await loc.count().catch(() => 0), max);
    const { width, height } = vp();
    const out = [];
    for (let i = 0; i < n; i++) {
      const el = loc.nth(i);
      const b = await el.boundingBox().catch(() => null);
      if (b && b.width >= Math.max(1, minSize) && b.height > 0 && b.y >= 0 && b.y + b.height <= height && b.x >= 0 && b.x + b.width <= width) out.push(el);
    }
    return out;
  }

  async function clickVisible(selector, opts = {}) {
    const els = await visible(selector, opts);
    if (!els.length) return false;
    return click(opts.random ? pick(els) : els[0], false);
  }

  async function scroll(amount) {
    fatigue = Math.min(FATIGUE_MAX, fatigue + 0.03); // aumenta o cansaço a cada scroll (com teto)
    const dir = Math.sign(amount) || 1;
    let left = Math.abs(amount);
    while (left > 0) {
      if (ctl.shouldStop()) throw new StopError();
      const d = Math.min(rand(60, 140), left);
      await page.mouse.wheel(0, d * dir);
      left -= d;
      await sleep(rand(16, 50) * Math.min(fatigue, FATIGUE_MAX));
    }
  }
  
  async function readNiche(text, keywords) {
    if (!text || !keywords || !keywords.length) return false;
    const lower = text.toLowerCase();
    if (keywords.some(k => lower.includes(k.toLowerCase()))) {
      ctl.log('Conteúdo do nicho encontrado! Dwell time (Pausa de leitura)...', 'info');
      await wait(12000, 22000, '👀 Lendo conteúdo (Nicho)');
      fatigue = Math.max(1.0, fatigue - 0.2); // Pausar ajuda a recuperar a fadiga
      return true;
    }
    return false;
  }

  async function goto(url, label) {
    ctl.status(label || 'Navegando');
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 45000 });
    await wait(2500, 5000, label ? `${label}: carregando` : 'Carregando página');
  }

  return { page, rand, pick, wait, moveTo, click, visible, clickVisible, scroll, goto, readNiche, rest, guard: async () => {} };
}

module.exports = { createBot, StopError, AbortError, isFatal, rand, pick, weighted, sleep };
