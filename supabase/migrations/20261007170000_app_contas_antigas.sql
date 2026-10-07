-- App 2/5: o primeiro usuário cadastrado fica com as contas e proxies antigos (sem dono), sem precisar da chave
-- secreta no app. Só funciona para o usuário mais antigo; para os outros não faz nada.
create or replace function public.claim_legacy_accounts() returns integer
language plpgsql security definer set search_path = '' as $$
declare
  me uuid := auth.uid();
  n integer := 0;
begin
  if me is null then
    raise exception 'precisa estar logado';
  end if;
  if me <> (select u.id from auth.users u order by u.created_at, u.id limit 1) then
    return 0;
  end if;
  update public.accounts set owner_id = me where owner_id is null;
  get diagnostics n = row_count;
  update public.proxies set owner_id = me where owner_id is null;
  return n;
end $$;
revoke all on function public.claim_legacy_accounts() from public, anon;
grant execute on function public.claim_legacy_accounts() to authenticated;
