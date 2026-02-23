/**
 * PIOERP — App Core
 * Responsável por: navegação SPA, utilitários de UI (Toast, Modal)
 * e inicialização dos módulos.
 */

// ═══════════════════════════════════════════════════════
// TOAST
// ═══════════════════════════════════════════════════════
const Toast = (() => {
  const icons = {
    success: `<svg class="toast-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="20 6 9 17 4 12"/></svg>`,
    error:   `<svg class="toast-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/></svg>`,
    warning: `<svg class="toast-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>`,
    info:    `<svg class="toast-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>`,
  };

  function show(type, title, message, duration = 4000) {
    const container = document.getElementById('toast-container');
    const el = document.createElement('div');
    el.className = `toast toast-${type}`;
    el.innerHTML = `
      ${icons[type] || icons.info}
      <div class="toast-body">
        <div class="toast-title">${escapeHtml(title)}</div>
        ${message ? `<div class="toast-message">${escapeHtml(message)}</div>` : ''}
      </div>
    `;
    container.appendChild(el);
    setTimeout(() => {
      el.style.animation = 'toastOut 250ms ease forwards';
      setTimeout(() => el.remove(), 250);
    }, duration);
  }

  return {
    success: (title, msg)  => show('success', title, msg),
    error:   (title, msg)  => show('error',   title, msg),
    warning: (title, msg)  => show('warning', title, msg),
    info:    (title, msg)  => show('info',    title, msg),
  };
})();

// ═══════════════════════════════════════════════════════
// MODAL
// ═══════════════════════════════════════════════════════
const Modal = (() => {
  const overlay = () => document.getElementById('modal-overlay');
  const box     = () => document.getElementById('modal-box');

  function abrir({ titulo, corpo, rodape, tamanho }) {
    document.getElementById('modal-titulo').textContent = titulo || '';
    document.getElementById('modal-body').innerHTML = corpo || '';
    document.getElementById('modal-footer').innerHTML = rodape || '';
    if (tamanho === 'lg') box().classList.add('modal-lg');
    else box().classList.remove('modal-lg');
    overlay().classList.add('open');
    // Foca no primeiro input
    setTimeout(() => {
      const first = box().querySelector('input, select, textarea');
      if (first) first.focus();
    }, 100);
  }

  function fechar() {
    overlay().classList.remove('open');
  }

  function fecharSeFora(e) {
    if (e.target === overlay()) fechar();
  }

  return { abrir, fechar, fecharSeFora };
})();

// ═══════════════════════════════════════════════════════
// UTILITÁRIOS
// ═══════════════════════════════════════════════════════

/** Sanitização básica para evitar XSS no innerHTML */
function escapeHtml(str) {
  if (str === null || str === undefined) return '—';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/** Formata data/hora para pt-BR */
function formatDateTime(iso) {
  if (!iso) return '—';
  return new Date(iso).toLocaleString('pt-BR', {
    day: '2-digit', month: '2-digit', year: 'numeric',
    hour: '2-digit', minute: '2-digit',
  });
}

/** Formata minutos para HH:MM */
function formatMinutos(min) {
  if (min === null || min === undefined) return '—';
  const h = Math.floor(min / 60);
  const m = min % 60;
  return `${String(h).padStart(2, '0')}h ${String(m).padStart(2, '0')}min`;
}

/** Formata segundos para HH:MM:SS */
function formatTimer(totalSeconds) {
  const h = Math.floor(totalSeconds / 3600);
  const m = Math.floor((totalSeconds % 3600) / 60);
  const s = totalSeconds % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

/** Badge de status de equipamento */
function badgeStatus(status) {
  const labels = {
    reposicao:   'Reposição',
    ag_triagem:  'Ag. Triagem',
    venda:       'Venda',
    em_uso:      'Em Uso',
    pre_triagem: 'Pré-Triagem',
    pre_venda:   'Pré-Venda',
  };
  return `<span class="badge status-${status}">${labels[status] || status}</span>`;
}

/** Badge de status de solicitação de pallet */
function badgeStatusSolicitacao(status) {
  const map = {
    pendente:     { label: 'Pendente',     cls: 'badge-warning' },
    em_andamento: { label: 'Em Andamento', cls: 'badge-info' },
    atendida:     { label: 'Atendida',     cls: 'badge-success' },
    cancelada:    { label: 'Cancelada',    cls: 'badge-gray' },
  };
  const s = map[status] || { label: status, cls: 'badge-gray' };
  return `<span class="badge ${s.cls}">${s.label}</span>`;
}

/** Badge de status de reparo */
function badgeStatusReparo(status) {
  const labels = {
    aguardando:   'Aguardando',
    em_progresso: 'Em Andamento',
    pausado:      'Pausado',
    finalizado:   'Finalizado',
  };
  return `<span class="badge status-${status}">${labels[status] || status}</span>`;
}

/** Badge de nível WMS */
function badgeNivel(nivel) {
  const labels = {
    porta_pallet: 'Porta-Pallet',
    sessao:       'Sessão',
    pallet:       'Pallet',
    caixa:        'Caixa',
  };
  const colors = {
    porta_pallet: 'info',
    sessao:       'info',
    pallet:       'gray',
    caixa:        'success',
  };
  return `<span class="badge badge-${colors[nivel] || 'gray'}">${labels[nivel] || nivel}</span>`;
}

/** Monta string de localização completa */
function montarLocalizacao(row) {
  const parts = [row.porta_pallet_codigo, row.sessao_codigo, row.pallet_codigo, row.caixa_codigo]
    .filter(Boolean);
  return parts.length ? parts.join(' › ') : '—';
}

// ═══════════════════════════════════════════════════════
// NAVEGAÇÃO SPA
// ═══════════════════════════════════════════════════════
const App = (() => {
  const sections = {
    'dashboard':    { title: 'Dashboard',                onEnter: () => Dashboard.carregar() },
    'catalogo':     { title: 'Catálogo de Equipamentos', onEnter: () => Catalogo.carregar() },
    'enderecos':    { title: 'Endereços WMS',             onEnter: () => Endereco.carregar() },
    'equipamentos': { title: 'Equipamentos',              onEnter: () => Movimentacao.carregarEquipamentos() },
    'entrada':      { title: 'Entrada de Equipamento',   onEnter: () => Movimentacao.inicializarFormEntrada() },
    'saida':        { title: 'Saída / Movimentação',      onEnter: () => {} },
    'recebimento':  { title: 'Recebimento',               onEnter: () => Recebimento.carregar() },
    'solicitacoes': { title: 'Solicitações de Almoxarifado', onEnter: () => Solicitacoes.carregar() },
    'reparo':       { title: 'Central de Reparo',         onEnter: () => Reparo.carregar() },
  };

  let currentSection = 'dashboard';

  function navegar(sectionId) {
    if (!sections[sectionId]) return;

    // Atualiza nav
    document.querySelectorAll('.nav-item').forEach(a => a.classList.remove('active'));
    const link = document.querySelector(`.nav-item[data-section="${sectionId}"]`);
    if (link) link.classList.add('active');

    // Troca section
    document.querySelectorAll('.page-section').forEach(s => s.classList.remove('active'));
    const sec = document.getElementById(`section-${sectionId}`);
    if (sec) sec.classList.add('active');

    // Atualiza topbar
    document.getElementById('page-title').textContent = sections[sectionId].title;

    currentSection = sectionId;
    sections[sectionId].onEnter();
  }

  function refresh() {
    navegar(currentSection);
  }

  function init() {
    // Bind nav links
    document.querySelectorAll('.nav-item[data-section]').forEach(link => {
      link.addEventListener('click', e => {
        e.preventDefault();
        navegar(link.dataset.section);
      });
    });

    // Sidebar toggle
    document.getElementById('sidebar-toggle').addEventListener('click', () => {
      document.getElementById('app').classList.toggle('sidebar-collapsed');
    });

    // Search filter for catálogo
    document.getElementById('search-catalogo')?.addEventListener('input', e => {
      Catalogo.filtrar(e.target.value);
    });

    // Search filter for equipamentos
    document.getElementById('search-equip')?.addEventListener('input', e => {
      Movimentacao.filtrarEquipamentos(e.target.value);
    });

    // Filter nivel enderecos
    document.getElementById('filter-nivel')?.addEventListener('change', e => {
      Endereco.carregar(e.target.value);
    });

    navegar('dashboard');
  }

  return { navegar, refresh, init };
})();

// ═══════════════════════════════════════════════════════
// DASHBOARD
// ═══════════════════════════════════════════════════════
const Dashboard = (() => {
  async function carregar() {
    try {
      const [dash, criticos] = await Promise.all([
        Api.movimentacao.dashboard(),
        Api.movimentacao.estoqueCritico(),
      ]);

      const t = dash.data.totais;
      document.getElementById('kpi-total').textContent     = t.total_equipamentos || 0;
      document.getElementById('kpi-reposicao').textContent = t.em_reposicao       || 0;
      document.getElementById('kpi-triagem').textContent   = t.em_triagem         || 0;
      document.getElementById('kpi-alertas').textContent   = dash.data.alertas_criticos || 0;

      // Badge na nav
      const badge = document.getElementById('badge-reparo');
      if (parseInt(t.em_triagem, 10) > 0) {
        badge.textContent = t.em_triagem;
        badge.style.display = 'inline-flex';
      } else {
        badge.style.display = 'none';
      }

      // Tabela alertas
      const tbodyAlertas = document.getElementById('tbody-alertas');
      document.getElementById('alertas-count').textContent = criticos.total;
      if (!criticos.data.length) {
        tbodyAlertas.innerHTML = `<tr><td colspan="6" class="empty-row">Nenhum alerta crítico. Estoque dentro dos limites.</td></tr>`;
      } else {
        tbodyAlertas.innerHTML = criticos.data.map(r => `
          <tr class="row-critical">
            <td><strong>${escapeHtml(r.nome)}</strong></td>
            <td>${escapeHtml(r.categoria)}</td>
            <td>${r.estoque_minimo}</td>
            <td><strong style="color:var(--c-danger)">${r.qtd_reposicao}</strong></td>
            <td><span class="badge badge-danger">-${Math.abs(r.deficit)}</span></td>
            <td>${r.qtd_ag_triagem}</td>
          </tr>
        `).join('');
      }

      // Tabela movimentações recentes
      const tbodyRec = document.getElementById('tbody-recentes');
      const movs = dash.data.movimentacoes_recentes || [];
      if (!movs.length) {
        tbodyRec.innerHTML = `<tr><td colspan="5" class="empty-row">Nenhuma movimentação registrada.</td></tr>`;
      } else {
        const tipoLabel = {
          entrada_compra:          'Entrada Compra',
          entrada_retorno_reparo:  'Retorno Reparo',
          entrada_recebimento:     'Recebimento',
          saida_uso:               'Saída para Uso',
          saida_triagem:           'Enviado Triagem',
          saida_venda:             'Baixa Venda',
          movimentacao:            'Movimentação',
          transferencia_lote:      'Transf. em Lote',
        };
        tbodyRec.innerHTML = movs.map(m => `
          <tr>
            <td>${formatDateTime(m.created_at)}</td>
            <td>${escapeHtml(m.modelo)}</td>
            <td><code>${escapeHtml(m.numero_serie)}</code></td>
            <td>${escapeHtml(tipoLabel[m.tipo] || m.tipo)}</td>
            <td>${badgeStatus(m.status_novo)}</td>
          </tr>
        `).join('');
      }
    } catch (err) {
      Toast.error('Erro ao carregar dashboard', err.message);
    }
  }

  return { carregar };
})();

// Inicializa quando o DOM estiver pronto
document.addEventListener('DOMContentLoaded', () => App.init());
