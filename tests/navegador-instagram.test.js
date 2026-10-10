// Robô do Instagram num Chromium de verdade, numa página LOCAL que imita o Instagram (toda requisição é respondida
// aqui; nada vai para a internet). A estrutura copia a do site de verdade, lida em 2026-10-07 com a conta logada:
// coração "Curtir" que vira "Descurtir", comentários e publicações numa janela [role=dialog] com o X "Fechar",
// anel (canvas) na foto de quem postou que abre /stories/<autor>/, botão "Seguir" (<button> com divs) que some da janela depois do follow.
/* global window */ // os page.evaluate rodam dentro do navegador
const test = require('node:test');
const assert = require('node:assert/strict');
const { chromium } = require('playwright');
const { createBot } = require('../motor/bot');
const human = require('../motor/human');
const instagram = require('../motor/platforms/instagram');

const heart = (label) =>
  `<div role="button" class="heart"><svg aria-label="${label}" width="24" height="24" viewBox="0 0 24 24"><rect width="24" height="24" fill="#999"/></svg></div>`;

// Uma página só; o conteúdo depende do endereço (feed, story, reels, busca por hashtag)
const PAGE = `<!doctype html><html><head><meta charset="utf-8"><style>
body{margin:0;font-family:sans-serif} article{position:absolute;left:400px;width:470px}
.avatar{position:absolute;left:0;top:0;width:42px;height:42px} .avatar canvas{width:42px;height:42px;background:#f0a}
.media{position:absolute;top:60px;width:470px;height:420px;background:#ddd}
.bar{position:absolute;top:490px;display:flex;gap:16px} .cap{position:absolute;top:530px}
[role=dialog]{position:fixed;left:0;top:20px;width:1340px;height:720px;background:rgba(0,0,0,.6)}
.x{position:fixed;left:1320px;top:30px} .seguir{position:absolute;left:900px;top:40px;padding:6px 12px;background:#eee}
.dlg-heart{position:absolute;left:900px;top:600px}
.grid a{display:inline-block;width:200px;height:200px;margin:4px;background:#ccc}
video{position:absolute;left:440px;top:20px;width:400px;height:700px;background:#222}
.col{position:fixed;left:700px;top:20px;width:470px;height:720px;overflow-y:auto;scroll-snap-type:y mandatory}
.col.travada{overflow:hidden} .reel{position:relative;height:720px;scroll-snap-align:start}
.col video{left:0;top:10px} .reel-bar{position:absolute;left:420px;top:400px}
.prox{position:fixed;left:1220px;top:400px;width:32px;height:32px;background:#ccc}
</style></head><body><div id="app"></div>
<script>
const app = document.getElementById('app');
const path = location.pathname;
window.keys = [];
addEventListener('keydown', (e) => window.keys.push(e.key));
const heart = ${JSON.stringify(heart('Curtir'))};
const icon = (l) => '<svg aria-label="' + l + '" width="24" height="24" viewBox="0 0 24 24"><rect width="24" height="24" fill="#bbb"/></svg>';
// Coração: "Curtir" vira "Descurtir" (a não ser que o teste trave a curtida)
document.addEventListener('click', (e) => {
  const h = e.target.closest('.heart');
  if (h && !window.blockLike) {
    const svg = h.querySelector('svg');
    svg.setAttribute('aria-label', svg.getAttribute('aria-label') === 'Curtir' ? 'Descurtir' : 'Curtir');
  }
});
function dialog(inner) {
  const d = document.createElement('div');
  d.setAttribute('role', 'dialog');
  d.innerHTML = '<div class="x" role="button">' + icon('Fechar') + '</div>' + inner;
  d.querySelector('.x').addEventListener('click', () => { d.remove(); history.pushState(null, '', window.backTo); window.closedBy = 'x'; });
  document.body.appendChild(d);
  return d;
}
if (path === '/') {
  window.backTo = '/';
  // Bandeja de stories no topo (como no site): ?bandeja=nova (um não visto) ou ?bandeja=vista (todos vistos)
  const tray = new URLSearchParams(location.search).get('bandeja');
  const trayHtml = !tray ? '' : '<main style="position:absolute;left:400px;top:0;width:600px"><ul style="display:flex;gap:10px;list-style:none;margin:0;padding:10px">' +
    [['velho', 'visto'], ['nova', tray === 'nova' ? 'não visto' : 'visto']].map(([n, v]) =>
      '<li><div role="button" class="tray" data-n="' + n + '" aria-label="Story de ' + n + ', ' + v + '" style="width:60px;height:60px"><canvas width="60" height="60" style="width:60px;height:60px;background:#f0a"></canvas></div></li>').join('') +
    '</ul></main>';
  const top = tray ? 120 : 20;
  app.innerHTML = trayHtml + [0, 1, 2].map((i) =>
    '<article style="top:' + (top + i * 900) + 'px"><div class="avatar" role="button"><canvas width="42" height="42"></canvas></div>' +
    '<span dir="auto" style="position:absolute;left:60px;top:10px">autor' + i + '</span><div class="media"></div>' +
    '<div class="bar">' + heart + '<div role="button" class="comment">' + icon('Comentar') + '</div></div>' +
    '<span dir="auto" class="cap">receita de bolo de cenoura ' + i + '</span></article>').join('');
  document.body.style.height = '3200px';
  // window.avatarSemStory: a foto de quem postou não abre story (anel de story que já acabou)
  document.querySelectorAll('.avatar').forEach((a) => a.addEventListener('click', () => { if (!window.avatarSemStory) location.href = '/stories/autor/'; }));
  document.querySelectorAll('.tray').forEach((a) => a.addEventListener('click', () => (location.href = '/stories/' + a.dataset.n + '/')));
  document.querySelectorAll('.comment').forEach((c) => c.addEventListener('click', () => {
    history.pushState(null, '', '/p/1/');
    dialog('<p style="color:#fff;margin:200px">comentários</p>');
  }));
} else if (path.startsWith('/stories/')) {
  window.backTo = '/';
  app.innerHTML = '<div style="position:absolute;left:500px;top:40px;width:380px;height:680px;background:#333"></div>';
  window.seen = 0;
  addEventListener('keydown', (e) => { if (e.key === 'ArrowRight') window.seen++; });
  const x = document.createElement('div');
  x.className = 'x';
  x.setAttribute('role', 'button');
  x.innerHTML = icon('Fechar');
  x.addEventListener('click', () => { window.closedBy = 'x'; location.href = '/'; });
  document.body.appendChild(x);
} else if (path.startsWith('/reels')) {
  // Coluna de reels como no site: só rola com o mouse em cima dela; cada reel tem o seu endereço; seta ao lado
  app.innerHTML = '<div class="col">' + [1, 2, 3, 4, 5].map((i) => '<div class="reel"><video muted></video><div class="reel-bar">' + heart +
    '</div><div role="button" style="position:absolute;left:10px;top:660px;color:#fff">skate radical na pista ' + i + '</div></div>').join('') +
    '</div><div class="prox" role="button" aria-label="Navegar para o próximo reel"></div>';
  const col = document.querySelector('.col');
  if (window.noWheel) col.classList.add('travada');
  window.shown = new Set([1]);
  col.addEventListener('scroll', () => {
    const n = Math.round(col.scrollTop / 720) + 1;
    window.shown.add(n);
    history.replaceState(null, '', '/reels/' + n + '/');
  });
  document.querySelector('.prox').addEventListener('click', () => { if (!window.noArrow) col.scrollTop += 720; });
} else if (path.startsWith('/explore')) {
  window.backTo = location.pathname + location.search;
  app.innerHTML = window.emptyGrid ? '' : '<div class="grid" style="padding:20px 300px">' +
    [1, 2, 3, 4, 5, 6].map((i) => '<a href="/p/' + i + '/"></a>').join('') + '</div>';
  document.querySelectorAll('.grid a').forEach((a) => a.addEventListener('click', (e) => {
    e.preventDefault();
    history.pushState(null, '', a.getAttribute('href'));
    const d = dialog('<button class="seguir"><div><div>Seguir</div></div></button><div class="dlg-heart">' + heart + '</div>');
    const s = d.querySelector('.seguir');
    s.addEventListener('click', () => { if (!window.blockFollow) s.remove(); });
  }));
}
window.events = [];
addEventListener('mousemove', () => window.events.push('move'));
</script></body></html>`;

// Relógio que anda sozinho nas esperas, cedendo um pouquinho de tempo real ao navegador
function quickClock() {
  let t = Date.now();
  return {
    now: () => t,
    sleep: async (ms) => {
      t += Math.max(0, ms);
      await new Promise((r) => setTimeout(r, Math.min(ms, 10)));
    },
  };
}

let browser;
let available = true;
test.before(async () => {
  try {
    browser = await chromium.launch({ headless: true });
  } catch {
    available = false; // sem Chromium do Playwright instalado: pula
  }
});
test.after(async () => {
  if (browser) await browser.close();
});

async function setup(url, { persona = {}, plan = { like: 5, follow: 5, story: 5, reel: 5, explore: 2 }, before } = {}) {
  const page = await browser.newPage({ viewport: { width: 1366, height: 768 } });
  if (before) await page.addInitScript(before);
  await page.route('**/*', (route) => route.fulfill({ status: 200, contentType: 'text/html', body: PAGE }));
  await page.goto(url);
  const logs = [];
  const actions = [];
  const done = {};
  const ctl = {
    status() {},
    sample() {},
    shouldStop: () => false,
    timeLeft: () => 60 * 60000,
    capped: () => false,
    useful: () => true,
    goalsDone: () => false,
    left: (k) => (plan[k] || 0) - (done[k] || 0),
    log: (m) => logs.push(m),
    fail: (l, e) => logs.push(`falha ${l}: ${e.message}`),
    action: (t, d) => {
      done[t] = (done[t] || 0) + 1;
      actions.push(`${t}:${d}`);
    },
  };
  const bot = createBot(page, ctl, { clock: quickClock(), rng: human.makeRng(7), persona: { ...human.makePersona(7), ...persona } });
  return { page, bot, ctl, logs, actions };
}
const label = (page, sel) => page.getAttribute(sel, 'aria-label');

test('Instagram real: curtida no coração chega e só conta se virou "Descurtir"; post já curtido não é clicado', async (t) => {
  if (!available) return t.skip('Chromium do Playwright não instalado');
  const { page, bot, ctl, actions, logs } = await setup('https://www.instagram.com/');
  assert.equal(await instagram._likeHere({ bot, ctl }, 'Post do feed'), true);
  assert.equal(await label(page, 'article .heart svg'), 'Descurtir', 'o clique não chegou no coração');
  assert.deepEqual(actions, ['like:Post do feed']);
  // De novo no mesmo post: não clica (descurtiria) e não conta
  assert.equal(await instagram._likeHere({ bot, ctl }, 'Post do feed'), false);
  assert.equal(await label(page, 'article .heart svg'), 'Descurtir');
  assert.equal(actions.length, 1);
  assert.match(logs.pop(), /já estava curtida/);
  assert.ok((await page.evaluate(() => window.events.length)) > 5, 'o mouse não andou até o coração');
  await page.close();
});

test('Instagram real: curtida que não pega não conta', async (t) => {
  if (!available) return t.skip('Chromium do Playwright não instalado');
  const { bot, ctl, actions, logs } = await setup('https://www.instagram.com/', { before: () => (window.blockLike = true) });
  assert.equal(await instagram._likeHere({ bot, ctl }, 'Post do feed'), false);
  assert.deepEqual(actions, []);
  assert.match(logs.pop(), /não pegou/);
});

test('Instagram real: reel curte no coração (dois cliques no reel não curtem no Instagram pelo computador)', async (t) => {
  if (!available) return t.skip('Chromium do Playwright não instalado');
  const { page, bot, ctl, actions } = await setup('https://www.instagram.com/reels/');
  assert.equal(await instagram._likeHere({ bot, ctl }, 'Reel'), true);
  assert.equal(await label(page, '.reel-bar svg'), 'Descurtir');
  assert.deepEqual(actions, ['like:Reel']);
  await page.close();
});

test('Instagram real: troca de reel com a rodinha em cima do vídeo; sem rodinha, a seta; sem as duas, avisa que ficou', async (t) => {
  if (!available) return t.skip('Chromium do Playwright não instalado');
  const path = (p) => new URL(p.url()).pathname;
  let s = await setup('https://www.instagram.com/reels/');
  // O mouse começa longe da coluna (onde a rodinha não rola nada)
  await s.page.mouse.move(100, 100);
  assert.equal(await instagram._reelStep(s, 1), true);
  assert.equal(path(s.page), '/reels/2/');
  assert.equal(await instagram._reelStep(s, 1), true);
  assert.equal(path(s.page), '/reels/3/');
  await s.page.close();

  s = await setup('https://www.instagram.com/reels/', { before: () => (window.noWheel = true) });
  assert.equal(await instagram._reelStep(s, 1), true);
  assert.equal(path(s.page), '/reels/2/');
  await s.page.close();

  s = await setup('https://www.instagram.com/reels/', {
    before: () => {
      window.noWheel = true;
      window.noArrow = true;
    },
  });
  assert.equal(await instagram._reelStep(s, 1), false);
  await s.page.close();
});

test('Instagram real: a atividade de Reels assiste reels diferentes (nunca o mesmo contado de novo)', async (t) => {
  if (!available) return t.skip('Chromium do Playwright não instalado');
  const { page, bot, ctl, actions, logs } = await setup('https://www.instagram.com/', { plan: { reel: 3 } });
  assert.equal(await instagram._activities.reels({ page, bot, ctl, account: { interests: [] } }), true);
  assert.equal(actions.filter((a) => a.startsWith('reel:')).length, 3);
  assert.ok((await page.evaluate(() => window.shown.size)) >= 3, 'contou o mesmo reel mais de uma vez');
  assert.ok(!logs.some((l) => /Não consegui passar/.test(l)));
  await page.close();
});

test('Instagram real: legenda lida é a do post e a do reel da tela (decide o nicho)', async (t) => {
  if (!available) return t.skip('Chromium do Playwright não instalado');
  let s = await setup('https://www.instagram.com/');
  const feed = await instagram._screenText(s.page);
  assert.match(feed, /receita de bolo de cenoura 0/);
  assert.doesNotMatch(feed, /cenoura 1/, 'leu o post de baixo, que não está inteiro na tela');
  await s.page.close();
  s = await setup('https://www.instagram.com/reels/');
  const reel = await instagram._screenText(s.page);
  assert.match(reel, /skate radical na pista 1/);
  assert.doesNotMatch(reel, /pista 2/, 'leu o reel de baixo');
  await s.page.close();
});

test('Instagram real: comentários abrem na janela do post e fecham no X, sem Esc', async (t) => {
  if (!available) return t.skip('Chromium do Playwright não instalado');
  const { page, bot } = await setup('https://www.instagram.com/');
  assert.equal(await bot.clickVisible(instagram.SEL.comment, { minSize: 15 }), true);
  assert.equal(new URL(page.url()).pathname, '/p/1/');
  await instagram._closeDialog({ page, bot });
  assert.equal(await page.locator('[role="dialog"]').count(), 0, 'a janela ficou aberta');
  assert.equal(new URL(page.url()).pathname, '/');
  assert.deepEqual(await page.evaluate(() => window.keys), [], 'apertou tecla para fechar');
  await page.close();
});

test('Instagram real: stories pela foto de quem postou; assiste, avança e fecha no X', async (t) => {
  if (!available) return t.skip('Chromium do Playwright não instalado');
  const { page, bot, ctl, actions } = await setup('https://www.instagram.com/', { plan: { story: 3 } });
  const visited = [];
  page.on('framenavigated', (f) => f === page.mainFrame() && visited.push(new URL(f.url()).pathname));
  assert.equal(await instagram._activities.stories({ page, bot, ctl }), true);
  assert.ok(visited.includes('/stories/autor/'), 'a foto não abriu o story');
  assert.deepEqual(actions, ['story:Story 1/3', 'story:Story 2/3', 'story:Story 3/3']);
  // Só o X do visor leva de volta ao feed (a página falsa do story não reage ao Esc)
  assert.equal(new URL(page.url()).pathname, '/', 'o visor ficou aberto');
  await page.close();
});

test('Instagram real: com o feed já rolado, volta ao topo e abre o story NÃO visto da bandeja', async (t) => {
  if (!available) return t.skip('Chromium do Playwright não instalado');
  const { page, bot, ctl, actions } = await setup('https://www.instagram.com/?bandeja=nova', { plan: { story: 2 } });
  await page.mouse.move(600, 400);
  await page.mouse.wheel(0, 1500); // a sessão rolou o feed antes: a bandeja saiu da tela
  await page.waitForFunction(() => window.scrollY > 1000);
  const visited = [];
  page.on('framenavigated', (f) => f === page.mainFrame() && visited.push(new URL(f.url()).pathname));
  assert.equal(await instagram._activities.stories({ page, bot, ctl }), true);
  assert.equal(visited[0], '/stories/nova/', `abriu ${visited[0]}`);
  assert.deepEqual(actions, ['story:Story 1/2', 'story:Story 2/2']);
  await page.close();
});

test('Instagram real: todos os stories vistos e a foto de quem postou sem story: revê um da bandeja', async (t) => {
  if (!available) return t.skip('Chromium do Playwright não instalado');
  const { page, bot, ctl, actions } = await setup('https://www.instagram.com/?bandeja=vista', { plan: { story: 1 } });
  await page.evaluate(() => (window.avatarSemStory = true));
  const visited = [];
  page.on('framenavigated', (f) => f === page.mainFrame() && visited.push(new URL(f.url()).pathname));
  assert.equal(await instagram._activities.stories({ page, bot, ctl }), true);
  assert.ok(
    visited.some((p) => /^\/stories\/(velho|nova)\/$/.test(p)),
    visited.join(' '),
  );
  assert.deepEqual(actions, ['story:Story 1/1']);
  await page.close();
});

test('Instagram real: follow só conta se o botão Seguir sumiu (ou virou Seguindo)', async (t) => {
  if (!available) return t.skip('Chromium do Playwright não instalado');
  let s = await setup('https://www.instagram.com/explore/');
  await s.bot.clickVisible(instagram.SEL.post, { minSize: 80 });
  assert.equal(await instagram._followHere({ bot: s.bot, ctl: s.ctl }, 'Autor'), true);
  assert.equal(await s.page.locator('.seguir').count(), 0);
  assert.deepEqual(s.actions, ['follow:Autor']);
  // Já seguindo: nada a clicar
  assert.equal(await instagram._followHere({ bot: s.bot, ctl: s.ctl }, 'Autor'), false);
  assert.equal(s.actions.length, 1);
  await s.page.close();

  s = await setup('https://www.instagram.com/explore/', { before: () => (window.blockFollow = true) });
  await s.bot.clickVisible(instagram.SEL.post, { minSize: 80 });
  assert.equal(await instagram._followHere({ bot: s.bot, ctl: s.ctl }, 'Autor'), false);
  assert.deepEqual(s.actions, []);
  assert.match(s.logs.pop(), /follow não pegou/);
  await s.page.close();
});

test('Instagram real: Explorar abre publicações pela hashtag, curte dentro da janela e fecha no X', async (t) => {
  if (!available) return t.skip('Chromium do Playwright não instalado');
  const { page, bot, ctl, actions } = await setup('https://www.instagram.com/', { plan: { explore: 1, like: 5, follow: 5 } });
  const account = { interests: ['skate'] };
  assert.equal(await instagram._activities.explore({ page, bot, ctl, account }), true);
  const url = new URL(page.url());
  assert.equal(url.pathname, '/explore/search/keyword/');
  assert.equal(url.searchParams.get('q'), '#skate');
  assert.equal(actions[0], 'explore:#skate', 'o Explorar não contou ao abrir a 1ª publicação');
  assert.equal(actions.filter((a) => a.startsWith('explore')).length, 1);
  assert.equal(await page.locator('[role="dialog"]').count(), 0, 'a janela ficou aberta');
  assert.deepEqual(await page.evaluate(() => window.keys), [], 'apertou tecla para fechar');
  await page.close();
});

test('Instagram real: Explorar sem publicações não conta', async (t) => {
  if (!available) return t.skip('Chromium do Playwright não instalado');
  const { page, bot, ctl, actions } = await setup('https://www.instagram.com/', { before: () => (window.emptyGrid = true) });
  assert.equal(await instagram._activities.explore({ page, bot, ctl, account: { interests: [] } }), false);
  assert.deepEqual(actions, []);
  await page.close();
});
