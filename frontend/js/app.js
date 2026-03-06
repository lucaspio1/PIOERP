/**
 * PIOERP — App Core
 * Responsável por: navegação SPA (Dinâmica), utilitários de UI (Toast, Modal)
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
function escapeHtml(str) {
  if (str === null || str === undefined) return '—';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function formatDateTime(iso) {
  if (!iso) return '—';
  return new Date(iso).toLocaleString('pt-BR', {
    day: '2-digit', month: '2-digit', year: 'numeric',
    hour: '2-digit', minute: '2-digit',
  });
}

function formatMinutos(min) {
  if (min === null || min === undefined) return '—';
  const h = Math.floor(min / 60);
  const m = min % 60;
  return `${String(h).padStart(2, '0')}h ${String(m).padStart(2, '0')}min`;
}

function formatTimer(totalSeconds) {
  const h = Math.floor(totalSeconds / 3600);
  const m = Math.floor((totalSeconds % 3600) / 60);
  const s = totalSeconds % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

function badgeStatus(status) {
  const labels = {
    reposicao:         'Reposição',
    ag_triagem:        'Ag. Triagem',
    venda:             'Venda',
    em_uso:            'Em Uso',
    pre_triagem:       'Pré-Triagem',
    pre_venda:         'Ag. Venda',
    ag_internalizacao: 'Ag. Internalização',
  };
  return `<span class="badge status-${status}">${labels[status] || status}</span>`;
}

function badgeStatusSolicitacao(status) {
  const map = {
    pendente:     { label: 'Pendente',     cls: 'badge-warning' },
    atendida:     { label: 'Atendida',     cls: 'badge-success' },
    cancelada:    { label: 'Cancelada',    cls: 'badge-gray' },
  };
  const s = map[status] || { label: status, cls: 'badge-gray' };
  return `<span class="badge ${s.cls}">${s.label}</span>`;
}

function badgeStatusReparo(status) {
  const labels = {
    aguardando:   'Aguardando',
    em_progresso: 'Em Andamento',
    pausado:      'Pausado',
    finalizado:   'Finalizado',
  };
  return `<span class="badge status-${status}">${labels[status] || status}</span>`;
}

function montarLocalizacao(row) {
  if (row.caixa_codigo) {
    return `${row.pallet_endereco_codigo || '?'} › ${row.pallet_codigo || '?'} › ${row.caixa_codigo}`;
  }
  return row.endereco_codigo || '—';
}

// ═══════════════════════════════════════════════════════
// NAVEGAÇÃO SPA (DINÂMICA)
// ═══════════════════════════════════════════════════════
const App = (() => {
  const sections = {
    'dashboard':    { title: 'Dashboard',                onEnter: () => { if(window.Dashboard) Dashboard.carregar(); } },
    'catalogo':     { title: 'Catálogo de Equipamentos', onEnter: () => { if(window.Catalogo) Catalogo.carregar(); } },
    'enderecos':    { title: 'Endereços WMS',             onEnter: () => { if(window.Endereco) Endereco.carregar(); } },
    'wms-mapa':     { title: 'Mapa Porta-Pallet',         onEnter: () => { if(window.WmsMapa) WmsMapa.init(); } },
    'equipamentos': { title: 'Equipamentos',              onEnter: () => { if(window.Movimentacao) Movimentacao.carregarEquipamentos(); } },
    'entrada':      { title: 'Entrada de Equipamento',   onEnter: () => { if(window.Movimentacao) Movimentacao.inicializarFormEntrada(); } },
    'saida':        { title: 'Saída / Movimentação',      onEnter: () => {} },
    'recebimento':  { title: 'Recebimento',               onEnter: () => { if(window.Recebimento) Recebimento.carregar(); } },
    'solicitacoes': { title: 'Solicitações de Almoxarifado', onEnter: () => { if(window.Solicitacoes) Solicitacoes.carregar(); } },
    'reparo':       { title: 'Central de Reparo',          onEnter: () => { if(window.Reparo) Reparo.carregar(); } },
    'internalizacao':{ title: 'Internalização',             onEnter: () => { if(window.Internalizacao) Internalizacao.carregar(); } },
  };

  let currentSection = 'dashboard';

  async function navegar(sectionId) {
    if (!sections[sectionId]) return;
    currentSection = sectionId;

    // 1. Atualiza CSS do menu lateral
    document.querySelectorAll('.nav-item').forEach(a => a.classList.remove('active'));
    const link = document.querySelector(`.nav-item[data-section="${sectionId}"]`);
    if (link) link.classList.add('active');

    // 2. Atualiza título no Topbar
    document.getElementById('page-title').textContent = sections[sectionId].title;

    // 3. Mostra spinner na área de conteúdo
    const pageContent = document.getElementById('page-content');
    pageContent.innerHTML = `
      <div style="padding: 3rem; text-align: center; color: var(--c-text-muted);">
        <span class="spinner" style="width:30px;height:30px;border-width:3px;vertical-align:middle;margin-right:10px;"></span> 
        Carregando tela...
      </div>
    `;

    try {
      // 4. Busca o arquivo HTML da pasta pages/
      const response = await fetch(`pages/${sectionId}.html`);
      if (!response.ok) throw new Error(`Página não encontrada (Erro ${response.status})`);
      
      // 5. Injeta o HTML na tela
      pageContent.innerHTML = await response.text();

      // 6. Refaz as ligações de eventos (buscas, filtros) que pertencem à nova tela injetada
      bindDynamicEvents();

      // 7. Dispara a função de carregamento daquele módulo
      sections[sectionId].onEnter();

    } catch (error) {
      pageContent.innerHTML = `
        <div class="card" style="margin: 2rem; border-left: 4px solid var(--c-danger);">
          <div class="card-body">
            <h3 style="color: var(--c-danger); margin-bottom: 0.5rem;">Erro de Navegação</h3>
            <p style="color: var(--c-text-secondary);">${escapeHtml(error.message)}</p>
            <button class="btn btn-outline" style="margin-top: 1rem;" onclick="App.refresh()">Tentar Novamente</button>
          </div>
        </div>
      `;
      Toast.error('Erro ao carregar', error.message);
    }
  }

  // Como o HTML agora é injetado, os inputs de busca deixam de existir no carregamento inicial.
  // Precisamos atrelar os eventos de 'input' toda vez que a página correspondente entra na tela.
  function bindDynamicEvents() {
    const searchCatalogo = document.getElementById('search-catalogo');
    if (searchCatalogo && window.Catalogo) {
      searchCatalogo.addEventListener('input', e => Catalogo.filtrar(e.target.value));
    }

    const searchEquip = document.getElementById('search-equip');
    if (searchEquip && window.Movimentacao) {
      searchEquip.addEventListener('input', e => Movimentacao.filtrarEquipamentos(e.target.value));
    }

    const filterNivel = document.getElementById('filter-nivel');
    if (filterNivel && window.Endereco) {
      filterNivel.addEventListener('change', e => Endereco.carregar(e.target.value));
    }
  }

  function refresh() {
    navegar(currentSection);
  }

  function init() {
    // Nav links
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
      if (badge) {
          if (parseInt(t.em_triagem, 10) > 0) {
            badge.textContent = t.em_triagem;
            badge.style.display = 'inline-flex';
          } else {
            badge.style.display = 'none';
          }
      }

      // Tabela alertas
      const tbodyAlertas = document.getElementById('tbody-alertas');
      const countAlertas = document.getElementById('alertas-count');
      if (countAlertas) countAlertas.textContent = criticos.total;
      
      if (tbodyAlertas) {
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
      }

      // Tabela movimentações recentes
      const tbodyRec = document.getElementById('tbody-recentes');
      if (tbodyRec) {
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
      }
    } catch (err) {
      Toast.error('Erro ao carregar dashboard', err.message);
    }
  }

  return { carregar };
})();

// Inicializa quando o DOM estiver pronto
document.addEventListener('DOMContentLoaded', () => App.init());