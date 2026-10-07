-- Login do painel: dono de cada conta e proxy, sessões do painel e registro de acessos.
-- Usuários ficam no Supabase Auth (auth.users). O servidor do painel usa a chave secreta (ignora o RLS);
-- a chave pública não tem acesso a nada (RLS ligado, sem políticas), como no resto do banco.

-- Dono: cada usuário vê só as próprias contas e proxies. Sem dono = ainda não reivindicado
-- (o primeiro usuário criado pelo "npm run usuario -- criar" fica com as contas que já existiam).
alter table public.accounts add column if not exists owner_id uuid references auth.users (id) on delete restrict;
alter table public.proxies add column if not exists owner_id uuid references auth.users (id) on delete restrict;
create index if not exists accounts_owner_idx on public.accounts (owner_id);
create index if not exists proxies_owner_idx on public.proxies (owner_id);

-- Sessões do painel. id = sha256 do código do cookie (o código em si nunca é gravado).
create table if not exists public.panel_sessions (
  id text primary key check (char_length(id) = 64),
  user_id uuid not null references auth.users (id) on delete cascade,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  last_seen timestamptz not null default now(),
  persistent boolean not null default false,
  ip text,
  user_agent text
);
create index if not exists panel_sessions_user_idx on public.panel_sessions (user_id);
create index if not exists panel_sessions_expires_idx on public.panel_sessions (expires_at);
alter table public.panel_sessions enable row level security;

-- Registro de acessos (Ajustes → Acessos) e base do bloqueio por tentativas
create table if not exists public.login_attempts (
  id bigint generated always as identity primary key,
  t timestamptz not null default now(),
  email text,
  user_id uuid references auth.users (id) on delete set null,
  ip text,
  user_agent text,
  ok boolean not null,
  reason text not null check (reason in ('ok', 'senha', 'bloqueado', 'cadastro', 'cadastro-recusado', 'sair', 'troca-senha'))
);
create index if not exists login_attempts_t_idx on public.login_attempts (t desc);
create index if not exists login_attempts_ip_t_idx on public.login_attempts (ip, t desc);
create index if not exists login_attempts_user_t_idx on public.login_attempts (user_id, t desc);
alter table public.login_attempts enable row level security;
