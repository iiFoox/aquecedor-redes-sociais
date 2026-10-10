// Robô num Chromium de verdade, numa página LOCAL que imita o TikTok (toda requisição é respondida aqui;
// nada vai para a internet). Pega o que a página falsa do simulador não pega: clique que não chega,
// dois cliques que não viram "dblclick", rolagem fora do painel, digitação que não entra na caixa.
// (Foi assim que o cursor do ghost-cursor passou despercebido: na página falsa, todo clique "funcionava".)
/* global window, document */ // os page.evaluate rodam dentro do navegador
const test = require('node:test');
const assert = require('node:assert/strict');
const { chromium } = require('playwright');
const { createBot } = require('../motor/bot');
const human = require('../motor/human');
const tiktok = require('../motor/platforms/tiktok');

const PAGE = `<!doctype html><html><head><meta charset="utf-8"><style>
body{margin:0;font-family:sans-serif}
form{position:absolute;left:16px;top:20px} input{width:200px;height:36px}
video{position:absolute;left:440px;top:30px;width:400px;height:700px;background:#222}
[data-e2e="like-icon"],[data-e2e="comment-icon"]{position:absolute;left:870px;width:48px;height:48px;background:#ddd}
[data-e2e="like-icon"]{top:380px} [data-e2e="comment-icon"]{top:460px}
.css-x-DivCommentMain{position:absolute;left:990px;top:60px;width:350px;height:600px;overflow-y:auto;display:none}
.css-x-DivCommentMain.open{display:block} .css-x-DivCommentMain p{height:120px;margin:0}
button[aria-label="exit"]{position:absolute;left:1300px;top:20px;width:32px;height:32px;display:none}
[data-e2e="feed-follow"]{position:absolute;left:870px;top:300px;width:24px;height:24px;background:#f33}
[data-e2e="following-count"]{position:absolute;left:20px;top:100px}
</style></head><body>
<form data-e2e="search-box" action="/search"><input data-e2e="search-user-input" name="q" type="search" placeholder="Pesquisar"></form>
<span id="tab-videos" style="position:absolute;left:560px;top:5px;padding:4px">Vídeos</span>
<video muted></video>
<div role="button" data-e2e="like-icon" aria-label="Curtir vídeo" aria-pressed="false"></div>
<div role="button" data-e2e="comment-icon"></div>
<button aria-label="exit"></button>
<button data-e2e="feed-follow"><div><svg viewBox="0 0 48 48"><path d="M22 4 mais"></path></svg></div></button>
<strong data-e2e="following-count">7</strong>
<div class="css-x-DivCommentMain">${'<p>comentário</p>'.repeat(20)}</div>
<script>
const like = document.querySelector('[data-e2e="like-icon"]');
const panel = document.querySelector('.css-x-DivCommentMain');
const exit = document.querySelector('button[aria-label="exit"]');
const setLiked = (v) => like.setAttribute('aria-pressed', String(v));
// Coração alterna; dois cliques no vídeo só curtem (como no TikTok)
like.addEventListener('click', () => setLiked(like.getAttribute('aria-pressed') !== 'true'));
document.querySelector('video').addEventListener('dblclick', () => setLiked(true));
const toggle = (open) => { panel.classList.toggle('open', open); exit.style.display = open ? 'block' : 'none'; };
document.querySelector('[data-e2e="comment-icon"]').addEventListener('click', () => toggle(!panel.classList.contains('open')));
exit.addEventListener('click', () => toggle(false));
// Aba "Vídeos" da busca: leva para /search/video com o mesmo termo
document.getElementById('tab-videos').addEventListener('click', () => (location.href = '/search/video' + location.search));
// "+" da foto do criador vira "✓" (a não ser que o TikTok recuse: o teste trava)
document.querySelector('[data-e2e="feed-follow"] path').closest('button').addEventListener('click', (e) => {
  if (!window.blockFollow) e.currentTarget.querySelector('path').setAttribute('d', 'M43 6 certo');
});
window.events = [];
addEventListener('mousemove', () => window.events.push('move'));
</script></body></html>`;

// Relógio que anda sozinho nas esperas (o teste não leva os minutos de uma sessão), mas cede um
// pouquinho de tempo real para o navegador processar cada evento
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

async function setup(persona = {}) {
  const page = await browser.newPage({ viewport: { width: 1366, height: 768 } });
  // Toda requisição recebe a página local: nada sai para a internet
  await page.route('**/*', (route) => route.fulfill({ status: 200, contentType: 'text/html', body: PAGE }));
  await page.goto('https://www.tiktok.com/foryou');
  const logs = [];
  const actions = [];
  const ctl = {
    status() {},
    sample() {},
    shouldStop: () => false,
    log: (m) => logs.push(m),
    action: (t, d) => actions.push(`${t}:${d}`),
  };
  const bot = createBot(page, ctl, { clock: quickClock(), rng: human.makeRng(3), persona: { ...human.makePersona(3), ...persona } });
  const pressed = () => page.getAttribute('[data-e2e="like-icon"]', 'aria-pressed');
  return { page, bot, ctl, logs, actions, pressed };
}

test('navegador real: curtida pelo coração chega, conta e não descurte vídeo já curtido', async (t) => {
  if (!available) return t.skip('Chromium do Playwright não instalado');
  const { page, bot, ctl, actions, logs, pressed } = await setup({ doubleTap: 0 });
  assert.equal(await tiktok._likeVideo(bot, ctl, '[data-e2e="like-icon"]', 'teste'), true);
  assert.equal(await pressed(), 'true', 'o clique não chegou no coração');
  assert.deepEqual(actions, ['like:teste']);
  // De novo no mesmo vídeo: não clica (descurtiria) e não conta
  assert.equal(await tiktok._likeVideo(bot, ctl, '[data-e2e="like-icon"]', 'teste'), false);
  assert.equal(await pressed(), 'true');
  assert.equal(actions.length, 1);
  assert.match(logs.pop(), /já estava curtido/);
  assert.ok((await page.evaluate(() => window.events.length)) > 5, 'o mouse não andou até o coração');
  await page.close();
});

test('navegador real: dois cliques no vídeo viram um duplo clique de verdade e curtem', async (t) => {
  if (!available) return t.skip('Chromium do Playwright não instalado');
  const { page, bot, ctl, actions, pressed } = await setup({ doubleTap: 1 });
  assert.equal(await tiktok._likeVideo(bot, ctl, '[data-e2e="like-icon"]', 'teste'), true);
  assert.equal(await pressed(), 'true', 'os dois cliques não curtiram');
  assert.deepEqual(actions, ['like:teste (dois cliques)']);
  await page.close();
});

test('navegador real: comentários rolam com a rodinha e fecham', async (t) => {
  if (!available) return t.skip('Chromium do Playwright não instalado');
  const { page, bot, ctl } = await setup();
  let scrolled = false;
  for (let i = 0; i < 6 && !scrolled; i++) {
    await page.evaluate(() => (document.querySelector('.css-x-DivCommentMain').scrollTop = 0));
    // Mede o maior scrollTop enquanto o painel está aberto
    await page.evaluate(() => {
      window.maxTop = 0;
      document.querySelector('.css-x-DivCommentMain').addEventListener('scroll', (e) => {
        window.maxTop = Math.max(window.maxTop, e.target.scrollTop);
      });
    });
    await tiktok._browseComments({ page, bot, ctl });
    scrolled = (await page.evaluate(() => window.maxTop)) > 0;
    const open = await page.evaluate(() => document.querySelector('.css-x-DivCommentMain').classList.contains('open'));
    assert.equal(open, false, 'o painel de comentários ficou aberto');
  }
  assert.ok(scrolled, 'a rodinha nunca rolou a lista de comentários');
  await page.close();
});

test('navegador real: busca digitada entra na caixa, o Enter abre a busca e ela clica na aba Vídeos', async (t) => {
  if (!available) return t.skip('Chromium do Playwright não instalado');
  const { page, bot, ctl } = await setup();
  // A busca digitada é sorteada em 80% das vezes; com esta semente sai digitada
  const visited = [];
  page.on('framenavigated', (f) => f === page.mainFrame() && visited.push(new URL(f.url()).pathname));
  for (let i = 0; i < 5 && !visited.includes('/search'); i++) {
    await page.goto('https://www.tiktok.com/foryou');
    await tiktok._typedSearch({ page, bot, ctl }, 'receitas fáceis');
  }
  // Digitou (o Enter levou a /search?q=) e clicou na aba "Vídeos"
  assert.ok(visited.includes('/search'), 'a busca nunca foi digitada');
  const url = new URL(page.url());
  assert.equal(url.pathname, '/search/video');
  assert.equal(url.searchParams.get('q'), 'receitas fáceis');
  await page.close();
});

test('navegador real: captcha na tela é reconhecido; página normal não dá alarme falso', async (t) => {
  if (!available) return t.skip('Chromium do Playwright não instalado');
  const { page } = await setup();
  assert.equal(await tiktok.detectProblem(page), null);
  // Formatos de nome que um captcha pode ter (id ou classe com "captcha", em qualquer caixa, ou iframe)
  for (const html of [
    '<div id="captcha-verify-container-main-page" style="width:300px;height:300px">x</div>',
    '<div class="TUXModal captcha-verify-container" style="width:300px;height:300px">x</div>',
    '<div class="secsdk-Captcha-drag" style="width:300px;height:300px">x</div>',
    '<iframe src="about:blank#captcha" style="width:300px;height:300px"></iframe>',
  ]) {
    await page.evaluate((h) => document.body.insertAdjacentHTML('beforeend', `<div class="t">${h}</div>`), html);
    const p = await tiktok.detectProblem(page);
    assert.equal(p && p.kind, 'captcha', `não reconheceu: ${html}`);
    await page.evaluate(() => document.querySelectorAll('.t').forEach((e) => e.remove()));
  }
  // Captcha escondido (contêiner vazio que não aparece) não para a sessão
  await page.evaluate(() => document.body.insertAdjacentHTML('beforeend', '<div class="captcha-holder" style="display:none"></div>'));
  assert.equal(await tiktok.detectProblem(page), null);
  await page.close();
});

test('navegador real: follow do vídeo só conta se o "+" virou "✓"; botão que não muda não conta', async (t) => {
  if (!available) return t.skip('Chromium do Playwright não instalado');
  let s = await setup();
  assert.equal(await tiktok._followHere(s.bot, s.ctl, '[data-e2e="feed-follow"]', 'Criador do vídeo'), true);
  assert.match(await s.page.getAttribute('[data-e2e="feed-follow"] path', 'd'), /certo/, 'o clique não chegou no botão');
  assert.deepEqual(s.actions, ['follow:Criador do vídeo']);
  await s.page.close();

  s = await setup();
  await s.page.evaluate(() => (window.blockFollow = true));
  assert.equal(await tiktok._followHere(s.bot, s.ctl, '[data-e2e="feed-follow"]', 'Criador do vídeo'), false);
  assert.deepEqual(s.actions, []);
  assert.match(s.logs.pop(), /não pegou/);
  await s.page.close();
});

test('navegador real: lê quantas contas a própria conta segue', async (t) => {
  if (!available) return t.skip('Chromium do Playwright não instalado');
  const { page, bot } = await setup();
  assert.equal(await tiktok._followingCount({ page, bot, account: { username: 'conta' } }), 7);
  assert.equal(new URL(page.url()).pathname, '/@conta');
  await page.close();
});
