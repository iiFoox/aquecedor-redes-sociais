// Horas em que este aparelho costuma ficar ligado: a Rotina planeja as sessões dentro delas (rules.planSlots).
// data/uptime.json: { 'AAAA-MM-DD': [minutos ligado em cada hora 0..23] }, últimos 21 dias. Conta só minuto com
// internet (o sinal do aparelho chegou no Supabase): PC em espera não abre sessão, então não conta como ligado.
// Primeira vez: reconstrói o passado pelo registro do motor (logs/motor.log).
const fs = require('fs');
const path = require('path');
const { DATA } = require('./paths');
const rules = require('./rules');
const cloud = require('./cloud');

const FILE = path.join(DATA, 'uptime.json');
const ONLINE_MS = 150000; // último sinal bem-sucedido há menos de 2,5 min
let data = null;
let dirty = false;
let timers = [];

function load() {
  if (data) return data;
  try {
    data = JSON.parse(fs.readFileSync(FILE, 'utf8'));
  } catch {
    let log = '';
    try {
      log = fs.readFileSync(path.join(DATA, 'logs', 'motor.log'), 'utf8');
    } catch {
      // sem registro (motor pelo terminal): começa do zero
    }
    data = rules.uptimeFromLog(log);
    dirty = true;
  }
  return data;
}

function save() {
  if (!dirty || !data) return;
  dirty = false;
  try {
    fs.mkdirSync(DATA, { recursive: true });
    fs.writeFileSync(FILE, JSON.stringify(data));
  } catch (e) {
    console.warn(`⚠️  Horas ligado: não consegui gravar (${e.message})`);
  }
}

function tick(now = Date.now()) {
  if (now - cloud.lastBeatOk() > ONLINE_MS) return;
  rules.addUptime(load(), now, 1);
  dirty = true;
}

function start() {
  if (timers.length) return;
  load();
  save();
  timers = [setInterval(() => tick(), 60000), setInterval(save, 10 * 60000)];
  for (const t of timers) t.unref();
}

function stop() {
  for (const t of timers) clearInterval(t);
  timers = [];
  save();
}

// Horas boas de hoje (null = ainda não sabe: menos de 2 dias de histórico)
const hours = (now = Date.now()) => rules.onHours(load(), rules.localDate(new Date(now)));

module.exports = { start, stop, hours, tick };
