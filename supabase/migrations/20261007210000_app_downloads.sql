-- App 4/5: instaladores e atualizações do aplicativo do Windows.
-- Bucket PÚBLICO "downloads" (o instalador não tem segredo nenhum): o app baixa daqui as versões novas
-- (electron-updater, provedor "generic"). Ninguém grava pela API pública: sem regras de escrita, só a chave de
-- manutenção (npm run publicar) envia arquivos.
insert into storage.buckets (id, name, public)
values ('downloads', 'downloads', true)
on conflict (id) do update set public = true;
