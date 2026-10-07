-- Só o servidor acessa o banco, com a chave secreta (service_role ignora o RLS).
-- RLS ligado e sem permissão para anon/authenticated: a chave pública não lê nem grava nada.
do $$
declare t text;
begin
  foreach t in array array['accounts', 'proxies', 'config'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('drop policy if exists "app_all" on public.%I', t);
    execute format('revoke all on public.%I from anon, authenticated', t);
  end loop;
end $$;
notify pgrst, 'reload schema';
