// Teste de proxy sem navegador, contra proxies falsos locais (sem internet).
const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('http');
const net = require('net');
const { checkProxy } = require('../motor/proxycheck');

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
