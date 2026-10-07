-- Fecha accounts, config e proxies para a chave pública. As regras "Allow All" deixavam qualquer um com a
-- chave pública ler e alterar as contas, a configuração e os proxies (com as senhas deles), e anulavam a
-- separação por usuário. O motor e o painel usam a chave secreta (ignora o RLS): nada muda para eles.
drop policy if exists "Allow All Accounts" on public.accounts;
drop policy if exists "Allow All Config" on public.config;
drop policy if exists "Allow All Proxies" on public.proxies;
