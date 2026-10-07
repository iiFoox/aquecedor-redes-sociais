-- A função auxiliar rls_auto_enable() não precisa ficar acessível pela API
revoke execute on function public.rls_auto_enable() from anon, authenticated, public;
