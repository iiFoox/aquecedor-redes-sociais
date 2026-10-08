// Teste de proxy sem abrir o navegador: conecta pelo proxy (HTTP CONNECT ou SOCKS5)
// e pergunta o IP de saída para api.ipify.org. Leve o bastante para rodar a cada 30 min.
const net = require('net');
const tls = require('tls');

const TARGET = { host: 'api.ipify.org', port: 443, tls: true, path: '/?format=json' };
const TIMEOUT_MS = 15000;

// Lê do socket aos poucos: until('\r\n\r\n') para cabeçalhos, take(n) para bytes do SOCKS
function reader(sock) {
  let buf = Buffer.alloc(0);
  let wake = null;
  let failed = null;
  sock.on('data', (d) => {
    buf = Buffer.concat([buf, d]);
    if (wake) wake();
  });
  const fail = (e) => {
    failed = e;
    if (wake) wake();
  };
  sock.on('error', fail);
  sock.on('close', () => fail(new Error('O proxy fechou a conexão')));
  const wait = async (ready) => {
    while (!ready()) {
      if (failed) throw failed;
      await new Promise((r) => (wake = r));
      wake = null;
    }
  };
  return {
    async take(n) {
      await wait(() => buf.length >= n);
      const out = buf.subarray(0, n);
      buf = buf.subarray(n);
      return out;
    },
    async until(sep) {
      await wait(() => buf.includes(sep));
      const i = buf.indexOf(sep) + sep.length;
      const out = buf.subarray(0, i).toString();
      buf = buf.subarray(i);
      return out;
    },
    detach() {
      sock.removeAllListeners('data');
      sock.removeAllListeners('close');
      sock.removeListener('error', fail);
    },
  };
}

function open(host, port, secure) {
  return new Promise((resolve, reject) => {
    const sock = secure ? tls.connect({ host, port, servername: host }) : net.connect({ host, port });
    sock.once(secure ? 'secureConnect' : 'connect', () => resolve(sock));
    sock.once('error', reject);
  });
}

async function viaHttp(u, target) {
  const sock = await open(u.hostname, Number(u.port), u.protocol === 'https:');
  const r = reader(sock);
  const auth = u.username
    ? `Proxy-Authorization: Basic ${Buffer.from(`${decodeURIComponent(u.username)}:${decodeURIComponent(u.password)}`).toString('base64')}\r\n`
    : '';
  sock.write(`CONNECT ${target.host}:${target.port} HTTP/1.1\r\nHost: ${target.host}:${target.port}\r\n${auth}\r\n`);
  const head = await r.until('\r\n\r\n');
  const code = Number((head.match(/^HTTP\/\d\.\d (\d{3})/) || [])[1]);
  r.detach();
  if (code === 407) throw new Error('Usuário ou senha do proxy recusados');
  if (code !== 200) throw new Error(`O proxy respondeu ${code || 'algo inválido'}`);
  return sock;
}

async function viaSocks5(u, target) {
  const sock = await open(u.hostname, Number(u.port), false);
  const r = reader(sock);
  const user = decodeURIComponent(u.username || '');
  const pass = decodeURIComponent(u.password || '');
  sock.write(Buffer.from(user ? [5, 2, 0, 2] : [5, 1, 0]));
  const [ver, method] = await r.take(2);
  if (ver !== 5) throw new Error('Não é um proxy SOCKS5');
  if (method === 2) {
    sock.write(Buffer.concat([Buffer.from([1, user.length]), Buffer.from(user), Buffer.from([pass.length]), Buffer.from(pass)]));
    const [, ok] = await r.take(2);
    if (ok !== 0) throw new Error('Usuário ou senha do proxy recusados');
  } else if (method !== 0) throw new Error('O proxy SOCKS5 pede um login que não está no endereço');
  const host = Buffer.from(target.host);
  sock.write(Buffer.concat([Buffer.from([5, 1, 0, 3, host.length]), host, Buffer.from([target.port >> 8, target.port & 255])]));
  const [, rep, , atyp] = await r.take(4);
  if (rep !== 0) throw new Error(`O proxy SOCKS5 recusou a conexão (código ${rep})`);
  await r.take(atyp === 1 ? 6 : atyp === 4 ? 18 : (await r.take(1))[0] + 2);
  r.detach();
  return sock;
}

// GET simples pelo túnel e lê o IP do JSON
async function askIp(sock, target) {
  const s = target.tls ? tls.connect({ socket: sock, servername: target.host }) : sock;
  if (target.tls) await new Promise((res, rej) => s.once('secureConnect', res).once('error', rej));
  const r = reader(s);
  s.write(`GET ${target.path} HTTP/1.1\r\nHost: ${target.host}\r\nConnection: close\r\nUser-Agent: warmup-check\r\n\r\n`);
  const head = await r.until('\r\n\r\n');
  if (!/^HTTP\/\d\.\d 200/.test(head)) throw new Error('O teste de IP não respondeu pelo proxy');
  const body = await r.until('}');
  s.destroy();
  return JSON.parse(body.slice(body.indexOf('{'))).ip;
}

/**
 * Testa um proxy. Devolve { ok, ms, ip } ou { ok: false, ms: 0, error }.
 * target só muda nos testes (servidor local, sem internet).
 */
async function checkProxy(url, { target = TARGET, timeout = TIMEOUT_MS } = {}) {
  const start = Date.now();
  let sock;
  let timer;
  try {
    const u = new URL(url);
    if (!u.port) throw new Error('Falta a porta no endereço do proxy');
    const work = (async () => {
      sock = u.protocol === 'socks5:' ? await viaSocks5(u, target) : await viaHttp(u, target);
      return askIp(sock, target);
    })();
    work.catch(() => {}); // se o tempo acabar antes, o erro tardio não vira "erro não tratado"
    const ip = await Promise.race([
      work,
      new Promise((_, rej) => (timer = setTimeout(() => rej(new Error(`Sem resposta em ${timeout / 1000} s`)), timeout))),
    ]);
    return { ok: true, ms: Date.now() - start, ip };
  } catch (e) {
    return { ok: false, ms: 0, error: e.code === 'ECONNREFUSED' ? 'Conexão recusada pelo proxy' : e.message };
  } finally {
    clearTimeout(timer);
    if (sock) sock.destroy();
  }
}

// País e fuso de um IP (o de saída do proxy). Pergunta direto, sem o proxy: é só uma consulta pelo número.
// Dois serviços gratuitos, um de reserva. null = não deu para saber agora.
const PLACES = [
  async (ip, get) => {
    const j = await get(`https://ipwho.is/${ip}`);
    return j && j.success ? { country: j.country_code, timezone: j.timezone && j.timezone.id } : null;
  },
  async (ip, get) => {
    const j = await get(`http://ip-api.com/json/${ip}?fields=status,countryCode,timezone`);
    return j && j.status === 'success' ? { country: j.countryCode, timezone: j.timezone } : null;
  },
];
const validZone = (tz) => {
  try {
    new Intl.DateTimeFormat('en', { timeZone: tz });
    return true;
  } catch {
    return false;
  }
};
async function getJson(url) {
  const r = await fetch(url, { signal: AbortSignal.timeout(8000) });
  return r.ok ? r.json() : null;
}
async function placeOf(ip, { get = getJson } = {}) {
  for (const ask of PLACES) {
    const p = await ask(ip, get).catch(() => null);
    if (p && typeof p.timezone === 'string' && validZone(p.timezone))
      return { country: String(p.country || '').toUpperCase(), timezone: p.timezone };
  }
  return null;
}

/**
 * O que gravar no proxy depois de um teste: situação, tempo, IP de saída e, quando o IP é novo
 * (ou o fuso ainda não é conhecido), o país e o fuso dele: o navegador da conta usa esse fuso.
 */
async function proxyUpdate(p, r, { place = placeOf } = {}) {
  const up = { status: r.ok ? 'online' : 'offline', ms: r.ms, ip: r.ip || p.ip || null, error: r.error || null, lastCheck: Date.now() };
  if (r.ok && r.ip && (r.ip !== p.ip || !p.timezone)) {
    const where = await place(r.ip);
    if (where) Object.assign(up, where);
  }
  return up;
}

module.exports = { checkProxy, placeOf, proxyUpdate };
