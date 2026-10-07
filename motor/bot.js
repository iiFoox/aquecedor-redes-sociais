const human = require('./human');

const realClock = { now: () => Date.now(), sleep: (ms) => new Promise((r) => setTimeout(r, ms)) };
const sleep = realClock.sleep;

// Inteiro entre a e b (inclusive)
const rand = (a, b, rng = Math.random) => Math.floor(rng() * (b - a + 1)) + a;
const pick = (arr, rng = Math.random) => arr[Math.floor(rng() * arr.length)];

function weighted(options, rng = Math.random) {
  const total = options.reduce((s, [, w]) => s + w, 0);
  let r = rng() * total;
  for (const [v, w] of options) if ((r -= w) <= 0) return v;
  return options[0][0];
}

class StopError extends Error {
  constructor() {
    super('Sessão interrompida');
    this.code = 'STOPPED';
  }
}
class AbortError extends Error {
  constructor(msg, code) {
    super(msg);
    this.code = code;
  }
}
const isFatal = (e) => e instanceof StopError || e instanceof AbortError;

/**
 * Cria o "bot humano": todas as interações passam por aqui para parecerem naturais
 * (mouse em curva, pausas de cauda longa, rolagem com inércia, mouse que mexe enquanto espera).
 *
 * opts (o simulador troca tudo isso por versões falsas):
 *  - persona: personalidade da conta (human.makePersona). Sem ela, usa valores médios.
 *  - mood: humor do dia (human.dayMood)
 *  - rng: sorteio. clock: { now, sleep }. cursor: cursor do mouse (padrão: motor/cursor.js).
 */
function createBot(page, ctl, opts = {}) {
  const rng = opts.rng || Math.random;
  const clock = opts.clock || realClock;
  const persona = opts.persona || null;
  const mood = opts.mood || null;
  const pos = { x: rand(400, 800, rng), y: rand(250, 550, rng) };
  const cursor = opts.cursor || require('./cursor').createCursor(page, { rng, sleep: clock.sleep, start: { ...pos } });
  const vp = () => page.viewportSize() || { width: 1280, height: 800 };
  const r = (a, b) => rand(a, b, rng);
  let fatigue = 1.0;

  // Cansaço: sobe devagar com o uso (rolagens), com teto de 1,6x. Uma distração "descansa".
  const FATIGUE_MAX = 1.6;
  const rest = () => {
    fatigue = 1.0;
  };

  // Espera até `ms`, interrompível. Esperas longas mexem o mouse de leve, como quem está olhando a tela.
  async function hold(ms, label, kind) {
    if (label) ctl.status(label, ms);
    if (kind && ctl.sample) ctl.sample(kind, ms);
    const end = clock.now() + ms;
    let nextFidget = clock.now() + human.bounded(rng, 4000, 0.6, 1500, 15000);
    while (clock.now() < end) {
      if (ctl.shouldStop()) throw new StopError();
      if (ms > 6000 && clock.now() >= nextFidget && clock.now() + 1500 < end) {
        await fidget();
        nextFidget = clock.now() + human.bounded(rng, 5000, 0.7, 1500, 20000);
        continue;
      }
      await clock.sleep(Math.min(400, end - clock.now()));
    }
  }

  // Espera entre min e max com cauda longa (a maioria perto do meio, às vezes bem mais).
  // min === max: espera exatamente esse tempo (ex.: tempo já decidido para um vídeo).
  async function wait(min, max = min, label) {
    const ms = (min === max ? min : human.span(min, max, rng)) * Math.min(fatigue, FATIGUE_MAX);
    await hold(Math.round(ms), label, 'pause');
  }

  // Espera de um tipo conhecido (load, read, decide, next...), com a curva própria (human.PAUSES)
  async function pause(kind, label) {
    await hold(human.pause(kind, { rng, persona, mood, fatigue: Math.min(fatigue, FATIGUE_MAX) }), label, 'pause');
  }

  // Tempo assistindo um vídeo (já decidido por human.watchPlan)
  async function watch(ms, label) {
    await hold(ms, label, 'watch');
  }

  // Movimento de mouse em curva, com aceleração e às vezes passando do alvo (motor/cursor.js)
  async function moveTo(x, y) {
    await cursor.moveTo({ x, y });
    pos.x = x;
    pos.y = y;
  }

  // Mexidinha do mouse: perto de onde está; às vezes sai da área do vídeo para a lateral
  async function fidget() {
    const { width, height } = vp();
    let x;
    let y;
    if (rng() < 0.2) {
      x = rng() < 0.5 ? r(20, Math.round(width * 0.18)) : r(Math.round(width * 0.82), width - 20);
      y = r(Math.round(height * 0.2), Math.round(height * 0.85));
    } else {
      x = Math.max(10, Math.min(width - 10, pos.x + r(-90, 90)));
      y = Math.max(10, Math.min(height - 10, pos.y + r(-70, 70)));
    }
    await moveTo(x, y).catch(() => {});
  }

  async function click(el, scroll = true) {
    if (scroll) await el.scrollIntoViewIfNeeded({ timeout: 4000 }).catch(() => {});
    // O cursor faz a curva até um ponto variado do elemento, mira e clica
    await cursor.click(el);
    if (cursor.position) Object.assign(pos, cursor.position);
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
      if (
        b &&
        b.width >= Math.max(1, minSize) &&
        b.height > 0 &&
        b.y >= 0 &&
        b.y + b.height <= height &&
        b.x >= 0 &&
        b.x + b.width <= width
      )
        out.push(el);
    }
    return out;
  }

  async function clickVisible(selector, opts2 = {}) {
    const els = await visible(selector, opts2);
    if (!els.length) return false;
    return click(opts2.random ? pick(els, rng) : els[0], false);
  }

  // Rolagem com inércia (human.scrollSteps): acelera, desacelera e às vezes passa do ponto e volta
  async function scroll(amount) {
    fatigue = Math.min(FATIGUE_MAX, fatigue + 0.03);
    for (const { dy, ms } of human.scrollSteps(amount, { persona, rng })) {
      if (ctl.shouldStop()) throw new StopError();
      if (dy) await page.mouse.wheel(0, dy);
      await clock.sleep(ms * Math.min(fatigue, FATIGUE_MAX));
    }
  }

  // Conteúdo do nicho? (só olha o texto; quem decide o tempo é quem chamou)
  function isNiche(text, keywords) {
    if (!text || !keywords || !keywords.length) return false;
    const lower = text.toLowerCase();
    return keywords.some((k) => lower.includes(k.toLowerCase()));
  }

  // Conteúdo do nicho: lê com calma (pausa longa) e descansa um pouco do cansaço
  async function readNiche(text, keywords) {
    if (!isNiche(text, keywords)) return false;
    ctl.log('Conteúdo do nicho encontrado: lendo com calma', 'info');
    await pause('nicheRead', '👀 Lendo conteúdo do nicho');
    fatigue = Math.max(1.0, fatigue - 0.2);
    return true;
  }

  // Duração do vídeo que está mais visível na tela (elemento <video> padrão, sem seletor de plataforma).
  // null se não houver vídeo ou a duração ainda não carregou.
  async function videoInfo() {
    const info = await page
      .evaluate(() => {
        /* global document, innerWidth, innerHeight */ // roda dentro da página
        let best = null;
        let area = 0;
        for (const v of document.querySelectorAll('video')) {
          const r = v.getBoundingClientRect();
          const w = Math.max(0, Math.min(r.right, innerWidth) - Math.max(r.left, 0));
          const h = Math.max(0, Math.min(r.bottom, innerHeight) - Math.max(r.top, 0));
          if (w * h > area) {
            area = w * h;
            best = v;
          }
        }
        return best && Number.isFinite(best.duration) && best.duration > 0 ? { duration: best.duration, current: best.currentTime } : null;
      })
      .catch(() => null);
    return info && typeof info.duration === 'number' ? info : null;
  }

  // Assiste `ms`; se `beforeLike` vier, para no meio (momento sorteado), chama, e termina de assistir.
  // A curtida acontece num ponto plausível do vídeo, não sempre no fim.
  async function watchWithLike(ms, label, like) {
    if (!like) return watch(ms, label);
    const at = Math.round(ms * (0.3 + rng() * 0.6));
    await watch(at, label);
    const t = clock.now();
    const ok = await like();
    const restMs = ms - at - (clock.now() - t); // desconta o tempo que o clique levou de verdade
    if (restMs > 400) await watch(restMs, ok ? 'Continua assistindo depois de curtir' : label);
    return ok;
  }

  // Distração "trocando de aba": abre uma aba em branco por um tempo e volta para a da sessão.
  // O site vê a aba ficar escondida e voltar, como quando a pessoa olha outra coisa. Nada é aberto.
  async function awayTab(ms, label = 'Distração: foi para outra aba') {
    let other = null;
    try {
      other = await page.context().newPage();
    } catch {
      other = null;
    }
    try {
      await hold(ms, label, 'pause');
    } finally {
      if (other) await other.close().catch(() => {});
      await page.bringToFront().catch(() => {});
    }
  }

  // Digita como gente: ritmo da personalidade, pausa entre palavras e às vezes erra e apaga
  async function type(text, label) {
    if (label) ctl.status(label);
    for (const { key, ms } of human.typingPlan(text, { persona, rng })) {
      if (ctl.shouldStop()) throw new StopError();
      await clock.sleep(ms);
      if (key === 'Backspace') await page.keyboard.press('Backspace');
      else await page.keyboard.type(key);
    }
  }

  // Maior vídeo inteiro na tela (null se não houver)
  async function mainVideo() {
    let best = null;
    let area = 0;
    for (const el of await visible('video', { minSize: 150, max: 6 })) {
      const b = await el.boundingBox().catch(() => null);
      if (b && b.width * b.height > area) {
        area = b.width * b.height;
        best = b;
      }
    }
    return best;
  }

  // Dois cliques rápidos no meio do vídeo (longe das bordas, onde ficam os botões e a legenda)
  async function doubleTap(box) {
    const x = Math.round(box.x + box.width * (0.3 + rng() * 0.4));
    const y = Math.round(box.y + box.height * (0.3 + rng() * 0.3));
    await moveTo(x, y);
    await clock.sleep(r(60, 200));
    await page.mouse.down();
    await clock.sleep(r(40, 90));
    await page.mouse.up();
    await clock.sleep(human.tapGap(rng));
    await page.mouse.down({ clickCount: 2 });
    await clock.sleep(r(40, 90));
    await page.mouse.up({ clickCount: 2 });
  }

  // Curte um vídeo: pela personalidade, com dois cliques no vídeo ou no coração.
  // Sem vídeo na tela, vai no coração. Retorna como curtiu ('tap' | 'icon') ou null se não achou onde.
  async function likeVideo(iconSelector, iconOpts = {}) {
    if (human.prefersDoubleTap(persona, rng)) {
      const box = await mainVideo();
      if (box) {
        await doubleTap(box);
        return 'tap';
      }
    }
    return (await clickVisible(iconSelector, iconOpts)) ? 'icon' : null;
  }

  async function goto(url, label) {
    ctl.status(label || 'Navegando');
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 45000 });
    await pause('load', label ? `${label}: carregando` : 'Carregando página');
  }

  return {
    page,
    persona,
    mood,
    rng,
    random: rng,
    rand: r,
    pick: (arr) => pick(arr, rng),
    weighted: (options) => weighted(options, rng),
    now: clock.now,
    wait,
    pause,
    watch,
    watchWithLike,
    videoInfo,
    awayTab,
    type,
    likeVideo,
    doubleTap,
    moveTo,
    fidget,
    click,
    visible,
    clickVisible,
    scroll,
    goto,
    isNiche,
    readNiche,
    rest,
    guard: async () => {},
  };
}

module.exports = { createBot, StopError, AbortError, isFatal, rand, pick, weighted, sleep };
