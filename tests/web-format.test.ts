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
