const { AbortError, isFatal, weighted, pick } = require('../core/bot');
const { phaseIndex } = require('./phases');

const HOME = 'https://www.instagram.com/';
const SEL = {
  like: 'svg[aria-label="Curtir"], svg[aria-label="Like"]',
  post: 'a[href*="/p/"], a[href*="/reel/"]',
  story: '[role="button"][aria-label*="tory"], main li canvas',
  popup: 'button:has-text("Agora não"), button:has-text("Not Now"), [role="button"]:has-text("Agora não"), [role="button"]:has-text("Not now")',
  loginForm: 'input[name="username"]',
};

// Metas diárias por fase (índice 0 = fase 1)
const PLANS = [
  { minutes: 8, like: 3, follow: 0, story: 4, reel: 3, explore: 0 },
  { minutes: 12, like: 8, follow: 3, story: 6, reel: 5, explore: 1 },
  { minutes: 18, like: 15, follow: 6, story: 8, reel: 8, explore: 2 },
  { minutes: 25, like: 25, follow: 10, story: 10, reel: 12, explore: 3 },
  { minutes: 30, like: 35, follow: 15, story: 12, reel: 15, explore: 3 },
];

const ACTIONS = {
  like: 'Curtidas', follow: 'Follows', story: 'Stories', reel: 'Reels',
  explore: 'Explorar/Hashtags', scroll: 'Rolagens de feed',
};
const ACT_LABEL = { feed: 'Rolar o feed', stories: 'Assistir stories', reels: 'Assistir Reels', explore: 'Explorar o nicho', afk: 'Distração / Fora do Teclado' };

const atHome = (page) => /^https:\/\/www\.instagram\.com\/?(\?.*)?$/.test(page.url());

// Chance de curtir adaptativa: sobe se as curtidas estão atrasadas (teto 70%)
function likeChance(ctl, base) {
  const l = ctl.left('like');
  if (l <= 0) return 0;
  const pool = ctl.left('reel') + ctl.left('story');
  if (pool <= 0) return Math.max(base, 0.5);
  return Math.min(0.7, Math.max(base, (l / pool) * 1.5));
}

async function isLoggedIn(page) {
  if (page.url().includes('/accounts/login')) return false;
  return (await page.locator(SEL.loginForm).count()) === 0;
}

async function detectProblem(page) {
  const url = page.url();
  if (url.includes('/challenge')) return { kind: 'captcha', msg: 'Instagram pediu uma verificação de segurança (challenge)' };
  if (url.includes('/accounts/login')) return { kind: 'logout', msg: 'A sessão do Instagram expirou. Faça login novamente' };
  const blocked = page.getByText(/Tente novamente mais tarde|Try Again Later|Ação bloqueada|Action Blocked|restringimos determinadas atividades|We restrict certain activity/i);
  if (await blocked.first().isVisible().catch(() => false)) return { kind: 'block', msg: 'Instagram bloqueou ações temporariamente' };
  return null;
}

async function dismissPopups(bot) {
  for (let i = 0; i < 2; i++) {
    if (await bot.clickVisible(SEL.popup)) await bot.wait(800, 1600, 'Fechando pop-up');
    else break;
  }
}

const ACTIVITIES = {
  async feed({ page, bot, ctl, account }) {
    if (!atHome(page)) await bot.goto(HOME, 'Voltando ao feed');
    const rounds = bot.rand(3, 7);
    for (let i = 0; i < rounds && ctl.timeLeft() > 0; i++) {
      ctl.status('Rolando o feed');
      await bot.scroll(bot.rand(350, 900));
      ctl.action('scroll', 'Feed');
      
      const text = await page.locator('article span[dir="auto"], article h1').first().textContent({ timeout: 1000 }).catch(() => '');
      const isNiche = await bot.readNiche(text, account.interests || []);
      const waitTime = isNiche ? bot.rand(12000, 22000) : bot.rand(2000, 8000);
      
      await bot.wait(waitTime, waitTime, 'Lendo o post como uma pessoa faria');
      
      if (Math.random() < 0.12) {
        ctl.status('Erro humano: abriu comentários do post');
        if (await bot.clickVisible('svg[aria-label="Comentar"], svg[aria-label="Comment"]', { minSize: 15 })) {
          await bot.wait(1500, 3500, 'Olhando comentários...');
          await page.keyboard.press('Escape');
          await bot.wait(1000, 2000);
        }
      }

      if (waitTime > 4000 && Math.random() < (isNiche ? Math.max(0.6, likeChance(ctl, 0.3)) : likeChance(ctl, 0.3))) {
        ctl.status('Decidiu curtir este post');
        if (await bot.clickVisible(SEL.like, { minSize: 20 })) {
          ctl.action('like', 'Post do feed');
          await bot.wait(1500, 4000, 'Pausa após curtir');
        }
      }
    }
    return true;
  },

  async stories({ page, bot, ctl }) {
    await bot.goto(HOME, 'Indo para a bandeja de stories');
    await dismissPopups(bot);
    if (!(await bot.clickVisible(SEL.story))) {
      ctl.log('Não encontrei stories disponíveis', 'warn');
      return false;
    }
    await bot.wait(1500, 2500, 'Abrindo story');
    const n = Math.min(ctl.left('story'), bot.rand(3, 6));
    for (let i = 1; i <= n; i++) {
      await bot.wait(3000, 8000, `Assistindo story ${i}/${n}`);
      ctl.action('story', `Story ${i}/${n}`);
      if (ctl.timeLeft() <= 0) break;
      await page.keyboard.press('ArrowRight');
    }
    await page.keyboard.press('Escape');
    await bot.wait(1000, 2000);
    return true;
  },

  async reels({ page, bot, ctl, account }) {
    await bot.goto(`${HOME}reels/`, 'Abrindo Reels');
    // Se a meta de reels já bateu mas faltam curtidas, assiste alguns mesmo assim
    const n = ctl.left('reel') > 0 ? Math.min(ctl.left('reel'), bot.rand(3, 6)) : bot.rand(2, 4);
    for (let i = 1; i <= n && ctl.timeLeft() > 0; i++) {
      const text = await page.locator('main span[dir="auto"], main h1').first().textContent({ timeout: 1000 }).catch(() => '');
      const isNiche = await bot.readNiche(text, account.interests || []);
      
      let ms = Math.random() < 0.25 ? bot.rand(12000, 30000) : bot.rand(4000, 11000);
      if (isNiche) ms = bot.rand(18000, 35000);
      
      const sec = Math.round(ms / 1000);
      await bot.wait(ms, ms, `Assistindo reel ${i}/${n} por ${sec}s${ms > 12000 ? ' (até o fim, sinal de interesse)' : ''}`);
      ctl.action('reel', `${sec}s`);
      
      if (Math.random() < 0.1) {
        ctl.status('Erro humano: pausou reel');
        await page.mouse.click(bot.rand(500, 700), bot.rand(300, 500));
        await bot.wait(2000, 5000);
        await page.mouse.click(bot.rand(500, 700), bot.rand(300, 500)); // despausa
      }

      if (ms > 12000 && Math.random() < (isNiche ? Math.max(0.6, likeChance(ctl, 0.4)) : likeChance(ctl, 0.4))) {
        if (await bot.clickVisible(SEL.like, { minSize: 20 })) ctl.action('like', 'Reel');
      }
      ctl.status('Passando para o próximo reel');
      await bot.moveTo(bot.rand(560, 720), bot.rand(300, 500));
      await bot.scroll(bot.rand(700, 900));
      await bot.wait(800, 1600);
    }
    return true;
  },

  async explore({ page, bot, ctl, account }) {
    const tag = account.interests.length ? pick(account.interests).replace(/^#/, '').trim() : null;
    const url = tag ? `${HOME}explore/tags/${encodeURIComponent(tag)}/` : `${HOME}explore/`;
    await bot.goto(url, tag ? `Explorando a hashtag #${tag}` : 'Abrindo o Explorar');
    if (ctl.left('explore') > 0) ctl.action('explore', tag ? `#${tag}` : 'Explorar');
    await bot.scroll(bot.rand(300, 700));
    await bot.wait(2000, 4000, 'Olhando a grade de publicações');
    const posts = bot.rand(2, 4);
    for (let i = 1; i <= posts && ctl.timeLeft() > 0; i++) {
      ctl.status(`Abrindo publicação ${i}/${posts}`);
      if (!(await bot.clickVisible(SEL.post, { random: true, minSize: 80 }))) break;
      await bot.wait(3000, 8000, 'Vendo a publicação');
      if (ctl.left('like') > 0 && Math.random() < 0.5 && (await bot.clickVisible(SEL.like, { minSize: 20 }))) {
        ctl.action('like', tag ? `#${tag}` : 'Explorar');
        await bot.wait(1000, 3000, 'Pausa após curtir');
      }
      if (ctl.left('follow') > 0 && Math.random() < 0.55) {
        const btn = page.getByRole('button', { name: /^(Seguir|Follow)$/ }).first();
        if (await btn.isVisible().catch(() => false)) {
          ctl.status('Seguindo o autor da publicação');
          await bot.click(btn);
          ctl.action('follow', tag ? `Autor em #${tag}` : 'Autor no Explorar');
          await bot.wait(2000, 5000, 'Pausa após seguir');
        }
      }
      await page.keyboard.press('Escape');
      await bot.wait(2000, 6000, 'Voltando à grade');
    }
    return true;
  },

  async afk({ bot }) {
    const ms = bot.rand(35000, 90000); // Fica de 35s a 1.5 min sem fazer nada
    await bot.wait(ms, ms, 'Distração (AFK): O humano foi ao banheiro ou minimizou a janela');
    bot.rest(); // voltou descansado
    return true;
  },
};

async function run({ page, bot, ctl, account }) {
  await bot.goto(HOME, 'Abrindo o Instagram');
  if (!(await isLoggedIn(page))) {
    throw new AbortError('Conta não está logada. Clique em "Login" no painel primeiro.', 'NOT_LOGGED');
  }
  ctl.log('Login confirmado ✔');
  await dismissPopups(bot);
  await bot.guard();

  const fails = {};
  const skip = new Set(); // metas inalcançáveis NESTA sessão (ex: conta nova sem stories pra ver)
  let last = null;
  let lastAfk = Date.now();

  // Loop guiado por META: só para quando bater tudo (ou teto de segurança / travamento)
  while (true) {
    if (ctl.goalsDone([...skip])) return 'goals';
    if (ctl.timeLeft() <= 0) return 'cap';
    if (ctl.stalled()) return 'stall';

    const opts = [['feed', ctl.left('like') > 0 ? 3 : 1]];
    if (!skip.has('story') && ctl.left('story') > 0) opts.push(['stories', 2]);
    if (!skip.has('reel') && (ctl.left('reel') > 0 || ctl.left('like') > 0)) opts.push(['reels', ctl.left('reel') > 0 ? 2 : 1]);
    if (!skip.has('explore') && (ctl.left('explore') > 0 || ctl.left('follow') > 0)) opts.push(['explore', 2]);
    // AFK: nunca duas vezes seguidas e no máximo ~1 a cada 6 min
    if (last !== 'afk' && Date.now() - lastAfk > 6 * 60000) opts.push(['afk', 0.5]);
    const act = weighted(opts);
    last = act;
    if (act === 'afk') lastAfk = Date.now();
    ctl.log(`Próxima atividade: ${ACT_LABEL[act]}`);
    let ok = false;
    try {
      ok = await ACTIVITIES[act]({ page, bot, ctl, account });
    } catch (e) {
      if (isFatal(e)) throw e;
      ctl.log(`Falha em "${ACT_LABEL[act]}": ${e.message.split('\n')[0]}`, 'warn');
    }
    if (!ok) {
      fails[act] = (fails[act] || 0) + 1;
      if (act === 'stories' && fails.stories >= 2) { skip.add('story'); ctl.log('Sem stories disponíveis, meta de stories ignorada nesta sessão', 'warn'); }
      if (act === 'reels' && fails.reels >= 2) { skip.add('reel'); ctl.log('Reels falhou 2x, meta de reels ignorada nesta sessão', 'warn'); }
      if (act === 'explore' && fails.explore >= 2) { skip.add('explore'); skip.add('follow'); ctl.log('Explorar falhou 2x, metas de explorar/follow ignoradas nesta sessão', 'warn'); }
    }
    await dismissPopups(bot);
    await bot.guard();
    if (!ctl.goalsDone([...skip])) await bot.wait(4000, 12000, 'Pausa natural entre atividades');
  }
}

module.exports = {
  id: 'instagram',
  name: 'Instagram',
  loginUrl: `${HOME}accounts/login/`,
  actions: ACTIONS,
  plans: PLANS,
  planForDay: (day) => {
    const base = PLANS[phaseIndex(day)];
    // Adiciona "White Noise" (Ruído Branco) na variação do comportamento diário
    return {
      minutes: Math.max(3, base.minutes + Math.floor(Math.random() * 5) - 2), // -2 a +2 min
      like: Math.max(1, base.like + Math.floor(Math.random() * 3) - 1),
      follow: Math.max(0, base.follow + Math.floor(Math.random() * 3) - 1),
      story: Math.max(1, base.story + Math.floor(Math.random() * 3) - 1),
      reel: Math.max(1, base.reel + Math.floor(Math.random() * 3) - 1),
      explore: Math.max(0, base.explore + Math.floor(Math.random() * 2)),
    };
  },
  detectProblem,
  run,
};
