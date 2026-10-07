const $ = (s, p = document) => p.querySelector(s);
const $$ = (s, p = document) => Array.from(p.querySelectorAll(s));
const api = async (url, method = 'GET', body) => {
  const r = await fetch(url, { method, headers: { 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
  const data = await r.json().catch(() => ({}));
  if (!r.ok) {
    const err = new Error(data.error || 'Erro desconhecido');
    err.motorOff = !!data.motorOff;
    throw err;
  }
  return data;
};
// Texto vindo do servidor (usuário, legendas, mensagens) nunca entra cru no HTML
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

// Situação da conta para o selo do card e do detalhe
const ATTENTION_TITLE = { login: 'Precisa de login', captcha: 'Precisa resolver o captcha', block: 'Bloqueada: aguardando você liberar' };
function statusOf(a) {
  if (a.loginOpen) return { cls: 'login', label: a.browserPurpose === 'captcha' ? 'Navegador aberto' : 'Aguardando login' };
  if (a.live) return { cls: 'on', label: 'Aquecendo...' };
  if (a.attention)
    return {
      cls: 'login',
      label: a.attention.kind === 'login' ? 'Precisa de login' : a.attention.kind === 'captcha' ? 'Precisa de captcha' : 'Bloqueada',
    };
  if (a.dayStatus === 'done') return { cls: 'ready', label: 'Meta batida' };
  if (a.dayStatus === 'limit') return { cls: '', label: 'Limite do plano' };
  if (a.day >= meta.readyDay) return { cls: 'ready', label: 'Pronta' };
  return { cls: '', label: 'Parada' };
}
function attentionBox(a) {
  if (!a.attention) return '';
  return `<div class="acc-alert ${a.attention.kind}"><b>${ATTENTION_TITLE[a.attention.kind] || 'Precisa de você'}</b><span>${esc(a.attention.msg)}</span></div>`;
}
// Botões do aviso: captcha abre o navegador para você resolver; bloqueio só volta quando você liberar
function attentionButtons(a, cls = 'btn sm') {
  if (!a.attention) return '';
  if (a.attention.kind === 'captcha') {
    return `<button class="${cls} primary" data-act="captcha" data-id="${a.id}">Abrir navegador</button><button class="${cls} ghost" data-act="release" data-id="${a.id}">Liberar</button>`;
  }
  if (a.attention.kind === 'block') return `<button class="${cls} primary" data-act="release" data-id="${a.id}">Liberar</button>`;
  return '';
}
function goalsHtml(a) {
  const pMeta = meta.platforms[a.platform];
  return Object.entries(a.plan)
    .filter(([k, max]) => k !== 'minutes' && (max > 0 || (a.today[k] || 0) > 0))
    .map(([k, max]) => {
      const done = a.today[k] || 0;
      const pct = max ? Math.min(100, (done / max) * 100) : 100;
      return `<div class="goal ${max && done >= max ? 'full' : ''}"><div class="goal-top"><span>${pMeta.actions[k] || k}</span> <b>${done}${max ? ' / ' + max : ''}</b></div><div class="bar"><i style="width: ${pct}%"></i></div></div>`;
    })
    .join('');
}
const RESULT_LABEL = {
  ok: 'Sucesso',
  stopped: 'Cancelada',
  not_logged: 'Sem login',
  captcha: 'Captcha',
  block: 'Bloqueio',
  limit: 'Limite do plano',
  error: 'Erro',
  watchdog: 'Travou',
};

// Por que o piloto automático não abre sessão agora (motivo vindo de rules.decide)
const SCHEDULE_LABEL = {
  'piloto-desligado': 'Piloto automático desligado',
  ferias: 'Em férias',
  backup: 'Esperando o backup dos logins',
  'fora-da-janela': 'Fora do horário',
  'precisa-atencao': 'Esperando você resolver o aviso',
  'proxy-fora': 'Proxy fora do ar: esperando ele voltar',
  'limite-simultaneo': 'Esperando vaga (limite de contas ao mesmo tempo)',
  'meta-batida': 'Metas de hoje batidas',
  'limite-do-plano': 'Limite de 120% do plano atingido',
  intervalo: 'Intervalo entre sessões',
  iniciar: 'Na fila para iniciar',
};
const scheduleLine = (a) => {
  if (a.live || a.loginOpen || !a.schedule || a.schedule === 'rodando' || a.schedule === 'navegador-aberto') return '';
  const win = a.window ? ` (horário dela: ${a.window.start}–${a.window.end})` : '';
  return `<div class="acc-sched">${SCHEDULE_LABEL[a.schedule] || a.schedule}${a.schedule === 'fora-da-janela' ? win : ''}</div>`;
};
// Opções de proxy para o cadastro e para a edição da conta
function proxyOptions(current = '') {
  const online = proxies.filter((p) => p.status === 'online').length;
  const list = proxies
    .map((p) => {
      const n = (p.accounts || []).length;
      const st = p.status === 'online' ? `${p.ms} ms` : p.status === 'offline' ? 'fora do ar' : 'não testado';
      return `<option value="${esc(p.url)}" ${p.url === current ? 'selected' : ''}>${esc(proxyHost(p.url))} · ${st} · ${n} conta(s)</option>`;
    })
    .join('');
  return `<option value="" ${!current ? 'selected' : ''}>Sem proxy</option>${online ? '<option value="auto">Automático (o online com menos contas)</option>' : ''}${list}`;
}
const proxyHost = (url) => {
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
};

const ICONS = {
  instagram:
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="2" y="2" width="20" height="20" rx="5" ry="5"></rect><path d="M16 11.37A4 4 0 1 1 12.63 8 4 4 0 0 1 16 11.37z"></path><line x1="17.5" y1="6.5" x2="17.51" y2="6.5"></line></svg>',
  tiktok:
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M9 12a4 4 0 1 0 4 4V4a5 5 0 0 0 5 5"></path></svg>',
  play: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polygon points="5 3 19 12 5 21 5 3"></polygon></svg>',
  square:
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="18" height="18" rx="2" ry="2"></rect></svg>',
  key: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 2l-2 2m-7.61 7.61a5.5 5.5 0 1 1-7.778 7.778 5.5 5.5 0 0 1 7.777-7.777zm0 0L15.5 7.5m0 0l3 3L22 7l-3-3m-3.5 3.5L19 4"></path></svg>',
  activity:
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="22 12 18 12 15 21 9 3 6 12 2 12"></polyline></svg>',
  trash:
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path></svg>',
};

let meta = {};
let accounts = [];
let proxies = [];
let feed = [];
let filter = 'all';
let openedDetail = null;
let chart = null;
let sseLive = null;
let nowTimer = null;

// Inicializa a UI (ícones de tabs/modal)
$('#tab-instagram').innerHTML = ICONS.instagram + ' Instagram';
$('#tab-tiktok').innerHTML = ICONS.tiktok + ' TikTok';
$('#seg-instagram').innerHTML = ICONS.instagram + ' Instagram';
$('#seg-tiktok').innerHTML = ICONS.tiktok + ' TikTok';

function toast(msg, type = 'ok') {
  const t = document.createElement('div');
  t.className = `toast ${type}`;
  t.textContent = msg;
  $('#toasts').appendChild(t);
  setTimeout(() => {
    t.style.opacity = 0;
    setTimeout(() => t.remove(), 300);
  }, 4000);
}

function renderKPIs() {
  const accs = accounts.filter((a) => filter === 'all' || a.platform === filter);
  const running = accs.filter((a) => a.live).length;
  const healthAvg = accs.length ? Math.round(accs.reduce((s, a) => s + a.health.score, 0) / accs.length) : 0;
  const sessions = accs.reduce((s, a) => s + a.sessions, 0);

  $('#kpis').innerHTML = `
    <div class="card kpi" style="--accent: #ff3d7f">
      <div class="k-label">Contas</div>
      <div class="k-value">${accs.length}</div>
      <div class="k-sub">${running} rodando agora</div>
    </div>
    <div class="card kpi" style="--accent: #22d39a">
      <div class="k-label">Saúde média</div>
      <div class="k-value">${healthAvg}<small style="font-size: 1rem">%</small></div>
      <div class="k-sub">${healthAvg >= 70 ? 'Saudável' : healthAvg >= 40 ? 'Atenção' : 'Crítico'}</div>
    </div>
    <div class="card kpi" style="--accent: #25f4ee">
      <div class="k-label">Sessões feitas</div>
      <div class="k-value">${sessions}</div>
      <div class="k-sub">histórico total</div>
    </div>
  `;
}

function formatTimeLeft(ms) {
  if (ms <= 0) return '00:00';
  const mins = Math.floor(ms / 60000)
    .toString()
    .padStart(2, '0');
  const secs = Math.floor((ms % 60000) / 1000)
    .toString()
    .padStart(2, '0');
  return `${mins}:${secs}`;
}

function renderAccounts() {
  const accs = accounts.filter((a) => filter === 'all' || a.platform === filter);
  $('#count-label').textContent = `${accs.length} conta${accs.length !== 1 ? 's' : ''}`;

  if (!accs.length) {
    $('#accounts').innerHTML = `
      <div class="card empty">
        <div class="big">👻</div>
        <p>Nenhuma conta adicionada.</p>
        <button class="btn primary" onclick="$('#add-open').click()">Adicionar agora</button>
      </div>`;
    return;
  }

  $('#accounts').innerHTML = accs
    .map((a) => {
      const isRunning = !!a.live;
      // Mesmo cálculo que o robô usa: média do cumprimento de cada meta do dia
      const progress = Math.round((a.completion || 0) * 100);
      const st = statusOf(a);

      return `
      <article class="card acc ${a.platform} ${isRunning ? 'running' : ''}" data-id="${a.id}">
        <div class="acc-head">
          <div class="pbadge">${ICONS[a.platform]}</div>
          <div>
            <div class="acc-name">@${esc(a.username)}</div>
            <div class="acc-sub">Dia ${a.day} · Fase ${a.phase.n}</div>
          </div>
          <div class="pill ${st.cls}">${st.label}</div>
        </div>

        <div class="acc-mid">
          <div class="warm">
            <div class="warm-top"><span>Meta de hoje${a.dayStatus === 'limit' ? ' (limite de 120% atingido)' : ''}</span><b>${progress}%</b></div>
            <div class="bar"><i style="width: ${progress}%"></i></div>
            <div class="phase-dots">
              ${[1, 2, 3, 4, 5].map((p) => `<span class="${a.phase.n > p ? 'done' : a.phase.n === p ? 'cur' : ''}"></span>`).join('')}
            </div>
          </div>
          <div class="ring-wrap">
            <svg class="ring" width="46" height="46" viewBox="0 0 36 36">
              <path class="ring-bg" d="M18 2.0845 a 15.9155 15.9155 0 0 1 0 31.831 a 15.9155 15.9155 0 0 1 0 -31.831" stroke-width="3"></path>
              <path stroke="${a.health.score >= 70 ? 'var(--ok)' : a.health.score >= 40 ? 'var(--warn)' : 'var(--bad)'}" stroke-dasharray="${a.health.score}, 100" d="M18 2.0845 a 15.9155 15.9155 0 0 1 0 31.831 a 15.9155 15.9155 0 0 1 0 -31.831" stroke-width="3"></path>
              <text x="18" y="19">${a.health.score}</text>
            </svg>
            <div>Saúde</div>
          </div>
        </div>
        
        ${
          isRunning
            ? `
          <div class="acc-now">
            <i class="spin"></i>
            <div>
              <div class="now-label">Ao vivo agora</div>
              <span>${a.live.status}</span>
            </div>
          </div>
        `
            : ''
        }
        
        ${attentionBox(a)}
        ${scheduleLine(a)}

        <div class="acc-foot">
          <button class="btn sm ghost" data-act="login" data-id="${a.id}">${ICONS.key} Login</button>
          ${
            isRunning
              ? `<button class="btn sm danger" data-act="stop" data-id="${a.id}">${ICONS.square} Parar</button>
               <button class="btn sm primary" data-act="view" data-id="${a.id}">🎥 Ao Vivo</button>`
              : a.attention
                ? attentionButtons(a)
                : `<button class="btn sm success" data-act="start" data-id="${a.id}">${ICONS.play} Iniciar</button>`
          }
        </div>
      </article>
    `;
    })
    .join('');
}

function renderFeed() {
  const c = $('#global-feed');
  if (!feed.length) {
    c.innerHTML = `<div class="feed-empty">Nenhuma atividade recente.</div>`;
    return;
  }
  const html = feed
    .map((f) => {
      let typeClass = f.kind === 'alert' ? (f.level === 'danger' ? 'danger' : 'warn') : '';
      let time = new Date(f.t).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
      return `
      <div class="fi ${typeClass} ${Date.now() - f.t < 2000 ? 'new' : ''}">
        <div class="fi-ico">${ICONS.activity}</div>
        <div class="fi-body">
          <span class="fi-acc ${f.platform}"><i class="${f.platform}"></i> @${esc(f.username)}</span>
          ${
            f.kind === 'action'
              ? `Completou: <b>${esc(f.action)}</b> ${f.detail ? `(${esc(f.detail)})` : ''}`
              : f.kind === 'alert'
                ? `<b>Alerta:</b> ${esc(f.msg)}`
                : `<i>${esc(f.msg)}</i>`
          }
        </div>
        <div class="fi-time">${time}</div>
      </div>
    `;
    })
    .join('');

  if (c.innerHTML !== html) {
    c.innerHTML = html;
  }
}

// Modal e Eventos Gerais
$$('#platform-tabs .tab').forEach((b) =>
  b.addEventListener('click', (e) => {
    $$('#platform-tabs .tab').forEach((x) => x.classList.remove('active'));
    e.target.classList.add('active');
    filter = e.target.dataset.filter;
    renderKPIs();
    renderAccounts();
  }),
);

$('#add-open').onclick = () => $('#add-modal').classList.remove('hidden');
$('#add-cancel').onclick = () => $('#add-modal').classList.add('hidden');

$('#btn-bulk-open').onclick = () => {
  $('#bulk-text').value = '';
  $('#modal-bulk').classList.remove('hidden');
};
$('#bulk-cancel').onclick = () => $('#modal-bulk').classList.add('hidden');

$('#bulk-submit').onclick = async () => {
  const lines = $('#bulk-text')
    .value.split('\n')
    .map((l) => l.trim())
    .filter(Boolean);
  if (!lines.length) return toast('Insira ao menos uma conta', 'warn');

  const platform = $('#bulk-platform').value;
  let imported = 0;
  const failed = [];

  $('#bulk-submit').disabled = true;
  $('#bulk-submit').textContent = 'Importando...';

  for (const line of lines) {
    const parts = line.split(':');
    const username = parts[0];
    let proxyUrl = '';

    if (parts.length >= 4 && !line.includes('http')) {
      const ip = parts[2];
      const port = parts[3];
      const puser = parts[4] || '';
      const ppass = parts[5] || '';
      proxyUrl = puser ? `http://${puser}:${ppass}@${ip}:${port}` : `http://${ip}:${port}`;
    } else if (parts[2]) {
      proxyUrl = parts.slice(2).join(':');
    }

    try {
      // A conta guarda o ENDEREÇO do proxy (antes gravava o ID e o navegador nem abria)
      await api('/api/accounts', 'POST', { platform, username, interests: '', proxy: proxyUrl });
      // Também entra na Central de Proxies; se já estiver lá, tudo bem
      if (proxyUrl) await api('/api/proxies', 'POST', { url: proxyUrl }).catch(() => {});
      imported++;
    } catch (e) {
      failed.push(`@${username}: ${e.message}`);
    }
  }

  $('#bulk-submit').disabled = false;
  $('#bulk-submit').textContent = 'Importar Contas';
  $('#modal-bulk').classList.add('hidden');
  toast(`${imported} conta(s) importada(s)${failed.length ? `, ${failed.length} com erro` : ''}`, failed.length ? 'warn' : 'success');
  failed.slice(0, 3).forEach((f) => toast(f, 'danger'));

  accounts = await api('/api/accounts');
  proxies = await api('/api/proxies').catch(() => []);
  renderAccounts();
  renderProxies();
  renderKPIs();
  renderAnalytics();
};

// Cadastro: escolhe o proxy da lista, automático, nenhum ou cola um novo
function fillProxyPick() {
  $('#proxy-pick').innerHTML = proxyOptions('') + '<option value="novo">Outro (colar endereço)</option>';
  if (proxies.some((p) => p.status === 'online')) $('#proxy-pick').value = 'auto';
  $('#proxy').classList.toggle('hidden', $('#proxy-pick').value !== 'novo');
}
$('#proxy-pick').onchange = () => $('#proxy').classList.toggle('hidden', $('#proxy-pick').value !== 'novo');
$('#add-open').addEventListener('click', fillProxyPick);

$$('#platform-seg button').forEach((b) =>
  b.addEventListener('click', (e) => {
    $$('#platform-seg button').forEach((x) => x.classList.remove('active'));
    e.target.closest('button').classList.add('active');
  }),
);

$('#add-form').onsubmit = async (e) => {
  e.preventDefault();
  const btn = $('#add-submit');
  btn.disabled = true;
  try {
    const data = {
      platform: $('#platform-seg .active').dataset.p,
      username: $('#username').value,
      interests: $('#interests').value,
      proxy: $('#proxy-pick').value === 'novo' ? $('#proxy').value : $('#proxy-pick').value,
    };
    await api('/api/accounts', 'POST', data);
    toast('Conta adicionada com sucesso!');
    $('#add-modal').classList.add('hidden');
    e.target.reset();
  } catch (err) {
    toast(err.message, 'danger');
  } finally {
    btn.disabled = false;
  }
};

$('#accounts').addEventListener('click', async (e) => {
  const btn = e.target.closest('button');
  const card = e.target.closest('.acc');

  if (btn) {
    e.stopPropagation();
    const { act, id } = btn.dataset;
    try {
      if (act === 'login') {
        toast('Abrindo navegador...');
        await api(`/api/accounts/${id}/login`, 'POST');
        openDetail(id);
      }
      if (act === 'start') {
        toast('Iniciando aquecimento...');
        await api(`/api/accounts/${id}/start`, 'POST');
        openDetail(id);
      }
      if (act === 'view') {
        openDetail(id);
      }
      if (act === 'stop') {
        toast('Parando...');
        await api(`/api/accounts/${id}/stop`, 'POST');
      }
      if (act === 'captcha') await openCaptchaBrowser(id);
      if (act === 'release') await releaseAccount(id);
    } catch (err) {
      toast(err.message, 'danger');
    }
  } else if (card) {
    openDetail(card.dataset.id);
  }
});

// Atualiza timers no painel live
setInterval(() => {
  if (!openedDetail || !nowTimer) return;
  const a = accounts.find((x) => x.id === openedDetail);
  if (a && a.live) {
    // Sessão é guiada por meta (sem fim fixo): mostra há quanto tempo está rodando
    const left = Math.max(0, Date.now() - a.live.startedAt);
    $('#detail-timeleft').textContent = '⏱ ' + formatTimeLeft(left);

    if (a.live.statusUntil) {
      const waitTot = a.live.statusUntil - a.live.statusAt;
      const waitCur = Date.now() - a.live.statusAt;
      const pct = Math.min(100, Math.max(0, (waitCur / waitTot) * 100));
      $('#now-bar').style.width = `${pct}%`;
    } else {
      $('#now-bar').style.width = '100%';
    }
  }
}, 500);

// Tela de Detalhes
async function openDetail(id) {
  try {
    const a = await api(`/api/accounts/${id}`);
    openedDetail = id;

    const pMeta = meta.platforms[a.platform];
    const statsHtml = goalsHtml(a);
    const st = statusOf(a);

    const html = `
      <div class="d-head">
        <div class="pbadge ${a.platform}">${ICONS[a.platform]}</div>
        <div class="d-title">
          <h2>@${esc(a.username)}</h2>
          <div>
            <span class="chip">Dia ${a.day} · Fase ${a.phase.n}</span>
            <span class="chip ${a.platform}">${pMeta.name}</span>
            ${a.proxy ? `<span class="chip">Proxy ${esc(a.proxyHost)}${a.proxyStatus === 'offline' ? ' · fora do ar' : ''}</span>` : ''}
            <span class="pill ${st.cls}">${st.label}</span>
          </div>
        </div>
        <div class="d-actions">
          ${
            a.loginOpen
              ? `<button class="btn" onclick="api('/api/accounts/${a.id}/browser/close', 'POST').catch(e => toast(e.message, 'danger'))">Fechar navegador</button>`
              : `<button class="btn" onclick="api('/api/accounts/${a.id}/login', 'POST').catch(e => toast(e.message, 'danger'))">${ICONS.key} Login Manual</button>`
          }
          ${
            a.live
              ? `<button class="btn danger" onclick="api('/api/accounts/${a.id}/stop', 'POST').catch(e => toast(e.message, 'danger'))">${ICONS.square} Parar</button>`
              : a.attention
                ? attentionButtons(a, 'btn')
                : `<button class="btn primary" onclick="api('/api/accounts/${a.id}/start', 'POST').catch(e => toast(e.message, 'danger'))">${ICONS.play} Iniciar Sessão</button>`
          }
          <button class="btn danger" onclick="if(confirm('Excluir conta definitivamente?')) api('/api/accounts/${a.id}', 'DELETE').then(() => closeDetail()).catch(e => toast(e.message, 'danger'))">${ICONS.trash}</button>
          <button class="btn ghost" onclick="closeDetail()">✕ Fechar</button>
        </div>
      </div>
      ${attentionBox(a)}
      
      <div class="d-grid">
        <div class="d-col">
          <div class="card">
            <div class="live-head">
              <h3>Transmissão ao vivo</h3>
              ${
                a.live
                  ? `<div class="live-badge on">LIVE</div> <div class="timer" id="detail-timeleft">⏱ ${formatTimeLeft(Math.max(0, Date.now() - a.live.startedAt))}</div>`
                  : a.loginOpen
                    ? `<div class="live-badge login">LOGIN</div>`
                    : `<div class="live-badge">OFFLINE</div>`
              }
            </div>
            <div class="screen" id="screencast">
              ${a.live || a.loginOpen ? `<div class="screen-empty">Conectando vídeo...</div>` : `<div class="screen-empty"><div class="big">😴</div>Nenhuma sessão rodando agora.</div>`}
            </div>
            ${
              a.live
                ? `
              <div class="now">
                <div class="now-label">O bot está fazendo:</div>
                <div class="now-text"><i class="spin"></i> <span id="detail-status">${a.live.status}</span></div>
                <div class="bar"><i id="now-bar" style="width: 100%"></i></div>
              </div>
            `
                : ''
            }
          </div>
          
        <div class="card">
          <h3>Metas de Hoje (Dia ${a.day})</h3>
          <div class="goals compact" id="detail-goals">${statsHtml}</div>
        </div>
      </div>
      
      <div class="d-col">
          <div class="card">
            <h3>❤️ Saúde da Conta</h3>
            <div class="health-box">
              <div class="ring-wrap">
                <svg class="ring" width="80" height="80" viewBox="0 0 36 36">
                  <path class="ring-bg" d="M18 2.0845 a 15.9155 15.9155 0 0 1 0 31.831 a 15.9155 15.9155 0 0 1 0 -31.831" stroke-width="3.5"></path>
                  <path stroke="${a.health.score >= 70 ? 'var(--ok)' : a.health.score >= 40 ? 'var(--warn)' : 'var(--bad)'}" stroke-dasharray="${a.health.score}, 100" d="M18 2.0845 a 15.9155 15.9155 0 0 1 0 31.831 a 15.9155 15.9155 0 0 1 0 -31.831" stroke-width="3.5"></path>
                  <text x="18" y="19">${a.health.score}</text>
                </svg>
              </div>
              <div class="hb-list">
                <div><b>${a.health.consistency}%</b> Consistência <small>Dias rodados vs esperados</small></div>
                <div><b>${a.health.completion}%</b> Metas <small>Cumprimento das sessões recentes</small></div>
                <div><b>${a.health.safety}%</b> Segurança <small>Sem bloqueios ou captchas</small></div>
              </div>
            </div>
          </div>
          
          <div class="card" style="padding-bottom: 0;">
            <h3>Jornada do Aquecimento</h3>
            <div class="roadmap">
              ${meta.phases
                .map(
                  (p) => `
                <div class="rm ${a.phase.n > p.n ? 'done' : a.phase.n === p.n ? 'cur' : ''}">
                  <div class="rm-dot">${a.phase.n > p.n ? '✓' : p.n}</div>
                  <div>
                    <div class="days">Dias ${p.from} a ${p.to === 9999 ? 'Infinito' : p.to}</div>
                    <h4>${p.name}</h4>
                    <p>${p.desc}</p>
                    ${a.phase.n === p.n ? `<div class="rm-plan">Plano atual: ${a.plan.minutes} min / ${a.plan.like || a.plan.likeVideo || 0} curtir</div>` : ''}
                  </div>
                </div>
              `,
                )
                .join('')}
            </div>
          </div>
        </div>
      </div>
      
      <div class="card mt-4">
        <h3>Ajustes desta conta</h3>
        ${scheduleLine(a)}
        <form class="acc-settings" data-id="${a.id}">
          <label class="inline"><input type="checkbox" name="own" ${a.window ? 'checked' : ''} /> Horário próprio</label>
          <div class="acc-win">
            <input type="time" name="start" value="${a.window ? a.window.start : window.scheduleConfig.start}" ${a.window ? '' : 'disabled'} />
            <span>até</span>
            <input type="time" name="end" value="${a.window ? a.window.end : window.scheduleConfig.end}" ${a.window ? '' : 'disabled'} />
          </div>
          <small>Sem horário próprio, usa o horário geral (${window.scheduleConfig.start}–${window.scheduleConfig.end}).</small>
          <label>Proxy</label>
          <select name="proxy">${proxyOptions(a.proxyUrl || '')}</select>
          <small>Trocar o proxy de uma conta já logada muda o IP dela e pode pedir verificação.</small>
          <button class="btn sm primary" type="submit">Salvar ajustes</button>
        </form>
      </div>

      ${
        a.screens && a.screens.length
          ? `<div class="card mt-4">
        <h3>Prints de problemas</h3>
        <div class="screens">
          ${a.screens
            .map(
              (f) =>
                `<a href="/api/accounts/${a.id}/screens/${f}" target="_blank" rel="noopener"><img loading="lazy" src="/api/accounts/${a.id}/screens/${f}" alt="${esc(f)}" /><span>${esc(f.slice(0, 16).replace('T', ' '))} · ${esc(f.split('_').pop().replace('.jpg', ''))}</span></a>`,
            )
            .join('')}
        </div>
      </div>`
          : ''
      }

      <div class="card mt-4">
        <h3>Últimas Sessões</h3>
        <div class="table-wrap">
          <table class="sessions">
            <thead><tr><th>Data</th><th>Dia / Fase</th><th>Duração</th><th>Cumprimento</th><th>Resultado</th></tr></thead>
            <tbody>
              ${
                a.history.length === 0
                  ? `<tr><td colspan="5" style="text-align: center; color: var(--dim); padding: 20px;">Nenhuma sessão concluída ainda.</td></tr>`
                  : a.history
                      .map(
                        (h) => `
                <tr>
                  <td>${new Date(h.date).toLocaleString('pt-BR')}</td>
                  <td>Dia ${h.day} · Fase ${h.phase}</td>
                  <td>${h.minutes} min</td>
                  <td><div class="bar" style="width: 100px; display: inline-block; vertical-align: middle; margin-right: 8px;"><i style="width: ${h.completion * 100}%"></i></div> ${(h.completion * 100).toFixed(0)}%</td>
                  <td><span class="res ${h.result === 'ok' ? 'ok' : h.result === 'stopped' || h.result === 'limit' || h.result === 'not_logged' ? 'warn' : 'bad'}">${RESULT_LABEL[h.result] || esc(String(h.result).toUpperCase())}</span></td>
                </tr>
              `,
                      )
                      .join('')
              }
            </tbody>
          </table>
        </div>
      </div>
    `;

    $('#detail-inner').innerHTML = html;
    $('#detail').classList.remove('hidden');
    document.body.style.overflow = 'hidden';
    nowTimer = true;

    // Conecta SSE de vídeo
    if (a.live || a.loginOpen) {
      sseLive = new EventSource(`/api/live/${a.id}`);
      sseLive.onmessage = (e) => {
        if (e.data.startsWith('ping')) return;
        const img = $('#screencast img');
        if (img) img.src = `data:image/jpeg;base64,${e.data}`;
        else {
          $('#screencast').innerHTML = `<img src="data:image/jpeg;base64,${e.data}" />`;
        }
      };
    }
  } catch (err) {
    toast(err.message, 'danger');
  }
}

// Abre o navegador da conta para você resolver o captcha; ao fechar a janela, a conta volta para a fila
async function openCaptchaBrowser(id) {
  try {
    toast('Abrindo o navegador. Resolva o captcha e feche a janela quando terminar.');
    await api(`/api/accounts/${id}/browser`, 'POST', { purpose: 'captcha' });
  } catch (err) {
    toast(err.message, 'danger');
  }
}

async function releaseAccount(id) {
  try {
    await api(`/api/accounts/${id}/release`, 'POST');
    toast('Conta liberada. Ela volta para a fila do piloto automático.', 'success');
    accounts = await api('/api/accounts');
    renderKPIs();
    renderAccounts();
    if (openedDetail === id) openDetail(id);
  } catch (err) {
    toast(err.message, 'danger');
  }
}
window.openCaptchaBrowser = openCaptchaBrowser;
window.releaseAccount = releaseAccount;

// Ajustes da conta (horário próprio e proxy)
$('#detail').addEventListener('change', (e) => {
  const form = e.target.closest('.acc-settings');
  if (!form || e.target.name !== 'own') return;
  form.start.disabled = form.end.disabled = !e.target.checked;
});
$('#detail').addEventListener('submit', async (e) => {
  const form = e.target.closest('.acc-settings');
  if (!form) return;
  e.preventDefault();
  const id = form.dataset.id;
  const a = accounts.find((x) => x.id === id) || {};
  const body = { window: form.own.checked ? { start: form.start.value, end: form.end.value } : null };
  if (form.proxy.value !== (a.proxyUrl || '')) {
    if (a.proxy && !confirm('Trocar o proxy muda o IP desta conta. Continuar?')) return;
    body.proxy = form.proxy.value;
  }
  try {
    await api(`/api/accounts/${id}`, 'PATCH', body);
    toast('Ajustes salvos', 'success');
    accounts = await api('/api/accounts');
    proxies = await api('/api/proxies').catch(() => proxies);
    renderAccounts();
    openDetail(id);
  } catch (err) {
    toast(err.message, 'danger');
  }
});

// Botões do aviso dentro do detalhe (o detalhe não passa pelo clique dos cards)
$('#detail').addEventListener('click', (e) => {
  const btn = e.target.closest('button[data-act]');
  if (!btn) return;
  if (btn.dataset.act === 'captcha') openCaptchaBrowser(btn.dataset.id);
  if (btn.dataset.act === 'release') releaseAccount(btn.dataset.id);
});

function closeDetail() {
  $('#detail').classList.add('hidden');
  document.body.style.overflow = '';
  openedDetail = null;
  nowTimer = false;
  if (sseLive) {
    sseLive.close();
    sseLive = null;
  }
}

// Global SSE Stream
function connectStream() {
  const evtSource = new EventSource('/api/stream');

  // Se o motor estava fora do ar na reconexão, o navegador desiste do tempo real: reconecta em 5 s
  evtSource.onerror = () => {
    if (evtSource.readyState === EventSource.CLOSED) setTimeout(connectStream, 5000);
  };

  evtSource.onmessage = function (event) {
    if (event.data.startsWith('ping')) return;
    const ev = JSON.parse(event.data);

    // Férias, backup e proxies: recarrega o estado geral
    if (ev.type === 'vacation' || ev.type === 'backup' || ev.type === 'proxies') {
      refreshGeneral();
      if (ev.type === 'backup' && ev.backup) toast(`Backup dos logins feito (${ev.backup.sizeMB} MB)`, 'success');
      return;
    }

    // Atualiza estado local rápido sem recarregar tudo
    const acc = accounts.find((a) => a.id === ev.id);
    if (!acc) return;

    if (ev.type === 'session') {
      acc.live = ev.running
        ? { status: 'Iniciando...', stats: {}, startedAt: Date.now(), endsAt: Date.now() + acc.plan.minutes * 60000 }
        : null;
      renderAccounts();
      if (openedDetail === acc.id) openDetail(acc.id);
    }

    if (ev.type === 'login') {
      acc.loginOpen = ev.open;
      acc.browserPurpose = ev.open ? ev.purpose : null;
      renderAccounts();
      if (openedDetail === acc.id) openDetail(acc.id);
    }

    // A conta precisa de você (login, captcha ou bloqueio) ou foi liberada
    if (ev.type === 'attention') {
      acc.attention = ev.attention;
      if (ev.attention) toast(`@${acc.username}: ${ev.attention.msg}`, 'danger');
      renderKPIs();
      renderAccounts();
      if (openedDetail === acc.id) openDetail(acc.id);
    }

    if (ev.type === 'status') {
      if (acc.live) {
        acc.live.status = ev.text;
        acc.live.statusUntil = ev.until;
        acc.live.statusAt = Date.now();
        if (openedDetail === acc.id) {
          const el = $('#detail-status');
          if (el) el.textContent = ev.text;
        }
      }
    }

    if (ev.type === 'action') {
      if (acc.live) acc.live.stats = ev.stats;
      acc.today[ev.action] = (acc.today[ev.action] || 0) + 1;

      if (openedDetail === acc.id) {
        // Atualiza apenas a barra de metas pra não piscar o vídeo
        const el = $('#detail-goals');
        if (el) el.innerHTML = goalsHtml(acc);
      }

      feed.unshift({ ...ev, kind: 'action', username: acc.username, platform: acc.platform });
      if (feed.length > 50) feed.pop();
      renderFeed();
    }

    if (ev.type === 'log' || ev.type === 'alert') {
      feed.unshift({ ...ev, kind: ev.type, username: acc.username, platform: acc.platform });
      if (feed.length > 50) feed.pop();
      renderFeed();
    }
  };
}

// Start
async function init() {
  try {
    meta = await api('/api/meta');

    // Mostra as regras na seção "Como Funciona"
    $('#how').innerHTML = `
      <div class="how-top">
        <h2 id="how-title">Como Funciona o WarmUp Studio</h2>
        <button class="btn ghost sm" onclick="$('#how').classList.add('hidden')">✕ Fechar</button>
      </div>
      <p>O aquecimento (warm up) é o processo de preparar uma nova conta agindo como um usuário comum antes de começar ações em massa (como postagens pesadas ou mensagens). Nosso bot humanizado usa pausas aleatórias, movimentos de mouse em curva e rolagem de página para imitar você.</p>
      
      <div class="how-grid">
        <div class="card">
          <h3 class="how-sub">Metas Diárias</h3>
          <table class="limits">
            <thead><tr><th>Fase</th><th>Min/Sessão</th><th>Curtidas</th><th>Follows</th></tr></thead>
            <tbody>
              ${meta.phases
                .map((p) => {
                  const ig = meta.platforms.instagram.plans[p.n - 1];
                  return `<tr><td>Fase ${p.n} (D ${p.from}-${p.to === 9999 ? '∞' : p.to})</td><td>${ig.minutes}m</td><td>${ig.like}</td><td class="${ig.follow === 0 ? 'zero' : ''}">${ig.follow}</td></tr>`;
                })
                .join('')}
            </tbody>
          </table>
        </div>
        <div>
          <h3 class="how-sub">Motor Indetectável</h3>
          <div class="tech">
            <div><b>Playwright</b> Oculto sem flags de automação</div>
            <div><b>Mouse Curvo</b> Movimentos Bezier com aceleração real</div>
            <div><b>Human Delay</b> Pausas aleatórias entre cliques</div>
            <div><b>CDP Stream</b> Transmissão da tela via DevTools puro</div>
          </div>
        </div>
      </div>
    `;

    $('#how-btn').onclick = () => $('#how').classList.toggle('hidden');

    // Sidebar Toggle
    $('#sidebar-toggle').onclick = () => {
      $('#sidebar').classList.toggle('collapsed');
      const isCol = $('#sidebar').classList.contains('collapsed');
      $('#brand-box').style.justifyContent = isCol ? 'center' : 'flex-start';
    };

    // Sidebar Navigation
    $$('.nav-item').forEach((btn) => {
      btn.onclick = () => {
        $$('.nav-item').forEach((b) => b.classList.remove('active'));
        btn.classList.add('active');

        $$('.view-section').forEach((v) => v.classList.add('hidden'));
        $(`#view-${btn.dataset.view}`).classList.remove('hidden');

        if (btn.dataset.view === 'accounts') {
          $('#view-accounts-header').classList.remove('hidden');
        } else {
          $('#view-accounts-header').classList.add('hidden');
        }
      };
    });

    // Carrega initial state
    [accounts, feed, proxies] = await Promise.all([api('/api/accounts'), api('/api/feed'), api('/api/proxies').catch(() => [])]);

    // Scheduler Config
    window.scheduleConfig = await api('/api/config').catch(() => ({
      active: false,
      start: '08:00',
      end: '22:00',
      max: 2,
      headless: false,
      muteAudio: true,
    }));
    $('#sch-active').checked = window.scheduleConfig.active;
    $('#sch-start').value = window.scheduleConfig.start;
    $('#sch-end').value = window.scheduleConfig.end;
    $('#sch-max').value = window.scheduleConfig.max;
    $('#cfg-headless').checked = !!window.scheduleConfig.headless;
    $('#cfg-mute').checked = window.scheduleConfig.muteAudio !== false;
    renderVacation();
    renderBackup();

    renderKPIs();
    renderAccounts();
    renderFeed();
    renderProxies();
    renderAnalytics();
    connectStream();

    // Polling backup a cada 10s pra garantir sinc de dados
    setInterval(async () => {
      try {
        accounts = await api('/api/accounts');
        proxies = await api('/api/proxies').catch(() => proxies);
        window.scheduleConfig = await api('/api/config').catch(() => window.scheduleConfig);
        motorOff(false);
      } catch (err) {
        if (err.motorOff) motorOff(true);
        return;
      }
      renderKPIs();
      renderAccounts();
      renderProxies();
      renderVacation();
      renderAnalytics();
    }, 10000);
  } catch (err) {
    // Motor reiniciando: o painel espera e tenta de novo sozinho
    if (err.motorOff) {
      motorOff(true);
      setTimeout(init, 5000);
      return;
    }
    toast('Erro fatal: falha ao iniciar o painel. ' + err.message, 'danger');
  }
}

function motorOff(off) {
  $('#motor-off').classList.toggle('hidden', !off);
}

// Proxies Logic
$('#proxy-form').onsubmit = async (e) => {
  e.preventDefault();
  const input = $('#proxy-input');
  try {
    const p = await api('/api/proxies', 'POST', { url: input.value });
    proxies.push(p);
    input.value = '';
    renderProxies();
    toast('Proxy adicionado à Farm', 'success');
  } catch (err) {
    toast(err.message, 'danger');
  }
};

function renderProxies() {
  $('#proxy-count-label').textContent = `${proxies.length} proxies · testados sozinhos a cada 30 min, sem abrir navegador`;
  if (!proxies.length) {
    $('#proxies-list').innerHTML = `<div class="empty card" style="padding: 30px;">Nenhum proxy cadastrado ainda.</div>`;
    return;
  }

  $('#proxies-list').innerHTML = proxies
    .map((p) => {
      let stat = `<span class="pill">Ainda não testado</span>`;
      if (p.status === 'online') stat = `<span class="pill on">Online · ${p.ms} ms${p.ip ? ` · IP ${esc(p.ip)}` : ''}</span>`;
      if (p.status === 'offline') stat = `<span class="pill login">Fora do ar${p.error ? `: ${esc(p.error)}` : ''}</span>`;
      const users = (p.accounts || []).map((a) => `@${esc(a.username)}`).join(', ');
      const when = p.lastCheck
        ? `Testado às ${new Date(p.lastCheck).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}`
        : '';

      return `
      <div class="card proxy-row">
        <div style="font-family: var(--mono); font-size: 0.9rem; min-width: 0;">
          <div style="margin-bottom: 8px; overflow-wrap: anywhere;">${esc(proxyHost(p.url))}</div>
          <div>${stat}</div>
          <small style="display: block; margin-top: 6px; color: var(--mut)">${users ? `Usado por ${users}` : 'Livre (nenhuma conta)'}${when ? ` · ${when}` : ''}</small>
        </div>
        <div style="display: flex; gap: 8px;">
          <button class="btn sm" onclick="pingProxy('${p.id}')">⚡ Testar agora</button>
          <button class="btn danger sm" onclick="deleteProxy('${p.id}')">${ICONS.trash}</button>
        </div>
      </div>
    `;
    })
    .join('');
}

window.pingProxy = async (id) => {
  toast('Testando o proxy...', 'warn');
  try {
    const res = await api(`/api/proxies/${id}/ping`, 'POST');
    proxies = proxies.map((p) => (p.id === id ? res : p));
    renderProxies();
    if (res.status === 'online') toast(`Proxy online (${res.ms} ms, IP ${res.ip})`, 'success');
    else toast(`Proxy fora do ar: ${res.error || 'sem resposta'}`, 'danger');
  } catch (e) {
    toast('Erro na checagem.', 'danger');
  }
};

window.deleteProxy = async (id) => {
  if (!confirm('Excluir este proxy da lista?')) return;
  try {
    await api(`/api/proxies/${id}`, 'DELETE');
    proxies = proxies.filter((p) => p.id !== id);
    renderProxies();
  } catch (err) {
    toast(err.message, 'danger');
  }
};

// Scheduler Logic
$('#schedule-form').onsubmit = async (e) => {
  e.preventDefault();
  try {
    window.scheduleConfig = await api('/api/config', 'POST', {
      ...window.scheduleConfig,
      active: $('#sch-active').checked,
      start: $('#sch-start').value,
      end: $('#sch-end').value,
      max: Number($('#sch-max').value),
    });
    toast('Configurações de agendamento salvas!', 'success');
  } catch (err) {
    toast('Erro ao salvar.', 'danger');
  }
};

// Anti-Detect Settings
$('#settings-form').onsubmit = async (e) => {
  e.preventDefault();
  try {
    window.scheduleConfig = await api('/api/config', 'POST', {
      ...window.scheduleConfig,
      headless: $('#cfg-headless').checked,
      muteAudio: $('#cfg-mute').checked,
    });
    toast('Motor atualizado. Válido para próximas sessões!', 'success');
  } catch (err) {
    toast('Erro ao salvar.', 'danger');
  }
};

// ---------- Férias ----------

function renderVacation() {
  const c = window.scheduleConfig || {};
  const on = c.pausedUntil && c.pausedUntil > Date.now();
  const back = on ? new Date(c.pausedUntil).toLocaleDateString('pt-BR') : '';
  $('#vacation-state').innerHTML = on
    ? `<b>Em férias.</b> As contas voltam a aquecer em ${back}, continuando do dia em que pararam.`
    : 'Desligado. As contas seguem o plano normalmente.';
  $('#vacation-form').classList.toggle('hidden', !!on);
  $('#vacation-end').classList.toggle('hidden', !on);
  $('#vacation-banner').classList.toggle('hidden', !on);
  $('#vacation-banner').textContent = on ? `🏖️ Modo férias: nada roda até ${back}. As contas continuam do dia em que pararam.` : '';
  if (!$('#vacation-until').value) {
    const d = new Date(Date.now() + 7 * 86400000);
    $('#vacation-until').value = d.toISOString().slice(0, 10);
  }
}

$('#vacation-form').onsubmit = async (e) => {
  e.preventDefault();
  if (!confirm('Parar todas as contas até a data de volta? Sessões em andamento fecham com segurança.')) return;
  try {
    window.scheduleConfig = await api('/api/vacation', 'POST', { until: $('#vacation-until').value });
    renderVacation();
    toast('Modo férias ligado', 'success');
  } catch (err) {
    toast(err.message, 'danger');
  }
};
$('#vacation-end').onclick = async () => {
  try {
    window.scheduleConfig = await api('/api/vacation', 'DELETE');
    renderVacation();
    toast('Férias encerradas. As contas continuam de onde pararam.', 'success');
    accounts = await api('/api/accounts');
    renderAccounts();
  } catch (err) {
    toast(err.message, 'danger');
  }
};

// ---------- Backup dos logins ----------

async function renderBackup() {
  const b = await api('/api/backup').catch(() => null);
  if (!b) return;
  const last = b.last && b.last.at ? `${new Date(b.last.at).toLocaleString('pt-BR')} · ${b.last.sizeMB} MB` : 'Nenhum ainda';
  const err =
    b.last && b.last.error ? `<div class="acc-alert block"><b>Último backup falhou</b><span>${esc(b.last.error)}</span></div>` : '';
  $('#backup-box').innerHTML = `
    <div class="kv"><span>Pasta</span><b style="overflow-wrap:anywhere">${esc(b.dir)}</b></div>
    <div class="kv"><span>Último backup</span><b>${last}</b></div>
    <div class="kv"><span>Automático</span><b>Todo dia às ${b.at}, guardando os ${b.keep} mais recentes (${b.files.length} agora)</b></div>
    <div class="kv"><span>Situação</span><b>${b.running ? 'Fazendo backup...' : b.due ? 'Pendente: roda quando nenhuma conta estiver aberta' : 'Em dia'}</b></div>
    ${err}`;
}

$('#backup-now').onclick = async () => {
  const btn = $('#backup-now');
  btn.disabled = true;
  try {
    await api('/api/backup', 'POST');
    toast('Backup dos logins feito', 'success');
    renderBackup();
  } catch (err) {
    toast(err.message, 'danger');
  } finally {
    btn.disabled = false;
  }
};

async function refreshGeneral() {
  try {
    window.scheduleConfig = await api('/api/config');
    proxies = await api('/api/proxies');
    accounts = await api('/api/accounts');
  } catch {
    return;
  }
  renderVacation();
  renderBackup();
  renderProxies();
  renderAccounts();
}

let charts = {};

async function renderAnalytics() {
  if ($('#view-analytics').classList.contains('hidden')) return;
  const res = await api('/api/analytics').catch(() => null);
  if (!res) return;

  const data = res.kpis;
  $('#analytics-grid').innerHTML = `
    <div class="card" style="padding: 24px;">
      <div style="font-size: 0.9rem; color: var(--mut); margin-bottom: 8px;">Contas Monitoradas</div>
      <div style="font-size: 2.2rem; font-weight: 700;">${data.totalAccounts}</div>
      <div style="font-size: 0.85rem; color: var(--ok); margin-top: 8px;">${data.activeNow} em aquecimento agora</div>
    </div>
    <div class="card" style="padding: 24px;">
      <div style="font-size: 0.9rem; color: var(--mut); margin-bottom: 8px;">Taxa de Sucesso Global</div>
      <div style="font-size: 2.2rem; font-weight: 700; color: ${data.successRate >= 90 ? 'var(--ok)' : 'var(--warn)'};">${data.successRate}%</div>
      <div style="font-size: 0.85rem; color: var(--mut); margin-top: 8px;">De um total de ${data.totalSessions} sessões</div>
    </div>
    <div class="card" style="padding: 24px;">
      <div style="font-size: 0.9rem; color: var(--mut); margin-bottom: 8px;">Dwell Time Acumulado</div>
      <div style="font-size: 2.2rem; font-weight: 700;">${(data.totalMinutes / 60).toFixed(1)}h</div>
      <div style="font-size: 0.85rem; color: var(--mut); margin-top: 8px;">Tempo total simulando humanos</div>
    </div>
    <div class="card" style="padding: 24px;">
      <div style="font-size: 0.9rem; color: var(--mut); margin-bottom: 8px;">Bloqueios / Captchas</div>
      <div style="font-size: 2.2rem; font-weight: 700; color: ${data.blockedAccounts > 0 ? 'var(--bad)' : 'var(--mut)'};">${data.blockedAccounts}</div>
      <div style="font-size: 0.85rem; color: var(--mut); margin-top: 8px;">Contas sinalizadas na plataforma</div>
    </div>
  `;

  // Inicializa gráficos se não existirem
  if (!charts.history) {
    const commonOpts = {
      responsive: true,
      maintainAspectRatio: false,
      color: '#9a91b0',
      plugins: { legend: { position: 'bottom', labels: { color: '#9a91b0', usePointStyle: true, boxWidth: 8 } } },
    };

    charts.history = new Chart($('#chart-history'), {
      type: 'line',
      data: {
        labels: [],
        datasets: [
          {
            label: 'Minutos em Tela (Diário)',
            data: [],
            borderColor: '#ff3d7f',
            backgroundColor: 'rgba(255, 61, 127, 0.1)',
            fill: true,
            tension: 0.4,
            borderWidth: 3,
            pointBackgroundColor: '#ff3d7f',
          },
        ],
      },
      options: {
        ...commonOpts,
        scales: { y: { beginAtZero: true, grid: { color: 'rgba(255,255,255,0.05)' } }, x: { grid: { display: false } } },
      },
    });

    charts.platforms = new Chart($('#chart-platforms'), {
      type: 'doughnut',
      data: {
        labels: ['Instagram', 'TikTok'],
        datasets: [{ data: [0, 0], backgroundColor: ['#8b5cff', '#25f4ee'], borderWidth: 0, hoverOffset: 4 }],
      },
      options: {
        ...commonOpts,
        cutout: '75%',
        plugins: { legend: { position: 'right', labels: { color: '#9a91b0', usePointStyle: true } } },
      },
    });

    charts.success = new Chart($('#chart-success'), {
      type: 'doughnut',
      data: {
        labels: ['Sucesso', 'Falha'],
        datasets: [{ data: [0, 0], backgroundColor: ['#22d39a', '#ff5a7a'], borderWidth: 0, hoverOffset: 4 }],
      },
      options: {
        ...commonOpts,
        cutout: '75%',
        plugins: { legend: { position: 'right', labels: { color: '#9a91b0', usePointStyle: true } } },
      },
    });
  }

  // Atualiza Dados
  const hist = res.history;
  charts.history.data.labels = hist.map((d) => d.date.split('-').slice(1).reverse().join('/'));
  charts.history.data.datasets[0].data = hist.map((d) => d.minutes);
  charts.history.update();

  charts.platforms.data.datasets[0].data = [res.platforms.instagram.minutes, res.platforms.tiktok.minutes];
  charts.platforms.update();

  const successCount = Math.round((data.successRate / 100) * data.totalSessions);
  const failCount = data.totalSessions - successCount;
  charts.success.data.datasets[0].data = [successCount, failCount];
  charts.success.update();
}

init();
