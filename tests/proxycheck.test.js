// Teste de proxy sem navegador, contra proxies falsos locais (sem internet).
const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('http');
const net = require('net');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { checkProxy, placeOf, proxyUpdate } = require('../motor/proxycheck');
const { guardWebrtc } = require('../motor/webrtc');
const { schemas } = require('../motor/validate');

// Sobe o servidor numa porta livre e guarda as conexões para fechar tudo no fim do teste
const open = new Set();
const listen = (srv) => {
  srv.on('connection', (s) => {
    open.add(s);
    s.on('close', () => open.delete(s));
  });
  return new Promise((r) => srv.listen(0, '127.0.0.1', () => r(srv.address().port)));
};
test.afterEach(() => open.forEach((s) => s.destroy()));

// "Site" que devolve o IP, no lugar do api.ipify.org
async function ipSite() {
  const srv = http.createServer((_, res) => res.end('{"ip":"203.0.113.7"}'));
  return { srv, port: await listen(srv) };
}

// Proxy HTTP com CONNECT e senha
async function httpProxy(user, pass) {
  const srv = http.createServer();
  srv.on('connect', (req, client) => {
    const expected = `Basic ${Buffer.from(`${user}:${pass}`).toString('base64')}`;
    if (req.headers['proxy-authorization'] !== expected) {
      client.end('HTTP/1.1 407 Proxy Authentication Required\r\n\r\n');
      return;
    }
    const [host, port] = req.url.split(':');
    const up = net.connect(Number(port), host, () => {
      client.write('HTTP/1.1 200 Connection Established\r\n\r\n');
      up.pipe(client).pipe(up);
    });
    up.on('error', () => client.destroy());
  });
  return { srv, port: await listen(srv) };
}

// Proxy SOCKS5 com usuário e senha (RFC 1928 / 1929)
async function socksProxy(user, pass) {
  const srv = net.createServer((c) => {
    let stage = 0;
    let buf = Buffer.alloc(0);
    c.on('data', (d) => {
      buf = Buffer.concat([buf, d]);
      if (stage === 0 && buf.length >= 2 + buf[1]) {
        buf = buf.subarray(2 + buf[1]);
        c.write(Buffer.from([5, 2]));
        stage = 1;
      }
      if (stage === 1 && buf.length >= 2 && buf.length >= 3 + buf[1] + buf[2 + buf[1]]) {
        const ulen = buf[1];
        const u = buf.subarray(2, 2 + ulen).toString();
        const plen = buf[2 + ulen];
        const p = buf.subarray(3 + ulen, 3 + ulen + plen).toString();
        buf = buf.subarray(3 + ulen + plen);
        const ok = u === user && p === pass;
        c.write(Buffer.from([1, ok ? 0 : 1]));
        if (!ok) return c.end();
        stage = 2;
      }
      if (stage === 2 && buf.length >= 5 && buf.length >= 7 + buf[4]) {
        const host = buf.subarray(5, 5 + buf[4]).toString();
        const port = buf.readUInt16BE(5 + buf[4]);
        stage = 3;
        c.removeAllListeners('data');
        const up = net.connect(port, host, () => {
          c.write(Buffer.from([5, 0, 0, 1, 127, 0, 0, 1, 0, 0]));
          up.pipe(c).pipe(up);
        });
        up.on('error', () => c.destroy());
      }
    });
  });
  return { srv, port: await listen(srv) };
}

test('proxy HTTP com senha: responde online, com o IP de saída e o tempo', async () => {
  const site = await ipSite();
  const px = await httpProxy('eu', 's3nh@');
  const target = { host: '127.0.0.1', port: site.port, tls: false, path: '/' };
  try {
    const ok = await checkProxy(`http://eu:${encodeURIComponent('s3nh@')}@127.0.0.1:${px.port}`, { target });
    assert.equal(ok.ok, true);
    assert.equal(ok.ip, '203.0.113.7');
    assert.ok(ok.ms >= 0);
    const bad = await checkProxy(`http://eu:errada@127.0.0.1:${px.port}`, { target });
    assert.deepEqual(bad, { ok: false, ms: 0, error: 'Usuário ou senha do proxy recusados' });
  } finally {
    site.srv.close();
    px.srv.close();
  }
});

test('proxy SOCKS5 com senha: responde online; senha errada é recusada', async () => {
  const site = await ipSite();
  const px = await socksProxy('eu', 'abc');
  const target = { host: '127.0.0.1', port: site.port, tls: false, path: '/' };
  try {
    const ok = await checkProxy(`socks5://eu:abc@127.0.0.1:${px.port}`, { target });
    assert.equal(ok.ok, true);
    assert.equal(ok.ip, '203.0.113.7');
    const bad = await checkProxy(`socks5://eu:x@127.0.0.1:${px.port}`, { target });
    assert.equal(bad.ok, false);
    assert.equal(bad.error, 'Usuário ou senha do proxy recusados');
  } finally {
    site.srv.close();
    px.srv.close();
  }
});

test('proxy desligado ou mudo: fora do ar, sem travar', async () => {
  const closed = net.createServer();
  const port = await listen(closed);
  closed.close();
  const refused = await checkProxy(`http://127.0.0.1:${port}`);
  assert.equal(refused.ok, false);
  assert.equal(refused.error, 'Conexão recusada pelo proxy');

  const mute = net.createServer(() => {}); // aceita e nunca responde
  const mport = await listen(mute);
  try {
    const t = Date.now();
    const r = await checkProxy(`http://127.0.0.1:${mport}`, { timeout: 300 });
    assert.equal(r.ok, false);
    assert.match(r.error, /Sem resposta/);
    assert.ok(Date.now() - t < 2000);
  } finally {
    mute.close();
  }
});

test('SOCKS5 com senha é recusado no cadastro (o navegador não abre); SOCKS5 sem senha e HTTP com senha passam', () => {
  const msg = /não aceita proxy SOCKS5 com usuário e senha/;
  const bad = schemas.newProxy.safeParse({ url: 'socks5://u:s@1.2.3.4:1080' });
  assert.equal(bad.success, false);
  assert.match(bad.error.issues[0].message, msg);
  assert.equal(schemas.accountPatch.safeParse({ proxy: 'socks5://u:s@1.2.3.4:1080' }).success, false);
  assert.equal(schemas.newProxy.safeParse({ url: 'socks5://1.2.3.4:1080' }).success, true);
  assert.equal(schemas.newProxy.safeParse({ url: 'http://u:s@1.2.3.4:8080' }).success, true);
});

test('país e fuso do IP: um serviço de reserva, fuso inválido não vale', async () => {
  const asked = [];
  const answers = {
    'https://ipwho.is/1.2.3.4': { success: true, country_code: 'br', timezone: { id: 'America/Sao_Paulo' } },
    'https://ipwho.is/5.6.7.8': null, // primeiro serviço fora: vai no de reserva
    'http://ip-api.com/json/5.6.7.8?fields=status,countryCode,timezone': {
      status: 'success',
      countryCode: 'PT',
      timezone: 'Europe/Lisbon',
    },
    'https://ipwho.is/9.9.9.9': { success: true, country_code: 'XX', timezone: { id: 'Lugar/Nenhum' } },
    'http://ip-api.com/json/9.9.9.9?fields=status,countryCode,timezone': { status: 'fail' },
  };
  const get = async (u) => {
    asked.push(u);
    return answers[u];
  };
  assert.deepEqual(await placeOf('1.2.3.4', { get }), { country: 'BR', timezone: 'America/Sao_Paulo' });
  assert.deepEqual(await placeOf('5.6.7.8', { get }), { country: 'PT', timezone: 'Europe/Lisbon' });
  assert.equal(await placeOf('9.9.9.9', { get }), null);
  const boom = async () => {
    throw new Error('sem internet');
  };
  assert.equal(await placeOf('1.2.3.4', { get: boom }), null);
});

test('teste do proxy: busca o fuso só com IP novo ou fuso desconhecido; fora do ar mantém o último IP', async () => {
  let asks = 0;
  const place = async () => {
    asks++;
    return { country: 'BR', timezone: 'America/Manaus' };
  };
  const p = { url: 'http://h:1', ip: '1.1.1.1', timezone: 'America/Sao_Paulo', country: 'BR' };
  // Mesmo IP e fuso conhecido: não pergunta
  let up = await proxyUpdate(p, { ok: true, ms: 80, ip: '1.1.1.1' }, { place });
  assert.equal(asks, 0);
  assert.equal(up.status, 'online');
  assert.equal(up.timezone, undefined); // não mexe no que já está gravado
  // IP mudou: pergunta e grava o fuso novo
  up = await proxyUpdate(p, { ok: true, ms: 80, ip: '2.2.2.2' }, { place });
  assert.equal(asks, 1);
  assert.deepEqual([up.ip, up.timezone, up.country], ['2.2.2.2', 'America/Manaus', 'BR']);
  // Nunca testado (sem fuso): pergunta
  await proxyUpdate({ url: 'http://h:1' }, { ok: true, ms: 80, ip: '1.1.1.1' }, { place });
  assert.equal(asks, 2);
  // Fora do ar: não pergunta e mantém o último IP
  up = await proxyUpdate(p, { ok: false, ms: 0, error: 'Sem resposta' }, { place });
  assert.equal(asks, 2);
  assert.deepEqual([up.status, up.ip, up.error], ['offline', '1.1.1.1', 'Sem resposta']);
});

test('WebRTC: conta com proxy grava a proteção no perfil; sem proxy tira; o resto das preferências fica', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wu-webrtc-'));
  const file = path.join(dir, 'Default', 'Preferences');
  const read = () => JSON.parse(fs.readFileSync(file, 'utf8'));
  try {
    // Sem proxy e sem perfil: nada a fazer (não cria arquivo)
    assert.equal(guardWebrtc(dir, false), false);
    assert.equal(fs.existsSync(file), false);
    // Perfil novo com proxy: cria só com a proteção
    assert.equal(guardWebrtc(dir, true), true);
    assert.equal(read().webrtc.ip_handling_policy, 'disable_non_proxied_udp');
    assert.equal(guardWebrtc(dir, true), false); // já estava
    // Perfil com outras preferências: mantém tudo
    fs.writeFileSync(file, JSON.stringify({ intl: { accept_languages: 'pt-BR' }, webrtc: { outra: 1 } }));
    guardWebrtc(dir, true);
    assert.deepEqual(read(), { intl: { accept_languages: 'pt-BR' }, webrtc: { outra: 1, ip_handling_policy: 'disable_non_proxied_udp' } });
    // Tirou o proxy: tira a proteção (sem proxy o WebRTC volta ao normal)
    assert.equal(guardWebrtc(dir, false), true);
    assert.deepEqual(read(), { intl: { accept_languages: 'pt-BR' }, webrtc: { outra: 1 } });
    // Arquivo estragado: não mexe
    fs.writeFileSync(file, '{lixo');
    assert.equal(guardWebrtc(dir, true), false);
    assert.equal(fs.readFileSync(file, 'utf8'), '{lixo');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
