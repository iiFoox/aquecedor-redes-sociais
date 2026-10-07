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

  let typed = '';
  const history = [];
  let liked = false; // o vídeo da tela está curtido? (vale até passar de vídeo)
  const LIKE = /like-icon/;
  const el = (sel, i) => ({
    sel,
    // O vídeo ocupa o meio da tela, o painel de comentários a direita; o resto são botões pequenos
    boundingBox: async () =>
      sel === 'video'
        ? i === 0
          ? { x: 440, y: 40, width: 400, height: 710 }
          : null
        : /CommentMain/.test(sel)
          ? { x: 990, y: 60, width: 352, height: 624 }
          : /\/video\/|\/p\/|\/reel\//.test(sel)
            ? { x: 290 + i * 200, y: 84, width: 192, height: 254 } // miniatura de vídeo/post (medida no TikTok)
            : { x: 560 + i * 8, y: 180 + i * 60, width: 48, height: 48 },
    scrollIntoViewIfNeeded: async () => {},
    inputValue: async () => typed,
    getAttribute: async (name) => (name === 'aria-pressed' && LIKE.test(sel) ? String(liked) : null),
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
    async goBack() {
      const prev = history.pop();
      if (!prev) return null;
      url = prev;
      liked = false;
      events.push({ type: 'back', url });
      return {};
    },
    async goto(u) {
      if (url !== 'about:blank') history.push(url);
      url = u;
      liked = false;
      events.push({ type: 'goto', url: u });
    },
    viewportSize: () => ({ width: W, height: H }),
    locator,
    getByText: () => ({ first: () => ({ isVisible: async () => false }) }),
    getByRole: (role) => ({ first: () => el(`role=${role}`, 0) }),
    keyboard: {
      press: async (key) => {
        events.push({ type: 'key', key });
        if (/Arrow(Down|Up)/.test(key)) liked = false;
        if (key === 'Backspace') typed = typed.slice(0, -1);
        else if (/^(Control|Meta)\+a$/i.test(key)) typed = '';
        else if (key === 'Enter' && typed) {
          url = `https://www.tiktok.com/search?q=${encodeURIComponent(typed)}`;
          typed = '';
        }
      },
      type: async (text) => {
        events.push({ type: 'type', text });
        typed += text;
      },
    },
    mouse: {
      wheel: async (_x, dy) => events.push({ type: 'wheel', dy }),
      click: async () => events.push({ type: 'click' }),
      down: async (o = {}) => {
        events.push({ type: 'down', count: o.clickCount || 1 });
        if (o.clickCount === 2) liked = true; // dois cliques no vídeo curtem (nunca descurtem)
      },
      up: async (o = {}) => events.push({ type: 'up', count: o.clickCount || 1 }),
      move: async () => {},
    },
    // Duração do vídeo visível: de ~6 s a 90 s, a maioria perto de 20 s (como num feed de vídeos curtos)
    evaluate: async () => ({ duration: Math.min(90, Math.max(6, 20 * Math.exp(0.6 * (rng() + rng() + rng() - 1.5) * 2))), current: 0 }),
    context: () => ({ newPage: async () => ({ close: async () => events.push({ type: 'tab', open: false }) }) }),
    bringToFront: async () => events.push({ type: 'tab', open: true }),
    // O cursor falso avisa a página do clique, e a página reage como o site faria
    _clicked(e) {
      events.push({ type: 'click', sel: e.sel });
      if (LIKE.test(e.sel)) liked = !liked; // o coração alterna
      const go = (u) => {
        history.push(url);
        url = u;
      };
      if (/avatar|uniqueid|author/.test(e.sel)) go('https://www.tiktok.com/@criador_exemplo');
      else if (/video\//.test(e.sel)) go('https://www.tiktok.com/@criador_exemplo/video/1');
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
