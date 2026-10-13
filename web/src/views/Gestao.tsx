// Painel de Gestão da Frota de Aparelhos (Admin): exclusivo para o Vini (vfbnn29@gmail.com).
// Mostra todos os computadores na rede, versões do app, contas de cada cliente, status e histórico de erros.
import { useCallback, useEffect, useMemo, useState } from 'react';
import { api, type FleetAccount, type FleetData, type FleetSessionItem } from '../api.ts';
import { Icon, PlatformBadge } from '../components/Icon.tsx';
import { useStore } from '../store.tsx';

function formatRelTime(dateStr: string | null): string {
  if (!dateStr) return 'Nunca';
  const t = Date.parse(dateStr);
  if (isNaN(t)) return 'Desconhecido';
  const diffSec = Math.floor((Date.now() - t) / 1000);
  if (diffSec < 60) return 'Agora mesmo';
  const diffMin = Math.floor(diffSec / 60);
  if (diffMin < 60) return `Há ${diffMin} min`;
  const diffH = Math.floor(diffMin / 60);
  if (diffH < 24) return `Há ${diffH} h`;
  const diffD = Math.floor(diffH / 24);
  if (diffD < 7) return `Há ${diffD} dia${diffD > 1 ? 's' : ''}`;
  return new Date(t).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
}

function formatExactDate(dateStr: string | null): string {
  if (!dateStr) return '—';
  const t = Date.parse(dateStr);
  if (isNaN(t)) return dateStr;
  return new Date(t).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}

export function Gestao() {
  const { me, go, toast } = useStore();
  const [data, setData] = useState<FleetData | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState<'all' | 'online' | 'outdated' | 'errors'>('all');
  const [expandedDevice, setExpandedDevice] = useState<string | null>(null);

  // Segurança estrita no frontend: se não for o e-mail do Vini, volta imediatamente ao cockpit
  const isAdmin = me?.email === 'vfbnn29@gmail.com';
  useEffect(() => {
    if (!isAdmin) {
      go('cockpit');
    }
  }, [isAdmin, go]);

  const loadData = useCallback(async (isRefresh = false) => {
    if (isRefresh) setRefreshing(true);
    else setLoading(true);
    setError(null);
    try {
      const res = await api<FleetData>('/api/admin/fleet');
      setData(res);
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : 'Erro ao carregar frota';
      setError(msg);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    if (isAdmin) {
      loadData();
      const interval = setInterval(() => loadData(true), 30000);
      return () => clearInterval(interval);
    }
  }, [isAdmin, loadData]);

  const copyId = useCallback(
    (id: string) => {
      navigator.clipboard.writeText(id).then(
        () => toast('ID copiado para a área de transferência', 'ok'),
        () => toast('Não foi possível copiar', 'bad'),
      );
    },
    [toast],
  );

  const filteredDevices = useMemo(() => {
    if (!data) return [];
    let list = data.devices;

    if (filter === 'online') list = list.filter((d) => d.online);
    else if (filter === 'outdated') list = list.filter((d) => !d.isLatest);
    else if (filter === 'errors') list = list.filter((d) => d.totalErrors > 0);

    if (search.trim()) {
      const q = search.toLowerCase();
      list = list.filter(
        (d) =>
          d.name.toLowerCase().includes(q) ||
          d.ownerEmail.toLowerCase().includes(q) ||
          d.appVersion.toLowerCase().includes(q) ||
          d.accounts.some((a) => a.username.toLowerCase().includes(q)),
      );
    }

    return list;
  }, [data, filter, search]);

  if (!isAdmin) return null;

  return (
    <div className="fleet-view">
      {/* Resumo executivo / KPIs no topo */}
      {data && (
        <div className="fleet-kpis">
          <div className="fleet-kpi-card">
            <div className="fk-icon">
              <Icon name="monitor" />
            </div>
            <div className="fk-data">
              <span className="fk-val">{data.summary.totalDevices}</span>
              <span className="fk-lbl">Computadores</span>
            </div>
          </div>

          <div className="fleet-kpi-card">
            <div className="fk-icon online">
              <span className="fleet-pulse-dot" />
            </div>
            <div className="fk-data">
              <span className="fk-val ok">{data.summary.onlineDevices}</span>
              <span className="fk-lbl">Online agora</span>
            </div>
          </div>

          <div className="fleet-kpi-card">
            <div className={`fk-icon ${data.summary.outdatedDevices > 0 ? 'warn' : 'ok'}`}>
              <Icon name={data.summary.outdatedDevices > 0 ? 'alertCircle' : 'check'} />
            </div>
            <div className="fk-data">
              <span className={`fk-val ${data.summary.outdatedDevices > 0 ? 'warn' : 'ok'}`}>{data.summary.outdatedDevices}</span>
              <span className="fk-lbl">{data.summary.outdatedDevices > 0 ? 'Desatualizados' : 'Todos atualizados'}</span>
            </div>
          </div>

          <div className="fleet-kpi-card">
            <div className="fk-icon">
              <Icon name="flame" />
            </div>
            <div className="fk-data">
              <span className="fk-val">{data.summary.totalAccounts}</span>
              <span className="fk-lbl">Contas na rede</span>
            </div>
          </div>

          <div className="fleet-kpi-card">
            <div className={`fk-icon ${data.summary.totalErrors24h > 0 ? 'bad' : 'ok'}`}>
              <Icon name={data.summary.totalErrors24h > 0 ? 'bolt' : 'check'} />
            </div>
            <div className="fk-data">
              <span className={`fk-val ${data.summary.totalErrors24h > 0 ? 'bad' : 'ok'}`}>{data.summary.totalErrors24h}</span>
              <span className="fk-lbl">Erros nas últimas 24h</span>
            </div>
          </div>

          <div className="fleet-kpi-card">
            <div className="fk-icon version">
              <Icon name="sliders" />
            </div>
            <div className="fk-data">
              <span className="fk-val brand">v{data.summary.latestVersion}</span>
              <span className="fk-lbl">Versão mais recente</span>
            </div>
          </div>
        </div>
      )}

      {/* Barra de Ações: Filtros, Pesquisa e Refresh */}
      <div className="fleet-toolbar">
        <div className="fleet-search-box">
          <Icon name="search" />
          <input
            type="text"
            className="input sm"
            placeholder="Buscar por computador, e-mail, conta ou versão..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
          {search && (
            <button className="icon-btn xs" onClick={() => setSearch('')} aria-label="Limpar busca">
              <Icon name="x" />
            </button>
          )}
        </div>

        <div className="fleet-filters">
          <button className={`btn sm ${filter === 'all' ? 'primary' : ''}`} onClick={() => setFilter('all')}>
            Todos ({data?.devices.length ?? 0})
          </button>
          <button className={`btn sm ${filter === 'online' ? 'primary' : ''}`} onClick={() => setFilter('online')}>
            Online ({data?.summary.onlineDevices ?? 0})
          </button>
          <button className={`btn sm ${filter === 'outdated' ? 'primary' : ''}`} onClick={() => setFilter('outdated')}>
            Desatualizados ({data?.summary.outdatedDevices ?? 0})
          </button>
          <button className={`btn sm ${filter === 'errors' ? 'primary' : ''}`} onClick={() => setFilter('errors')}>
            Com falhas
          </button>
        </div>

        <button
          className={`btn sm ${refreshing ? 'loading' : ''}`}
          onClick={() => loadData(true)}
          disabled={loading || refreshing}
          title="Recarregar dados agora"
        >
          <Icon name="refresh" className={refreshing ? 'spin' : ''} />
          {refreshing ? 'Sincronizando...' : 'Atualizar'}
        </button>
      </div>

      {/* Estados de carregamento e erro */}
      {loading && !data && (
        <div className="panel empty">
          <span className="spinner" />
          <p className="muted">Carregando mapa de computadores e contas da frota...</p>
        </div>
      )}

      {error && (
        <div className="banner" role="alert">
          <Icon name="alertCircle" />
          <div className="grow">
            <b>Erro ao carregar dados da frota.</b> <span className="muted">{error}</span>
          </div>
          <button className="btn sm primary" onClick={() => loadData(false)}>
            Tentar de novo
          </button>
        </div>
      )}

      {/* Lista detalhada dos computadores */}
      {!loading && data && filteredDevices.length === 0 && (
        <div className="panel empty">
          <div className="empty-art">
            <Icon name="monitor" />
          </div>
          <h2>Nenhum computador encontrado</h2>
          <p className="muted">
            {search || filter !== 'all'
              ? 'Nenhum computador corresponde aos filtros aplicados.'
              : 'Nenhum computador registrado na frota ainda.'}
          </p>
          {(search || filter !== 'all') && (
            <button
              className="btn sm"
              onClick={() => {
                setSearch('');
                setFilter('all');
              }}
            >
              Limpar filtros
            </button>
          )}
        </div>
      )}

      <div className="fleet-list">
        {filteredDevices.map((dev) => {
          const isExpanded = expandedDevice === dev.id;
          const toggleExpand = () => setExpandedDevice(isExpanded ? null : dev.id);

          return (
            <div
              key={dev.id}
              className={`fleet-device-card ${dev.online ? 'is-online' : 'is-offline'} ${!dev.isLatest ? 'is-outdated' : ''}`}
            >
              {/* Topo do Aparelho */}
              <div className="fdc-header">
                <div className="fdc-title-group">
                  <div className="fdc-name-row">
                    <span className={`fleet-status-dot ${dev.online ? 'online' : 'offline'}`} />
                    <h2 className="fdc-name">{dev.name}</h2>
                    <span className="badge sm muted id-badge" title="ID do Aparelho" onClick={() => copyId(dev.id)}>
                      {dev.id.slice(0, 8)}…
                      <Icon name="copy" />
                    </span>
                  </div>
                  <div className="fdc-owner-row">
                    <span className="fdc-owner-email">{dev.ownerEmail}</span>
                    <span className="fdc-dot">·</span>
                    <span className="muted fdc-last-seen" title={`Último sinal: ${formatExactDate(dev.lastSeen)}`}>
                      {dev.online ? 'Online agora' : `Visto ${formatRelTime(dev.lastSeen)}`}
                    </span>
                  </div>
                </div>

                <div className="fdc-version-badge">
                  {dev.isLatest ? (
                    <span className="badge ok">
                      <Icon name="check" /> v{dev.appVersion} (Mais recente)
                    </span>
                  ) : (
                    <span className="badge warn" title={`Versão recomendada: v${data?.summary.latestVersion ?? ''}`}>
                      <Icon name="alertCircle" /> v{dev.appVersion} (Desatualizado)
                    </span>
                  )}
                </div>
              </div>

              {/* Informações da Máquina e Configuração */}
              <div className="fdc-config-grid">
                <div className="fdc-cfg-item">
                  <span className="fdc-cfg-label">Janela operacional</span>
                  <span className="fdc-cfg-val">
                    {dev.config.start && dev.config.end ? `${dev.config.start} às ${dev.config.end}` : 'Padrão (08h às 22h)'}
                  </span>
                </div>

                <div className="fdc-cfg-item">
                  <span className="fdc-cfg-label">Instâncias máx.</span>
                  <span className="fdc-cfg-val">{dev.config.max ? `${dev.config.max} navegadores` : 'Padrão (2)'}</span>
                </div>

                <div className="fdc-cfg-item">
                  <span className="fdc-cfg-label">Modo da tela</span>
                  <span className="fdc-cfg-val">{dev.config.headless ? 'Oculto (headless)' : 'Visível na tela'}</span>
                </div>

                <div className="fdc-cfg-item">
                  <span className="fdc-cfg-label">Último backup</span>
                  <span className="fdc-cfg-val">
                    {dev.config.lastBackup
                      ? `${formatRelTime(new Date(dev.config.lastBackup.at).toISOString())} (${(dev.config.lastBackup.sizeMB ?? 0).toFixed(1)} MB)`
                      : 'Sem backup registrado'}
                  </span>
                </div>
              </div>

              {/* Contas Vinculadas */}
              <div className="fdc-section">
                <div className="fdc-section-header">
                  <span className="fdc-sec-title">Contas neste computador ({dev.accountsCount})</span>
                </div>

                {dev.accounts.length === 0 ? (
                  <p className="muted fdc-empty-accounts">Nenhuma conta atribuída a este computador.</p>
                ) : (
                  <div className="fdc-accounts-chips">
                    {dev.accounts.map((acc: FleetAccount) => (
                      <div key={acc.id} className="fdc-acc-chip">
                        <PlatformBadge platform={acc.platform} size="xs" />
                        <span className="fdc-acc-user">@{acc.username}</span>
                        {acc.hasProxy ? (
                          <span className="badge xs ok" title={acc.proxyInfo ? `Proxy configurado: ${acc.proxyInfo}` : 'Com proxy configurado'}>
                            <Icon name="globe" /> {acc.proxyInfo ? acc.proxyInfo : 'Proxy'}
                          </span>
                        ) : (
                          <span className="badge xs muted" title="Sem proxy">
                            Direto
                          </span>
                        )}
                        {Boolean(acc.status?.schedule) && (
                          <span className="badge xs muted fdc-acc-schedule">{String(acc.status?.schedule)}</span>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* Saúde das Sessões e Último Erro */}
              <div className="fdc-health-section">
                <div className="fdc-stats-row">
                  <div className="fdc-stat">
                    <span className="fdc-stat-lbl">Total de sessões:</span>
                    <span className="fdc-stat-val">{dev.totalSessions}</span>
                  </div>
                  <div className="fdc-stat">
                    <span className="fdc-stat-lbl">Com falha:</span>
                    <span className={`fdc-stat-val ${dev.totalErrors > 0 ? 'bad' : 'ok'}`}>{dev.totalErrors}</span>
                  </div>
                  <div className="fdc-stat">
                    <span className="fdc-stat-lbl">Taxa de sucesso:</span>
                    <span className={`fdc-stat-val ${dev.successRate >= 90 ? 'ok' : dev.successRate >= 60 ? 'warn' : 'bad'}`}>
                      {dev.successRate}%
                    </span>
                  </div>
                </div>

                {/* Exibição em destaque do último erro (se houver) */}
                {dev.lastError && (
                  <div className="fdc-last-error-box">
                    <div className="fdc-err-header">
                      <Icon name="alertCircle" />
                      <b>Último erro detectado ({formatRelTime(dev.lastError.at)}):</b>
                      <span className="fdc-err-acc">@{dev.lastError.account}</span>
                    </div>
                    <pre className="fdc-err-msg">{dev.lastError.error}</pre>
                  </div>
                )}
              </div>

              {/* Gaveta de Histórico de Sessões Recentes */}
              {dev.recentSessions.length > 0 && (
                <div className="fdc-sessions-toggle">
                  <button className="link sm" onClick={toggleExpand}>
                    <Icon name={isExpanded ? 'back' : 'arrow'} className={isExpanded ? 'rot-up' : 'rot-down'} />
                    {isExpanded ? 'Ocultar sessões recentes' : `Ver histórico de sessões (${dev.recentSessions.length})`}
                  </button>

                  {isExpanded && (
                    <div className="fdc-sessions-table-wrap">
                      <table className="fdc-sessions-table">
                        <thead>
                          <tr>
                            <th>Conta</th>
                            <th>Rede / Proxy</th>
                            <th>Início</th>
                            <th>Duração</th>
                            <th>Resultado</th>
                            <th>Detalhes / Erro</th>
                          </tr>
                        </thead>
                        <tbody>
                          {dev.recentSessions.map((s: FleetSessionItem) => (
                            <tr key={s.id} className={s.error ? 'err-row' : ''}>
                              <td className="bold">@{s.account}</td>
                              <td>
                                {s.usedProxy ? (
                                  <span className="badge xs ok" title={s.proxyInfo ? `Sessão executada via proxy: ${s.proxyInfo}` : 'Rodou com proxy'}>
                                    <Icon name="globe" /> {s.proxyInfo ? s.proxyInfo : 'Com proxy'}
                                  </span>
                                ) : (
                                  <span className="badge xs muted" title="Conexão direta sem proxy">
                                    Normal (direto)
                                  </span>
                                )}
                              </td>
                              <td>{formatRelTime(s.startedAt)}</td>
                              <td>{s.minutes ? `${s.minutes.toFixed(1)} min` : '< 1 min'}</td>
                              <td>
                                <span className={`badge xs ${s.result === 'ok' ? 'ok' : s.error ? 'bad' : 'muted'}`}>{s.result}</span>
                              </td>
                              <td className="fdc-err-cell" title={s.error || ''}>
                                {s.error ? s.error : <span className="muted">Concluída normalmente</span>}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
