const { AbortError, isFatal } = require('../bot');
const human = require('../human');
const { phaseIndex } = require('./phases');
const custom = require('../custom');

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
  // Comentários do Para Você: painel à direita, rolável; o X tem aria-label "exit". O Esc NÃO fecha o painel.
  commentIcon: '[data-e2e="comment-icon"]',
  commentPanel: '[class*="DivCommentMain"]',
  commentClose: 'button[aria-label="exit"]',
  login: '[data-e2e="top-login-button"], #header-login-button',
  // Rede larga: qualquer coisa visível com "captcha" no id, na classe ou no endereço de um iframe
  captcha:
    '#captcha-verify-container, #captcha_container, .captcha-verify-container, [class*="captcha_verify"], [class*="CaptchaVerify"], [id*="captcha" i], [class*="captcha" i], iframe[src*="captcha" i]',
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

// Vídeos guardados para as buscas que ainda faltam (cada busca assiste pelo menos 1 vídeo): o Para Você não gasta
// esses vídeos. Sem isso, com o teto exato da meta personalizada, os vídeos acabavam antes e a busca nunca fechava.
const searchReserve = (ctl, skip) => (skip && skip.has('search') ? 0 : Math.max(0, ctl.left('search')));

// E o contrário: a busca (que não segue ninguém) deixa um vídeo por follow que falta para o Para Você seguir.
// O 1º vídeo de cada busca sempre é visto (ela já contou).
// (e um vídeo para cada próxima busca que falta).
const reserveFor = (ctl, act, skip, i) =>
  act === 'fyp' ? searchReserve(ctl, skip) : act === 'search' && i > 1 ? Math.max(0, ctl.left('follow')) + searchReserve(ctl, skip) : 0;

// Continua a rodada (mais um vídeo)? Só se ainda tem tempo, sobra vídeo até o teto além da reserva (reserveFor), a
// atividade ainda adianta alguma meta que falta e a sessão não cumpriu a parte dela do dia.
const keepGoing = (ctl, act, skip, i = 1) =>
  ctl.timeLeft() > 0 && ctl.room('watch') > reserveFor(ctl, act, skip, i) && ctl.useful(ACTIVITY_GOALS[act]) && !ctl.goalsDone();

// Gosto de base de cada atividade (variedade); quem decide mesmo é o que falta no dia
const BASE_WEIGHT = { fyp: 1.5, search: 1, profile: 1 };

// Tempo assistido: depende da duração do vídeo, do nicho e da paciência da conta (human.watchPlan)
const WATCH_NOTE = { skip: ' (pulando)', half: ' (até a metade)', full: ' (inteiro)', loop: ' (revendo, sinal de interesse)' };
const watchFor = (bot, niche, duration = null, keen = false) =>
  human.watchPlan(duration, { niche, keen, persona: bot.persona, mood: bot.mood, rng: bot.random });

// Ritmo das curtidas: curtidas que faltam por vídeo que ainda dá para ver hoje.
// Vídeos do plano já batidos: conta os que cabem até o teto de 120% (antes ignorava o teto e as
// curtidas ficavam para trás quando os vídeos acabavam primeiro).
function likePace(ctl) {
  const l = ctl.left('like');
  if (l <= 0) return 0;
  const w = ctl.left('watch') > 0 ? ctl.left('watch') : ctl.room('watch');
  return w > 0 ? l / w : 1;
}
// Chance de curtir: ~metade dos vídeos é elegível (vistos por mais de 8 s), então ~2,2x o ritmo.
// Normal: até 70%. Curtidas apertadas: até 95%, pulando menos vídeos (sem passar do plano de curtidas).
const ELIGIBLE = 2.2;
// Última chance das curtidas: os vídeos que ainda cabem até o teto são só os necessários para as curtidas que faltam.
// Aí cada vídeo é curtido (meta personalizada tem teto exato: sem isso, o dia não fechava).
const likeLast = (ctl) => ctl.left('like') > 0 && ctl.room('watch') <= ctl.left('like');
const likeChance = (ctl, base) => {
  const pace = likePace(ctl);
  return pace ? Math.min(0.95, Math.max(base, pace * ELIGIBLE)) : 0;
};
const likesTight = (ctl) => likePace(ctl) * ELIGIBLE > 0.7;

// Follows: mesmo raciocínio. Vêm do perfil (onde seguir é natural) e, às vezes, de um vídeo visto até o fim.
// A chance sobe se os follows que faltam estão apertados em relação ao que ainda dá para fazer hoje.
const roomOf = (ctl, k) => (ctl.left(k) > 0 ? ctl.left(k) : ctl.room(k));
// Follows apertados: sobram poucos vídeos até o teto para os follows que faltam (meta personalizada tem teto exato).
// Aí o vídeo é visto com mais calma e o follow quase sempre sai, como nas curtidas apertadas.
// Última chance: os vídeos (ou perfis) que ainda cabem são só os necessários para os follows que faltam: segue com certeza.
const followsTight = (ctl) => ctl.left('follow') > 0 && ctl.room('watch') - Math.max(0, ctl.left('search')) <= ctl.left('follow') * 2;
// (vídeos: desconta os guardados para as buscas que faltam, que não seguem ninguém)
const lastChance = (ctl, where) =>
  ctl.left('follow') > 0 &&
  (where === 'profile' ? ctl.room('profile') : ctl.room('watch') - Math.max(0, ctl.left('search'))) <= ctl.left('follow');
function followChance(ctl, where) {
  const f = ctl.left('follow');
  if (f <= 0) return 0;
  if (lastChance(ctl, where)) return 1;
  if (where === 'fyp' && followsTight(ctl)) return 0.95;
  if (where === 'profile') return Math.min(0.95, Math.max(0.55, f / Math.max(1, roomOf(ctl, 'profile'))));
  // Para Você: só vídeos vistos por 15 s ou mais (~1 em 3)
  return Math.min(0.8, Math.max(0.35, (f / Math.max(1, roomOf(ctl, 'watch'))) * 3));
}

// Algum dos primeiros elementos está visível? (o primeiro pode ser um contêiner escondido)
async function anyVisible(loc, max = 8) {
  const n = Math.min(await loc.count().catch(() => 0), max);
  for (let i = 0; i < n; i++)
    if (
      await loc
        .nth(i)
        .isVisible()
        .catch(() => false)
    )
      return true;
  return false;
}

async function detectProblem(page) {
  if (page.url().includes('/login')) return { kind: 'logout', msg: 'TikTok pediu login novamente' };
  if (await anyVisible(page.locator(SEL.captcha))) return { kind: 'captcha', msg: 'TikTok exibiu um captcha' };
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
// O coração do vídeo da tela diz se ele está curtido: aria-pressed "true" (vermelho) ou "false".
// null = não deu para ler (aí vale o clique, como antes).
async function likedState(bot, icon) {
  const [el] = await bot.visible(icon);
  if (!el) return null;
  const v = await el.getAttribute('aria-pressed').catch(() => null);
  return v === 'true' ? true : v === 'false' ? false : null;
}

// Curte o vídeo da tela (dois cliques no vídeo ou coração, pela personalidade) e só conta se pegou.
// Vídeo já curtido: não clica (o coração descurtiria) e não conta.
async function likeVideo(bot, ctl, icon, detail) {
  if ((await likedState(bot, icon)) === true) {
    ctl.log('Este vídeo já estava curtido, seguindo sem clicar');
    return false;
  }
  const how = await bot.likeVideo(icon);
  if (!how) return false;
  await bot.wait(500, 1200);
  if ((await likedState(bot, icon)) === false) {
    ctl.log(how === 'tap' ? 'Os dois cliques não curtiram o vídeo' : 'A curtida não pegou', 'warn');
    return false;
  }
  ctl.action('like', how === 'tap' ? `${detail} (dois cliques)` : detail);
  return true;
}

// Segue e só conta se o botão mudou ("+" da foto do criador vira "✓"; "Seguir" do perfil vira "Seguindo").
// Botão igual depois do clique = o follow não pegou. Não deu para ler (botão trocado na página): vale o clique.
async function followHere(bot, ctl, sel, detail) {
  const [el] = await bot.visible(sel);
  if (!el) return false;
  const h = typeof el.elementHandle === 'function' ? await el.elementHandle().catch(() => null) : null;
  const look = () =>
    h ? h.evaluate((e) => (e.isConnected ? `${e.innerHTML}|${e.innerText}` : null)).catch(() => null) : Promise.resolve(null);
  const before = await look();
  await bot.click(el, false);
  await bot.wait(800, 1600);
  const after = await look();
  if (before !== null && after !== null && before === after) {
    ctl.log('O follow não pegou (o botão não mudou)', 'warn');
    return false;
  }
  ctl.action('follow', detail);
  return true;
}

// Quantas contas a própria conta segue (perfil dela). null = não deu para ler.
async function followingCount({ page, bot, account }) {
  await bot.goto(`https://www.tiktok.com/@${account.username}`, 'Olhando o próprio perfil');
  const t = await page
    .locator('[data-e2e="following-count"]')
    .first()
    .textContent({ timeout: 5000 })
    .catch(() => null);
  return t && /^\d+$/.test(t.trim()) ? Number(t.trim()) : null;
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
    if (page.url().includes('/search/video')) return true;
    // O Enter abre a aba "Melhores" (mistura usuários e vídeos; sem login nem carrega). Gente clica em "Vídeos".
    if (page.url().includes('/search')) {
      const tab = page.getByText(/^V[íi]deos$/).first();
      if (await tab.isVisible().catch(() => false)) {
        await bot.pause('decide');
        await bot.click(tab);
        await bot.pause('load', 'Abrindo a aba Vídeos');
        if (page.url().includes('/search/video')) return true;
      }
    } else ctl.log('A busca digitada não abriu os resultados, indo pelo endereço', 'warn');
  }
  // Pelo endereço, direto na aba de vídeos (o caminho antigo, conferido no site)
  await bot.goto(`https://www.tiktok.com/search/video?q=${encodeURIComponent(term)}`, `Buscando "${term}"`);
  return true;
}

// Abre os comentários, lê, às vezes rola a lista e fecha (no X ou no ícone de novo, como gente faz)
async function browseComments({ page, bot, ctl }) {
  ctl.status('Abriu os comentários');
  if (!(await bot.clickVisible(SEL.commentIcon))) return;
  await bot.pause('decide');
  await bot.pause('glance', 'Lendo os comentários...');
  const panel = await page
    .locator(SEL.commentPanel)
    .first()
    .boundingBox()
    .catch(() => null);
  if (panel && panel.height > 150) {
    const rounds = bot.rand(0, 3);
    for (let i = 0; i < rounds; i++) {
      // A rodinha só rola o painel com o mouse em cima dele
      await bot.moveTo(
        Math.round(panel.x + panel.width * (0.25 + bot.random() * 0.5)),
        Math.round(panel.y + panel.height * (0.3 + bot.random() * 0.4)),
      );
      await bot.scroll(bot.rand(200, 650));
      await bot.pause('glance', 'Rolando os comentários');
    }
  }
  const closed = (bot.random() < 0.7 && (await bot.clickVisible(SEL.commentClose))) || (await bot.clickVisible(SEL.commentIcon));
  if (!closed) await page.keyboard.press('Escape');
  await bot.pause('next');
}

async function dismissPopups(bot) {
  if (await bot.clickVisible(SEL.popup)) await bot.pause('decide', 'Fechando pop-up');
}

const ACTIVITIES = {
  async fyp({ page, bot, ctl, account, skip }) {
    if (!page.url().includes('/foryou')) await bot.goto(HOME, 'Abrindo o Para Você');
    const n = bot.rand(5, 12);
    for (let i = 1; i <= n && keepGoing(ctl, 'fyp', skip); i++) {
      // Legenda para checar o nicho (timeout de 1 s pra não travar)
      const desc = await page
        .locator('[data-e2e="video-desc"]')
        .first()
        .textContent({ timeout: 1000 })
        .catch(() => '');
      const niche = bot.isNiche(desc, account.interests || []);
      // Tempo assistido a partir da duração real do vídeo (se deu para ler)
      const info = await bot.videoInfo();
      const ftight = followsTight(ctl);
      const last = likeLast(ctl);
      const tight = likesTight(ctl) || ftight || last;
      const { ms: waitTime, outcome } = watchFor(bot, niche, info ? info.duration : null, tight);
      // Decide antes se vai curtir e curte num momento sorteado do vídeo.
      // Meta de curtidas batida = chance zero (antes o nicho furava e passava do teto de 120%).
      const chance = likeChance(ctl, 0.25);
      const likeP = human.likeProbability(chance, { niche, persona: bot.persona, max: Math.max(0.75, chance) });
      const willLike = last || (waitTime > (tight ? 5000 : 8000) && bot.random() < likeP);
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
        await browseComments({ page, bot, ctl });
      }

      if ((waitTime > 15000 || (ftight && waitTime > 6000) || lastChance(ctl, 'fyp')) && bot.random() < followChance(ctl, 'fyp')) {
        ctl.status('Assistiu até o fim, seguindo o criador');
        if (await followHere(bot, ctl, SEL.feedFollow, 'Criador do vídeo')) await bot.pause('afterAction');
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

  async search({ page, bot, ctl, account, skip }) {
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
    for (let i = 1; i <= n && keepGoing(ctl, 'search', skip, i); i++) {
      // Veio de uma busca do nicho: conta como conteúdo do nicho
      const info = await bot.videoInfo();
      const last = likeLast(ctl);
      const tight = likesTight(ctl) || last;
      const { ms, outcome } = watchFor(bot, true, info ? info.duration : null, tight);
      const chance = likeChance(ctl, 0.45);
      const willLike =
        last ||
        (ms > (tight ? 5000 : 8000) &&
          ctl.left('like') > 0 &&
          bot.random() < human.likeProbability(chance, { niche: true, nicheMin: 0.45, persona: bot.persona, max: Math.max(0.75, chance) }));
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
    if (bot.random() < followChance(ctl, 'profile')) {
      await bot.scroll(-2500);
      await bot.pause('decide');
      if (await followHere(bot, ctl, SEL.follow, handle ? `@${handle}` : 'Pelo perfil'))
        await bot.pause('afterAction', 'Pausa após seguir');
    }
    // Volta como gente: botão "Voltar" do navegador. Se não cair no Para Você, abre pelo endereço.
    ctl.status('Voltando ao Para Você');
    await page.goBack({ waitUntil: 'domcontentloaded', timeout: 30000 }).catch(() => null);
    await bot.pause('load', 'Voltando ao Para Você');
    if (!page.url().includes('/foryou')) await bot.goto(HOME, 'Voltando ao Para Você');
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

// Aviso quando o TikTok mostra "Seguindo" mas não grava o follow (o robô clicou certo: o problema é a conta)
const FOLLOW_NOT_SAVED =
  'O TikTok não está gravando os follows desta conta: o robô clica em Seguir, o botão muda, mas o número de "Seguindo" do perfil não sobe. Não é o programa, é restrição do TikTok na conta. Para confirmar, siga alguém pelo celular e veja se o número sobe. Os follows continuam sendo feitos.';

async function run({ page, bot, ctl, account }) {
  await bot.goto(HOME, 'Abrindo o TikTok');
  if ((await page.locator(SEL.login).count()) > 0) {
    throw new AbortError('Conta não está logada no TikTok. Clique em "Login" no painel primeiro.', 'NOT_LOGGED');
  }
  ctl.log('Login confirmado ✔');
  await dismissPopups(bot);
  await bot.guard();

  // O TikTok às vezes mostra "Seguindo" e descarta o follow (conta nova ou desconfiada: é da conta, não do robô).
  // Dia com follow: guarda quantas contas ela segue agora e confere no fim. Não subiu: aviso no painel (texto fixo, para
  // as sessões seguintes somarem no mesmo aviso) e o detalhe no registro. Não pausa: os follows do plano continuam.
  const baseline = ctl.left('follow') > 0 ? await followingCount({ page, bot, account }) : null;
  const reason = await loop({ page, bot, ctl, account });
  if (baseline !== null && (ctl.stats.follow || 0) > 0) {
    const now = await followingCount({ page, bot, account });
    if (now !== null && now <= baseline) {
      ctl.alert('warn', FOLLOW_NOT_SAVED, 'follow');
      ctl.log(`Follows não gravados: ${ctl.stats.follow} feito(s) nesta sessão e o perfil continua seguindo ${now}`, 'warn');
    } else if (now !== null) ctl.log(`Follows conferidos no perfil: seguindo ${baseline} → ${now} ✔`);
  }
  return reason;
}

async function loop({ page, bot, ctl, account }) {
  const fails = {};
  const skip = new Set(); // metas que se mostraram inalcançáveis NESTA sessão
  const interests = account.interests || [];
  if (!interests.length) skip.add('search');
  let last = null;
  let lastAfk = bot.now();
  // Distrações: o intervalo médio entre elas é sorteado por sessão (personalidade + acaso)
  const afkGap = human.distractionGapMin(bot.persona, bot.random) * 60000;
  // Atividade liberada: não falhou nesta sessão, não passa nenhuma meta do teto e ainda adianta alguma
  // (o Para Você só se ainda sobra vídeo além da reserva das buscas que faltam)
  const can = (act) =>
    !skip.has(act) &&
    ctl.allowed(ACTIVITY_GOALS[act], account) &&
    ctl.useful(ACTIVITY_GOALS[act]) &&
    (act !== 'fyp' || ctl.room('watch') > searchReserve(ctl, skip));

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
      ok = await ACTIVITIES[act]({ page, bot, ctl, account, skip });
    } catch (e) {
      if (isFatal(e)) throw e;
      ctl.fail(ACT_LABEL[act], e);
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
  // template: modelo de meta personalizada da conta (motor/custom.js) ou null (a recomendada)
  planForDay: (day, rng = Math.random, template = null) => {
    if (template) return custom.planFrom(template, phaseIndex(day, template.readyDay), rng);
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
  _likeVideo: likeVideo, // para os testes
  _followHere: followHere,
  _followingCount: followingCount,
  _activities: ACTIVITIES,
  _browseComments: browseComments,
  _typedSearch: typedSearch,
};
