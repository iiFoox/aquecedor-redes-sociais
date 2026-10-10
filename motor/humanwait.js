// Espera você resolver algo na janela da conta (captcha): o robô não mexe em nada, confere a cada poucos segundos.
// Devolve 'resolvido' (o captcha sumiu), 'tempo' (passou o limite), 'fechou' (a janela foi fechada) ou 'parou'
// (você parou a sessão). Funções injetadas: os testes usam relógio e página falsos.
async function waitForHuman({ check, closed, stopped, onTick, sleep, now = Date.now, timeoutMs = 15 * 60000, everyMs = 3000 }) {
  const end = now() + timeoutMs;
  while (now() < end) {
    if (stopped()) return 'parou';
    if (closed()) return 'fechou';
    onTick(Math.max(0, end - now()));
    await sleep(everyMs);
    if (closed()) return 'fechou';
    if (!(await check())) return 'resolvido';
  }
  return 'tempo';
}

module.exports = { waitForHuman };
