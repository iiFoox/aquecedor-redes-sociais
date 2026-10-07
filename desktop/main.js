// WarmUp Studio para Windows (Electron). Sobe o motor e o painel deste aparelho, abre o painel numa janela própria
// e fica perto do relógio (bandeja) com a cor da situação. Cuida de: iniciar com o Windows, notificações,
// notebook acordado durante as sessões, bateria fraca, suspensão e atualização com 1 clique.
const { app, BrowserWindow, Tray, Menu, Notification, nativeImage, powerMonitor, powerSaveBlocker, dialog, shell } = require('electron');
const path = require('path');
const fs = require('fs');
const http = require('http');
const { spawn, execFile } = require('child_process');
const logic = require('./logic');
const updater = require('./updater');

const ROOT = path.join(__dirname, '..');
const NAME = 'WarmUp Studio';
const PANEL_PORT = 3001;
const MOTOR_PORT = 3101;
const PANEL_URL = `http://localhost:${PANEL_PORT}`;
// Instalado: dados em %APPDATA%\WarmUp Studio\data (sobrevivem às atualizações). Rodando do projeto: data/ dele.
const DATA = process.env.WU_DATA_DIR || (app.isPackaged ? path.join(app.getPath('userData'), 'data') : path.join(ROOT, 'data'));
const SETTINGS = path.join(app.getPath('userData'), 'app-settings.json');
const HIDDEN = process.argv.includes('--escondido'); // aberto pelo Windows ao ligar: começa só na bandeja

let win = null;
let tray = null;
let quitting = false;
let updateReady = null; // versão baixada, esperando reiniciar
let updateFile = null; // instalador baixado e conferido
let state = { color: 'cinza', tip: `${NAME}: ligando...`, info: null };
let seen = new Set(); // avisos já notificados (conta:tipo)
let awake = null; // powerSaveBlocker
let battery = { has: null, onBattery: false, level: null, hold: null };
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
  const c = (children[name] = { child, script, crashes: (children[name] && children[name].crashes) || [] });
  child.on('exit', (code) => {
    out.write(`===== ${stamp()} ${name} parou (código ${code}) =====\n`);
    out.end();
    if (quitting || children[name] !== c) return;
    // Caiu: liga de novo (como o PM2 fazia). 5 quedas em 2 min: para e avisa.
    c.crashes = c.crashes.filter((t) => Date.now() - t < 120000).concat(Date.now());
    if (c.crashes.length >= 5) {
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
    // Fechar a janela não desliga o robô: ele continua perto do relógio
    win.on('close', (e) => {
      if (quitting) return;
      e.preventDefault();
      win.hide();
      if (!settings().closedOnce) {
        saveSettings({ closedOnce: true });
        notify('Continua rodando', 'O WarmUp Studio segue aquecendo as contas. Abra pelo ícone perto do relógio.');
      }
    });
    win.on('closed', () => (win = null));
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
  const auto = app.isPackaged ? app.getLoginItemSettings().openAtLogin : false;
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
    { label: 'Abrir a pasta dos registros', click: () => shell.openPath(path.join(DATA, 'logs')) },
    { type: 'separator' },
    { label: `Sair (para o robô neste aparelho)`, click: () => app.quit() },
  );
  return Menu.buildFromTemplate(items);
}

function setAutostart(on) {
  if (!app.isPackaged) return;
  app.setLoginItemSettings({ openAtLogin: on, args: ['--escondido'] });
  saveSettings({ autostart: on });
  if (tray) tray.setContextMenu(menu());
}

// A cada 10 s: situação do motor → cor, avisos novos → notificação, sessão rodando → aparelho acordado
async function poll() {
  const info = await motor('GET', '/api/_device/tray');
  const look = logic.trayState(info, { battery });
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
  setInterval(checkPower, 120000);
  powerMonitor.on('on-battery', checkPower);
  powerMonitor.on('on-ac', checkPower);
  // Vai dormir (tampa, suspensão): encerra as sessões direito antes
  powerMonitor.on('suspend', () => {
    motor('POST', '/api/_device/power', { event: 'suspend' });
  });
  powerMonitor.on('resume', () => setTimeout(poll, 5000));
  // Windows desligando: fecha tudo com segurança
  powerMonitor.on('shutdown', (e) => {
    e.preventDefault();
    app.quit();
  });
}

// ---------- Atualização (Supabase Storage, pasta pública de downloads; ver updater.js) ----------
let updating = false;
function setupUpdates() {
  if (!app.isPackaged) return;
  setTimeout(() => checkUpdates(false), 60000);
  setInterval(() => checkUpdates(false), 6 * 3600000);
}

// Procura e já baixa em segundo plano; quando está pronta, avisa e pergunta
async function checkUpdates(manual) {
  if (!app.isPackaged || updating || updateReady) {
    if (manual && updateReady) installUpdate();
    return;
  }
  updating = true;
  try {
    const m = await updater.latest(app.getVersion());
    if (!m) {
      if (manual) notify('Sem atualização', `Você já está na versão ${app.getVersion()}.`);
      return;
    }
    if (manual) notify('Baixando a atualização', `Versão ${m.version}. Aviso quando estiver pronta.`);
    updateFile = await updater.download(m, path.join(app.getPath('temp'), 'warmup-studio-update'));
    updateReady = m.version;
    if (tray) tray.setContextMenu(menu());
    notify('Atualização pronta', `A versão ${m.version} foi baixada. Clique para atualizar (o app reinicia sozinho).`, installUpdate);
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
      if (r.response === 0) installUpdate();
    }
  } catch (e) {
    console.error('Atualização:', e.message);
    if (manual) notify('Não consegui atualizar', e.message);
  } finally {
    updating = false;
  }
}

async function installUpdate() {
  if (!updateFile || quitting) return;
  quitting = true;
  setState('cinza', `${NAME}: atualizando...`);
  await stopChildren();
  updater.install(updateFile);
  app.exit(0);
}

// ---------- Início ----------
if (!app.requestSingleInstanceLock()) {
  app.quit(); // já aberto: o outro mostra a janela
} else {
  app.on('second-instance', () => showWindow());
  app.setAppUserModelId('com.warmupstudio.app'); // notificações com o nome do app
  app.whenReady().then(async () => {
    if (await portBusy()) {
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
    startChild('motor', 'motor/index.js');
    startChild('painel', 'painel/index.js');
    // Primeira abertura do app instalado: liga "Iniciar com o Windows"
    if (app.isPackaged && settings().autostart === undefined) setAutostart(true);
    if (!HIDDEN) showWindow();
    setInterval(poll, 10000);
    setTimeout(poll, 4000);
    watchPower();
    setupUpdates();
  });
  // Janela fechada não fecha o app (bandeja)
  app.on('window-all-closed', () => {});
  app.on('before-quit', async (e) => {
    if (Object.values(children).every((c) => c.child.exitCode !== null)) return;
    e.preventDefault();
    if (quitting === 'stopping') return;
    quitting = 'stopping';
    setState('cinza', `${NAME}: fechando as sessões com segurança...`);
    await stopChildren();
    app.exit(0);
  });
}
