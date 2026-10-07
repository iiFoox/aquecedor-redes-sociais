-- WarmUp Studio: setup do Supabase
-- Cole TUDO no Supabase > SQL Editor > New query > Run. Pode rodar mais de uma vez sem problema.

create table if not exists public.accounts (id text primary key);
create table if not exists public.proxies  (id text primary key);
create table if not exists public.config   (id text primary key, data jsonb);

-- Colunas fixas usadas pelo app
alter table public.accounts add column if not exists platform text;
alter table public.accounts add column if not exists username text;
alter table public.proxies  add column if not exists url      text;
alter table public.proxies  add column if not exists status   text;
alter table public.proxies  add column if not exists ms       integer;

-- Todo o resto (metas do dia, histórico, eventos, alertas, user-agent, viewport...)
-- vai numa coluna JSON só. Assim o app nunca mais quebra por "coluna faltando".
alter table public.accounts add column if not exists data jsonb not null default '{}'::jsonb;
alter table public.proxies  add column if not exists data jsonb not null default '{}'::jsonb;

-- Colunas antigas (interests, history, proxy, lastCheck...) não são mais gravadas.
-- Se alguma for NOT NULL sem default, o insert falharia: libera todas.
do $$
declare r record;
begin
  for r in
    select table_name, column_name from information_schema.columns
    where table_schema = 'public' and table_name in ('accounts', 'proxies')
      and is_nullable = 'NO' and column_name not in ('id', 'data')
  loop
    execute format('alter table public.%I alter column %I drop not null', r.table_name, r.column_name);
  end loop;
end $$;

-- Se o RLS estiver ligado, a chave do app (anon) precisa poder ler, gravar e apagar
do $$
declare t text;
begin
  foreach t in array array['accounts', 'proxies', 'config'] loop
    execute format('drop policy if exists "app_all" on public.%I', t);
    execute format('create policy "app_all" on public.%I for all to anon using (true) with check (true)', t);
  end loop;
end $$;

-- Faz a API do Supabase enxergar as colunas novas na hora
notify pgrst, 'reload schema';
