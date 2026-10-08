// WebRTC com proxy: sem isso o Edge revela o IP real da sua internet (candidato "srflx" do STUN, que não passa
// pelo proxy). A opção de linha de comando não vale no Edge; a preferência do perfil vale (conferido em 2026-10-07):
// "disable_non_proxied_udp" = o WebRTC só sai pelo proxy. É a mesma preferência que as extensões de privacidade mudam.
const fs = require('fs');
const path = require('path');

const POLICY = 'disable_non_proxied_udp';

/**
 * Liga (conta com proxy) ou desliga (sem proxy) a proteção no perfil da conta. Roda com o navegador fechado:
 * o Edge lê o arquivo ao abrir. Devolve true se mudou algo.
 */
function guardWebrtc(profileDir, on) {
  const file = path.join(profileDir, 'Default', 'Preferences');
  let prefs = {};
  try {
    prefs = JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (e) {
    if (e.code !== 'ENOENT') return false; // arquivo estranho: não mexe (o Edge recria o dele)
    if (!on) return false;
  }
  const cur = prefs.webrtc && prefs.webrtc.ip_handling_policy;
  if (on ? cur === POLICY : cur !== POLICY) return false;
  prefs.webrtc = { ...(prefs.webrtc || {}) };
  if (on) prefs.webrtc.ip_handling_policy = POLICY;
  else delete prefs.webrtc.ip_handling_policy;
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(prefs));
  return true;
}

module.exports = { guardWebrtc, POLICY };
