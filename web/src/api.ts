// Tipos do que o motor devolve (motor/api) e a função que fala com ele.

export type Platform = 'tiktok' | 'instagram';
export type AttentionKind = 'login' | 'captcha' | 'block';

export interface Phase {
  n: number;
  name: string;
  from: number;
  to: number;
  desc: string;
}

export interface Alert {
  t: number;
  lastT: number;
  count: number;
  level: 'info' | 'warn' | 'danger';
  kind: string;
  msg: string;
  resolved: boolean;
}

export interface DayInfo {
  date: string;
  completion: number | null;
  sessions: number;
  minutes: number;
  vacation: boolean;
}

export interface Live {
  status: string;
  statusUntil: number | null;
  statusAt: number;
  stats: Record<string, number>;
  startedAt: number;
  endsAt: number;
}

export interface Account {
  id: string;
  platform: Platform;
  username: string;
  interests: string[];
  proxy: boolean;
  proxyHost: string | null;
  proxyStatus: 'online' | 'offline' | 'unknown' | null;
  window: { start: string; end: string } | null;
  schedule: string;
  startedAt: string;
  day: number;
  phase: Phase;
  // Meta da conta: recomendada (goal null) ou um modelo personalizado; fases e dia de pronta seguem a meta
  goal: { id: string; name: string } | null;
  goalRamp: string | null; // em transição para a meta nova desde esta data
  readyDay: number;
  phases: Phase[];
  plan: Record<string, number>;
  today: Record<string, number>;
  completion: number;
  dayStatus: 'done' | 'limit' | 'pending';
  attention: { kind: AttentionKind; msg: string; at: number } | null;
  health: { score: number; consistency: number; completion: number; safety: number; label: string; nodata?: boolean };
  sessions: number;
  nextAfter: number | null;
  slots: { at: number; target: number }[]; // rotina de hoje
  checklist: Record<string, boolean>;
  days: DayInfo[];
  todaySessions: { start: number; end: number; result: string }[];
  month: { sessions: number; ok: number; grave: number };
  lastScreen: string | null;
  loginSavedAt: number | null; // último login guardado no Supabase (cifrado)
  alerts: Alert[];
  loginOpen: boolean;
  browserPurpose: 'login' | 'captcha' | null;
  live: Live | null;
  mine: boolean; // roda neste aparelho
  deviceId: string | null;
  deviceName: string | null;
  deviceOnline: boolean;
}

// Aparelhos do usuário (cada um roda as próprias contas)
export interface Device {
  id: string;
  name: string;
  lastSeen: number;
  online: boolean;
  appVersion: string | null;
  current: boolean;
}
export interface DeviceInfo {
  linked: boolean;
  ready: boolean;
  mine: boolean;
  email: string | null;
  device: { id: string; name: string; named: boolean } | null;
  vault: VaultStatus | null;
}
// Chave dos logins das contas neste aparelho
export type VaultStatus = 'ok' | 'trancada' | 'off';

export interface FeedEvent {
  t: number;
  kind: 'action' | 'log' | 'alert';
  action?: string;
  level?: string;
  msg?: string;
  detail?: string;
  id: string;
  username?: string;
  platform?: Platform;
}

export interface Session {
  date: string;
  startedAt?: string;
  day: number;
  phase: number;
  minutes: number;
  stats: Record<string, number>;
  completion: number;
  result: string;
  error?: string;
  screenshot?: string;
  timing?: Record<string, Timing>;
}

// Resumo dos tempos de uma sessão (human.timingSummary)
export interface Timing {
  n: number;
  p10: number;
  p50: number;
  p90: number;
  p99: number;
  max: number;
  edges: number[];
  hist: number[];
}

export interface Persona {
  readSpeed: number;
  pace: number;
  patience: number;
  likeBias: number;
  typingCps: number;
  distraction: number;
  peak: number;
  spread: number;
  scroll: { step: number; flick: number; overshoot: number };
  doubleTap?: number;
}

export interface AccountFull extends Account {
  events: Omit<FeedEvent, 'id'>[];
  history: Session[];
  screens: string[];
  proxyUrl: string;
  persona: Persona | null;
}

// Modelo de meta personalizada (aba "Metas personalizadas")
export interface GoalTemplate {
  id: string;
  name: string;
  platform: Platform;
  readyDay: number;
  vary: boolean;
  phases: Record<string, number>[];
  updatedAt?: string;
}

export interface Meta {
  phases: Phase[];
  readyDay: number;
  checklist: { key: string; label: string }[];
  platforms: Record<Platform, { name: string; actions: Record<string, string>; plans: Record<string, number>[] }>;
}

export interface Config {
  active: boolean;
  start: string;
  end: string;
  max: number;
  headless: boolean;
  muteAudio: boolean;
  pausedUntil: number | null;
  pausedFrom: number | null;
  lastBackup: { at?: number; file?: string; sizeMB?: number; error?: string | null } | null;
}

export interface Proxy {
  id: string;
  url: string;
  status: 'online' | 'offline' | 'unknown';
  ms: number;
  ip?: string | null;
  // País e fuso do IP de saída: o navegador das contas com este proxy usa esse fuso
  country?: string;
  timezone?: string;
  error?: string | null;
  lastCheck: number | null;
  accounts: { id: string; username: string; platform: Platform }[];
}

export interface BackupStatus {
  running: boolean;
  due: boolean;
  at: string;
  keep: number;
  dir: string;
  last: Config['lastBackup'];
  files: { file: string; sizeMB: number }[];
}

export interface SystemInfo {
  version: string;
  uptime: number;
  pm2: boolean;
  app: boolean; // aberto pelo aplicativo do Windows
  channel?: 'teste' | 'estavel'; // canal de atualização deste aparelho
  restarts: number;
  autostart: boolean;
  sessions: number;
  pending: number;
  onHours?: boolean[] | null; // horas (0..23) em que este PC costuma ficar ligado; null = ainda aprendendo
}

// Evento do tempo real (/api/stream)
export interface StreamEvent {
  t: number;
  type: string;
  id?: string;
  [k: string]: unknown;
}

export class ApiError extends Error {
  motorOff: boolean;
  needsDevice: boolean; // o motor está ligado, mas o aparelho está sem login (entrar de novo religa)
  constructor(msg: string, motorOff: boolean, needsDevice = false) {
    super(msg);
    this.motorOff = motorOff;
    this.needsDevice = needsDevice;
  }
}

export async function api<T = unknown>(url: string, method = 'GET', body?: unknown): Promise<T> {
  let r: Response;
  try {
    r = await fetch(url, {
      method,
      headers: body === undefined ? undefined : { 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch {
    throw new ApiError('O painel está fora do ar', true);
  }
  const data = await r.json().catch(() => ({}));
  // Sessão do painel venceu: volta para o login sem perder a página (o #conta/... segue no endereço)
  if (r.status === 401 && data.auth === false) {
    expired();
    throw new ApiError(data.error || 'Sessão expirada', false);
  }
  if (!r.ok) throw new ApiError(data.error || `Erro ${r.status}`, !!data.motorOff, !!data.needsDevice);
  return data as T;
}

let leaving = false;
// why: 'religar' = o login do aparelho caiu (a tela de login explica); senão, sessão do painel vencida
export function expired(why: 'sessao' | 'religar' = 'sessao') {
  if (leaving) return;
  leaving = true;
  try {
    sessionStorage.setItem('wu-expired', why);
  } catch {
    /* sem armazenamento: só não mostra o aviso */
  }
  location.replace('/login' + location.hash);
}

// ---------- Login do painel ----------
export interface Me {
  id: string;
  email: string;
  signup: boolean; // cadastro liberado neste PC
  persistent: boolean; // entrou com "Manter conectado"
}
export interface Access {
  t: number;
  ip: string | null;
  userAgent: string | null;
  ok: boolean;
  reason: 'ok' | 'senha' | 'bloqueado' | 'cadastro' | 'cadastro-recusado' | 'sair' | 'troca-senha';
}
