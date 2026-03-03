/**
 * PIOERP — Módulo: Solicitações de Almoxarifado
 *
 * Permite que o almoxarife visualize e atenda as solicitações de
 * descida de pallet/lote enviadas pelos técnicos da Central de Reparo.
 */

const Solicitacoes = (() => {
  let _lista = [];

  // ════════════════════════════════════════════════════════
  // CARREGAR
  // ════════════════════════════════════════════════════════

  async function carregar() {
    const tbody = document.getElementById('tbody-solicitacoes');
    const status = document.getElementById('filter-sol-status')?.value || '';
    tbody.innerHTML = `<tr><td colspan="9" class="empty-row"><span class="spinner"></span></td></tr>`;

    try {
      const res = await Api.reparo.listarSolicitacoes(status);
      _lista = res.data;
      _renderizar(_lista);
      _atualizarBadge(res.data);
    } catch (err) {
      tbody.innerHTML = `<tr><td colspan="9" class="empty-row" style="color:var(--c-danger)">${escapeHtml(err.message)}</td></tr>`;
      Toast.error('Erro ao carregar solicitações', err.message);
    }
  }

  function _renderizar(lista) {
    const tbody = document.getElementById('tbody-solicitacoes');
    if (!lista.length) {
      tbody.innerHTML = `<tr><td colspan="9" class="empty-row">Nenhuma solicitação encontrada.</td></tr>`;
      return;
    }

    tbody.innerHTML = lista.map(r => {
      const isPendente = r.status === 'pendente';

      return `
        <tr class="${isPendente ? 'row-critical' : ''}">
          <td><span style="color:var(--c-text-muted);font-size:12px">#${r.id}</span></td>
          <td>
            <div><strong>${escapeHtml(r.modelo)}</strong></div>
            <div style="font-size:11px;color:var(--c-text-muted)">${escapeHtml(r.categoria)}</div>
          </td>
          <td>${escapeHtml(r.categoria)}</td>
          <td>
            <span style="font-weight:700;color:${r.deficit > 0 ? 'var(--c-danger)' : 'inherit'}">
              ${r.qtd_reposicao ?? '—'} / ${r.estoque_minimo}
            </span>
          </td>
          <td>
            ${r.deficit > 0
              ? `<span class="badge badge-danger">-${Math.abs(r.deficit)}</span>`
              : `<span class="badge badge-success">OK</span>`
            }
          </td>
          <td>${badgeStatusSolicitacao(r.status)}</td>
          <td style="font-size:12px">${formatDateTime(r.created_at)}</td>
          <td style="font-size:12px;color:var(--c-text-secondary)">${escapeHtml(r.observacao || '—')}</td>
          <td>
            <div class="action-group">
              ${isPendente ? `
                <button class="btn btn-sm btn-success" onclick="Solicitacoes.abrirModalAtender(${r.id})" title="Escolher pallet e atender">
                  Atender
                </button>
                <button class="btn btn-sm btn-outline btn-danger-outline" onclick="Solicitacoes.atualizarStatus(${r.id}, 'cancelada')" title="Cancelar">
                  Cancelar
                </button>
              ` : ''}
            </div>
          </td>
        </tr>
      `;
    }).join('');
  }

  // ════════════════════════════════════════════════════════
  // AÇÕES
  // ════════════════════════════════════════════════════════

  async function atualizarStatus(id, novoStatus) {
    try {
      const res = await Api.reparo.atualizarSolicitacao(id, { status: novoStatus });
      Toast.success(res.message);
      await carregar();
    } catch (err) {
      Toast.error('Erro ao atualizar solicitação', err.message);
    }
  }

  // ════════════════════════════════════════════════════════
  // MODAL: Escolher Pallet para Atender
  // ════════════════════════════════════════════════════════

  async function abrirModalAtender(solicitacaoId) {
    Modal.abrir({
      titulo: 'Escolher Pallet para Atendimento',
      tamanho: 'lg',
      corpo: `<div class="empty-row"><span class="spinner"></span> Carregando endereços...</div>`,
      rodape: '',
    });

    try {
      // Carrega endereços (somente porta-pallets, sem RECV-*)
      const resEnd = await Api.endereco.listar();
      const enderecos = (resEnd.data || []).filter(e => e.ativo && !e.codigo.startsWith('RECV-'));

      document.getElementById('modal-body').innerHTML = `
        <p style="margin-bottom:16px">
          Selecione o endereço e o pallet que será descido do porta-pallet.
          O pallet será movido para a área de pré-triagem.
        </p>

        <div class="form-group">
          <label for="sol-end-select">1. Endereço (Porta-Pallet) *</label>
          <select id="sol-end-select" class="input-select" onchange="Solicitacoes._onEnderecoChange(${solicitacaoId})">
            <option value="">Selecione o endereço...</option>
            ${enderecos.map(e => `<option value="${e.id}">${escapeHtml(e.codigo)}</option>`).join('')}
          </select>
        </div>

        <div class="form-group" id="sol-pallet-group" style="display:none">
          <label>2. Pallet *</label>
          <div class="input-with-btn">
            <select id="sol-pallet-select" class="input-select">
              <option value="">Selecione o pallet...</option>
            </select>
            <button type="button" class="btn btn-secondary" onclick="Solicitacoes._mostrarCriarPallet()">+ Pallet</button>
          </div>
          <div id="sol-criar-pallet-inline" style="display:none;margin-top:8px">
            <div style="display:flex;gap:8px;align-items:center">
              <input type="text" id="sol-novo-pallet-codigo" class="input-text" style="flex:1"
                placeholder="Código ex: P-001" />
              <button class="btn btn-sm btn-primary" onclick="Solicitacoes._criarPallet(${solicitacaoId})">Criar</button>
              <button class="btn btn-sm btn-outline" onclick="Solicitacoes._ocultarCriarPallet()">&times;</button>
            </div>
          </div>
        </div>
      `;
      document.getElementById('modal-footer').innerHTML = `
        <button class="btn btn-outline" onclick="Modal.fechar()">Cancelar</button>
        <button class="btn btn-success" onclick="Solicitacoes._confirmarAtender(${solicitacaoId})">
          Confirmar Atendimento
        </button>
      `;
    } catch (err) {
      document.getElementById('modal-body').innerHTML =
        `<p style="color:var(--c-danger)">${escapeHtml(err.message)}</p>`;
      document.getElementById('modal-footer').innerHTML = `
        <button class="btn btn-outline" onclick="Modal.fechar()">Fechar</button>
      `;
    }
  }

  // ── Cascata: ao selecionar endereço, carrega pallets ───
  async function _onEnderecoChange(solicitacaoId) {
    const enderecoId = document.getElementById('sol-end-select')?.value;
    const palletGroup = document.getElementById('sol-pallet-group');
    const palletSelect = document.getElementById('sol-pallet-select');

    if (!enderecoId) {
      palletGroup.style.display = 'none';
      return;
    }

    palletSelect.innerHTML = `<option value="">Carregando...</option>`;
    palletGroup.style.display = '';
    _ocultarCriarPallet();

    try {
      const res = await Api.pallets.listar(enderecoId);
      const pallets = res.data || [];

      if (!pallets.length) {
        palletSelect.innerHTML = `<option value="">Nenhum pallet neste endereço</option>`;
      } else {
        palletSelect.innerHTML = `
          <option value="">Selecione o pallet...</option>
          ${pallets.map(p => `
            <option value="${p.id}">${escapeHtml(p.codigo)}</option>
          `).join('')}
        `;
      }
    } catch (err) {
      palletSelect.innerHTML = `<option value="">Erro ao carregar pallets</option>`;
      Toast.error('Erro ao carregar pallets', err.message);
    }
  }

  // ── Criar pallet inline ────────────────────────────────
  function _mostrarCriarPallet() {
    document.getElementById('sol-criar-pallet-inline').style.display = '';
    document.getElementById('sol-novo-pallet-codigo').focus();
  }

  function _ocultarCriarPallet() {
    document.getElementById('sol-criar-pallet-inline').style.display = 'none';
    const input = document.getElementById('sol-novo-pallet-codigo');
    if (input) input.value = '';
  }

  async function _criarPallet(solicitacaoId) {
    const codigo = document.getElementById('sol-novo-pallet-codigo')?.value?.trim();
    const enderecoId = document.getElementById('sol-end-select')?.value;

    if (!codigo) { Toast.error('Informe o código do pallet.'); return; }
    if (!enderecoId) { Toast.error('Selecione um endereço primeiro.'); return; }

    try {
      const res = await Api.pallets.criar({ codigo, endereco_id: Number(enderecoId) });
      Toast.success(`Pallet "${res.data.codigo}" criado.`);
      _ocultarCriarPallet();
      // Recarrega pallets e seleciona o novo automaticamente
      await _onEnderecoChange(solicitacaoId);
      const select = document.getElementById('sol-pallet-select');
      if (select) select.value = res.data.id;
    } catch (err) {
      Toast.error('Erro ao criar pallet', err.message);
    }
  }

  // ── Confirmar atendimento ──────────────────────────────
  async function _confirmarAtender(solicitacaoId) {
    const palletId = document.getElementById('sol-pallet-select')?.value;
    if (!palletId) {
      Toast.error('Selecione um pallet antes de confirmar.');
      return;
    }

    try {
      const res = await Api.reparo.atualizarSolicitacao(solicitacaoId, {
        status: 'atendida',
        pallet_id: palletId,
      });
      Modal.fechar();
      Toast.success(res.message);
      await carregar();
    } catch (err) {
      Toast.error('Erro ao atender solicitação', err.message);
    }
  }

  // ── Badge na nav ─────────────────────────────────────────
  async function _atualizarBadge(lista) {
    let pendentes = 0;
    if (lista) {
      pendentes = lista.filter(s => s.status === 'pendente').length;
    } else {
      try {
        const res = await Api.reparo.listarSolicitacoes('pendente');
        pendentes = res.total;
      } catch (_) { return; }
    }

    const badge = document.getElementById('badge-solicitacoes');
    if (badge) {
      badge.textContent = pendentes;
      badge.style.display = pendentes > 0 ? 'inline-flex' : 'none';
    }
  }

  return {
    carregar, atualizarStatus, abrirModalAtender,
    _onEnderecoChange, _mostrarCriarPallet, _ocultarCriarPallet,
    _criarPallet, _confirmarAtender,
  };
})();
