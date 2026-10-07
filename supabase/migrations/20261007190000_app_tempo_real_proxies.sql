-- App 2/5: proxies também no tempo real (o canal de dados do motor escuta contas, eventos, alertas, sessões e proxies;
-- com uma tabela fora da publicação, o canal inteiro falha).
do $$
begin
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'proxies') then
    alter publication supabase_realtime add table public.proxies;
  end if;
end $$;
