// Proteção de dados do Windows (DPAPI): cifra com a conta do Windows de quem está logado neste PC.
// Só esse usuário, neste PC, consegue abrir. Guarda o login do aparelho no Supabase sem texto puro em arquivo.
// (Fora do Windows, ou com WU_DPAPI=off nos testes, não cifra: só para testes.)
const { spawnSync } = require('child_process');

const enabled = () => process.platform === 'win32' && process.env.WU_DPAPI !== 'off';

function run(op, base64) {
  const script = [
    'Add-Type -AssemblyName System.Security',
    '$in = [Console]::In.ReadToEnd().Trim()',
    '$b = [Convert]::FromBase64String($in)',
    `$o = [Security.Cryptography.ProtectedData]::${op}($b, $null, [Security.Cryptography.DataProtectionScope]::CurrentUser)`,
    '[Console]::Out.Write([Convert]::ToBase64String($o))',
  ].join('; ');
  const r = spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script], {
    input: base64,
    encoding: 'utf8',
    windowsHide: true,
    timeout: 20000,
  });
  if (r.status !== 0) throw new Error(`Proteção do Windows falhou: ${(r.stderr || r.error?.message || '').trim().split('\n')[0]}`);
  return r.stdout.trim();
}

// Texto → texto protegido (base64)
function protect(text) {
  const b64 = Buffer.from(text, 'utf8').toString('base64');
  return enabled() ? `dpapi:${run('Protect', b64)}` : `plain:${b64}`;
}

// Texto protegido → texto
function unprotect(data) {
  const [kind, b64] = String(data).split(':');
  if (kind === 'dpapi') return Buffer.from(run('Unprotect', b64), 'base64').toString('utf8');
  if (kind === 'plain') return Buffer.from(b64, 'base64').toString('utf8');
  throw new Error('Formato desconhecido');
}

module.exports = { protect, unprotect, enabled };
