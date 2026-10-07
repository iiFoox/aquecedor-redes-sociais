-- Eventos, alertas e sessões em tabelas próprias (antes ficavam dentro do JSON de cada conta).
-- A cópia original das listas fica em accounts.legacy até você confirmar que está tudo certo.

create table if not exists public.events (
  id bigint generated always as identity primary key,
  account_id text not null references public.accounts (id) on delete cascade,
  t timestamptz not null,
  kind text not null check (kind in ('action', 'log', 'alert')),
  action text,
  level text,
  msg text,
  detail text
);
create index if not exists events_account_t_idx on public.events (account_id, t desc);
create index if not exists events_t_idx on public.events (t desc);

create table if not exists public.alerts (
  id uuid primary key default gen_random_uuid(),
  account_id text not null references public.accounts (id) on delete cascade,
  t timestamptz not null,
  last_t timestamptz not null,
  count integer not null default 1 check (count > 0),
  level text not null check (level in ('info', 'warn', 'danger')),
  kind text not null default 'other' check (kind in ('login', 'captcha', 'block', 'error', 'other')),
  msg text not null,
  resolved_at timestamptz
);
create index if not exists alerts_account_t_idx on public.alerts (account_id, t desc);
create index if not exists alerts_open_idx on public.alerts (account_id) where resolved_at is null;

create table if not exists public.sessions (
  id bigint generated always as identity primary key,
  account_id text not null references public.accounts (id) on delete cascade,
  started_at timestamptz,
  ended_at timestamptz not null,
  day integer,
  phase integer,
  minutes numeric(6, 1) not null default 0,
  stats jsonb not null default '{}'::jsonb,
  plan jsonb,
  completion numeric(5, 4),
  result text not null,
  error text
);
create index if not exists sessions_account_end_idx on public.sessions (account_id, ended_at desc);

-- Só o servidor acessa (chave secreta). A chave pública não lê nem grava nada.
do $$
declare t text;
begin
  foreach t in array array['events', 'alerts', 'sessions'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on public.%I from anon, authenticated', t);
  end loop;
end $$;

-- Cópia de segurança das listas antigas, intacta
alter table public.accounts add column if not exists legacy jsonb;
update public.accounts
set legacy = jsonb_build_object('events', data -> 'events', 'alerts', data -> 'alerts', 'history', data -> 'history', 'copied_at', now())
where legacy is null and (data ? 'events' or data ? 'alerts' or data ? 'history');

-- Eventos
insert into public.events (account_id, t, kind, action, level, msg, detail)
select a.id, to_timestamp((e ->> 't')::double precision / 1000), e ->> 'kind', e ->> 'action', e ->> 'level', e ->> 'msg', nullif(e ->> 'detail', '')
from public.accounts a
cross join lateral jsonb_array_elements(coalesce(a.legacy -> 'events', '[]'::jsonb)) e
where e ->> 'kind' in ('action', 'log', 'alert')
  and not exists (select 1 from public.events x where x.account_id = a.id);

-- Alertas: o mesmo aviso repetido em até 30 min vira um só, com a contagem.
-- Todos os alertas antigos entram como resolvidos (o sistema antigo não tinha "resolver").
with src as (
  select a.id as account_id,
         to_timestamp((x ->> 't')::double precision / 1000) as t,
         coalesce(x ->> 'level', 'warn') as level,
         coalesce(x ->> 'msg', '') as msg
  from public.accounts a
  cross join lateral jsonb_array_elements(coalesce(a.legacy -> 'alerts', '[]'::jsonb)) x
  where not exists (select 1 from public.alerts y where y.account_id = a.id)
),
marked as (
  select *, case when lag(t) over w is null or t - lag(t) over w > interval '30 minutes' then 1 else 0 end as brk
  from src
  window w as (partition by account_id, level, msg order by t)
),
grouped as (
  select *, sum(brk) over (partition by account_id, level, msg order by t) as g
  from marked
)
insert into public.alerts (account_id, t, last_t, count, level, kind, msg, resolved_at)
select account_id, min(t), max(t), count(*)::int,
       case when level in ('info', 'warn', 'danger') then level else 'warn' end,
       case
         when msg ~* 'logad|login|expirou' then 'login'
         when msg ~* 'captcha|verifica|challenge' then 'captcha'
         when msg ~* 'bloque|limitou|restring|tente novamente' then 'block'
         else 'other'
       end,
       msg,
       now()
from grouped
group by account_id, level, msg, g;

-- Sessões
insert into public.sessions (account_id, started_at, ended_at, day, phase, minutes, stats, plan, completion, result, error)
select a.id,
       (h ->> 'date')::timestamptz - make_interval(secs => coalesce((h ->> 'minutes')::double precision, 0) * 60),
       (h ->> 'date')::timestamptz,
       (h ->> 'day')::int,
       (h ->> 'phase')::int,
       coalesce((h ->> 'minutes')::numeric, 0),
       coalesce(h -> 'stats', '{}'::jsonb),
       h -> 'plan',
       (h ->> 'completion')::numeric,
       coalesce(h ->> 'result', 'ok'),
       h ->> 'error'
from public.accounts a
cross join lateral jsonb_array_elements(coalesce(a.legacy -> 'history', '[]'::jsonb)) h
where h ->> 'date' is not null
  and not exists (select 1 from public.sessions s where s.account_id = a.id);

-- O JSON da conta passa a guardar só o essencial (as listas estão nas tabelas e em "legacy")
update public.accounts set data = data - 'events' - 'alerts' - 'history' where legacy is not null;

notify pgrst, 'reload schema';
