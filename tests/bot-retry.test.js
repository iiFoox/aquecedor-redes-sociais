// Planos de teste extensivos para a tolerância e retry automático do bot.goto
const test = require('node:test');
const assert = require('node:assert/strict');
const { createBot, AbortError } = require('../motor/bot');
const { createCtl } = require('../motor/ctl');
const human = require('../motor/human');

function createTestEnvironment({ gotoHandler, customClock, customCtlState }) {
  const statusList = [];
  const pageGotoCalls = [];
  const sleeps = [];

  let virtualTime = 1791850000000;
  const clock = customClock || {
    now: () => virtualTime,
    sleep: async (ms) => {
      sleeps.push(ms);
      virtualTime += ms;
    },
    wait: async () => {},
  };

  const page = {
    url: () => 'https://www.tiktok.com/foryou',
    goto: async (url, opts) => {
      pageGotoCalls.push({ url, opts, at: clock.now() });
      return gotoHandler(pageGotoCalls.length, url, opts);
    },
    locator: () => ({
      count: async () => 0,
      nth: () => ({ boundingBox: async () => null }),
    }),
    evaluate: async () => ({ width: 1366, height: 768 }),
    mouse: { move: async () => {}, click: async () => {}, wheel: async () => {} },
  };

  const state = Object.assign(
    {
      stop: false,
      stats: {},
      startedAt: clock.now(),
      endsAt: clock.now() + 3600000,
      lastProgress: clock.now(),
      lastBeat: clock.now(),
    },
    customCtlState || {},
  );

  const ctl = createCtl({
    state,
    plan: { watch: 10, like: 2 },
    done: () => ({}),
    now: clock.now,
    hooks: {
      status(s) {
        statusList.push(s);
      },
      action() {},
      log() {},
      alert() {},
    },
  });

  const bot = createBot(page, ctl, {
    rng: human.makeRng(42),
    clock,
    cursor: { moveTo: async () => {}, click: async () => {}, position: { x: 0, y: 0 } },
    persona: human.makePersona(42),
  });

  const retrySleeps = () => sleeps.filter((ms) => ms === 3000 || ms === 5000);

  return { bot, page, ctl, state, clock, pageGotoCalls, statusList, sleeps, retrySleeps };
}

// -------------------------------------------------------------
// PLANO 1: Navegação suave e sem falhas (baseline)
// -------------------------------------------------------------
test('Plano 1: navegação sem falhas ocorre em exatamente 1 tentativa sem delay de retry', async () => {
  const { bot, pageGotoCalls, statusList, retrySleeps } = createTestEnvironment({
    gotoHandler: () => null,
  });

  await bot.goto('https://www.tiktok.com/foryou', 'Abrindo TikTok');

  assert.equal(pageGotoCalls.length, 1, 'chamou goto exatamente uma vez');
  assert.equal(pageGotoCalls[0].url, 'https://www.tiktok.com/foryou');
  assert.equal(pageGotoCalls[0].opts.timeout, 45000);
  assert.equal(retrySleeps().length, 0, 'não dormiu tempo de retry');
  assert.ok(statusList.includes('Abrindo TikTok'));
  assert.ok(!statusList.some((s) => s.includes('tentando novamente')));
  assert.ok(!statusList.some((s) => s.includes('oscilou')));
});

// -------------------------------------------------------------
// PLANO 2: Recuperação de túnel proxy (ERR_TUNNEL_CONNECTION_FAILED) na 2ª tentativa
// -------------------------------------------------------------
test('Plano 2: recupera de ERR_TUNNEL_CONNECTION_FAILED na 2ª tentativa com espera de 3s', async () => {
  const { bot, pageGotoCalls, statusList, retrySleeps } = createTestEnvironment({
    gotoHandler: (count) => {
      if (count === 1) {
        throw new Error('page.goto: net::ERR_TUNNEL_CONNECTION_FAILED at https://www.tiktok.com/foryou');
      }
      return null;
    },
  });

  await bot.goto('https://www.tiktok.com/foryou', 'Abrindo TikTok');

  assert.equal(pageGotoCalls.length, 2, 'executou a 2ª tentativa');
  assert.deepEqual(retrySleeps(), [3000], 'esperou exatamente 3000ms antes da 2ª tentativa');
  assert.ok(statusList.some((s) => s.includes('Conexão oscilou, aguardando para tentar novamente (1/3)')));
  assert.ok(statusList.some((s) => s.includes('tentando novamente (2/3)')));
});

// -------------------------------------------------------------
// PLANO 3: Recuperação de falha de autenticação temporária (ERR_INVALID_AUTH_CREDENTIALS)
// -------------------------------------------------------------
test('Plano 3: recupera de ERR_INVALID_AUTH_CREDENTIALS na 2ª tentativa', async () => {
  const { bot, pageGotoCalls, retrySleeps } = createTestEnvironment({
    gotoHandler: (count) => {
      if (count === 1) {
        throw new Error('page.goto: net::ERR_INVALID_AUTH_CREDENTIALS at https://www.tiktok.com/foryou');
      }
      return null;
    },
  });

  await bot.goto('https://www.tiktok.com/foryou', 'Abrindo TikTok');

  assert.equal(pageGotoCalls.length, 2);
  assert.deepEqual(retrySleeps(), [3000]);
});

// -------------------------------------------------------------
// PLANO 4: Dupla falha transitória com recuperação na 3ª tentativa
// -------------------------------------------------------------
test('Plano 4: recupera na 3ª tentativa após falhas sucessivas (proxy connection failed + reset)', async () => {
  const { bot, pageGotoCalls, statusList, retrySleeps } = createTestEnvironment({
    gotoHandler: (count) => {
      if (count === 1) throw new Error('net::ERR_PROXY_CONNECTION_FAILED');
      if (count === 2) throw new Error('net::ERR_CONNECTION_RESET');
      return null;
    },
  });

  await bot.goto('https://www.tiktok.com/foryou', 'Abrindo TikTok');

  assert.equal(pageGotoCalls.length, 3, 'tentou 3 vezes e teve sucesso');
  assert.deepEqual(retrySleeps(), [3000, 5000], 'esperou 3000ms na 1ª falha e 5000ms na 2ª');
  assert.ok(statusList.some((s) => s.includes('tentando novamente (2/3)')));
  assert.ok(statusList.some((s) => s.includes('tentando novamente (3/3)')));
});

// -------------------------------------------------------------
// PLANO 5: Esgotamento das 3 tentativas (falha persistente)
// -------------------------------------------------------------
test('Plano 5: falha persistente esgota as 3 tentativas e propaga o erro original', async () => {
  const { bot, pageGotoCalls, retrySleeps } = createTestEnvironment({
    gotoHandler: () => {
      throw new Error('net::ERR_TUNNEL_CONNECTION_FAILED');
    },
  });

  await assert.rejects(
    () => bot.goto('https://www.tiktok.com/foryou', 'Abrindo TikTok'),
    (err) => {
      assert.match(err.message, /ERR_TUNNEL_CONNECTION_FAILED/);
      return true;
    },
  );

  assert.equal(pageGotoCalls.length, 3, 'não ultrapassou o teto de 3 tentativas');
  assert.deepEqual(retrySleeps(), [3000, 5000], 'fez as pausas antes das tentativas 2 e 3');
});

// -------------------------------------------------------------
// PLANO 6: Tolerância a timeout de carregamento da página (Timeout 45000ms)
// -------------------------------------------------------------
test('Plano 6: recupera de Timeout 45000ms exceeded', async () => {
  const { bot, pageGotoCalls, retrySleeps } = createTestEnvironment({
    gotoHandler: (count) => {
      if (count === 1) throw new Error('page.goto: Timeout 45000ms exceeded.');
      return null;
    },
  });

  await bot.goto('https://www.tiktok.com/foryou', 'Abrindo TikTok');

  assert.equal(pageGotoCalls.length, 2);
  assert.deepEqual(retrySleeps(), [3000]);
});

// -------------------------------------------------------------
// PLANO 7: Tolerância a oscilação de DNS (ERR_NAME_NOT_RESOLVED)
// -------------------------------------------------------------
test('Plano 7: recupera de ERR_NAME_NOT_RESOLVED', async () => {
  const { bot, pageGotoCalls, retrySleeps } = createTestEnvironment({
    gotoHandler: (count) => {
      if (count === 1) throw new Error('net::ERR_NAME_NOT_RESOLVED');
      return null;
    },
  });

  await bot.goto('https://www.tiktok.com/foryou', 'Abrindo TikTok');

  assert.equal(pageGotoCalls.length, 2);
  assert.deepEqual(retrySleeps(), [3000]);
});

// -------------------------------------------------------------
// PLANO 8: Erros que NÃO são de rede não sofrem retry e falham imediatamente
// -------------------------------------------------------------
test('Plano 8: erros de execução ou navegador fechado não sofrem retry', async () => {
  const { bot, pageGotoCalls, retrySleeps } = createTestEnvironment({
    gotoHandler: () => {
      throw new Error('Target page, context or browser has been closed');
    },
  });

  await assert.rejects(
    () => bot.goto('https://www.tiktok.com/foryou', 'Abrindo TikTok'),
    /Target page, context or browser has been closed/,
  );

  assert.equal(pageGotoCalls.length, 1, 'falhou imediatamente na 1ª tentativa');
  assert.equal(retrySleeps().length, 0, 'não perdeu tempo em sleep de retry');
});

// -------------------------------------------------------------
// PLANO 9: Interrupção manual do usuário durante o intervalo de espera
// -------------------------------------------------------------
test('Plano 9: se o usuário clicar em Parar durante o retry, cancela imediatamente', async () => {
  let environment;
  environment = createTestEnvironment({
    gotoHandler: (count) => {
      if (count === 1) throw new Error('net::ERR_TUNNEL_CONNECTION_FAILED');
      return null;
    },
    customClock: {
      now: () => Date.now(),
      sleep: async () => {
        // Usuário clica em Parar exatamente durante a espera do retry
        environment.state.stop = true;
      },
      wait: async () => {},
    },
  });

  await assert.rejects(
    () => environment.bot.goto('https://www.tiktok.com/foryou', 'Abrindo TikTok'),
    (err) => {
      assert.equal(err.code, 'STOPPED', 'encerrou com código STOPPED do usuário');
      return true;
    },
  );

  assert.equal(environment.pageGotoCalls.length, 1, 'não tentou a 2ª chamada porque foi parado');
});

// -------------------------------------------------------------
// PLANO 10: Guard / Captcha detectado durante retry
// -------------------------------------------------------------
test('Plano 10: bot.guard levanta aborto se detectado durante o ciclo de check do retry', async () => {
  const environment = createTestEnvironment({
    gotoHandler: () => {
      throw new Error('net::ERR_TUNNEL_CONNECTION_FAILED');
    },
  });

  environment.bot.guard = async () => {
    throw new AbortError('TikTok pediu captcha', 'CAPTCHA');
  };

  await assert.rejects(
    () => environment.bot.goto('https://www.tiktok.com/foryou', 'Abrindo TikTok'),
    (err) => {
      assert.equal(err.code, 'CAPTCHA');
      return true;
    },
  );

  assert.equal(environment.pageGotoCalls.length, 1, 'não executou tentativas adicionais');
});

// -------------------------------------------------------------
// PLANO 11: Múltiplas navegações sequenciais (isolamento de estado)
// -------------------------------------------------------------
test('Plano 11: duas navegações seguidas têm ciclos de retry totalmente independentes', async () => {
  let callIndex = 0;
  const { bot, pageGotoCalls, retrySleeps } = createTestEnvironment({
    gotoHandler: () => {
      callIndex++;
      // Na primeira navegação, falha na tentativa 1 e passa na 2
      if (callIndex === 1) throw new Error('net::ERR_TUNNEL_CONNECTION_FAILED');
      // Na segunda navegação, passa direto na 1ª tentativa
      return null;
    },
  });

  await bot.goto('https://www.tiktok.com/foryou', 'Abrindo feed');
  await bot.goto('https://www.tiktok.com/@perfil', 'Abrindo perfil');

  assert.equal(pageGotoCalls.length, 3, '2 chamadas para o feed + 1 chamada para o perfil');
  assert.equal(pageGotoCalls[0].url, 'https://www.tiktok.com/foryou');
  assert.equal(pageGotoCalls[1].url, 'https://www.tiktok.com/foryou');
  assert.equal(pageGotoCalls[2].url, 'https://www.tiktok.com/@perfil');
  assert.deepEqual(retrySleeps(), [3000], 'só houve 1 pausa de 3s no feed, nenhuma no perfil');
});

// -------------------------------------------------------------
// PLANO 12: Simulação de plataforma com falha inicial e fluxo completo
// -------------------------------------------------------------
test('Plano 12: sessão que recupera na abertura segue normalmente para assistir vídeos', async () => {
  let feedLoads = 0;
  const { bot } = createTestEnvironment({
    gotoHandler: () => {
      feedLoads++;
      if (feedLoads === 1) throw new Error('net::ERR_TUNNEL_CONNECTION_FAILED');
      return null;
    },
  });

  // Simula o arranque do motor: goto inicial no feed
  await bot.goto('https://www.tiktok.com/foryou', 'Abrindo o TikTok');
  assert.equal(feedLoads, 2, 'recuperou na 2ª tentativa');

  // Continua as atividades subsequentes do robô normalmente
  await bot.pause('read', 'Lendo legenda');
  await bot.watch(5000, 'Assistindo vídeo');
  assert.ok(true, 'fluxo completo concluído sem quebras');
});
