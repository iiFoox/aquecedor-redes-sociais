const { AbortError, isFatal } = require('../bot');
const human = require('../human');
const { phaseIndex } = require('./phases');

const HOME = 'https://www.tiktok.com/foryou';
const SEL = {
  like: '[data-e2e="like-icon"]',
  browseLike: '[data-e2e="browse-like-icon"]',
  feedFollow: '[data-e2e="feed-follow"]',
  follow: '[data-e2e="follow-button"]',
  avatar: '[data-e2e="video-author-avatar"], [data-e2e="video-author-uniqueid"], [data-e2e="feed-video-author"]',
  videoLink: 'a[href*="/video/"]',
  close: '[data-e2e="browse-close"]',
  searchInput: 'input[data-e2e="search-user-input"]',
  login: '[data-e2e="top-login-button"], #header-login-button',
  captcha: '#captcha-verify-container, #captcha_container, .captcha-verify-container, [class*="captcha_verify"], [class*="CaptchaVerify"]',
  popup: 'button:has-text("Agora não"), button:has-text("Not now"), button:has-text("Pular"), button:has-text("Skip")',
};

const PLANS = [
  { minutes: 12, watch: 30, like: 4, follow: 0, profile: 1, search: 0 },
  { minutes: 18, watch: 45, like: 10, follow: 2, profile: 3, search: 1 },
  { minutes: 25, watch: 60, like: 20, follow: 5, profile: 5, search: 2 },
  { minutes: 30, watch: 80, like: 30, follow: 8, profile: 6, search: 3 },
  { minutes: 35, watch: 100, like: 40, follow: 12, profile: 6, search: 3 },
];

const ACTIONS = { watch: 'Vídeos assistidos', like: 'Curtidas', follow: 'Follows', profile: 'Perfis visitados', search: 'Buscas no nicho' };
const ACT_LABEL = {
  fyp: 'Assistir o Para Você',
  search: 'Buscar vídeos do nicho',
  profile: 'Visitar perfil de criador',
  afk: 'Distração / Fora do Teclado',
};

// Metas que cada atividade conta (produces) e metas que ela pode adiantar (advances).
// Uma atividade só roda se nenhuma meta que ela conta passou do teto de 120% do plano.
const ACTIVITY_GOALS = {
  fyp: { produces: ['watch'], advances: ['watch', 'like', 'follow'] },
  search: { produces: ['watch', 'search'], advances: ['search', 'watch', 'like'], when: (acc) => (acc.interests || []).length > 0 },
  profile: { produces: ['profile'], advances: ['profile', 'follow'] },
};

// Tempo assistido: depende da duração do vídeo, do nicho e da paciência da conta (human.watchPlan)
const WATCH_NOTE = { skip: ' (pulando)', half: ' (até a metade)', full: ' (inteiro)', loop: ' (revendo, sinal de interesse)' };
const watchFor = (bot, niche, duration = null) =>
  human.watchPlan(duration, { niche, persona: bot.persona, mood: bot.mood, rng: bot.random });

// Chance de curtir adaptativa: se as curtidas estão atrasadas em relação aos vídeos
// que ainda faltam, a chance sobe (com teto de 70% pra não virar padrão de robô).
function likeChance(ctl, base) {
  const l = ctl.left('like');
  if (l <= 0) return 0;
  const w = ctl.left('watch');
  if (w <= 0) return Math.max(base, 0.5);
  return Math.min(0.7, Math.max(base, (l / w) * 2.2)); // ~metade dos vídeos são elegíveis (>8s)
}

async function detectProblem(page) {
  if (page.url().includes('/login')) return { kind: 'logout', msg: 'TikTok pediu login novamente' };
  if (
    await page
      .locator(SEL.captcha)
      .first()
      .isVisible()
      .catch(() => false)
  )
    return { kind: 'captcha', msg: 'TikTok exibiu um captcha' };
  const limit = page.getByText(
    /Muitas tentativas|Too many attempts|visitando nosso serviço com muita frequência|visiting our service too frequently/i,
  );
  if (
    await limit
      .first()
      .isVisible()
      .catch(() => false)
  )
    return { kind: 'block', msg: 'TikTok limitou a atividade (ações demais)' };
  return null;
}

// Curte o vídeo da tela (dois cliques no vídeo ou coração, pela personalidade) e registra
async function likeVideo(bot, ctl, icon, detail) {
  const how = await bot.likeVideo(icon);
  if (!how) return false;
  ctl.action('like', how === 'tap' ? `${detail} (dois cliques)` : detail);
  return true;
}

// Busca como gente: clica na caixa de busca, digita e aperta Enter.
// Se a caixa não estiver na tela (layout estreito) ou a busca não abrir, vai direto pelo endereço.
async function typedSearch({ page, bot, ctl }, term) {
  if (bot.random() < 0.8 && (await bot.clickVisible(SEL.searchInput, { minSize: 40 }))) {
    await bot.pause('decide');
    const box = page.locator(SEL.searchInput).first();
    if ((await box.inputValue().catch(() => '')).trim()) {
      await page.keyboard.press('Control+a'); // apaga a busca anterior escrevendo por cima
      await bot.pause('decide');
    }
    await bot.type(term, `Digitando "${term}" na busca`);
    await bot.pause('decide');
    await page.keyboard.press('Enter');
    await bot.pause('load', `Buscando "${term}"`);
    if (page.url().includes('/search')) return true;
    ctl.log('A busca digitada não abriu os resultados, indo pelo endereço', 'warn');
  }
  await bot.goto(`https://www.tiktok.com/search/video?q=${encodeURIComponent(term)}`, `Buscando "${term}"`);
  return true;
}

async function dismissPopups(bot) {
  if (await bot.clickVisible(SEL.popup)) await bot.pause('decide', 'Fechando pop-up');
}

const ACTIVITIES = {
  async fyp({ page, bot, ctl, account }) {
    if (!page.url().includes('/foryou')) await bot.goto(HOME, 'Abrindo o Para Você');
    const n = bot.rand(5, 12);
    for (let i = 1; i <= n && ctl.timeLeft() > 0 && !ctl.capped('watch'); i++) {
      // Legenda para checar o nicho (timeout de 1 s pra não travar)
      const desc = await page
        .locator('[data-e2e="video-desc"]')
        .first()
        .textContent({ timeout: 1000 })
        .catch(() => '');
      const niche = bot.isNiche(desc, account.interests || []);
      // Tempo assistido a partir da duração real do vídeo (se deu para ler)
      const info = await bot.videoInfo();
      const { ms: waitTime, outcome } = watchFor(bot, niche, info ? info.duration : null);
      // Decide antes se vai curtir e curte num momento sorteado do vídeo.
      // Meta de curtidas batida = chance zero (antes o nicho furava e passava do teto de 120%).
      const likeP = human.likeProbability(likeChance(ctl, 0.25), { niche, persona: bot.persona });
      const willLike = waitTime > 8000 && bot.random() < likeP;
      await bot.watchWithLike(
        waitTime,
        `Assistindo vídeo ${i}/${n} por ${Math.round(waitTime / 1000)}s${WATCH_NOTE[outcome]}${niche ? ' · nicho' : ''}`,
        willLike &&
          (async () => {
            ctl.status('Gostou do vídeo, curtindo');
            return likeVideo(bot, ctl, SEL.like, 'Vídeo do Para Você');
          }),
      );
      ctl.action('watch', `${Math.round(waitTime / 1000)}s`);

      // Às vezes abre os comentários, dá uma olhada e fecha
      if (bot.random() < 0.15) {
        ctl.status('Abriu os comentários');
        if (await bot.clickVisible('[data-e2e="comment-icon"]')) {
          await bot.pause('glance', 'Lendo os comentários...');
          await page.keyboard.press('Escape'); // Fecha
          await bot.pause('next');
        }
      }

      if (waitTime > 15000 && ctl.left('follow') > 0 && bot.random() < 0.35) {
        ctl.status('Assistiu até o fim, seguindo o criador');
        if (await bot.clickVisible(SEL.feedFollow)) {
          ctl.action('follow', 'Criador do vídeo');
          await bot.pause('afterAction');
        }
      }
      await bot.guard();
      ctl.status('Indo para o próximo vídeo');
      await page.keyboard.press('ArrowDown');
      await bot.pause('next');
      // Às vezes volta ao anterior ("espera, o que era aquilo?"), olha uns segundos e segue.
      // Não conta como vídeo novo.
      if (i < n && bot.random() < 0.04) {
        ctl.status('Voltou ao vídeo anterior');
        await page.keyboard.press('ArrowUp');
        await bot.watch(bot.rand(1500, 6000), 'Revendo o vídeo anterior');
        await page.keyboard.press('ArrowDown');
        await bot.pause('next');
      }
    }
    return true;
  },

  async search({ page, bot, ctl, account }) {
    const term = bot.pick(account.interests).trim();
    await typedSearch({ page, bot, ctl }, term);
    ctl.action('search', term);
    await bot.pause('read', 'Olhando os resultados da busca');
    await bot.scroll(bot.rand(200, 600));
    await bot.pause('decide', 'Escolhendo um vídeo');
    if (!(await bot.clickVisible(SEL.videoLink, { random: true, minSize: 80 }))) {
      ctl.log('Nenhum vídeo encontrado na busca', 'warn');
      return false;
    }
    await bot.pause('load', 'Abrindo o vídeo');
    const n = bot.rand(3, 6);
    for (let i = 1; i <= n && ctl.timeLeft() > 0 && !ctl.capped('watch'); i++) {
      // Veio de uma busca do nicho: conta como conteúdo do nicho
      const info = await bot.videoInfo();
      const { ms, outcome } = watchFor(bot, true, info ? info.duration : null);
      const willLike =
        ms > 8000 &&
        ctl.left('like') > 0 &&
        bot.random() < human.likeProbability(likeChance(ctl, 0.45), { niche: true, nicheMin: 0.45, persona: bot.persona });
      await bot.watchWithLike(
        ms,
        `Vídeo ${i}/${n} de "${term}" por ${Math.round(ms / 1000)}s${WATCH_NOTE[outcome]}`,
        willLike && (() => likeVideo(bot, ctl, SEL.browseLike, `Busca: ${term}`)),
      );
      ctl.action('watch', `Busca: ${term}`);
      await page.keyboard.press('ArrowDown');
      await bot.pause('next');
    }
    if (!(await bot.clickVisible(SEL.close))) await page.keyboard.press('Escape');
    return true;
  },

  async profile({ page, bot, ctl }) {
    if (!page.url().includes('/foryou')) await bot.goto(HOME, 'Abrindo o Para Você');
    await bot.pause('read', 'Assistindo antes de abrir o perfil');
    if (!(await bot.clickVisible(SEL.avatar))) {
      ctl.log('Avatar do criador não encontrado', 'warn');
      return false;
    }
    await bot.pause('load', 'Abrindo o perfil do criador');
    const handle = (page.url().split('/@')[1] || '').split(/[/?]/)[0];
    ctl.action('profile', handle ? `@${handle}` : 'Perfil');
    const rounds = bot.rand(1, 3);
    for (let i = 0; i < rounds; i++) {
      ctl.status('Rolando o perfil');
      await bot.scroll(bot.rand(300, 700));
      await bot.pause('glance', 'Olhando os vídeos do perfil');
    }
    if (ctl.left('follow') > 0 && bot.random() < 0.55) {
      await bot.scroll(-2500);
      await bot.pause('decide');
      if (await bot.clickVisible(SEL.follow)) {
        ctl.action('follow', handle ? `@${handle}` : 'Pelo perfil');
        await bot.pause('afterAction', 'Pausa após seguir');
      }
    }
    await bot.goto(HOME, 'Voltando ao Para Você');
    return true;
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
  await bot.goto(HOME, 'Abrindo o TikTok');
  if ((await page.locator(SEL.login).count()) > 0) {
    throw new AbortError('Conta não está logada no TikTok. Clique em "Login" no painel primeiro.', 'NOT_LOGGED');
  }
  ctl.log('Login confirmado ✔');
  await dismissPopups(bot);
  await bot.guard();

  const fails = {};
  const skip = new Set(); // metas que se mostraram inalcançáveis NESTA sessão
  const interests = account.interests || [];
  if (!interests.length) skip.add('search');
  let last = null;
  let lastAfk = bot.now();
  // Distrações: o intervalo médio entre elas é sorteado por sessão (personalidade + acaso)
  const afkGap = human.distractionGapMin(bot.persona, bot.random) * 60000;
  // Atividade liberada: não falhou nesta sessão, não passa nenhuma meta do teto e ainda adianta alguma
  const can = (act) => !skip.has(act) && ctl.allowed(ACTIVITY_GOALS[act], account) && ctl.useful(ACTIVITY_GOALS[act]);

  // Loop guiado por META: só para quando bater tudo (ou teto de segurança / travamento)
  while (true) {
    if (ctl.goalsDone([...skip])) return 'goals';
    if (ctl.timeLeft() <= 0) return 'cap';
    if (ctl.stalled()) return 'stall';

    const needFyp = ctl.left('watch') > 0 || ctl.left('like') > 0 || ctl.left('follow') > 0;
    // Pesos guiados pelo que falta: se o Para Você já bateu, prioriza as metas restantes
    const opts = [];
    if (can('fyp')) opts.push(['fyp', needFyp ? 5 : 0.5]);
    if (can('search')) opts.push(['search', needFyp ? 2 : 4]);
    if (can('profile')) opts.push(['profile', ctl.left('follow') > 0 ? 2 : needFyp ? 1.5 : 4]);
    // O que falta só sairia passando do teto de 120% do plano: encerra em vez de forçar
    if (!opts.length) return 'limit';
    // Distração: nunca duas vezes seguidas e só depois do intervalo sorteado desta sessão
    if (last !== 'afk' && bot.now() - lastAfk > afkGap) opts.push(['afk', 0.5]);
    const act = bot.weighted(opts);
    last = act;
    if (act === 'afk') lastAfk = bot.now();
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
      if (act === 'search' && fails.search >= 2) {
        skip.add('search');
        ctl.log('Busca falhou 2x, meta de buscas ignorada nesta sessão', 'warn');
      }
      if (act === 'profile' && fails.profile >= 3) {
        skip.add('profile');
        ctl.log('Perfil falhou 3x, meta de perfis ignorada nesta sessão', 'warn');
      }
    }
    await dismissPopups(bot);
    await bot.guard();
    if (!ctl.goalsDone([...skip])) await bot.pause('between', 'Pausa natural entre atividades');
  }
}

module.exports = {
  id: 'tiktok',
  name: 'TikTok',
  loginUrl: 'https://www.tiktok.com/login',
  homeUrl: HOME,
  actions: ACTIONS,
  activities: ACTIVITY_GOALS,
  plans: PLANS,
  planForDay: (day, rng = Math.random) => {
    const base = PLANS[phaseIndex(day)];
    return {
      minutes: Math.max(3, base.minutes + Math.floor(rng() * 5) - 2), // -2 a +2 min
      watch: Math.max(5, base.watch + Math.floor(rng() * 11) - 5), // -5 a +5 videos
      like: Math.max(1, base.like + Math.floor(rng() * 5) - 2),
      // Fase sem follow continua sem follow (o sorteio não pode criar 1 follow na fase 1)
      follow: base.follow === 0 ? 0 : Math.max(0, base.follow + Math.floor(rng() * 3) - 1),
      profile: Math.max(0, base.profile + Math.floor(rng() * 3) - 1),
      search: Math.max(0, base.search + Math.floor(rng() * 2)),
    };
  },
  detectProblem,
  run,
};
