// Simula dias de aquecimento sem abrir navegador (relógio e página falsos, regras e robô de verdade).
//   npm run simular -- alemdofato5          3 dias da conta real (lê do Supabase, não grava nada)
//   npm run simular -- alemdofato5 7        7 dias
//   npm run simular -- nova-tiktok 5        conta nova do TikTok (ou nova-instagram)
//   opções: --semente 42 (repete o mesmo resultado)  --json arquivo.json (salva a linha do tempo)
const fs = require('fs');
const path = require('path');
const { simulate, summarize } = require('../motor/sim/simulate');
const human = require('../motor/human');

try {
  process.loadEnvFile(path.join(__dirname, '..', '.env'));
} catch {
  /* sem .env */
}

const args = process.argv.slice(2);
const opt = (name) => {
  const i = args.indexOf(`--${name}`);
  return i === -1 ? null : args.splice(i, 2)[1];
};
const seed = Number(opt('semente')) || Math.floor(Math.random() * 1e9);
const jsonOut = opt('json');
const [who = 'nova-tiktok', daysArg = '3'] = args;
const days = Math.max(1, Math.min(60, Number(daysArg) || 3));

const fmtS = (ms) => (ms >= 60000 ? `${(ms / 60000).toFixed(1)} min` : `${(ms / 1000).toFixed(1)} s`);
const hhmm = (ms) => new Date(ms).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });

// Conta real: só leitura (nunca grava). Conta nova: personalidade sorteada pela semente.
async function loadAccount() {
  const nova = /^nova-(tiktok|instagram)$/.exec(who);
  if (nova) return { account: { platform: nova[1], username: `nova_${nova[1]}`, interests: ['IA', 'comédia', 'receitas'] }, config: {} };
  const { createClient } = require('@supabase/supabase-js');
  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_KEY) throw new Error('Faltam SUPABASE_URL e SUPABASE_KEY no .env');
  const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY, { auth: { persistSession: false } });
  const [acc, cfg] = await Promise.all([
    sb.from('accounts').select('id, platform, username, data').ilike('username', who.replace(/^@/, '')).maybeSingle(),
    sb.from('config').select('data').eq('id', 'main').maybeSingle(),
  ]);
  if (acc.error || !acc.data) throw new Error(`Conta "${who}" não encontrada`);
  const d = acc.data.data || {};
  return {
    account: { ...d, id: acc.data.id, platform: acc.data.platform, username: acc.data.username },
    config: { start: cfg.data?.data?.start, end: cfg.data?.data?.end },
  };
}

// Barrinhas de texto para o histograma
function bars(sum) {
  const top = Math.max(1, ...sum.hist);
  const labels = sum.edges
    .map((e, i) => `${i === 0 ? '0' : fmtS(sum.edges[i - 1])}–${fmtS(e)}`)
    .concat([`>${fmtS(sum.edges[sum.edges.length - 1])}`]);
  return sum.hist
    .map((n, i) => (n ? `    ${labels[i].padEnd(16)} ${'█'.repeat(Math.max(1, Math.round((n / top) * 30)))} ${n}` : null))
    .filter(Boolean)
    .join('\n');
}

async function main() {
  const { account, config } = await loadAccount();
  if (!account.persona) account.persona = human.makePersona(seed);
  const r = await simulate({ account, days, config: Object.fromEntries(Object.entries(config).filter(([, v]) => v)), seed });
  const p = r.account.persona;
  console.log(`\n🧪 Simulação: @${account.username} (${account.platform}) · ${days} dia(s) · semente ${seed}`);
  console.log(
    `   Personalidade: leitura ${p.readSpeed}x · ritmo ${p.pace}x · paciência ${p.patience}x · curtir ${p.likeBias}x · ` +
      `digita ${p.typingCps} letras/s · distração ${p.distraction}x · pico às ${p.peak}h (±${p.spread}h)\n`,
  );
  for (const s of r.sessions) {
    const done = Object.keys(s.plan)
      .filter((k) => k !== 'minutes' && (s.plan[k] > 0 || s.done[k] > 0))
      .map((k) => `${k} ${s.done[k] || 0}/${s.plan[k]}`)
      .join(' · ');
    const dow = new Date(`${s.date}T12:00:00Z`).toLocaleDateString('pt-BR', { weekday: 'short', timeZone: 'UTC' });
    console.log(
      `  ${s.date} ${dow} dia ${s.day}  ${hhmm(s.start)}–${hhmm(s.end)} (${s.minutes} min) meta do dia ${Math.round(s.completion * 100)}%  ${done}`,
    );
  }
  const all = (k) => r.sessions.flatMap((s) => s.samples[k] || []);
  for (const [k, title] of [
    ['pause', 'Pausas'],
    ['watch', 'Tempo por vídeo/story'],
  ]) {
    const sum = summarize(all(k));
    if (!sum.n) continue;
    console.log(`\n  ${title}: ${sum.n} · mediana ${fmtS(sum.p50)} · 90% até ${fmtS(sum.p90)} · maior ${fmtS(sum.max)}`);
    console.log(bars(sum));
  }
  if (jsonOut) {
    fs.writeFileSync(
      jsonOut,
      JSON.stringify(
        { seed, account: { username: account.username, platform: account.platform, persona: p }, sessions: r.sessions },
        null,
        1,
      ),
    );
    console.log(`\n  Linha do tempo salva em ${jsonOut}`);
  }
  console.log('\n  Nada foi aberto nem gravado: relógio e página são falsos.\n');
}

main().catch((e) => {
  console.error(`❌ ${e.message}`);
  process.exit(1);
});
