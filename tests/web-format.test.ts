// Funções puras do painel novo (web/src/lib/format.ts). Rodam no Node, sem navegador.
import test from 'node:test';
import assert from 'node:assert/strict';
import * as f from '../web/src/lib/format.ts';

test('quanto falta para a meta, em português', () => {
  const plan = { minutes: 12, watch: 27, like: 5, follow: 0, profile: 0, search: 0 };
  assert.equal(f.missing(plan, { watch: 55, like: 4 }), 'falta 1 curtida');
  assert.equal(f.missing(plan, { watch: 25, like: 3 }), 'faltam 2 vídeos e 2 curtidas');
  assert.equal(f.missing(plan, { watch: 27, like: 5 }), 'meta batida');
  assert.equal(f.missing({ like: 3, search: 1, profile: 2 }, {}), 'faltam 3 curtidas, 1 busca e 2 perfis');
});

test('cor do dia no calendário', () => {
  assert.equal(f.heat(null), 'none');
  assert.equal(f.heat(0), 'h0');
  assert.equal(f.heat(0.3), 'h1');
  assert.equal(f.heat(0.9), 'h3');
  assert.equal(f.heat(1), 'h4');
});

test('sequência de dias: hoje sem sessão ainda não zera; férias não quebram', () => {
  const d = (completion: number | null, vacation = false) => ({ completion, vacation });
  assert.equal(f.streak([d(1), d(0.8), d(null)]), 2);
  assert.equal(f.streak([d(1), d(0.8), d(0.4)]), 3);
  assert.equal(f.streak([d(1), d(0), d(1), d(null)]), 1);
  assert.equal(f.streak([d(1), d(null, true), d(1), d(null)]), 2);
});

test('janela que passa da meia-noite vira dois trechos; agenda mostra o dia todo se precisar', () => {
  assert.deepEqual(f.windowSegments('08:00', '22:00'), [[480, 1320]]);
  assert.deepEqual(f.windowSegments('20:00', '02:00'), [
    [1200, 1440],
    [0, 120],
  ]);
  assert.deepEqual(f.agendaRange([{ start: '08:00', end: '22:00' }]), [360, 1440]);
  assert.deepEqual(
    f.agendaRange([
      { start: '08:00', end: '22:00' },
      { start: '20:00', end: '02:00' },
    ]),
    [0, 1440],
  );
});

test('próxima sessão só para contas que ainda têm o que fazer', () => {
  const now = 1_000_000;
  const slots = [
    { at: now - 5000, target: 0.4 },
    { at: now + 90000, target: 1 },
  ];
  assert.equal(f.nextSessionAt({ schedule: 'agendada', nextAfter: null, slots, today: { sessions: 1 } }, now), now + 90000);
  assert.equal(f.nextSessionAt({ schedule: 'espacamento', nextAfter: null }, now), now);
  // Rotina: só as sessões que faltam, com duração proporcional à parte do dia
  const up = f.upcomingSlots({ slots, today: { sessions: 1 }, plan: { minutes: 20 } });
  assert.equal(up.length, 1);
  assert.equal(up[0].minutes, Math.round(20 * 0.6 * 1.3));
  assert.equal(f.nextSessionAt({ schedule: 'intervalo', nextAfter: now + 5000 }, now), now + 5000);
  assert.equal(f.nextSessionAt({ schedule: 'iniciar', nextAfter: null }, now), now);
  assert.equal(f.nextSessionAt({ schedule: 'meta-batida', nextAfter: now + 5000 }, now), null);
  assert.equal(f.nextSessionAt({ schedule: 'fora-da-janela', nextAfter: null }, now), null);
});

test('resultado da sessão vira cor e texto', () => {
  assert.equal(f.resultClass('ok'), 'ok');
  assert.equal(f.resultClass('limit'), 'ok');
  assert.equal(f.resultClass('not_logged'), 'login');
  assert.equal(f.resultClass('watchdog'), 'bad');
  assert.equal(f.RESULT_LABEL.watchdog, 'Travou');
});

test('texto do evento e busca sem acento', () => {
  const actions = { like: 'Curtidas', watch: 'Vídeos assistidos' };
  assert.equal(f.eventText({ kind: 'action', action: 'like', detail: '#ia' }, actions), 'Curtidas: #ia');
  assert.equal(f.eventText({ kind: 'log', msg: 'Sessão iniciada' }, actions), 'Sessão iniciada');
  assert.equal(f.norm('Análises'), 'analises');
  assert.equal(f.duration(3 * 3600 + 12 * 60), '3 h 12 min');
});

test('print: hora do nome do arquivo (UTC) e o tipo do problema', () => {
  const s = f.shotInfo('2026-10-07T03-00-19_captcha.jpg');
  assert.equal(s.at, Date.parse('2026-10-07T03:00:19Z'));
  assert.equal(s.tag, 'captcha');
});

test('sessão da rotina que fez a parte dela aparece como "Parte do dia"', () => {
  assert.equal(f.resultLabel({ result: 'ok', completion: 0.43 }), 'Parte do dia');
  assert.equal(f.resultLabel({ result: 'ok', completion: 1 }), 'Concluída');
  assert.equal(f.resultLabel({ result: 'captcha', completion: 0.2 }), 'Captcha');
});

test('acessos ao painel: texto do motivo e aparelho a partir do user-agent', () => {
  assert.equal(f.accessLabel('senha'), 'Senha errada');
  assert.equal(f.accessLabel('ok'), 'Entrou');
  const edge =
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/154.0.0.0 Safari/537.36 Edg/154.0.0.0';
  assert.equal(f.deviceOf(edge), 'Edge no Windows');
  assert.equal(
    f.deviceOf('Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0 Mobile Safari/537.36'),
    'Chrome no Android',
  );
  assert.equal(f.deviceOf(null), 'aparelho desconhecido');
});

test('loginSaved: hora de hoje, data de outro dia, ou ainda não salvo', () => {
  const now = new Date(2026, 9, 7, 15, 0).getTime();
  assert.equal(f.loginSaved(null, now), 'Login ainda não salvo no Supabase');
  assert.equal(f.loginSaved(new Date(2026, 9, 7, 9, 5).getTime(), now), 'Login salvo no Supabase às 09:05');
  assert.equal(f.loginSaved(new Date(2026, 9, 6, 22, 40).getTime(), now), 'Login salvo no Supabase em 06/10 às 22:40');
});

test('horário em que o PC fica ligado: faixas de horas; sem saber ainda = null', () => {
  const on = (...hs: number[]) => Array.from({ length: 24 }, (_, h) => hs.includes(h));
  assert.equal(f.hoursText(on(10, 11, 12, 13, 14)), '10h–15h');
  assert.equal(f.hoursText(on(9, 10, 19, 20, 21)), '9h–11h, 19h–22h');
  assert.equal(f.hoursText(on(22, 23)), '22h–0h');
  assert.equal(f.hoursText(on()), null);
  assert.equal(f.hoursText(null), null);
});

test('O que há de novo?: mais nova primeiro, versões sem repetir, a versão do app está lá', async () => {
  const { NOVIDADES } = await import('../web/src/novidades.ts');
  const pkg = JSON.parse((await import('node:fs')).readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
  assert.equal(NOVIDADES[0].versao, pkg.version, 'a versão do package.json precisa ser a primeira do "O que há de novo?"');
  const vs = NOVIDADES.map((n) => n.versao);
  assert.equal(new Set(vs).size, vs.length, 'versão repetida');
  for (let i = 1; i < NOVIDADES.length; i++) assert.ok(NOVIDADES[i - 1].data >= NOVIDADES[i].data, `fora de ordem: ${vs[i]}`);
  for (const n of NOVIDADES) assert.ok(n.titulo && n.itens.length, `${n.versao} sem título ou itens`);
});
