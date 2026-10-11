// WarmUp Studio para Windows (Electron). Sobe o motor e o painel deste aparelho, abre o painel numa janela própria
// e fica perto do relógio (bandeja) com a cor da situação. Cuida de: iniciar com o Windows, notificações,
// notebook acordado durante as sessões, bateria fraca, suspensão e atualização com 1 clique.
const { app, BrowserWindow, Tray, Menu, Notification, nativeImage, powerMonitor, powerSaveBlocker, dialog, shell } = require('electron');
const path = require('path');
const fs = require('fs');
const http = require('http');
const { spawn, execFile } = require('child_process');
const os = require('os');
const logic = require('./logic');
const updater = require('./updater');
const integrity = require('./integrity');
const { SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY } = require('../motor/supabase-config');

const ROOT = path.join(__dirname, '..');
const pkg = require('../package.json');
const NAME = 'WarmUp Studio';
// Id do app (notificações, "Iniciar com o Windows"). Vem do pacote: uma cópia de teste tem outro id e não mexe na de verdade.
const APP_ID = pkg.wuAppId || 'com.warmupstudio.app';
// Instalado: dados em %APPDATA%\WarmUp Studio\data (sobrevivem às atualizações). Rodando do projeto: data/ dele.
const DATA = process.env.WU_DATA_DIR || (app.isPackaged ? path.join(app.getPath('userData'), 'data') : path.join(ROOT, 'data'));
const SETTINGS = path.join(app.getPath('userData'), 'app-settings.json');
const PENDING = path.join(DATA, 'update-pending.json'); // atualização em andamento (conferida na próxima abertura)
// Portas e endereço de atualização: os de sempre. O teste de ponta a ponta muda pelo app-settings.json da cópia de teste.
const LOCAL = settings();
const PANEL_PORT = Number(LOCAL.panelPort) || 3001;
const MOTOR_PORT = Number(LOCAL.motorPort) || 3101;
const UPDATE_BASE = LOCAL.updateBase || updater.BASE;
// Canal de atualização deste aparelho: "estavel" (padrão) ou "teste" (recebe primeiro; só o PC do dono)
const channel = () => updater.channelOf(settings().channel);
const PANEL_URL = `http://localhost:${PANEL_PORT}`;
const HIDDEN = process.argv.includes('--escondido'); // aberto pelo Windows ao ligar: começa só na bandeja
const AUTOSTART_ARGS = ['--escondido'];

let win = null;
let tray = null;
let quitting = false;
let updateReady = null; // versão baixada, esperando reiniciar
let updateFile = null; // instalador baixado e conferido
let updateSha = null; // SHA-256 do instalador (conferido de novo antes de instalar)
let autoWhenIdle = false; // instala sozinho assim que a janela estiver fechada e nada aberto
let warnedLogin = false; // já avisou que o login do aparelho caiu
let state = { color: 'cinza', tip: `${NAME}: ligando...`, info: null };
let seen = new Set(); // avisos já notificados (conta:tipo)
let awake = null; // powerSaveBlocker
let battery = { has: null, onBattery: false, level: null, hold: null };
let gaveUp = null; // motor ou painel que caiu 5 vezes em 2 min (o ícone fica vermelho até você reabrir o app)
const children = {};

// ---------- Ajustes do aplicativo ----------
function settings() {
  try {
    return JSON.parse(fs.readFileSync(SETTINGS, 'utf8'));
  } catch {
    return {};
  }
}
function saveSettings(patch) {
  fs.mkdirSync(path.dirname(SETTINGS), { recursive: true });
  fs.writeFileSync(SETTINGS, JSON.stringify({ ...settings(), ...patch }, null, 2));
}

// ---------- Registro do app (data/logs/app.log): ligou, atualizou, caiu, avisou ----------
function log(msg) {
  try {
    const dir = path.join(DATA, 'logs');
    fs.mkdirSync(dir, { recursive: true });
    const file = path.join(dir, 'app.log');
    try {
      if (fs.statSync(file).size > 5 * 1048576) fs.renameSync(file, `${file}.old`);
    } catch {
      /* ainda não existe */
    }
    fs.appendFileSync(file, `${new Date().toLocaleString('pt-BR')}  ${msg}\n`);
  } catch {
    /* registro nunca derruba o app */
  }
}

// Atualização em andamento: gravada antes de instalar, conferida na próxima abertura
function readPending() {
  try {
    return JSON.parse(fs.readFileSync(PENDING, 'utf8'));
  } catch {
    return null;
  }
}
function writePending(p) {
  fs.mkdirSync(path.dirname(PENDING), { recursive: true });
  fs.writeFileSync(PENDING, JSON.stringify(p, null, 2));
}
const removePending = () => fs.rmSync(PENDING, { force: true });

// ---------- Relatório de erro para o dono (tabela app_reports no Supabase; só grava, ninguém lê pelo app) ----------
// Assim um problema num aparelho (motor caindo, instalação incompleta) aparece sem ninguém ir até ele buscar o registro.
// Caminho do usuário do Windows sai do texto. Até 10 por hora. Falhou (sem internet, sem a tabela): fica só no app.log.
let reported = [];
const redact = (t) => String(t || '').replace(/(\\Users\\+)[^\\\s'"]+/gi, '$1…'); // C:\Users\<nome> e C:\\Users\\<nome>
function report(kind, message) {
  if (!app.isPackaged) return;
  reported = reported.filter((t) => Date.now() - t < 3600000);
  if (reported.length >= 10) return;
  reported.push(Date.now());
  const body = {
    device: os.hostname().slice(0, 120) || 'sem-nome',
    version: app.getVersion().slice(0, 20),
    kind: String(kind).slice(0, 40),
    message: redact(message).slice(0, 4000),
  };
  fetch(`${SUPABASE_URL}/rest/v1/app_reports`, {
    method: 'POST',
    headers: { apikey: SUPABASE_PUBLISHABLE_KEY, 'Content-Type': 'application/json', Prefer: 'return=minimal' },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(10000),
  }).catch(() => {});
}

// ---------- Motor e painel (processos filhos, com o Node do próprio Electron) ----------
function logStream(name) {
  const dir = path.join(DATA, 'logs');
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, `${name}.log`);
  try {
    if (fs.statSync(file).size > 20 * 1048576) fs.renameSync(file, `${file}.old`);
  } catch {
    /* ainda não existe */
  }
  return fs.createWriteStream(file, { flags: 'a' });
}

function startChild(name, script) {
  const out = logStream(name);
  const env = {
    ...process.env,
    ELECTRON_RUN_AS_NODE: '1',
    WU_DATA_DIR: DATA,
    WU_APP: '1',
    PORT: String(PANEL_PORT),
    MOTOR_PORT: String(MOTOR_PORT),
    WU_CHANNEL: channel(),
  };
  const child = spawn(process.execPath, [path.join(ROOT, script)], {
    cwd: ROOT,
    env,
    stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
    windowsHide: true,
  });
  const stamp = () => new Date().toLocaleString('pt-BR');
  out.write(`\n===== ${stamp()} ${name} ligado (versão ${app.getVersion()}) =====\n`);
  child.stdout.pipe(out, { end: false });
  child.stderr.pipe(out, { end: false });
  const c = (children[name] = { child, script, crashes: (children[name] && children[name].crashes) || [], tail: '' });
  // Fim do que ele escreveu (para o relatório de erro e para reconhecer arquivo faltando)
  const keep = (d) => (c.tail = (c.tail + d).slice(-3000));
  child.stdout.on('data', keep);
  child.stderr.on('data', keep);
  child.on('exit', (code) => {
    out.write(`===== ${stamp()} ${name} parou (código ${code}) =====\n`);
    out.end();
    if (quitting || children[name] !== c) return;
    log(`O ${name} parou sozinho (código ${code}). Ligando de novo em 3 s`);
    // Arquivo do app faltando (instalação incompleta): religar não adianta, conserta reinstalando
    if (/Cannot find module|MODULE_NOT_FOUND/.test(c.tail)) {
      log(`O ${name} não acha um arquivo do app: instalação incompleta`);
      return repair(`o ${name} não acha um arquivo do app`, c.tail);
    }
    // Caiu: liga de novo (como o PM2 fazia). 5 quedas em 2 min: para e avisa.
    c.crashes = c.crashes.filter((t) => Date.now() - t < 120000).concat(Date.now());
    if (c.crashes.length >= 5) {
      gaveUp = name;
      log(`O ${name} parou 5 vezes em 2 min: desisti de religar (veja ${name}.log)`);
      report(`${name}-caiu`, c.tail);
      setState('vermelho', `${NAME}: o ${name} parou várias vezes`);
      notify(`O ${name} parou várias vezes`, `Veja o registro em ${path.join(DATA, 'logs', `${name}.log`)}`);
      return;
    }
    setTimeout(() => !quitting && startChild(name, script), 3000);
  });
  return child;
}

// Fecha os dois com segurança (as sessões gravam o histórico). Até 35 s.
function stopChildren() {
  const alive = Object.values(children).filter((c) => c.child.exitCode === null);
  return Promise.all(
    alive.map(
      (c) =>
        new Promise((resolve) => {
          const t = setTimeout(() => (c.child.kill(), resolve()), 35000);
          c.child.once('exit', () => (clearTimeout(t), resolve()));
          try {
            c.child.send('shutdown');
          } catch {
            c.child.kill();
          }
        }),
    ),
  );
}

// ---------- Falar com o motor (senha interna em data/motor.token) ----------
function motor(method, route, body) {
  return new Promise((resolve) => {
    let token = '';
    try {
      token = fs.readFileSync(path.join(DATA, 'motor.token'), 'utf8').trim();
    } catch {
      return resolve(null);
    }
    const data = body ? JSON.stringify(body) : null;
    const req = http.request(
      {
        host: '127.0.0.1',
        port: MOTOR_PORT,
        path: route,
        method,
        timeout: method === 'GET' ? 5000 : 30000,
        headers: {
          'x-motor-token': token,
          'x-wu-user': 'app',
          ...(data ? { 'content-type': 'application/json', 'content-length': Buffer.byteLength(data) } : {}),
        },
      },
      (res) => {
        let s = '';
        res.on('data', (d) => (s += d));
        res.on('end', () => {
          try {
            resolve(res.statusCode < 400 ? JSON.parse(s) : null);
          } catch {
            resolve(null);
          }
        });
      },
    );
    req.on('error', () => resolve(null));
    req.on('timeout', () => req.destroy());
    req.end(data || undefined);
  });
}

// Alguém já usa as portas (a versão de terminal ligada pelo PM2)?
const portBusy = () =>
  new Promise((resolve) => {
    const req = http.get({ host: '127.0.0.1', port: MOTOR_PORT, path: '/api/health', timeout: 1500 }, (res) => {
      res.resume();
      resolve(true);
    });
    req.on('error', () => resolve(false));
    req.on('timeout', () => (req.destroy(), resolve(false)));
  });

// ---------- Janela ----------
function showWindow(hash = '') {
  if (!win) {
    win = new BrowserWindow({
      width: 1320,
      height: 860,
      minWidth: 380,
      minHeight: 500,
      title: NAME,
      icon: path.join(__dirname, 'icons', 'app.png'),
      backgroundColor: '#16121c',
      autoHideMenuBar: true,
      show: false,
      webPreferences: { contextIsolation: true, sandbox: true, nodeIntegration: false, spellcheck: false },
    });
    win.setMenuBarVisibility(false);
    win.once('ready-to-show', () => win.show());
    // Links de fora (ajuda, Supabase) abrem no navegador normal; a janela só mostra o painel deste aparelho
    win.webContents.setWindowOpenHandler(({ url }) => {
      if (/^https?:\/\//.test(url) && !url.startsWith(PANEL_URL)) shell.openExternal(url);
      return { action: 'deny' };
    });
    win.webContents.on('will-navigate', (e, url) => {
      if (!url.startsWith(PANEL_URL) && !url.startsWith(`http://127.0.0.1:${PANEL_PORT}`)) {
        e.preventDefault();
        if (/^https?:\/\//.test(url)) shell.openExternal(url);
      }
    });
    // Fechar a janela não desliga o robô: ele continua perto do relógio. A janela fecha de verdade (libera ~100 MB e o
    // processamento do painel, que ninguém está vendo) e abre de novo pelo ícone.
    win.on('close', () => {
      if (quitting) return;
      if (!settings().closedOnce) {
        saveSettings({ closedOnce: true });
        notify('Continua rodando', 'O WarmUp Studio segue aquecendo as contas. Abra pelo ícone perto do relógio.');
      }
    });
    win.on('closed', () => (win = null));
    win.on('session-end', sessionEnd);
    loadPanel(hash);
  } else {
    if (hash) win.loadURL(`${PANEL_URL}/${hash}`);
    if (win.isMinimized()) win.restore();
    win.show();
    win.focus();
  }
}

// O painel pode levar uns segundos para subir: tenta até conseguir
function loadPanel(hash, tries = 0) {
  if (!win) return;
  win.loadURL(`${PANEL_URL}/${hash}`).catch(() => {
    if (tries < 60) setTimeout(() => loadPanel(hash, tries + 1), 1000);
  });
}

// ---------- Bandeja e notificações ----------
const icon = (color) => nativeImage.createFromPath(path.join(__dirname, 'icons', `tray-${color}.png`));

function notify(title, body, onClick) {
  if (!Notification.isSupported()) return;
  const n = new Notification({ title, body, icon: path.join(__dirname, 'icons', 'app.png') });
  if (onClick) n.on('click', onClick);
  n.show();
}

function setState(color, tip, info = state.info) {
  state = { color, tip, info };
  if (!tray) return;
  tray.setImage(icon(color));
  tray.setToolTip(tip.slice(0, 127));
  tray.setContextMenu(menu());
}

function menu() {
  const i = state.info;
  const auto = app.isPackaged ? app.getLoginItemSettings({ args: AUTOSTART_ARGS }).openAtLogin : false;
  const items = [
    { label: 'Abrir o painel', click: () => showWindow() },
    { type: 'separator' },
    { label: state.tip.replace(`${NAME}: `, ''), enabled: false },
  ];
  if (i && i.ready) items.push({ label: `${i.accounts} conta(s) neste aparelho · ${i.running} aquecendo`, enabled: false });
  for (const a of (i && i.attention) || [])
    items.push({ label: `@${a.username}: ${a.msg.split('.')[0]}`, click: () => showWindow(`#conta/${a.id}`) });
  items.push({ type: 'separator' });
  if (updateReady) items.push({ label: `Atualizar para a versão ${updateReady} (reinicia)`, click: installUpdate });
  else if (app.isPackaged) items.push({ label: 'Procurar atualização', click: () => checkUpdates(true) });
  items.push(
    {
      label: 'Iniciar com o Windows',
      type: 'checkbox',
      checked: auto,
      enabled: app.isPackaged,
      click: (m) => setAutostart(m.checked),
    },
    {
      label: 'Receber atualizações em teste (antes dos outros computadores)',
      type: 'checkbox',
      checked: channel() === 'teste',
      enabled: app.isPackaged,
      click: (m) => {
        saveSettings({ channel: m.checked ? 'teste' : 'estavel' });
        log(`Canal de atualização: ${channel()}`);
        notify(
          m.checked ? 'Canal de teste ligado' : 'Canal estável',
          m.checked
            ? 'Este computador recebe as versões em teste antes dos outros. Procurando agora.'
            : 'Este computador recebe só as versões liberadas para todos.',
        );
        if (tray) tray.setContextMenu(menu());
        if (m.checked) checkUpdates(false);
      },
    },
    { label: 'Abrir a pasta dos registros', click: () => shell.openPath(path.join(DATA, 'logs')) },
    { type: 'separator' },
    { label: `Sair (para o robô neste aparelho)`, click: () => app.quit() },
  );
  return Menu.buildFromTemplate(items);
}

function setAutostart(on) {
  if (!app.isPackaged) return;
  app.setLoginItemSettings({ openAtLogin: on, args: AUTOSTART_ARGS });
  saveSettings({ autostart: on });
  if (tray) tray.setContextMenu(menu());
}

// A cada 10 s: situação do motor → cor, avisos novos → notificação, sessão rodando → aparelho acordado
async function poll() {
  if (gaveUp) return; // fica vermelho com o aviso (a cor "ligando" esconderia o problema)
  const info = await motor('GET', '/api/_device/tray');
  const look = logic.trayState(info);
  setState(look.color, `${NAME}: ${look.text}`, info);
  if (!info) return;
  // Avisos novos (captcha, bloqueio, login, proxy) viram notificação; clicar abre a conta
  const now = new Set();
  for (const a of info.attention) {
    const k = `${a.id}:${a.kind}`;
    now.add(k);
    if (!seen.has(k)) notify(`@${a.username} (${a.platform})`, a.msg, () => showWindow(`#conta/${a.id}`));
  }
  seen = now;
  // O login do aparelho caiu (senha trocada): avisa uma vez; clicar abre o painel, que pede para entrar de novo
  if (info.needsLogin && !warnedLogin) {
    warnedLogin = true;
    log('O login deste aparelho caiu: pedindo para entrar de novo no painel');
    notify(
      'Entre de novo no painel',
      'O login deste aparelho caiu (a senha foi trocada?). Nenhuma conta aquece aqui até você entrar.',
      () => showWindow(),
    );
  }
  if (!info.needsLogin && warnedLogin) {
    warnedLogin = false;
    log('Login do aparelho de volta');
  }
  // Atualização pronta e nada aberto (janela fechada, sem sessão nem navegador): instala sozinha
  if (autoWhenIdle && updateReady && logic.idleForUpdate(info, !!(win && win.isVisible()))) installUpdate({ auto: true });
  // Notebook acordado enquanto houver sessão aquecendo (a tela pode apagar; o PC não dorme sozinho)
  if (info.running > 0 && awake === null) awake = powerSaveBlocker.start('prevent-app-suspension');
  if (info.running === 0 && awake !== null) {
    powerSaveBlocker.stop(awake);
    awake = null;
  }
}

// ---------- Energia (notebook) ----------
function readBattery() {
  return new Promise((resolve) => {
    execFile(
      'powershell.exe',
      [
        '-NoProfile',
        '-NonInteractive',
        '-Command',
        '(Get-CimInstance Win32_Battery | Measure-Object -Property EstimatedChargeRemaining -Average).Average',
      ],
      { windowsHide: true, timeout: 15000 },
      (err, out) => {
        const n = parseFloat(
          String(out || '')
            .trim()
            .replace(',', '.'),
        );
        resolve(err || !Number.isFinite(n) ? null : Math.round(n));
      },
    );
  });
}

async function checkPower() {
  const level = await readBattery();
  const first = battery.has === null;
  battery.has = level !== null;
  if (!battery.has) return; // PC de mesa
  const onBattery = powerMonitor.isOnBatteryPower();
  const wasOnBattery = battery.onBattery;
  battery.onBattery = onBattery;
  battery.level = level;
  const r = await motor('POST', '/api/_device/power', { battery: { onBattery, level } });
  if (r && r.changed && r.hold === 'bateria')
    notify('Bateria fraca', `Bateria em ${level}%: o robô não abre sessão nova até você ligar na tomada.`);
  if (r) battery.hold = r.hold;
  if (onBattery && !wasOnBattery && !first)
    notify('Na bateria', 'Abaixo de 20% o robô para de abrir sessões novas até voltar para a tomada.');
  // Notebook: avisa uma vez sobre a tampa
  if (first && !settings().lidNotice) {
    saveSettings({ lidNotice: true });
    notify(
      'Notebook: atenção à tampa',
      'Com a tampa fechada o Windows costuma dormir e as sessões param. Para rodar de tampa fechada: Opções de energia → "Ao fechar a tampa: Nada a fazer" (na tomada).',
    );
  }
}

function watchPower() {
  checkPower();
  setInterval(() => battery.has !== false && checkPower(), 120000); // PC de mesa (sem bateria): não fica consultando
  powerMonitor.on('on-battery', checkPower);
  powerMonitor.on('on-ac', checkPower);
  // Vai dormir (tampa, suspensão): encerra as sessões direito antes
  powerMonitor.on('suspend', () => {
    motor('POST', '/api/_device/power', { event: 'suspend' });
  });
  powerMonitor.on('resume', () => setTimeout(poll, 5000));
  // Windows saindo ou desligando: avisa uma janela ('session-end'). Mesmo começando só na bandeja existe uma janela
  // invisível para receber o aviso. O Windows dá poucos segundos: pede para o motor e o painel fecharem direito.
  const guard = new BrowserWindow({
    show: false,
    width: 1,
    height: 1,
    skipTaskbar: true,
    focusable: false,
    webPreferences: { sandbox: true },
  });
  guard.on('session-end', sessionEnd);
}

function sessionEnd() {
  if (quitting === 'session-end') return;
  quitting = 'session-end'; // as janelas fecham de verdade (não vão para a bandeja)
  for (const c of Object.values(children)) {
    try {
      c.child.send('shutdown');
    } catch {
      /* já fechou */
    }
  }
}

// ---------- Atualização (Supabase Storage, pasta pública de downloads; ver updater.js) ----------
// Baixa sozinha. Janela aberta: pergunta. Janela fechada: instala sozinha quando nada estiver aberto (sem sessão
// nem navegador), e o app volta escondido, como estava. Cada passo vai para o app.log. Na próxima abertura o app
// confere se ficou na versão nova (update-pending.json); se não ficou, tenta de novo (até 3 vezes) e avisa.
let updating = false;
function setupUpdates(retrySoon) {
  if (!app.isPackaged) return;
  setTimeout(() => checkUpdates(false), retrySoon ? 120000 : 60000);
  setInterval(() => checkUpdates(false), 6 * 3600000);
}

// Procura e já baixa em segundo plano
async function checkUpdates(manual) {
  if (!app.isPackaged || updating || updateReady) {
    if (manual && updateReady) installUpdate();
    return;
  }
  updating = true;
  try {
    const m = await updater.latest(app.getVersion(), UPDATE_BASE, channel());
    if (!m) {
      if (manual) notify('Sem atualização', `Você já está na versão ${app.getVersion()}.`);
      return;
    }
    log(`Atualização: versão ${m.version} disponível (esta é a ${app.getVersion()}). Baixando`);
    if (manual) notify('Baixando a atualização', `Versão ${m.version}. Aviso quando estiver pronta.`);
    updateFile = await updater.download(m, path.join(app.getPath('temp'), `${APP_ID}-update`), () => {}, UPDATE_BASE);
    updateSha = m.sha256;
    updateReady = m.version;
    log(`Atualização: versão ${m.version} baixada e conferida`);
    if (tray) tray.setContextMenu(menu());
    if (win && win.isVisible()) {
      const r = await dialog.showMessageBox(win, {
        type: 'info',
        buttons: ['Atualizar agora', 'Depois'],
        defaultId: 0,
        cancelId: 1,
        title: 'Atualização pronta',
        message: `A versão ${m.version} do WarmUp Studio está pronta.`,
        detail: 'As sessões em andamento fecham com segurança e o app volta sozinho. Nada se perde.',
      });
      if (r.response === 0) return installUpdate();
      log('Atualização: você escolheu "Depois". Instala sozinha quando a janela estiver fechada e nada aberto');
    } else {
      notify(
        'Atualização pronta',
        `A versão ${m.version} instala sozinha quando nenhuma conta estiver aquecendo. Clique para atualizar agora.`,
        () => installUpdate(),
      );
    }
    autoWhenIdle = true;
  } catch (e) {
    log(`Atualização: falhou (${e.message})`);
    if (manual) notify('Não consegui atualizar', e.message);
  } finally {
    updating = false;
  }
}

// opts.auto: instalação sozinha (janela fechada, nada aberto). O app volta escondido.
async function installUpdate(opts) {
  if (!updateFile || quitting) return;
  const auto = !!(opts && opts.auto === true);
  const to = updateReady;
  // O instalador ficou horas na pasta temporária: confere de novo antes de usar
  if ((await updater.hashFile(updateFile)) !== updateSha) {
    log('Atualização: o instalador baixado mudou ou sumiu. Baixo de novo na próxima procura');
    updateFile = updateReady = updateSha = null;
    autoWhenIdle = false;
    if (tray) tray.setContextMenu(menu());
    return;
  }
  const prev = readPending();
  const attempts = prev && prev.to === to ? (prev.attempts || 1) + 1 : 1;
  const hidden = opts && typeof opts.hidden === 'boolean' ? opts.hidden : auto || !(win && win.isVisible());
  writePending({ from: app.getVersion(), to, at: Date.now(), attempts, hidden });
  log(`Atualização: instalando ${app.getVersion()} → ${to} (${auto ? 'sozinha, nada aberto' : 'você pediu'}, tentativa ${attempts})`);
  if (!(opts && opts.repair))
    notify('Atualizando o WarmUp Studio', `Versão ${to}: leva alguns minutos e ele abre sozinho no fim. Não precisa abrir enquanto isso.`);
  quitting = true;
  setState('cinza', `${NAME}: atualizando...`);
  await stopChildren();
  try {
    const pid = await updater.install(updateFile);
    log(`Atualização: instalador aberto (pid ${pid}). Fechando o app para ele trocar os arquivos e abrir a versão ${to}`);
  } catch (e) {
    // O instalador nem abriu: continua nesta versão (religa motor e painel) e avisa
    log(`Atualização: o instalador não abriu (${e.message}). Continuo na versão ${app.getVersion()}`);
    report('atualizacao-falhou', `o instalador não abriu: ${e.message}`);
    removePending();
    quitting = false;
    autoWhenIdle = false;
    startChild('motor', 'motor/index.js');
    startChild('painel', 'painel/index.js');
    notify('Não consegui atualizar', `O instalador não abriu (${e.message}). Tento de novo mais tarde.`);
    return;
  }
  app.exit(0);
}

// ---------- Autoconserto: instalação incompleta (faltam arquivos do app) ----------
// Baixa a versão publicada e se reinstala sozinho, como numa atualização. No máximo 2 vezes em 6 h (não fica em laço).
let repairing = false;
async function repair(reason, detail = '') {
  if (repairing || quitting || !app.isPackaged) return;
  repairing = true;
  const recent = (settings().repairs || []).filter((t) => Date.now() - t < 6 * 3600000);
  if (recent.length >= 2) {
    log(`Instalação incompleta (${reason}), mas já tentei consertar 2 vezes em 6 h. Precisa reinstalar`);
    report('reparo-desistiu', `${reason}\n${detail}`);
    setState('vermelho', `${NAME}: precisa reinstalar`);
    notify(
      'O WarmUp Studio precisa ser reinstalado',
      'Faltam arquivos do aplicativo e o conserto sozinho não resolveu. Rode o instalador de novo (seus dados ficam).',
    );
    repairing = false;
    return;
  }
  saveSettings({ repairs: recent.concat(Date.now()) });
  log(`Instalação incompleta (${reason}): baixando a versão publicada para reinstalar sozinho`);
  report('reparo', `${reason}\n${detail}`);
  setState('cinza', `${NAME}: consertando a instalação...`);
  notify(
    'Consertando o WarmUp Studio',
    'Faltam arquivos do aplicativo. Ele baixa a versão certa e se reinstala sozinho em alguns minutos. Não precisa fazer nada.',
  );
  try {
    const m = await updater.latest('0.0.0', UPDATE_BASE, channel());
    if (!m) throw new Error('nenhuma versão publicada');
    updateFile = await updater.download(m, path.join(app.getPath('temp'), `${APP_ID}-update`), () => {}, UPDATE_BASE);
    updateSha = m.sha256;
    updateReady = m.version;
    repairing = false;
    await installUpdate({ auto: !(win && win.isVisible()), repair: true });
  } catch (e) {
    log(`Conserto: não consegui baixar (${e.message}). Tento de novo na próxima abertura`);
    report('reparo-falhou', e.message);
    setState('vermelho', `${NAME}: instalação incompleta`);
    notify('Não consegui consertar agora', `Sem conseguir baixar (${e.message}). Tento de novo quando o app abrir; ou rode o instalador.`);
    repairing = false;
  }
}

// Instalador do WarmUp Studio rodando agora? (atualização em andamento)
function installerRunning() {
  return new Promise((resolve) =>
    execFile('tasklist', ['/FI', 'IMAGENAME eq WarmUp-Studio*', '/NH'], { windowsHide: true }, (err, out) =>
      resolve(!err && /WarmUp-Studio[\w.-]*Setup/i.test(out || '')),
    ),
  );
}

// Ao abrir: versão nova já liberada no servidor? Baixa e instala ANTES de ligar o motor (as sessões só começam
// depois, já na versão nova). Também é o que deixa uma instalação nova sempre na última versão, mesmo com um
// instalador antigo. Sem internet, servidor lento (15 s) ou download que falha: segue normal e a procura de sempre
// tenta depois. Não roda logo depois de uma atualização que não terminou (a tentativa de sempre cuida disso).
// Devolve true se o app está fechando para instalar.
async function updateFirst(pending, hidden) {
  if (!app.isPackaged || pending.retry || readPending()) return false;
  let m;
  try {
    m = await Promise.race([
      updater.latest(app.getVersion(), UPDATE_BASE, channel()),
      new Promise((_, rej) => setTimeout(() => rej(new Error('servidor demorou')), 15000)),
    ]);
  } catch (e) {
    log(`Atualização ao abrir: não consegui procurar (${e.message}). Sigo e procuro depois`);
    return false;
  }
  if (!m) return false;
  log(`Atualização ao abrir: versão ${m.version} disponível. Instalo antes de começar as sessões`);
  setState('cinza', `${NAME}: baixando a versão ${m.version}...`);
  notify(
    'Atualizando antes de começar',
    `Baixando a versão ${m.version}. Leva alguns minutos; as contas começam depois, já na versão nova.`,
  );
  updating = true;
  try {
    updateFile = await updater.download(m, path.join(app.getPath('temp'), `${APP_ID}-update`), () => {}, UPDATE_BASE);
    updateSha = m.sha256;
    updateReady = m.version;
  } catch (e) {
    log(`Atualização ao abrir: o download falhou (${e.message}). Sigo nesta versão e tento depois`);
    return false;
  } finally {
    updating = false;
  }
  await installUpdate({ auto: true, hidden });
  return quitting === true; // o instalador abriu: o app fecha e volta na versão nova
}

// Abriu depois de uma atualização? Confere se ficou na versão nova. Devolve se deve começar escondido.
function checkPending() {
  const p = readPending();
  const d = logic.pendingUpdate(p, app.getVersion());
  if (!d) return { hidden: false, retry: false };
  if (d === 'ok') {
    log(`Atualização concluída: agora na versão ${app.getVersion()} (era ${p.from})`);
    removePending();
    notify('WarmUp Studio atualizado', `Agora na versão ${app.getVersion()}. Tudo continua de onde parou.`);
    return { hidden: !!p.hidden, retry: false };
  }
  if (d === 'ignorar') {
    removePending();
    return { hidden: false, retry: false };
  }
  if (d === 'desistir') {
    log(`Atualização para ${p.to}: ${p.attempts} tentativas sem sucesso. Paro de tentar sozinho`);
    report('atualizacao-desistiu', `${p.from} → ${p.to}, ${p.attempts} tentativas`);
    removePending();
    notify(
      'Não consegui atualizar sozinho',
      'Clique com o botão direito no ícone perto do relógio → Procurar atualização. Se não der, instale de novo pelo instalador.',
    );
    return { hidden: false, retry: false };
  }
  log(`Atualização para ${p.to} não terminou (ainda na ${app.getVersion()}, tentativa ${p.attempts}). Tento de novo em 2 min`);
  return { hidden: !!p.hidden, retry: true };
}

// ---------- Início ----------
if (!app.requestSingleInstanceLock()) {
  log('Já havia um WarmUp Studio aberto: esta cópia fechou e o outro mostrou a janela');
  app.quit(); // já aberto: o outro mostra a janela
} else {
  app.on('second-instance', () => showWindow());
  app.setAppUserModelId(APP_ID); // notificações com o nome do app
  app.whenReady().then(async () => {
    // Aberto no meio de uma atualização (o instalador ainda trocando os arquivos): espera até 15 s o instalador
    // terminar (é ele que abre o app no fim); se ainda estiver instalando, sai sem mexer em nada. Abrir o app com a
    // instalação pela metade deixava arquivos faltando.
    if (app.isPackaged && (await installerRunning())) {
      for (let i = 0; i < 5 && (await installerRunning()); i++) await new Promise((r) => setTimeout(r, 3000));
      if (await installerRunning()) {
        log('Aberto durante uma atualização: fechei para não atrapalhar (o instalador abre o app no fim)');
        new Notification({ title: NAME, body: 'Atualizando: ele abre sozinho quando terminar. Não precisa abrir agora.' }).show();
        quitting = true;
        return app.quit();
      }
    }
    const pending = checkPending();
    log(`App ligou: versão ${app.getVersion()}${HIDDEN || pending.hidden ? ', escondido' : ''}`);
    if (await portBusy()) {
      log(`A porta ${MOTOR_PORT} já está em uso (versão de terminal ligada?): app fechou`);
      await dialog.showMessageBox({
        type: 'warning',
        title: NAME,
        message: 'O WarmUp Studio já está rodando neste PC pelo terminal.',
        detail: 'Desligue a versão de terminal ("npm run desligar" na pasta do projeto) e abra o aplicativo de novo.',
      });
      quitting = true;
      return app.quit();
    }
    tray = new Tray(icon('cinza'));
    tray.on('click', () => showWindow());
    setState('cinza', `${NAME}: ligando...`);
    // Instalação completa? (lista de arquivos gravada no empacotamento) Faltando algo: conserta antes de ligar o motor
    const integ = integrity.check(ROOT);
    if (!integ.ok) {
      log(
        `Instalação incompleta: ${integ.count} de ${integ.total} arquivos faltando ou errados (ex.: ${integ.missing.slice(0, 3).join(', ')})`,
      );
      return repair(`${integ.count} arquivos faltando`, integ.missing.join('\n'));
    }
    if (app.isPackaged) saveSettings({ repairs: [] }); // instalação boa: zera as tentativas de conserto
    // Versão nova esperando no servidor: instala antes de as sessões começarem
    if (await updateFirst(pending, HIDDEN || pending.hidden)) return;
    // (se o instalador não abriu, installUpdate já religou motor e painel)
    if (!children.motor || children.motor.child.exitCode !== null) {
      startChild('motor', 'motor/index.js');
      startChild('painel', 'painel/index.js');
    }
    // Primeira abertura do app instalado: liga "Iniciar com o Windows". Já ligado: confere se aponta para este
    // executável (a pasta pode ter mudado numa atualização) e corrige.
    if (app.isPackaged && settings().autostart === undefined) setAutostart(true);
    else if (app.isPackaged && settings().autostart && !app.getLoginItemSettings({ args: AUTOSTART_ARGS }).openAtLogin) {
      log('"Iniciar com o Windows" apontava para outro lugar: corrigido para este executável');
      setAutostart(true);
    }
    if (!HIDDEN && !pending.hidden) showWindow();
    setInterval(poll, 10000);
    setTimeout(poll, 4000);
    watchPower();
    setupUpdates(pending.retry);
  });
  // Janela fechada não fecha o app (bandeja)
  app.on('window-all-closed', () => {});
  app.on('before-quit', async (e) => {
    if (Object.values(children).every((c) => c.child.exitCode !== null)) return;
    e.preventDefault();
    if (quitting === 'stopping') return;
    quitting = 'stopping';
    log('App fechando: encerrando motor e painel com segurança');
    setState('cinza', `${NAME}: fechando as sessões com segurança...`);
    await stopChildren();
    app.exit(0);
  });
}
