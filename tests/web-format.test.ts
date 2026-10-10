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

test('meta personalizada no painel: fases iguais às do motor para todo prazo de 5 a 90 dias', async () => {
  const { phasesFor } = await import('../web/src/lib/meta.ts');
  const { createRequire } = await import('node:module');
  const req = createRequire(import.meta.url);
  const motor = req('../motor/platforms/phases.js');
  for (let d = 5; d <= 90; d++)
    assert.deepEqual(
      phasesFor(motor.PHASES, d).map((p: { from: number; to: number }) => [p.from, p.to]),
      motor.phasesFor(d).map((p: { from: number; to: number }) => [p.from, p.to]),
      `prazo ${d}`,
    );
});

test('meta personalizada no painel: avisos de prazo, acima do recomendado, follow cedo, fora da ordem e TikTok sem fechar', async () => {
  const { avisos, nivelDe } = await import('../web/src/lib/meta.ts');
  const plans = [
    { minutes: 12, watch: 30, like: 4, follow: 0 },
    { minutes: 18, watch: 45, like: 10, follow: 2 },
    { minutes: 25, watch: 60, like: 20, follow: 5 },
    { minutes: 30, watch: 80, like: 30, follow: 8 },
    { minutes: 35, watch: 100, like: 40, follow: 12 },
  ];
  const labels = { watch: 'Vídeos assistidos', like: 'Curtidas', follow: 'Follows' };
  // A própria recomendada: nenhum aviso
  assert.deepEqual(avisos('tiktok', { readyDay: 22, phases: plans }, plans, labels), []);
  const t = { readyDay: 8, phases: plans.map((p) => ({ ...p })) };
  t.phases[0].follow = 2; // follow na fase 1 (recomendado nenhum)
  t.phases[1].like = 16; // 1,6x
  t.phases[2].like = 70; // 3,5x
  t.phases[2].watch = 100; // (com vídeos para caber as curtidas)
  t.phases[3].watch = 50; // menor que na fase 3 (100)
  t.phases[4].like = 120; // mais que os 100 vídeos
  const list = avisos('tiktok', t, plans, labels);
  assert.ok(list.some((a) => a.fase === null && a.nivel === 'risco' && /8 dias/.test(a.msg)));
  assert.equal(nivelDe(list, 1, 'follow'), 'risco');
  assert.equal(nivelDe(list, 2, 'like'), 'atencao');
  assert.equal(nivelDe(list, 3, 'like'), 'risco');
  assert.equal(nivelDe(list, 4, 'watch'), 'atencao');
  assert.ok(list.some((a) => a.fase === 5 && a.nivel === 'erro' && /o dia nunca fecharia/.test(a.msg)));
  assert.equal(nivelDe(list, 5, 'like'), 'erro');
  assert.equal(nivelDe(list, 1, 'like'), null);
  // Prazo curto (10 a 14): só atenção
  assert.equal(avisos('tiktok', { readyDay: 12, phases: plans }, plans, labels)[0].nivel, 'atencao');
});

test('meta personalizada no painel: erros que bloqueiam (limite e impossível) iguais aos que o motor recusa', async () => {
  const { avisos, impossiveis, resumo } = await import('../web/src/lib/meta.ts');
  const { createRequire } = await import('node:module');
  const req = createRequire(import.meta.url);
  const custom = req('../motor/custom.js');
  const platforms = req('../motor/platforms/index.js');
  // Sorteia fases e compara: o painel acusa erro exatamente quando o motor recusa
  let seed = 7;
  const rnd = (n: number) => ((seed = (seed * 16807) % 2147483647), seed % n);
  for (const platform of ['tiktok', 'instagram'] as const) {
    const p = platforms[platform];
    for (let i = 0; i < 400; i++) {
      const ph = Object.fromEntries(Object.keys(p.plans[0]).map((k) => [k, k === 'minutes' ? 10 : rnd(12)]));
      const motorSays = custom.impossible(platform, ph, p.actions).length > 0;
      assert.equal(impossiveis(platform, ph, p.actions).length > 0, motorSays, `${platform} ${JSON.stringify(ph)}`);
      let threw = false;
      try {
        custom.normalizeTemplate({ name: 'x', platform, phases: [ph] }, p.plans, p.actions);
      } catch {
        threw = true;
      }
      assert.equal(threw, motorSays, `${platform} ${JSON.stringify(ph)}: motor e painel discordam`);
    }
  }
  const tt = platforms.tiktok;
  const list = avisos(
    'tiktok',
    { readyDay: 3, phases: tt.plans.map((x: Record<string, number>, i: number) => (i === 1 ? { ...x, like: 301 } : x)) },
    tt.plans,
    tt.actions,
    custom.LIMITS,
  );
  assert.ok(list.some((a) => a.key === 'readyDay' && a.nivel === 'erro' && /entre 5 e 90/.test(a.msg)));
  assert.ok(list.some((a) => a.fase === 2 && a.key === 'like' && a.nivel === 'erro' && /máximo 300/.test(a.msg)));
  assert.match(resumo(list), new RegExp(`^${list.filter((a) => a.nivel === 'erro').length} erros, 1 atenção$`));
  assert.equal(resumo([]), '');
});

test('meta personalizada no painel: prévia dia a dia, totais e pontos de partida válidos no motor', async () => {
  const { serie, total, presets, phaseIdx, avisos } = await import('../web/src/lib/meta.ts');
  const { createRequire } = await import('node:module');
  const req = createRequire(import.meta.url);
  const { PHASES } = req('../motor/platforms/phases.js');
  const custom = req('../motor/custom.js');
  const platforms = req('../motor/platforms/index.js');
  const phases = [1, 2, 3, 4, 5].map((n) => ({ like: n * 10 }));
  // Prazo 8: fases 1 | 2 | 3-5 | 6-7 | 8+
  assert.deepEqual(serie(PHASES, phases, 8, 'like', 9), [10, 20, 30, 30, 30, 40, 40, 50, 50]);
  assert.equal(total(PHASES, phases, 8, 'like'), 10 + 20 + 30 * 3 + 40 * 2);
  assert.equal(phaseIdx(PHASES, 18, 22), 3);
  assert.equal(phaseIdx(PHASES, 18, 15), 4);
  assert.equal(phaseIdx(PHASES, 18, 60), 1);
  for (const platform of ['tiktok', 'instagram'] as const) {
    const p = platforms[platform];
    const list = presets(p.plans);
    assert.deepEqual(
      list.map((x) => [x.key, x.readyDay]),
      [
        ['cautelosa', 30],
        ['recomendada', 22],
        ['rapida', 15],
      ],
    );
    for (const pr of list) {
      assert.doesNotThrow(() =>
        custom.normalizeTemplate({ name: pr.name, platform, readyDay: pr.readyDay, phases: pr.phases }, p.plans, p.actions),
      );
      assert.equal(
        avisos(platform, pr, p.plans, p.actions, custom.LIMITS).filter((a) => a.nivel !== 'atencao').length,
        0,
        `${platform} ${pr.key}`,
      );
      pr.phases.forEach((ph, i) => {
        for (const k of Object.keys(ph)) if (p.plans[i][k] === 0) assert.equal(ph[k], 0, `${pr.key}: ${k} zerado virou ${ph[k]}`);
      });
    }
    assert.deepEqual(list[1].phases, p.plans);
  }
});

test('meta personalizada no painel: o que acontece com a fase da conta ao trocar de meta', async () => {
  const { mudancaDeFase } = await import('../web/src/lib/meta.ts');
  const { createRequire } = await import('node:module');
  const { PHASES } = createRequire(import.meta.url)('../motor/platforms/phases.js');
  assert.match(
    mudancaDeFase(PHASES, 18, 22, 15),
    /dia 18 \(fase 4\); com esta meta ela vai para a fase 5 · Aquecida\. Os números sobem aos poucos/,
  );
  assert.match(mudancaDeFase(PHASES, 18, 22, 60), /volta para a fase 2 · Interação leve\. Os números descem já hoje/);
  assert.match(mudancaDeFase(PHASES, 5, 22, 22), /continua na fase 2/);
});
