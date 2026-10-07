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
  plan: Record<string, number>;
  today: Record<string, number>;
  completion: number;
  dayStatus: 'done' | 'limit' | 'pending';
  attention: { kind: AttentionKind; msg: string; at: number } | null;
  health: { score: number; consistency: number; completion: number; safety: number; label: string; nodata?: boolean };
  sessions: number;
  nextAfter: number | null;
  checklist: Record<string, boolean>;
  days: DayInfo[];
  todaySessions: { start: number; end: number; result: string }[];
  month: { sessions: number; ok: number; grave: number };
  lastScreen: string | null;
  alerts: Alert[];
  loginOpen: boolean;
  browserPurpose: 'login' | 'captcha' | null;
  live: Live | null;
}

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
}

export interface AccountFull extends Account {
  events: Omit<FeedEvent, 'id'>[];
  history: Session[];
  screens: string[];
  proxyUrl: string;
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
  restarts: number;
  autostart: boolean;
  sessions: number;
  pending: number;
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
  constructor(msg: string, motorOff: boolean) {
    super(msg);
    this.motorOff = motorOff;
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
  if (!r.ok) throw new ApiError(data.error || `Erro ${r.status}`, !!data.motorOff);
  return data as T;
}
