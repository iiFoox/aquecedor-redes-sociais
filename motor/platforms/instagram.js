/* global document, innerHeight */ // screenText roda dentro do navegador
const { AbortError, isFatal } = require('../bot');
const human = require('../human');
const { phaseIndex } = require('./phases');

const HOME = 'https://www.instagram.com/';
// Seletores conferidos no Instagram de verdade (2026-10-07, conta nova logada, Edge 1920x1080):
// coração "Curtir" (24 px; os dos comentários têm 12 px) vira "Descurtir" depois de curtir; comentários e publicações
// abrem numa janela [role=dialog] com o X "Fechar"; conta nova não segue ninguém e não tem bandeja de stories, mas a foto
// de quem postou no feed tem o anel (canvas) e abre /stories/<autor>/; a hashtag abre /explore/search/keyword/?q=%23tag.
const LIKE = 'svg[aria-label="Curtir"], svg[aria-label="Like"]';
const LIKED = 'svg[aria-label="Descurtir"], svg[aria-label="Unlike"]';
const DIALOG = '[role="dialog"]';
const inDialog = (sel) =>
  sel
    .split(', ')
    .map((x) => `${DIALOG} ${x}`)
    .join(', ');
const buttonText = (words) =>
  words.flatMap((w) => [`${DIALOG} [role="button"]:text-is("${w}")`, `${DIALOG} button:text-is("${w}")`]).join(', ');
const SEL = {
  like: LIKE,
  liked: LIKED,
  comment: 'svg[aria-label="Comentar"], svg[aria-label="Comment"]',
  close: 'svg[aria-label="Fechar"], svg[aria-label="Close"]',
  dialog: DIALOG,
  post: 'a[href*="/p/"], a[href*="/reel/"]',
  // Bandeja de stories (quem a conta segue) ou o anel na foto de quem postou no feed
  story: 'main li [role="button"]:has(canvas), article [role="button"]:has(> canvas)',
  follow: buttonText(['Seguir', 'Follow']),
  following: buttonText(['Seguindo', 'Solicitado', 'Following', 'Requested']),
  popup:
    'button:has-text("Agora não"), button:has-text("Not Now"), [role="button"]:has-text("Agora não"), [role="button"]:has-text("Not now")',
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
  like: 'Curtidas',
  follow: 'Follows',
  story: 'Stories',
  reel: 'Reels',
  explore: 'Explorar/Hashtags',
  scroll: 'Rolagens de feed',
};
const ACT_LABEL = {
  feed: 'Rolar o feed',
  stories: 'Assistir stories',
  reels: 'Assistir Reels',
  explore: 'Explorar o nicho',
  afk: 'Distração / Fora do Teclado',
};

// Metas que cada atividade conta (produces) e metas que ela pode adiantar (advances).
// Uma atividade só roda se nenhuma meta que ela conta passou do teto de 120% do plano.
// ("scroll" do feed não está no plano, então o feed não tem teto próprio.)
const ACTIVITY_GOALS = {
  feed: { produces: [], advances: ['like'] },
  stories: { produces: ['story'], advances: ['story'] },
  reels: { produces: ['reel'], advances: ['reel', 'like'] },
  explore: { produces: ['explore'], advances: ['explore', 'like', 'follow'] },
};
// Gosto de base de cada atividade (variedade); quem decide mesmo é o que falta no dia
const BASE_WEIGHT = { feed: 1.3, stories: 1, reels: 1, explore: 1 };
// Nome da meta que cada atividade usa no controle de falhas desta sessão
const SKIP_KEY = { stories: 'story', reels: 'reel', explore: 'explore' };

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
  const blocked = page.getByText(
    /Tente novamente mais tarde|Try Again Later|Ação bloqueada|Action Blocked|restringimos determinadas atividades|We restrict certain activity/i,
  );
  if (
    await blocked
      .first()
      .isVisible()
      .catch(() => false)
  )
    return { kind: 'block', msg: 'Instagram bloqueou ações temporariamente' };
  return null;
}

async function dismissPopups(bot) {
  for (let i = 0; i < 2; i++) {
    if (await bot.clickVisible(SEL.popup)) await bot.pause('decide', 'Fechando pop-up');
    else break;
  }
}

// Texto da publicação ou do reel da tela (autor, legenda, áudio): decide se é do nicho.
// É o post do primeiro coração inteiro na tela, o mesmo que a curtida pega.
async function screenText(page) {
  const t = await page
    .evaluate((sel) => {
      const h = [...document.querySelectorAll(sel)].find((s) => {
        const r = s.getBoundingClientRect();
        return r.width >= 20 && r.top >= 0 && r.bottom <= innerHeight;
      });
      if (!h) return '';
      let box = h.closest('article');
      if (!box) {
        box = h;
        while (box.parentElement && !box.querySelector('video')) box = box.parentElement;
      }
      return (box.innerText || '').slice(0, 800);
    }, `${LIKE}, ${LIKED}`)
    .catch(() => null);
  if (typeof t === 'string') return t;
  // Sem leitura da página (simulador): a primeira legenda
  return page
    .locator('article span[dir="auto"], main span[dir="auto"]')
    .first()
    .textContent({ timeout: 1000 })
    .catch(() => '');
}

const near = (a, b) => !!a && !!b && Math.abs(a.x - b.x) < 12 && Math.abs(a.y - b.y) < 12;
// O coração que estava em "box" ficou curtido? true / false / null (não deu para ler: vale o clique)
async function heartAt(bot, box, dialog) {
  for (const el of await bot.visible(dialog ? inDialog(LIKED) : LIKED, { minSize: 20 }))
    if (near(await el.boundingBox().catch(() => null), box)) return true;
  for (const el of await bot.visible(dialog ? inDialog(LIKE) : LIKE, { minSize: 20 }))
    if (near(await el.boundingBox().catch(() => null), box)) return false;
  return null;
}

// Curte a publicação da tela e só conta se o coração virou "Descurtir". Já curtida: não clica (descurtiria).
// video: pela personalidade, dois cliques no vídeo (se não pegarem, vai no coração). dialog: só dentro da janela aberta.
async function likeHere({ bot, ctl }, detail, { video = false, dialog = false } = {}) {
  const sel = dialog ? inDialog(LIKE) : LIKE;
  const [heart] = await bot.visible(sel, { minSize: 20 });
  if (!heart) {
    if ((await bot.visible(dialog ? inDialog(LIKED) : LIKED, { minSize: 20 })).length)
      ctl.log('Esta publicação já estava curtida, seguindo sem clicar');
    return false;
  }
  const box = await heart.boundingBox().catch(() => null);
  let how = 'icon';
  if (video) how = await bot.likeVideo(sel, { minSize: 20 });
  else await bot.click(heart, false);
  if (!how) return false;
  await bot.wait(500, 1200);
  let state = await heartAt(bot, box, dialog);
  if (state === false && how === 'tap') {
    // Os dois cliques não curtiram: vai no coração, como gente faz
    ctl.log('Os dois cliques não curtiram, indo no coração', 'warn');
    const [again] = await bot.visible(sel, { minSize: 20 });
    if (!again) return false;
    await bot.click(again, false);
    how = 'icon';
    await bot.wait(500, 1200);
    state = await heartAt(bot, box, dialog);
  }
  if (state === false) {
    ctl.log('A curtida não pegou', 'warn');
    return false;
  }
  ctl.action('like', how === 'tap' ? `${detail} (dois cliques)` : detail);
  return true;
}

// Segue o autor da publicação aberta e só conta se o botão virou "Seguindo" (ou "Solicitado", conta privada)
async function followHere({ bot, ctl }, detail) {
  const [btn] = await bot.visible(SEL.follow);
  if (!btn) return false;
  ctl.status('Seguindo o autor da publicação');
  await bot.click(btn, false);
  await bot.wait(800, 1600);
  if (!(await bot.visible(SEL.following)).length && (await bot.visible(SEL.follow)).length) {
    ctl.log('O follow não pegou', 'warn');
    return false;
  }
  ctl.action('follow', detail);
  return true;
}

// Fecha a janela aberta (publicação, comentários, story) no X, como gente faz. Esc só se o X não está na tela.
async function closeDialog({ page, bot }) {
  if (!(await bot.clickVisible(SEL.close))) await page.keyboard.press('Escape');
}

const ACTIVITIES = {
  async feed({ page, bot, ctl, account }) {
    if (!atHome(page)) await bot.goto(HOME, 'Voltando ao feed');
    const rounds = bot.rand(3, 7);
    for (let i = 0; i < rounds && ctl.timeLeft() > 0; i++) {
      ctl.status('Rolando o feed');
      await bot.scroll(bot.rand(350, 900));
      ctl.action('scroll', 'Feed');

      const text = await screenText(page);
      const isNiche = bot.isNiche(text, account.interests || []);
      const t0 = bot.now();
      if (isNiche) await bot.readNiche(text, account.interests || []);
      else await bot.pause('read', 'Lendo o post');
      const waitTime = bot.now() - t0;

      // Às vezes abre os comentários (abrem numa janela do post), dá uma olhada e fecha no X
      if (bot.random() < 0.12) {
        ctl.status('Abriu os comentários do post');
        if (await bot.clickVisible(SEL.comment, { minSize: 15 })) {
          await bot.pause('load');
          await bot.pause('glance', 'Olhando comentários...');
          await closeDialog({ page, bot });
          await bot.pause('next');
        }
      }

      // Meta de curtidas batida = chance zero, com ou sem nicho
      const likeP = human.likeProbability(likeChance(ctl, 0.3), { niche: isNiche, persona: bot.persona });
      if (waitTime > 4000 && bot.random() < likeP) {
        ctl.status('Decidiu curtir este post');
        if (await likeHere({ bot, ctl }, 'Post do feed')) await bot.pause('afterAction', 'Pausa após curtir');
      }
    }
    return true;
  },

  async stories({ page, bot, ctl }) {
    if (!atHome(page)) await bot.goto(HOME, 'Indo para os stories');
    await dismissPopups(bot);
    let opened = await bot.clickVisible(SEL.story, { random: true });
    if (!opened) {
      // Nenhuma foto com story na tela: desce um pouco o feed e procura de novo
      await bot.scroll(bot.rand(300, 700));
      await bot.pause('decide');
      opened = await bot.clickVisible(SEL.story, { random: true });
    }
    if (!opened) {
      ctl.log('Não encontrei stories disponíveis', 'warn');
      return false;
    }
    await bot.pause('load', 'Abrindo story');
    if (!page.url().includes('/stories/')) {
      // A foto abriu o perfil (sem story): volta
      ctl.log('A foto não abriu um story', 'warn');
      if (!atHome(page)) await page.goBack().catch(() => {});
      return false;
    }
    const n = Math.min(ctl.left('story'), bot.rand(3, 6));
    for (let i = 1; i <= n; i++) {
      // Story: a maioria passa em poucos segundos; às vezes fica até o fim (~15 s)
      const sms = Math.round(human.bounded(bot.random, 5200 * (bot.persona ? bot.persona.patience : 1), 0.45, 1500, 15500));
      await bot.watch(sms, `Assistindo story ${i}/${n}`);
      ctl.action('story', `Story ${i}/${n}`);
      if (ctl.timeLeft() <= 0 || i === n) break;
      await page.keyboard.press('ArrowRight');
      await bot.wait(300, 900);
      if (!page.url().includes('/stories/')) break; // acabaram os stories: o visor fechou sozinho
    }
    if (page.url().includes('/stories/')) await closeDialog({ page, bot });
    await bot.pause('next');
    return true;
  },

  async reels({ page, bot, ctl, account }) {
    await bot.goto(`${HOME}reels/`, 'Abrindo Reels');
    // Se a meta de reels já bateu mas faltam curtidas, assiste alguns mesmo assim
    const n = ctl.left('reel') > 0 ? Math.min(ctl.left('reel'), bot.rand(3, 6)) : bot.rand(2, 4);
    // Para quando não sobra nada que os reels adiantem (ou a sessão cumpriu a parte dela do dia)
    for (let i = 1; i <= n && ctl.timeLeft() > 0 && !ctl.capped('reel') && ctl.useful(ACTIVITY_GOALS.reels) && !ctl.goalsDone(); i++) {
      const text = await screenText(page);
      const isNiche = bot.isNiche(text, account.interests || []);
      const info = await bot.videoInfo();
      const { ms, outcome } = human.watchPlan(info ? info.duration : null, {
        niche: isNiche,
        persona: bot.persona,
        mood: bot.mood,
        rng: bot.random,
      });
      const sec = Math.round(ms / 1000);
      const note = { skip: ' (pulando)', half: ' (até a metade)', full: ' (inteiro)', loop: ' (revendo, sinal de interesse)' }[outcome];
      // Meta de curtidas batida = chance zero, com ou sem nicho. A curtida sai num momento sorteado do reel.
      const likeP = human.likeProbability(likeChance(ctl, 0.4), { niche: isNiche, persona: bot.persona });
      const willLike = ms > 12000 && bot.random() < likeP;
      await bot.watchWithLike(
        ms,
        `Assistindo reel ${i}/${n} por ${sec}s${note}${isNiche ? ' · nicho' : ''}`,
        willLike && (() => likeHere({ bot, ctl }, 'Reel', { video: true })),
      );
      ctl.action('reel', `${sec}s`);

      // Às vezes pausa o reel com um clique no vídeo, espera e despausa
      if (bot.random() < 0.1) {
        ctl.status('Pausou o reel');
        if (await bot.tapVideo()) {
          await bot.pause('glance');
          await bot.tapVideo();
        }
      }

      ctl.status('Passando para o próximo reel');
      await bot.moveTo(bot.rand(560, 720), bot.rand(300, 500));
      await bot.scroll(bot.rand(700, 900));
      await bot.pause('next');
      // Às vezes volta um pouco para rever o reel anterior e segue (não conta como reel novo)
      if (i < n && bot.random() < 0.04) {
        ctl.status('Voltou ao reel anterior');
        await bot.scroll(-bot.rand(700, 900));
        await bot.watch(bot.rand(1500, 5000), 'Revendo o reel anterior');
        await bot.scroll(bot.rand(700, 900));
        await bot.pause('next');
      }
    }
    return true;
  },

  async explore({ page, bot, ctl, account }) {
    const tag = account.interests.length ? bot.pick(account.interests).replace(/^#/, '').trim() : null;
    // A hashtag abre a busca por palavra (o endereço antigo /explore/tags/ redireciona para cá)
    const url = tag ? `${HOME}explore/search/keyword/?q=${encodeURIComponent(`#${tag}`)}` : `${HOME}explore/`;
    const where = tag ? `#${tag}` : 'Explorar';
    await bot.goto(url, tag ? `Explorando a hashtag #${tag}` : 'Abrindo o Explorar');
    await bot.scroll(bot.rand(300, 700));
    await bot.pause('read', 'Olhando a grade de publicações');
    const posts = bot.rand(2, 4);
    let opened = 0;
    for (let i = 1; i <= posts && ctl.timeLeft() > 0; i++) {
      ctl.status(`Abrindo publicação ${i}/${posts}`);
      if (!(await bot.clickVisible(SEL.post, { random: true, minSize: 80 }))) break;
      await bot.pause('load', 'Abrindo a publicação');
      const dialog = await page
        .locator(SEL.dialog)
        .first()
        .isVisible()
        .catch(() => false);
      if (!dialog) {
        ctl.log('A publicação não abriu', 'warn');
        break;
      }
      // O Explorar conta quando a primeira publicação abre de verdade
      if (!opened++ && ctl.left('explore') > 0) ctl.action('explore', where);
      await bot.pause('read', 'Vendo a publicação');
      if (ctl.left('like') > 0 && bot.random() < 0.5 && (await likeHere({ bot, ctl }, where, { dialog: true })))
        await bot.pause('afterAction', 'Pausa após curtir');
      if (ctl.left('follow') > 0 && bot.random() < 0.55 && (await followHere({ bot, ctl }, `Autor em ${where}`)))
        await bot.pause('afterAction', 'Pausa após seguir');
      await closeDialog({ page, bot });
      await bot.pause('decide', 'Voltando à grade');
    }
    if (!opened) ctl.log('Nenhuma publicação abriu no Explorar', 'warn');
    return opened > 0;
  },

  async afk({ bot }) {
    // Metade das vezes "vai para outra aba"; nas outras, só para de mexer (celular, café)
    const ms = human.pause('distraction', { rng: bot.random, persona: bot.persona });
    if (bot.random() < 0.5) await bot.awayTab(ms);
    else await bot.watch(ms, 'Distração: saiu da tela por um tempo');
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
  let lastAfk = bot.now();
  // Distrações: o intervalo médio entre elas é sorteado por sessão (personalidade + acaso)
  const afkGap = human.distractionGapMin(bot.persona, bot.random) * 60000;
  // Atividade liberada: não falhou nesta sessão, não passa nenhuma meta do teto e ainda adianta alguma
  const can = (act) => !skip.has(SKIP_KEY[act]) && ctl.allowed(ACTIVITY_GOALS[act], account) && ctl.useful(ACTIVITY_GOALS[act]);

  // Loop guiado por META: só para quando bater tudo (ou teto de segurança / travamento)
  while (true) {
    if (ctl.goalsDone([...skip])) return 'goals';
    if (ctl.timeLeft() <= 0) return 'cap';
    if (ctl.stalled()) return 'stall';

    // Prioridade pelo que FALTA no dia (ctl.priority) vezes o gosto de base de cada atividade
    const opts = [];
    for (const a of Object.keys(ACTIVITY_GOALS)) if (can(a)) opts.push([a, BASE_WEIGHT[a] * ctl.priority(ACTIVITY_GOALS[a])]);
    // O que falta só sairia passando do teto de 120% do plano: encerra em vez de forçar
    if (!opts.length) return 'limit';
    // Distração: nunca duas vezes seguidas e só depois do intervalo sorteado desta sessão (~6% das escolhas)
    if (last !== 'afk' && bot.now() - lastAfk > afkGap) opts.push(['afk', 0.06 * opts.reduce((s, [, w]) => s + w, 0)]);
    const act = bot.weighted(opts);
    last = act;
    if (act === 'afk') lastAfk = bot.now();
    ctl.log(`Próxima atividade: ${ACT_LABEL[act]} · falta: ${ctl.missing(ACTIONS)}`);
    let ok = false;
    try {
      ok = await ACTIVITIES[act]({ page, bot, ctl, account });
    } catch (e) {
      if (isFatal(e)) throw e;
      ctl.fail(ACT_LABEL[act], e);
    }
    if (!ok) {
      fails[act] = (fails[act] || 0) + 1;
      if (act === 'stories' && fails.stories >= 2) {
        skip.add('story');
        ctl.log('Sem stories disponíveis, meta de stories ignorada nesta sessão', 'warn');
      }
      if (act === 'reels' && fails.reels >= 2) {
        skip.add('reel');
        ctl.log('Reels falhou 2x, meta de reels ignorada nesta sessão', 'warn');
      }
      if (act === 'explore' && fails.explore >= 2) {
        skip.add('explore');
        skip.add('follow');
        ctl.log('Explorar falhou 2x, metas de explorar/follow ignoradas nesta sessão', 'warn');
      }
    }
    await dismissPopups(bot);
    await bot.guard();
    if (!ctl.goalsDone([...skip])) await bot.pause('between', 'Pausa natural entre atividades');
  }
}

module.exports = {
  id: 'instagram',
  name: 'Instagram',
  loginUrl: `${HOME}accounts/login/`,
  homeUrl: HOME,
  actions: ACTIONS,
  activities: ACTIVITY_GOALS,
  plans: PLANS,
  planForDay: (day, rng = Math.random) => {
    const base = PLANS[phaseIndex(day)];
    // Adiciona "White Noise" (Ruído Branco) na variação do comportamento diário
    return {
      minutes: Math.max(3, base.minutes + Math.floor(rng() * 5) - 2), // -2 a +2 min
      like: Math.max(1, base.like + Math.floor(rng() * 3) - 1),
      // Fase sem follow continua sem follow (o sorteio não pode criar 1 follow na fase 1)
      follow: base.follow === 0 ? 0 : Math.max(0, base.follow + Math.floor(rng() * 3) - 1),
      story: Math.max(1, base.story + Math.floor(rng() * 3) - 1),
      reel: Math.max(1, base.reel + Math.floor(rng() * 3) - 1),
      explore: Math.max(0, base.explore + Math.floor(rng() * 2)),
    };
  },
  detectProblem,
  run,
  // para os testes
  SEL,
  _activities: ACTIVITIES,
  _likeHere: likeHere,
  _followHere: followHere,
  _screenText: screenText,
  _closeDialog: closeDialog,
};
