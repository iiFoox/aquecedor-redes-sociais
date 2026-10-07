-- Nome do print de tela tirado no fim da sessão (captcha, bloqueio, erro ou sessão travada).
-- O arquivo fica só no computador, em data/screens/<conta>/.
alter table public.sessions add column if not exists screenshot text;
