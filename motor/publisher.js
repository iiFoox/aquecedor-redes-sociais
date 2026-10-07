// Publica no banco (coluna accounts.status) o que o robô está fazendo em cada conta deste aparelho:
// sessão ao vivo, por que o piloto não abriu sessão, navegador aberto. Os outros aparelhos leem daí.
// Publica quando muda (olha a cada 10 s) e, mesmo sem mudança, a cada 60 s (para saberem que está fresco).
const store = require('./store');
const runner = require('./runner');
const platforms = require('./platforms');
const { scheduleReason } = require('./summary');

const EVERY_MS = 10000;
const REFRESH_MS = 60000;
const last = new Map(); // id -> { key, at }
let timer = null;

function statusOf(a) {
  const p = platforms[a.platform];
  const s = runner.getSession(a.id);
  const plan = store.planOf(a, p.planForDay);
  const today = a.daily[store.localDate()] || {};
  return {
    schedule: scheduleReason(a, p, plan, today),
    loginOpen: runner.isBrowserOpen(a.id),
    browserPurpose: runner.browserPurpose(a.id),
    live: s
      ? { status: s.status, statusUntil: s.statusUntil, statusAt: s.statusAt, stats: s.stats, startedAt: s.startedAt, endsAt: s.endsAt }
      : null,
  };
}

let lastLease = 0;

async function tick(force = false) {
  // Trava das contas abertas aqui (sessão ou navegador): renova a cada minuto
  if (Date.now() - lastLease >= 60000) {
    lastLease = Date.now();
    const open = store
      .mine()
      .filter((a) => runner.getSession(a.id) || runner.isBrowserOpen(a.id))
      .map((a) => a.id);
    await store.renewLeases(open).catch(() => {});
  }
  for (const a of store.mine()) {
    const st = statusOf(a);
    // O texto ao vivo muda o tempo todo: entra na comparação só o que importa (estado e números)
    const key = JSON.stringify({ ...st, live: st.live && { stats: st.live.stats, startedAt: st.live.startedAt, status: st.live.status } });
    const prev = last.get(a.id);
    if (!force && prev && prev.key === key && Date.now() - prev.at < REFRESH_MS) continue;
    last.set(a.id, { key, at: Date.now() });
    await store.publishStatus(a.id, { ...st, at: Date.now() }).catch(() => {});
  }
}

function start() {
  clearInterval(timer);
  tick(true);
  timer = setInterval(() => tick().catch(() => {}), EVERY_MS);
}
const stop = () => clearInterval(timer);

module.exports = { start, stop, tick, statusOf };
