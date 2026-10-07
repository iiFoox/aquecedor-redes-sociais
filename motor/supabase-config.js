// Projeto do Supabase do app. O endereço e a chave PÚBLICA podem ficar à vista (vão até no instalador):
// quem protege os dados são as regras por dono no banco. A chave secreta nunca entra no app.
module.exports = {
  SUPABASE_URL: process.env.SUPABASE_URL || 'https://cuuuudyjqjyeqvvfqtkl.supabase.co',
  SUPABASE_PUBLISHABLE_KEY: process.env.SUPABASE_PUBLISHABLE_KEY || 'sb_publishable_9GzY4AOTk22ux1x-llGOlw_x1PUGhBA',
};
