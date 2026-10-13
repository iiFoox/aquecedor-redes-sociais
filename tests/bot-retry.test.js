const test = require('node:test');
const assert = require('node:assert/strict');
const { createBot } = require('../motor/bot');
const { createCtl } = require('../motor/ctl');
const human = require('../motor/human');

function createMockEnvironment({ gotoHandler }) {
  let statusList = [];
  let pageGotoCalls = [];

  const page = {
    url: () => 'https://www.tiktok.com/foryou',
    goto: async (url, opts) => {
      pageGotoCalls.push({ url, opts });
      return gotoHandler(pageGotoCalls.length, url, opts);
    },
    locator: () => ({
      count: async () => 0,
      nth: () => ({ boundingBox: async () => null }),
    }),
    evaluate: async () => ({ width: 1366, height: 768 }),
    mouse: { move: async () => {}, click: async () => {}, wheel: async () => {} },
  };

  const state = {
    stop: false,
    stats: {},
    startedAt: Date.now(),
    endsAt: Date.now() + 60000,
    lastProgress: Date.now(),
    lastBeat: Date.now(),
  };

  const ctl = createCtl({
    state,
    plan: { watch: 10 },
    done: () => ({}),
    now: () => Date.now(),
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
    rng: human.makeRng(123),
    clock: { now: () => Date.now(), sleep: async () => {}, wait: async () => {} },
    cursor: { moveTo: async () => {}, click: async () => {}, position: { x: 0, y: 0 } },
    persona: human.makePersona(123),
  });

  return { bot, pageGotoCalls, statusList };
}

test('bot.goto: recupera de erro transitório de proxy (ERR_TUNNEL_CONNECTION_FAILED) na 2ª tentativa', async () => {
  const { bot, pageGotoCalls, statusList } = createMockEnvironment({
    gotoHandler: (callCount) => {
      if (callCount === 1) {
        throw new Error('page.goto: net::ERR_TUNNEL_CONNECTION_FAILED at https://www.tiktok.com/foryou');
      }
      return null;
    },
  });

  await bot.goto('https://www.tiktok.com/foryou', 'Abrindo TikTok');

  assert.equal(pageGotoCalls.length, 2, 'deve tentar exatamente 2 vezes');
  assert.ok(
    statusList.some((s) => s.includes('tentando novamente')),
    'deve avisar no status sobre a nova tentativa',
  );
});

test('bot.goto: recupera de erro de autenticação temporária de proxy (ERR_INVALID_AUTH_CREDENTIALS)', async () => {
  const { bot, pageGotoCalls, statusList } = createMockEnvironment({
    gotoHandler: (callCount) => {
      if (callCount === 1) {
        throw new Error('page.goto: net::ERR_INVALID_AUTH_CREDENTIALS at https://www.tiktok.com/foryou');
      }
      return null;
    },
  });

  await bot.goto('https://www.tiktok.com/foryou', 'Abrindo TikTok');

  assert.equal(pageGotoCalls.length, 2, 'deve tentar exatamente 2 vezes');
  assert.ok(
    statusList.some((s) => s.includes('Conexão oscilou')),
    'deve emitir status avisando que a conexão oscilou',
  );
});

test('bot.goto: esgota as 3 tentativas se a falha de túnel persistir e lança o erro', async () => {
  const { bot, pageGotoCalls } = createMockEnvironment({
    gotoHandler: () => {
      throw new Error('page.goto: net::ERR_TUNNEL_CONNECTION_FAILED at https://www.tiktok.com/foryou');
    },
  });

  await assert.rejects(
    () => bot.goto('https://www.tiktok.com/foryou', 'Abrindo TikTok'),
    /ERR_TUNNEL_CONNECTION_FAILED/,
    'deve lançar o erro original após esgotar as tentativas',
  );

  assert.equal(pageGotoCalls.length, 3, 'deve ter tentado 3 vezes antes de desistir');
});

test('bot.goto: não faz retry para erros que não sejam de rede/proxy', async () => {
  const { bot, pageGotoCalls } = createMockEnvironment({
    gotoHandler: () => {
      throw new Error('Target closed / ReferenceError: foo is not defined');
    },
  });

  await assert.rejects(() => bot.goto('https://www.tiktok.com/foryou', 'Abrindo TikTok'), /ReferenceError/);

  assert.equal(pageGotoCalls.length, 1, 'não deve fazer retry para erros que não são de rede');
});
