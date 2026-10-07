// Página e cursor falsos para o simulador: imitam o pouco da API do Playwright que o robô usa,
// sem abrir navegador nem rede. Nunca mostram captcha, bloqueio ou tela de login.
const W = 1280;
const H = 800;

const CAPTIONS = ['receita rápida de bolo', 'dança nova do momento', 'meme do dia', 'unboxing de fone', 'vlog de viagem', 'treino em casa'];

// Seletores que, no site de verdade, só aparecem quando há problema (login, captcha)
const PROBLEM = /captcha|login|username/i;
// Pop-ups ("Agora não", "Pular"): aparecem de vez em quando
const POPUP = /has-text\("(Agora não|Not now|Not Now|Pular|Skip)"\)/;

function createFakePage({ rng = Math.random, interests = [], nicheRate = 0.25 } = {}) {
  let url = 'about:blank';
  const events = [];
  const pick = (arr) => arr[Math.floor(rng() * arr.length)];
  const caption = () => (interests.length && rng() < nicheRate ? `vídeo sobre ${pick(interests)}` : pick(CAPTIONS));

  const el = (sel, i) => ({
    sel,
    boundingBox: async () => ({ x: 560 + i * 8, y: 180 + i * 60, width: 48, height: 48 }),
    scrollIntoViewIfNeeded: async () => {},
    isVisible: async () => !PROBLEM.test(sel),
    textContent: async () => caption(),
  });
  const count = (sel) => (PROBLEM.test(sel) ? 0 : POPUP.test(sel) ? (rng() < 0.05 ? 1 : 0) : 3);
  const locator = (sel) => ({
    count: async () => count(sel),
    first: () => el(sel, 0),
    nth: (i) => el(sel, i),
  });

  const page = {
    events,
    url: () => url,
    async goto(u) {
      url = u;
      events.push({ type: 'goto', url: u });
    },
    viewportSize: () => ({ width: W, height: H }),
    locator,
    getByText: () => ({ first: () => ({ isVisible: async () => false }) }),
    getByRole: (role) => ({ first: () => el(`role=${role}`, 0) }),
    keyboard: { press: async (key) => events.push({ type: 'key', key }) },
    mouse: {
      wheel: async (_x, dy) => events.push({ type: 'wheel', dy }),
      click: async () => events.push({ type: 'click' }),
      move: async () => {},
    },
    // Duração do vídeo visível: de ~6 s a 90 s, a maioria perto de 20 s (como num feed de vídeos curtos)
    evaluate: async () => ({ duration: Math.min(90, Math.max(6, 20 * Math.exp(0.6 * (rng() + rng() + rng() - 1.5) * 2))), current: 0 }),
    context: () => ({ newPage: async () => ({ close: async () => events.push({ type: 'tab', open: false }) }) }),
    bringToFront: async () => events.push({ type: 'tab', open: true }),
    // O cursor falso avisa a página do clique, e a página reage como o site faria
    _clicked(e) {
      events.push({ type: 'click', sel: e.sel });
      if (/avatar|uniqueid|author/.test(e.sel)) url = 'https://www.tiktok.com/@criador_exemplo';
      else if (/video\//.test(e.sel)) url = 'https://www.tiktok.com/@criador_exemplo/video/1';
    },
  };
  return page;
}

function createFakeCursor(page) {
  return {
    moveTo: async ({ x, y }) => page.events.push({ type: 'move', x, y }),
    click: async (el) => page._clicked(el),
  };
}

// Relógio falso: "dormir" só anda o ponteiro (um dia simulado leva milissegundos)
function createFakeClock(start) {
  let t = start;
  return {
    now: () => t,
    sleep: async (ms) => {
      t += Math.max(0, ms);
      await null;
    },
    advance: (ms) => {
      t += ms;
    },
  };
}

module.exports = { createFakePage, createFakeCursor, createFakeClock };
