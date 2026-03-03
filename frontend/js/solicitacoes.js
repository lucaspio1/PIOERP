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
      const isPendente     = r.status === 'pendente';
      const isEmAndamento  = r.status === 'em_andamento';
      const podeAtender    = isPendente || isEmAndamento;

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
                <button class="btn btn-sm btn-secondary" onclick="Solicitacoes.atualizarStatus(${r.id}, 'em_andamento')" title="Marcar em andamento">
                  Em Andamento
                </button>
              ` : ''}
              ${podeAtender ? `
                <button class="btn btn-sm btn-success" onclick="Solicitacoes.abrirModalAtender(${r.id})" title="Escolher pallet e atender">
                  Atendido
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
      corpo: `<div class="empty-row"><span class="spinner"></span> Buscando pallets disponíveis...</div>`,
      rodape: '',
    });

    try {
      const res = await Api.reparo.palletsDisponiveis(solicitacaoId);
      const pallets = res.data;

      if (!pallets.length) {
        document.getElementById('modal-body').innerHTML = `
          <div style="text-align:center;padding:24px">
            <p class="badge badge-warning" style="display:inline-block;padding:8px 14px;margin-bottom:12px">
              Nenhum pallet encontrado com itens deste modelo em estoque.
            </p>
            <p style="color:var(--c-text-muted);font-size:13px">
              Verifique se há equipamentos em status "Reposição" armazenados em pallets no porta-pallet.
            </p>
          </div>
        `;
        document.getElementById('modal-footer').innerHTML = `
          <button class="btn btn-outline" onclick="Modal.fechar()">Fechar</button>
        `;
        return;
      }

      document.getElementById('modal-body').innerHTML = `
        <div class="form-group">
          <p style="margin-bottom:12px">
            Selecione o pallet que será descido do porta-pallet para atender esta solicitação.
            O pallet será movido para a área de pré-triagem.
          </p>
          <label for="sol-pallet-select">Pallet *</label>
          <select id="sol-pallet-select" class="input-select">
            <option value="">Selecione o pallet...</option>
            ${pallets.map(p => `
              <option value="${p.pallet_id}">
                ${escapeHtml(p.pallet_codigo)} — ${escapeHtml(p.endereco_codigo)} (${p.qtd_itens} ${p.qtd_itens === 1 ? 'item' : 'itens'})
              </option>
            `).join('')}
          </select>
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
    // Conta apenas pendentes para o badge de alerta
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

  return { carregar, atualizarStatus, abrirModalAtender, _confirmarAtender };
})();
