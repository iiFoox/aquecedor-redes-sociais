// Captcha no meio da sessão: o robô para de mexer, espera você resolver na janela e continua (motor/humanwait.js).
const test = require('node:test');
const assert = require('node:assert/strict');
const { waitForHuman } = require('../motor/humanwait');

function fakes({ solveAfter = Infinity, closeAfter = Infinity, stopAfter = Infinity } = {}) {
  let t = 0;
  const ticks = [];
  return {
    ticks,
    now: () => t,
    sleep: async (ms) => {
      t += ms;
    },
    check: async () => t < solveAfter, // true = captcha ainda na tela
    closed: () => t >= closeAfter,
    stopped: () => t >= stopAfter,
    onTick: (left) => ticks.push(left),
  };
}

test('captcha: resolvido por você, a espera acaba e a sessão continua', async () => {
  const f = fakes({ solveAfter: 40000 });
  assert.equal(await waitForHuman({ ...f, timeoutMs: 15 * 60000 }), 'resolvido');
  assert.ok(f.now() >= 40000 && f.now() < 50000, 'demorou para perceber que resolveu');
  assert.ok(f.ticks.length > 5 && f.ticks[0] === 15 * 60000, 'não mostrou quanto falta');
});

test('captcha: sem resolver em 15 min, para (a conta fica esperando você)', async () => {
  const f = fakes();
  assert.equal(await waitForHuman({ ...f, timeoutMs: 15 * 60000 }), 'tempo');
  assert.ok(f.now() >= 15 * 60000);
});

test('captcha: janela fechada ou sessão parada por você encerram a espera na hora', async () => {
  let f = fakes({ closeAfter: 9000 });
  assert.equal(await waitForHuman({ ...f }), 'fechou');
  assert.ok(f.now() <= 12000);
  f = fakes({ stopAfter: 6000 });
  assert.equal(await waitForHuman({ ...f }), 'parou');
  assert.ok(f.now() <= 9000);
});
