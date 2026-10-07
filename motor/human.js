// Comportamento humano: tempos de cauda longa, personalidade de cada conta e destino de cada vídeo.
// Tudo puro e com sorteio injetável (rng), para o simulador e os testes repetirem o mesmo resultado.
//
// Por que cauda longa: o tempo que uma pessoa leva para ler, decidir ou voltar de uma distração
// não fica em volta de uma média fixa. A maioria das pausas é curta e, de vez em quando, vem
// uma bem longa. A log-normal descreve isso bem (tempos de reação e de leitura seguem essa forma).
// Nada aqui muda QUANTAS ações a conta faz: isso continua sendo o plano do dia (teto de 120%).

// ---------- Sorteio ----------

// Sorteio com semente (mulberry32): mesma semente, mesma sequência
function makeRng(seed = Date.now()) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Semente a partir de um texto (ex.: semente da conta + data do dia)
function hashSeed(text) {
  let h = 2166136261;
  for (const c of String(text)) h = Math.imul(h ^ c.charCodeAt(0), 16777619);
  return h >>> 0;
}

const between = (rng, a, b) => a + rng() * (b - a);
const round2 = (v) => Math.round(v * 100) / 100;

// Normal padrão (Box-Muller)
function normal(rng) {
  let u = 0;
  while (u === 0) u = rng();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * rng());
}

// Log-normal pela mediana: metade das amostras abaixo de `median`, cauda longa para cima
const lognormal = (rng, median, sigma) => median * Math.exp(sigma * normal(rng));

// Amostra dentro de [min, max]: sorteia de novo algumas vezes antes de cortar no limite
// (cortar direto empilharia valores exatamente no limite, o que é um padrão de robô)
function bounded(rng, median, sigma, min, max) {
  for (let i = 0; i < 6; i++) {
    const v = lognormal(rng, median, sigma);
    if (v >= min && v <= max) return v;
  }
  return Math.min(max, Math.max(min, median));
}

// ---------- Curvas de cada tipo de espera (ms) ----------
// median: tempo típico. sigma: quanto espalha (0,3 pouco; 0,7 muito). min/max: limites físicos.
// pace = ritmo geral da conta; read = velocidade de leitura (ver personalidade).
const PAUSES = {
  load: { median: 2200, sigma: 0.35, min: 900, max: 9000, trait: 'pace' }, // página carregando, olhar o que apareceu
  read: { median: 3500, sigma: 0.55, min: 1200, max: 20000, trait: 'read' }, // ler legenda ou post comum
  nicheRead: { median: 14000, sigma: 0.4, min: 7000, max: 45000, trait: 'read' }, // conteúdo do nicho: lê com calma
  decide: { median: 900, sigma: 0.5, min: 280, max: 4500, trait: 'pace' }, // hesitar antes de clicar
  afterAction: { median: 1600, sigma: 0.5, min: 500, max: 8000, trait: 'pace' }, // depois de curtir ou seguir
  next: { median: 850, sigma: 0.45, min: 300, max: 4000, trait: 'pace' }, // entre um vídeo e o próximo
  glance: { median: 3200, sigma: 0.6, min: 1000, max: 18000, trait: 'read' }, // olhar comentários ou um perfil
  between: { median: 5000, sigma: 0.7, min: 1500, max: 45000, trait: 'pace' }, // entre atividades
  distraction: { median: 55000, sigma: 0.6, min: 15000, max: 300000, trait: null }, // celular, outra aba, banheiro
};

/**
 * Tempo de uma espera do tipo `kind`, já com a personalidade da conta, o humor do dia e o cansaço.
 * mood: multiplicadores do dia ({ pace, read }); fatigue: 1 = descansado.
 */
function pause(kind, { rng = Math.random, persona = null, mood = null, fatigue = 1 } = {}) {
  const k = PAUSES[kind];
  if (!k) throw new Error(`Tipo de espera desconhecido: ${kind}`);
  const trait = k.trait === 'read' ? 'readSpeed' : k.trait === 'pace' ? 'pace' : null;
  const mult = (trait && persona ? persona[trait] : 1) * (k.trait && mood ? mood[k.trait] || 1 : 1) * fatigue;
  return Math.round(bounded(rng, k.median * mult, k.sigma, k.min * mult, k.max * mult));
}

// Espera genérica entre min e max (as chamadas antigas do tipo wait(1500, 3000)):
// mediana na média geométrica, ~90% dentro do intervalo e cauda até 2x o máximo.
function span(min, max, rng = Math.random) {
  if (max <= min) return Math.round(min);
  const median = Math.sqrt(min * max);
  const sigma = Math.log(max / min) / 3.3;
  return Math.round(bounded(rng, median, sigma, min * 0.7, max * 2));
}

// ---------- Personalidade ----------

// Horários de pico mais comuns de quem usa rede social por lazer (noite pesa mais)
const PEAKS = [
  [8, 1],
  [12, 2],
  [13, 1.5],
  [18, 2],
  [19, 3],
  [20, 4],
  [21, 4],
  [22, 3],
  [23, 1.5],
];

/**
 * Traços fixos da conta, sorteados uma vez e guardados nela. Mudam o JEITO de agir, nunca o volume.
 *  - readSpeed: multiplica o tempo de leitura (1,2 = lê 20% mais devagar)
 *  - pace: ritmo geral de cliques e transições
 *  - patience: paciência com vídeos (mais alto = pula menos, assiste mais até o fim)
 *  - likeBias: inclinação a curtir cedo ou tarde no dia (o total segue o plano)
 *  - scroll: tamanho dos passos da rolagem, chance de "deslizar rápido" e de passar do ponto
 *  - typingCps: letras por segundo ao digitar
 *  - distraction: frequência de distrações (1 = normal)
 *  - peak / spread: horário preferido (hora) e quanto se espalha em volta dele (horas)
 *  - doubleTap: parte das curtidas em vídeo feitas com dois cliques no vídeo (o resto vai no coração)
 */
function makePersona(seed = Math.floor(Math.random() * 2 ** 31)) {
  const rng = makeRng(seed);
  const total = PEAKS.reduce((s, [, w]) => s + w, 0);
  let r = rng() * total;
  let peak = 20;
  for (const [h, w] of PEAKS)
    if ((r -= w) <= 0) {
      peak = h;
      break;
    }
  return {
    v: 1,
    seed,
    readSpeed: round2(between(rng, 0.8, 1.3)),
    pace: round2(between(rng, 0.85, 1.25)),
    patience: round2(between(rng, 0.75, 1.3)),
    likeBias: round2(between(rng, 0.85, 1.15)),
    scroll: {
      step: Math.round(between(rng, 70, 130)),
      flick: round2(between(rng, 0.05, 0.25)),
      overshoot: round2(between(rng, 0.05, 0.2)),
    },
    typingCps: round2(between(rng, 3.5, 7)),
    distraction: round2(between(rng, 0.5, 1.5)),
    peak,
    spread: round2(between(rng, 1.5, 3.5)),
    // Sorteado por último: as contas que já têm personalidade mantêm os outros traços iguais
    doubleTap: round2(between(rng, 0.2, 0.6)),
  };
}

// Humor do dia: a mesma pessoa varia um pouco de um dia para o outro (±8%)
function dayMood(persona, date) {
  const rng = makeRng(hashSeed(`${persona ? persona.seed : 0}:${date}`));
  return { pace: round2(between(rng, 0.92, 1.08)), read: round2(between(rng, 0.92, 1.08)), patience: round2(between(rng, 0.92, 1.08)) };
}

// Distrações desta sessão: quantos minutos, em média, entre uma e outra (sorteado por sessão)
function distractionGapMin(persona, rng = Math.random) {
  const rate = persona ? persona.distraction : 1;
  return Math.round(bounded(rng, 9 / rate, 0.5, 3, 40));
}

// ---------- Vídeos ----------

/**
 * Quanto tempo assistir um vídeo e com que "destino":
 *  skip (pula nos primeiros segundos), half (até a metade), full (inteiro) ou loop (revê).
 * duration: segundos do vídeo (null se não deu para ler; usa uma estimativa).
 * Conteúdo do nicho: pula menos e vê mais até o fim. Paciência da conta muda as chances.
 */
function watchPlan(duration, { niche = false, keen = false, persona = null, mood = null, rng = Math.random } = {}) {
  const dur = Number.isFinite(duration) && duration > 1 ? duration : bounded(rng, 22, 0.6, 6, 90);
  const patience = (persona ? persona.patience : 1) * (mood ? mood.patience || 1 : 1);
  const base = niche ? { skip: 0.1, half: 0.25, full: 0.45, loop: 0.2 } : { skip: 0.5, half: 0.3, full: 0.17, loop: 0.03 };
  // keen: com vontade de curtir (curtidas apertadas no dia), pula bem menos
  const w = { skip: base.skip / patience / (keen ? 3 : 1), half: base.half, full: base.full * patience, loop: base.loop * patience };
  // Vídeo longo (>90 s): quase ninguém revê, e ver inteiro fica mais raro
  if (dur > 90) {
    w.loop = 0;
    w.full *= 0.4;
  }
  const total = w.skip + w.half + w.full + w.loop;
  let r = rng() * total;
  let outcome = 'loop';
  for (const k of ['skip', 'half', 'full', 'loop'])
    if ((r -= w[k]) <= 0) {
      outcome = k;
      break;
    }
  const s = {
    skip: () => bounded(rng, 2.6, 0.45, 0.8, Math.max(1.2, Math.min(7, dur * 0.4))),
    half: () => dur * between(rng, 0.3, 0.7),
    full: () => dur * between(rng, 0.95, 1.05),
    loop: () => dur * between(rng, 1.3, 2.2),
  }[outcome]();
  return { ms: Math.round(Math.min(s, 180) * 1000), outcome, duration: Math.round(dur) };
}

// ---------- Curtir ----------

/**
 * Chance final de curtir. `chance` vem da plataforma (adaptativa ao que falta no plano):
 * zero quando a meta de curtidas já foi batida, e aí continua zero, com ou sem nicho.
 * Nicho sobe a chance para pelo menos `nicheMin`; a inclinação da conta (likeBias) ajusta.
 * Teto de 75% (max): a plataforma sobe o teto quando as curtidas estão apertadas no dia.
 */
function likeProbability(chance, { niche = false, nicheMin = 0.6, persona = null, max = 0.75 } = {}) {
  if (!(chance > 0)) return 0;
  const base = niche ? Math.max(nicheMin, chance) : chance;
  return Math.min(max, base * (persona ? persona.likeBias : 1));
}

// ---------- Rolagem ----------

/**
 * Passos de uma rolagem com inércia: começa devagar, acelera, desacelera no fim.
 * Às vezes passa do ponto e volta um pouco. Devolve [{ dy, ms }] (delta da roda e espera depois).
 */
function scrollSteps(amount, { persona = null, rng = Math.random } = {}) {
  const dir = Math.sign(amount) || 1;
  const total = Math.abs(amount);
  const step = persona ? persona.scroll.step : 100;
  const flick = rng() < (persona ? persona.scroll.flick : 0.15);
  const steps = [];
  let done = 0;
  const n = Math.max(2, Math.round(total / (step * (flick ? 1.8 : 1))));
  for (let i = 0; i < n && done < total; i++) {
    // Perfil em "sino": passos maiores no meio
    const shape = Math.sin(((i + 0.5) / n) * Math.PI);
    const dy = Math.min(total - done, Math.max(15, Math.round((total / n) * (0.55 + shape * 0.9) * between(rng, 0.8, 1.2))));
    done += dy;
    steps.push({ dy: dy * dir, ms: Math.round((flick ? 12 : 20) + (1 - shape) * between(rng, 15, 45)) });
  }
  if (done < total) steps.push({ dy: (total - done) * dir, ms: Math.round(between(rng, 20, 40)) });
  if (rng() < (persona ? persona.scroll.overshoot : 0.1)) {
    const back = Math.round(total * between(rng, 0.05, 0.15));
    steps.push({ dy: 0, ms: Math.round(between(rng, 180, 450)) }); // percebe que passou
    steps.push({ dy: -back * dir, ms: Math.round(between(rng, 30, 60)) });
  }
  return steps;
}

// ---------- Resumo dos tempos (card "Naturalidade") ----------

const TIME_EDGES = [500, 1000, 2000, 4000, 8000, 15000, 30000, 60000, 120000];

// Lista de tempos (ms) → quantos, percentis e histograma por faixas (TIME_EDGES; a última é "acima de 2 min")
function timingSummary(values, edges = TIME_EDGES) {
  const sorted = [...values].sort((a, b) => a - b);
  const at = (p) => (sorted.length ? sorted[Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length))] : 0);
  const hist = edges.map(() => 0).concat([0]);
  for (const v of sorted) {
    const i = edges.findIndex((e) => v < e);
    hist[i === -1 ? edges.length : i]++;
  }
  return { n: sorted.length, p10: at(10), p50: at(50), p90: at(90), p99: at(99), max: sorted[sorted.length - 1] || 0, edges, hist };
}

// ---------- Teclado e dois cliques ----------

// Vizinhas no teclado (QWERTY/ABNT): o erro de digitação mais comum é a tecla do lado
const ROWS = ['qwertyuiop', 'asdfghjklç', 'zxcvbnm'];
function neighbor(ch, rng) {
  const lower = ch.toLowerCase();
  for (const row of ROWS) {
    const i = row.indexOf(lower);
    if (i === -1) continue;
    const opts = [row[i - 1], row[i + 1]].filter(Boolean);
    const n = opts[Math.floor(rng() * opts.length)];
    return ch === lower ? n : n.toUpperCase();
  }
  return null;
}

/**
 * Como digitar um texto: lista de { key, ms } (key é uma letra ou "Backspace"; ms é a espera antes dela).
 * Velocidade da personalidade (typingCps), ritmo irregular, pausa maior entre palavras e,
 * às vezes, uma letra errada que é apagada logo depois. Aplicando a lista, sai exatamente o texto.
 */
function typingPlan(text, { persona = null, rng = Math.random, typo = 0.025 } = {}) {
  const cps = persona && persona.typingCps ? persona.typingCps : 5;
  const base = 1000 / cps;
  const steps = [];
  let typos = 0;
  for (const ch of text) {
    let ms = bounded(rng, base, 0.45, 35, base * 5);
    if (ch === ' ') ms += bounded(rng, base * 0.8, 0.6, 50, 1500); // fim de palavra
    const wrong = typos < 1 && /[a-zç]/i.test(ch) && rng() < typo ? neighbor(ch, rng) : null;
    if (wrong) {
      typos++;
      steps.push({ key: wrong, ms: Math.round(ms) });
      steps.push({ key: 'Backspace', ms: Math.round(bounded(rng, 450, 0.4, 180, 1500)) }); // percebeu o erro
      ms = bounded(rng, base, 0.4, 60, base * 4);
    }
    steps.push({ key: ch, ms: Math.round(ms) });
  }
  return steps;
}

// Texto que sai de um plano de digitação (para conferir nos testes)
function typedText(steps) {
  let out = '';
  for (const s of steps) out = s.key === 'Backspace' ? out.slice(0, -1) : out + s.key;
  return out;
}

// Intervalo entre os dois cliques de um "toque duplo" (pessoas: ~80 a 200 ms)
const tapGap = (rng = Math.random) => Math.round(bounded(rng, 120, 0.3, 70, 220));

// Usa dois cliques no vídeo em vez do coração? (conta antiga sem o traço: 40%)
const prefersDoubleTap = (persona, rng = Math.random) => rng() < (persona && persona.doubleTap != null ? persona.doubleTap : 0.4);

module.exports = {
  typingPlan,
  typedText,
  tapGap,
  prefersDoubleTap,
  TIME_EDGES,
  timingSummary,
  PAUSES,
  makeRng,
  hashSeed,
  lognormal,
  bounded,
  pause,
  span,
  makePersona,
  dayMood,
  distractionGapMin,
  watchPlan,
  likeProbability,
  scrollSteps,
};
