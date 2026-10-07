// Funções puras do painel (sem React e sem navegador), testadas em tests/web-format.test.ts.

export const pct = (v: number) => Math.round(v * 100);
export const pad = (n: number) => String(n).padStart(2, '0');

export const toMin = (hhmm: string) => {
  const [h, m] = hhmm.split(':').map(Number);
  return h * 60 + m;
};
export const minOfDay = (d: Date) => d.getHours() * 60 + d.getMinutes();
export const hhmm = (ms: number) => {
  const d = new Date(ms);
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
};
// Hora de um evento: só HH:MM se foi hoje, senão DD/MM HH:MM
export function when(ms: number, now = Date.now()) {
  const d = new Date(ms);
  return d.toDateString() === new Date(now).toDateString() ? hhmm(ms) : `${pad(d.getDate())}/${pad(d.getMonth() + 1)} ${hhmm(ms)}`;
}
export const ddmm = (iso: string) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}`;
export const isoDate = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
export function addDays(iso: string, n: number) {
  const d = new Date(`${iso}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}
export const diffDays = (a: string, b: string) => Math.round((Date.parse(`${b}T12:00:00Z`) - Date.parse(`${a}T12:00:00Z`)) / 86400000);
// Dia da semana com segunda = 0
export const weekday = (iso: string) => (new Date(`${iso}T12:00:00Z`).getUTCDay() + 6) % 7;

export function duration(sec: number) {
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  return h ? `${h} h ${pad(m)} min` : `${m} min`;
}
export const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

// Cor do quadradinho do dia: nada, zero, pouco, metade, quase, meta batida
export function heat(v: number | null | undefined) {
  if (v == null) return 'none';
  if (v === 0) return 'h0';
  if (v < 0.5) return 'h1';
  if (v < 0.8) return 'h2';
  if (v < 1) return 'h3';
  return 'h4';
}

export const healthLabel = (s: number) => (s >= 70 ? 'Saudável' : s >= 40 ? 'Atenção' : 'Crítica');
export const healthColor = (s: number) => (s >= 70 ? 'var(--ok)' : s >= 40 ? 'var(--warn)' : 'var(--bad)');

// Dias seguidos com sessão. Hoje só conta se já teve sessão (de manhã cedo a sequência não zera).
export function streak(days: { completion: number | null; vacation?: boolean }[]) {
  let n = 0;
  for (let i = days.length - 1; i >= 0; i--) {
    const d = days[i];
    if (d.vacation) continue;
    if (!d.completion) {
      if (i === days.length - 1) continue;
      break;
    }
    n++;
  }
  return n;
}

export const UNIT: Record<string, [string, string]> = {
  watch: ['vídeo', 'vídeos'],
  like: ['curtida', 'curtidas'],
  follow: ['follow', 'follows'],
  profile: ['perfil', 'perfis'],
  search: ['busca', 'buscas'],
  story: ['story', 'stories'],
  reel: ['reel', 'reels'],
  explore: ['exploração', 'explorações'],
  scroll: ['rolagem', 'rolagens'],
};
const unit = (k: string, n: number) => (UNIT[k] ? UNIT[k][n === 1 ? 0 : 1] : k);

// "faltam 3 vídeos e 1 curtida" / "falta 1 busca" / "meta batida"
export function missing(plan: Record<string, number>, done: Record<string, number>) {
  const parts = Object.keys(plan)
    .filter((k) => k !== 'minutes' && plan[k] > (done[k] || 0))
    .map((k) => {
      const n = plan[k] - (done[k] || 0);
      return `${n} ${unit(k, n)}`;
    });
  if (!parts.length) return 'meta batida';
  const list = parts.length > 1 ? `${parts.slice(0, -1).join(', ')} e ${parts[parts.length - 1]}` : parts[0];
  return `${parts.length === 1 && parts[0].startsWith('1 ') ? 'falta' : 'faltam'} ${list}`;
}

export const goalKeys = (plan: Record<string, number>, done: Record<string, number>, order: string[]) =>
  order.filter((k) => k !== 'minutes' && ((plan[k] || 0) > 0 || (done[k] || 0) > 0));

// Janela em trechos de minutos do dia. Janela que passa da meia-noite vira dois trechos.
export function windowSegments(start: string, end: string): [number, number][] {
  const s = toMin(start);
  const e = toMin(end);
  if (s === e) return [[0, 1440]];
  return s < e
    ? [[s, e]]
    : [
        [s, 1440],
        [0, e],
      ];
}

// Eixo da agenda: das 6h às 24h, ou o dia todo se alguma janela começar antes das 6h
export function agendaRange(windows: { start: string; end: string }[]): [number, number] {
  const early = windows.some((w) => windowSegments(w.start, w.end).some(([s]) => s < 360));
  return early ? [0, 1440] : [360, 1440];
}

export const RESULT_LABEL: Record<string, string> = {
  ok: 'Concluída',
  limit: 'Limite do plano',
  stopped: 'Interrompida',
  not_logged: 'Sem login',
  captcha: 'Captcha',
  block: 'Bloqueio',
  error: 'Erro',
  watchdog: 'Travou',
  running: 'Rodando',
};
// Texto do resultado de uma sessão. Sessão da rotina que fez a parte dela do dia (e não o dia todo): "Parte do dia"
export function resultLabel(s: { result: string; completion?: number }) {
  if (s.result === 'ok' && (s.completion ?? 1) < 1) return 'Parte do dia';
  return RESULT_LABEL[s.result] || s.result;
}

export function resultClass(r: string) {
  if (r === 'ok' || r === 'limit') return 'ok';
  if (r === 'stopped') return 'stopped';
  if (r === 'not_logged') return 'login';
  if (r === 'running') return 'running';
  return 'bad';
}

// Por que o piloto automático não abre sessão agora (motivos de rules.decide)
export const SCHEDULE_LABEL: Record<string, string> = {
  'piloto-desligado': 'Piloto automático desligado',
  ferias: 'Modo férias',
  backup: 'Esperando o backup dos logins',
  'fora-da-janela': 'Fora do horário',
  'precisa-atencao': 'Esperando você',
  'proxy-fora': 'Proxy fora do ar',
  'limite-simultaneo': 'Esperando vaga',
  'meta-batida': 'Meta de hoje batida',
  'limite-do-plano': 'Limite de 120% do plano',
  intervalo: 'Descansando entre sessões',
  agendada: 'Próxima sessão agendada',
  espacamento: 'Esperando outra conta começar',
  iniciar: 'Na fila para iniciar',
  rodando: 'Aquecendo',
  'navegador-aberto': 'Navegador aberto',
  'aparelho-desligado': 'Aparelho dono desligado',
  'sem-aparelho': 'Escolha onde ela roda',
};

// Quando a próxima sessão desta conta deve abrir (só se ela ainda tem o que fazer hoje)
export function nextSessionAt(
  a: { schedule: string; nextAfter: number | null; slots?: { at: number }[]; today?: Record<string, number> },
  now: number,
) {
  if (a.schedule === 'iniciar' || a.schedule === 'limite-simultaneo' || a.schedule === 'espacamento') return now;
  if (a.schedule === 'intervalo') return Math.max(now, a.nextAfter || now);
  if (a.schedule === 'agendada') {
    const slot = (a.slots || [])[(a.today && a.today.sessions) || 0];
    return slot ? Math.max(now, slot.at, a.nextAfter || 0) : null;
  }
  return null;
}

// Sessões da rotina de hoje que ainda não aconteceram, com a duração estimada de cada uma (min)
export function upcomingSlots(a: {
  slots?: { at: number; target: number }[];
  today?: Record<string, number>;
  plan: Record<string, number>;
}) {
  const slots = a.slots || [];
  const done = (a.today && a.today.sessions) || 0;
  return slots.slice(done).map((s, i) => {
    const prev = done + i > 0 ? slots[done + i - 1].target : 0;
    return { at: s.at, minutes: Math.max(4, Math.round((a.plan.minutes || 15) * (s.target - prev) * 1.3)) };
  });
}

// Texto de um evento do feed
export function eventText(ev: { kind: string; action?: string; msg?: string; detail?: string }, actions: Record<string, string>) {
  if (ev.kind === 'action') {
    const label = (ev.action && actions[ev.action]) || ev.action || 'Ação';
    return ev.detail ? `${label}: ${ev.detail}` : label;
  }
  return ev.msg || '';
}
export function eventClass(ev: { kind: string; level?: string }) {
  if (ev.kind === 'action') return 'action';
  if (ev.level === 'danger') return 'bad';
  if (ev.level === 'warn') return 'warn';
  return '';
}

// Print "2026-10-07T03-00-19_captcha.jpg" (hora UTC no nome) → { at: ms, tag: 'captcha' }
export function shotInfo(file: string) {
  const at = Date.parse(`${file.slice(0, 10)}T${file.slice(11, 19).replace(/-/g, ':')}Z`);
  return {
    at,
    tag:
      file
        .replace(/\.jpg$/, '')
        .split('_')
        .pop() || '',
  };
}

export const norm = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

// ---------- Acessos ao painel (Ajustes → Acessos) ----------

const ACCESS_LABEL: Record<string, string> = {
  ok: 'Entrou',
  senha: 'Senha errada',
  bloqueado: 'Tentou durante o bloqueio',
  cadastro: 'Conta criada',
  'cadastro-recusado': 'Cadastro recusado',
  sair: 'Saiu',
  'troca-senha': 'Trocou a senha',
  esqueci: 'Pediu link de senha nova',
};
export const accessLabel = (reason: string) => ACCESS_LABEL[reason] || reason;

// "Edge no Windows", "Chrome no Android"... a partir do user-agent
export function deviceOf(ua: string | null | undefined) {
  if (!ua) return 'aparelho desconhecido';
  const browser = /Edg\//.test(ua)
    ? 'Edge'
    : /OPR\//.test(ua)
      ? 'Opera'
      : /Firefox\//.test(ua)
        ? 'Firefox'
        : /Chrome\//.test(ua)
          ? 'Chrome'
          : /Safari\//.test(ua)
            ? 'Safari'
            : 'navegador';
  const os = /Android/.test(ua)
    ? 'Android'
    : /iPhone|iPad/.test(ua)
      ? 'iPhone'
      : /Windows/.test(ua)
        ? 'Windows'
        : /Mac OS X/.test(ua)
          ? 'Mac'
          : /Linux/.test(ua)
            ? 'Linux'
            : '';
  return os ? `${browser} no ${os}` : browser;
}
