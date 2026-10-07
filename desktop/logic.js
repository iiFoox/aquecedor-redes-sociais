// Regras puras do aplicativo (testadas em tests/desktop.test.js, sem abrir o Electron).

const GRAVE = ['captcha', 'block'];

// Cor e texto do ícone perto do relógio.
// info: o que o motor devolve em /api/_device/tray (null = motor não respondeu).
// verde: tudo certo · amarelo: precisa de você (login, proxy, chave, bateria) · vermelho: captcha/bloqueio · cinza: ligando
function trayState(info) {
  if (!info) return { color: 'cinza', text: 'ligando o motor...' };
  if (info.needsLogin) return { color: 'amarelo', text: 'o login deste aparelho caiu: entre de novo no painel' };
  if (!info.linked) return { color: 'amarelo', text: 'entre no painel para ligar este aparelho' };
  if (!info.ready) return { color: 'cinza', text: 'carregando as contas...' };
  const grave = info.attention.filter((a) => GRAVE.includes(a.kind));
  if (grave.length) return { color: 'vermelho', text: `${grave.length} conta(s) com captcha ou bloqueio` };
  if (info.attention.length) return { color: 'amarelo', text: `${info.attention.length} conta(s) precisam de você` };
  if (info.vault === 'trancada') return { color: 'amarelo', text: 'logins na nuvem trancados (veja Ajustes)' };
  if (info.power === 'bateria') return { color: 'amarelo', text: 'bateria fraca: sem sessão nova até a tomada' };
  if (info.running) return { color: 'verde', text: `aquecendo ${info.running} conta(s)` };
  if (!info.accounts) return { color: 'verde', text: 'ligado, sem contas neste aparelho' };
  return { color: 'verde', text: info.pilot ? 'piloto automático ligado' : 'ligado (piloto automático desligado)' };
}

// Dá para atualizar sozinho agora, sem perguntar? Só com a janela fechada e nada aberto (sessão ou navegador).
function idleForUpdate(info, windowVisible) {
  return !!info && !windowVisible && info.running === 0 && !info.browsers;
}

// Abriu depois de uma atualização? pending = o que foi gravado antes de instalar ({ from, to, at, attempts }).
// 'ok' (já está na versão nova) · 'tentar' (continua na antiga: tenta de novo) · 'desistir' (3 tentativas) ·
// 'ignorar' (aviso velho demais, de mais de 2 dias)
const MAX_UPDATE_TRIES = 3;
function pendingUpdate(pending, version, now = Date.now()) {
  if (!pending || !pending.to) return null;
  if (now - (pending.at || 0) > 2 * 86400000) return 'ignorar';
  if (!newer(pending.to, version)) return 'ok'; // versão atual >= a esperada
  return (pending.attempts || 1) >= MAX_UPDATE_TRIES ? 'desistir' : 'tentar';
}

// Versão a é mais nova que b? ("2.1.0" > "2.0.9"; partes que faltam contam como 0)
function newer(a, b) {
  const pa = String(a)
    .split('.')
    .map((x) => parseInt(x, 10) || 0);
  const pb = String(b)
    .split('.')
    .map((x) => parseInt(x, 10) || 0);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    if ((pa[i] || 0) !== (pb[i] || 0)) return (pa[i] || 0) > (pb[i] || 0);
  }
  return false;
}

// Corta um tamanho em partes de até max bytes: [[início, fim), ...]
function chunks(size, max) {
  const out = [];
  for (let s = 0; s < size; s += max) out.push([s, Math.min(size, s + max)]);
  return out;
}

module.exports = { trayState, newer, chunks, idleForUpdate, pendingUpdate, MAX_UPDATE_TRIES };
