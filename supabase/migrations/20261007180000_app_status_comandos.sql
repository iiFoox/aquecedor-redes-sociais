-- App 2/5: o que o robô está fazendo agora em cada conta (para os outros aparelhos verem) e mais tipos de comando
-- (mudar a conta e apagá-la, executados pelo aparelho dono dela).
alter table public.accounts add column if not exists status jsonb;
alter table public.commands drop constraint if exists commands_kind_check;
alter table public.commands add constraint commands_kind_check check (
  kind in ('start', 'stop', 'login', 'captcha', 'close-browser', 'release', 'pause-all', 'resume-all', 'move-out', 'patch', 'remove')
);
