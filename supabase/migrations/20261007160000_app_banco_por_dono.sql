-- App 1/5: banco por dono. O app fala com o Supabase com a chave pública + o usuário logado (Supabase Auth);
-- as regras (RLS) deixam cada usuário ler e mudar só o que é dele. A chave secreta não vai para o app.
--
-- Antes: as tabelas estavam fechadas à chave pública (sem permissão de tabela), e as regras "Allow All" não tinham
-- efeito. Agora o usuário logado (authenticated) ganha permissão nas tabelas, então as "Allow All" saem (senão qualquer
-- usuário logado veria tudo) e entram regras por dono. Quem não está logado (anon) continua sem acesso a nada.

-- ---------- Regras antigas ----------
-- (ficam só para a chave secreta: o mesmo efeito de apagar, sem comando destrutivo)
alter policy "Allow All Accounts" on public.accounts to service_role;
alter policy "Allow All Config" on public.config to service_role;
alter policy "Allow All Proxies" on public.proxies to service_role;

-- Login do painel antigo (servidor): só a chave secreta mexe
revoke all on public.panel_sessions, public.login_attempts from anon, authenticated;

-- ---------- Aparelhos ----------
create table if not exists public.devices (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  name text not null check (char_length(name) between 1 and 60),
  config jsonb not null default '{}'::jsonb, -- janela de horário e limite de sessões deste aparelho
  app_version text,
  created_at timestamptz not null default now(),
  last_seen timestamptz not null default now()
);
create index if not exists devices_owner_idx on public.devices (owner_id);

-- ---------- Contas: aparelho dono e trava ----------
alter table public.accounts add column if not exists device_id uuid references public.devices (id) on delete set null;
alter table public.accounts add column if not exists lease_device uuid references public.devices (id) on delete set null;
alter table public.accounts add column if not exists lease_until timestamptz;
create index if not exists accounts_device_idx on public.accounts (device_id);
alter table public.accounts alter column owner_id set default auth.uid();
alter table public.proxies alter column owner_id set default auth.uid();

-- ---------- Eventos, alertas e sessões: dono direto na linha (regra simples e rápida) ----------
alter table public.events add column if not exists owner_id uuid references auth.users (id) on delete cascade;
alter table public.alerts add column if not exists owner_id uuid references auth.users (id) on delete cascade;
alter table public.sessions add column if not exists owner_id uuid references auth.users (id) on delete cascade;
create index if not exists events_owner_t_idx on public.events (owner_id, t desc);
create index if not exists alerts_owner_idx on public.alerts (owner_id);
create index if not exists sessions_owner_idx on public.sessions (owner_id);

-- Linha nova sem dono: herda o dono da conta (o motor de agora grava sem dono; o app novo, com o próprio usuário)
create or replace function public.inherit_account_owner() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.owner_id is null then
    select a.owner_id into new.owner_id from public.accounts a where a.id = new.account_id;
  end if;
  return new;
end $$;
revoke all on function public.inherit_account_owner() from public, anon, authenticated;
create trigger events_owner before insert on public.events for each row execute function public.inherit_account_owner();
create trigger alerts_owner before insert on public.alerts for each row execute function public.inherit_account_owner();
create trigger sessions_owner before insert on public.sessions for each row execute function public.inherit_account_owner();

-- Conta ganhou dono (passar as contas antigas para o usuário): eventos, alertas e sessões dela vão junto
create or replace function public.cascade_account_owner() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.owner_id is distinct from old.owner_id then
    update public.events set owner_id = new.owner_id where account_id = new.id;
    update public.alerts set owner_id = new.owner_id where account_id = new.id;
    update public.sessions set owner_id = new.owner_id where account_id = new.id;
  end if;
  return new;
end $$;
revoke all on function public.cascade_account_owner() from public, anon, authenticated;
create trigger accounts_owner_cascade after update of owner_id on public.accounts
  for each row execute function public.cascade_account_owner();

-- ---------- Comandos (de qualquer aparelho para o aparelho dono da conta) ----------
create table if not exists public.commands (
  id bigint generated always as identity primary key,
  owner_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  device_id uuid not null references public.devices (id) on delete cascade,
  account_id text references public.accounts (id) on delete cascade,
  kind text not null check (kind in ('start', 'stop', 'login', 'captcha', 'close-browser', 'release', 'pause-all', 'resume-all', 'move-out')),
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  taken_at timestamptz,
  done_at timestamptz,
  error text
);
create index if not exists commands_device_pending_idx on public.commands (device_id, created_at) where done_at is null;

-- ---------- Logins das contas (cifrados no aparelho com AES-256; o banco só vê embaralhado) ----------
create table if not exists public.account_logins (
  account_id text primary key references public.accounts (id) on delete cascade,
  owner_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  cipher text not null, -- base64(iv | tag | dados cifrados)
  key_version int not null default 1,
  device_id uuid references public.devices (id) on delete set null,
  updated_at timestamptz not null default now()
);

-- Chave dos logins de cada usuário, trancada pela senha dele (derivação scrypt no aparelho)
create table if not exists public.user_keys (
  owner_id uuid primary key default auth.uid() references auth.users (id) on delete cascade,
  wrapped_key text not null, -- base64(iv | tag | chave cifrada)
  salt text not null,
  kdf jsonb not null default '{"name":"scrypt","N":32768,"r":8,"p":1}'::jsonb,
  key_version int not null default 1,
  updated_at timestamptz not null default now()
);

-- ---------- Configuração de cada usuário ----------
create table if not exists public.user_config (
  owner_id uuid primary key default auth.uid() references auth.users (id) on delete cascade,
  data jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

-- ---------- Regras por dono (só usuário logado; cada um vê e muda só o que é dele) ----------
do $$
declare t text;
begin
  foreach t in array array['accounts', 'proxies', 'events', 'alerts', 'sessions', 'devices', 'commands', 'account_logins', 'user_keys', 'user_config']
  loop
    execute format('alter table public.%I enable row level security', t);
    execute format(
      'create policy "dono" on public.%I for all to authenticated using (owner_id = (select auth.uid())) with check (owner_id = (select auth.uid()))',
      t);
    execute format('grant select, insert, update, delete on public.%I to authenticated', t);
    execute format('revoke all on public.%I from anon', t);
  end loop;
end $$;

-- Ids automáticos de eventos, sessões e comandos
grant usage on sequence public.events_id_seq, public.sessions_id_seq, public.commands_id_seq to authenticated;

-- Conta, comando e login sempre apontam para um aparelho do mesmo dono (não dá para jogar nada no aparelho de outro)
create or replace function public.same_owner_device() returns trigger
language plpgsql security definer set search_path = '' as $$
declare d uuid;
begin
  d := new.device_id;
  if d is not null and not exists (select 1 from public.devices x where x.id = d and x.owner_id = new.owner_id) then
    raise exception 'aparelho de outro usuário';
  end if;
  if tg_table_name = 'accounts' then
    if new.lease_device is not null
       and not exists (select 1 from public.devices x where x.id = new.lease_device and x.owner_id = new.owner_id) then
      raise exception 'aparelho de outro usuário';
    end if;
  end if;
  return new;
end $$;
revoke all on function public.same_owner_device() from public, anon, authenticated;
create trigger accounts_same_owner before insert or update on public.accounts for each row execute function public.same_owner_device();
create trigger commands_same_owner before insert or update on public.commands for each row execute function public.same_owner_device();
create trigger logins_same_owner before insert or update on public.account_logins for each row execute function public.same_owner_device();

-- Comando e login cifrado só de conta do próprio dono
create or replace function public.same_owner_account() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.account_id is not null and not exists (select 1 from public.accounts a where a.id = new.account_id and a.owner_id is not distinct from new.owner_id) then
    raise exception 'conta de outro usuário';
  end if;
  return new;
end $$;
revoke all on function public.same_owner_account() from public, anon, authenticated;
create trigger commands_same_account before insert or update on public.commands for each row execute function public.same_owner_account();
create trigger logins_same_account before insert or update on public.account_logins for each row execute function public.same_owner_account();
create trigger events_same_account before insert or update on public.events for each row execute function public.same_owner_account();
create trigger alerts_same_account before insert or update on public.alerts for each row execute function public.same_owner_account();
create trigger sessions_same_account before insert or update on public.sessions for each row execute function public.same_owner_account();

-- Tempo real (Supabase Realtime) das tabelas que o painel acompanha; respeita as regras por dono
do $$
declare t text;
begin
  foreach t in array array['accounts', 'events', 'alerts', 'sessions', 'devices', 'commands']
  loop
    if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = t) then
      execute format('alter publication supabase_realtime add table public.%I', t);
    end if;
  end loop;
end $$;
