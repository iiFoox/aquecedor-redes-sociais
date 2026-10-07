-- Resumo dos tempos da sessão (pausas e tempo por vídeo): quantos, percentis e histograma.
-- Alimenta o card "Naturalidade" da página da conta.
alter table public.sessions add column if not exists timing jsonb;
