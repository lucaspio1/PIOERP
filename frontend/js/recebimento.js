/**
 * PIOERP — Módulo: Recebimento
 *
 * Aba 1 - Entrada e Catalogação:
 *   Registra itens recebidos de outras lojas, destinando-os
 *   à prateleira de Pré-Triagem ou Pré-Venda.
 *
 * Aba 2 - Montar Pallet / Caixa:
 *   Consolida itens das prateleiras em caixas definitivas do
 *   porta-pallet, alterando status para ag_triagem ou venda.
 */

const Recebimento = (() => {
  // IDs fixos das caixas de recebimento (preenchidos ao carregar endereços)
  let _caixaPreTriagemId  = null;
  let _caixaPreVendaId    = null;
  let _todosCaixas        = [];      // Todas as caixas ativas (para select de destino)
  let _itensPrateleira    = [];      // Cache dos itens listados na aba 2
  let _abaAtual           = 'catalogacao';

  // ════════════════════════════════════════════════════════
  // INICIALIZAÇÃO / CARREGAR
  // ════════════════════════════════════════════════════════

  async function carregar() {
    try {
      await Promise.all([
        _inicializarFormCatalogacao(),
        carregarPrateleiras(),
        _carregarCaixasDestino(),
      ]);
    } catch (err) {
      Toast.error('Erro ao inicializar Recebimento', err.message);
    }
  }

  function trocarAba(aba) {
    _abaAtual = aba;
    document.querySelectorAll('.receb-tab-content').forEach(el => { el.style.display = 'none'; });
    document.querySelectorAll('.tab-btn').forEach(btn => btn.classList.remove('active', 'btn-primary'));
    document.querySelectorAll('.tab-btn').forEach(btn => btn.classList.add('btn-outline'));

    const conteudo = document.getElementById(`receb-${aba}`);
    if (conteudo) conteudo.style.display = 'block';

    const btnAtivo = document.querySelector(`.tab-btn[data-tab="receb-${aba}"]`);
    if (btnAtivo) {
      btnAtivo.classList.remove('btn-outline');
      btnAtivo.classList.add('active', 'btn-primary');
    }

    if (aba === 'montar') carregarPrateleiras();
  }

  // ════════════════════════════════════════════════════════
  // ABA 1: ENTRADA E CATALOGAÇÃO
  // ════════════════════════════════════════════════════════

  async function _inicializarFormCatalogacao() {
    try {
      const [catRes, endRes] = await Promise.all([
        Api.catalogo.listar(),
        Api.endereco.listar(),
      ]);

      // Popular catálogo
      const selCat = document.getElementById('receb-catalogo');
      selCat.innerHTML = '<option value="">Selecione o modelo...</option>' +
        catRes.data
          .filter(c => c.ativo)
          .map(c => `<option value="${c.id}">${escapeHtml(c.nome)} — ${escapeHtml(c.categoria)}</option>`)
          .join('');

      // Localiza caixas fixas de recebimento
      const caixaPreTriagem = endRes.data.find(e => e.codigo === 'RECV-CX-PRETRIAGEM');
      const caixaPreVenda   = endRes.data.find(e => e.codigo === 'RECV-CX-PREVENDA');

      _caixaPreTriagemId = caixaPreTriagem?.id || null;
      _caixaPreVendaId   = caixaPreVenda?.id   || null;

      document.getElementById('receb-addr-pretriagem').textContent =
        caixaPreTriagem ? caixaPreTriagem.codigo : 'Endereço não encontrado (rode a migration 004)';
      document.getElementById('receb-addr-prevenda').textContent =
        caixaPreVenda ? caixaPreVenda.codigo : 'Endereço não encontrado (rode a migration 004)';

    } catch (err) {
      Toast.error('Erro ao carregar formulário de catalogação', err.message);
    }

    // Bind submit
    const form = document.getElementById('form-recebimento');
    if (form) {
      form.onsubmit = async (e) => {
        e.preventDefault();
        await _submitCatalogacao();
      };
    }
  }

  async function _submitCatalogacao() {
    const item_catalogo_id   = document.getElementById('receb-catalogo').value;
    const destinoInicial     = document.getElementById('receb-destino-inicial').value;
    const numero_serie       = document.getElementById('receb-serie').value.trim();
    const imobilizado        = document.getElementById('receb-imobilizado').value.trim();
    const observacao         = document.getElementById('receb-obs').value.trim();

    if (!item_catalogo_id) { Toast.warning('Selecione o modelo (catálogo).'); return; }
    if (!numero_serie)     { Toast.warning('Informe o Número de Série.');     return; }
    if (!imobilizado)      { Toast.warning('Informe o Patrimônio.');          return; }

    // Determina endereço destino conforme prateleira escolhida
    const endereco_id = destinoInicial === 'pre_venda' ? _caixaPreVendaId : _caixaPreTriagemId;

    if (!endereco_id) {
      Toast.error('Configuração incompleta', 'Endereços de recebimento não encontrados. Execute a migration 005.');
      return;
    }

    const btn = document.querySelector('#form-recebimento [type="submit"]');
    btn.disabled = true;
    btn.textContent = 'Salvando...';

    try {
      await Api.equipamento.entrada({
        item_catalogo_id: parseInt(item_catalogo_id, 10),
        numero_serie,
        imobilizado,
        tipo_entrada: 'entrada_recebimento',
        endereco_id,
        observacao,
      });

      if (destinoInicial === 'pre_venda') {
        const res = await Api.equipamento.listar('pre_triagem');
        const equip = res.data.find(e => e.numero_serie.toLowerCase() === numero_serie.toLowerCase());
        if (equip) {
          await Api.equipamento.saida(equip.id, {
            status_destino: 'pre_venda',
            endereco_destino_id: _caixaPreVendaId,
            observacao: 'Destinado à Pré-Venda no recebimento.',
          });
        }
      }

      Toast.success('Item recebido e catalogado!', `Nº Série: ${numero_serie} → ${destinoInicial === 'pre_venda' ? 'Pré-Venda' : 'Pré-Triagem'}`);
      limparFormCatalogacao();

      // Atualiza badge do nav
      _atualizarBadge();
    } catch (err) {
      Toast.error('Erro ao registrar recebimento', err.message);
    } finally {
      btn.disabled = false;
      btn.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="20 6 9 17 4 12"/></svg> Registrar Item Recebido`;
    }
  }

  function limparFormCatalogacao() {
    document.getElementById('form-recebimento')?.reset();
  }

  // ════════════════════════════════════════════════════════
  // ABA 2: MONTAR PALLET / CAIXA
  // ════════════════════════════════════════════════════════

  async function carregarPrateleiras() {
    const tbody = document.getElementById('tbody-prateleiras');
    const status = document.getElementById('montar-filtro-status')?.value || 'pre_triagem';
    tbody.innerHTML = `<tr><td colspan="6" class="empty-row"><span class="spinner"></span></td></tr>`;

    try {
      const res = await Api.equipamento.listar(status);
      _itensPrateleira = res.data;
      _renderizarPrateleiras(_itensPrateleira);
      _atualizarContadorSelecionados();
    } catch (err) {
      tbody.innerHTML = `<tr><td colspan="6" class="empty-row" style="color:var(--c-danger)">${escapeHtml(err.message)}</td></tr>`;
      Toast.error('Erro ao carregar prateleira', err.message);
    }
  }

  function _renderizarPrateleiras(lista) {
    const tbody = document.getElementById('tbody-prateleiras');
    if (!lista.length) {
      tbody.innerHTML = `<tr><td colspan="6" class="empty-row">Nenhum item nesta prateleira.</td></tr>`;
      return;
    }
    tbody.innerHTML = lista.map(r => `
      <tr data-id="${r.id}">
        <td>
          <input type="checkbox" class="montar-check" data-id="${r.id}"
            onchange="Recebimento._atualizarContadorSelecionados()" />
        </td>
        <td>
          <div><strong>${escapeHtml(r.modelo)}</strong></div>
          <div style="font-size:11px;color:var(--c-text-muted)">${escapeHtml(r.categoria)}</div>
        </td>
        <td><code>${escapeHtml(r.numero_serie)}</code></td>
        <td><code>${escapeHtml(r.imobilizado)}</code></td>
        <td>${badgeStatus(r.status)}</td>
        <td style="font-size:12px;color:var(--c-text-secondary)">${escapeHtml(r.observacoes || '—')}</td>
      </tr>
    `).join('');
  }

  async function _carregarCaixasDestino() {
    try {
      const res = await Api.endereco.listar();
      _todosCaixas = res.data.filter(e => e.ativo && !['RECV-CX-PRETRIAGEM', 'RECV-CX-PREVENDA'].includes(e.codigo));

      const sel = document.getElementById('montar-caixa-destino');
      if (!sel) return;
      sel.innerHTML = '<option value="">Selecione o endereço...</option>' +
        _todosCaixas.map(c => `<option value="${c.id}">${escapeHtml(c.codigo)}${c.descricao ? ' — ' + escapeHtml(c.descricao) : ''}</option>`).join('');
    } catch (err) {
      Toast.error('Erro ao carregar endereços de destino', err.message);
    }
  }

  function selecionarTodos(checked) {
    document.querySelectorAll('.montar-check').forEach(cb => { cb.checked = checked; });
    _atualizarContadorSelecionados();
  }

  function _atualizarContadorSelecionados() {
    const selecionados = document.querySelectorAll('.montar-check:checked').length;
    const badge = document.getElementById('montar-count-badge');
    if (badge) badge.textContent = `${selecionados} item(ns) selecionado(s)`;
  }

  async function confirmarMontarPallet() {
    const checkboxes = document.querySelectorAll('.montar-check:checked');
    const equipamento_ids = Array.from(checkboxes).map(cb => parseInt(cb.dataset.id, 10));

    if (!equipamento_ids.length) {
      Toast.warning('Selecione pelo menos um item.');
      return;
    }

    const status_destino     = document.getElementById('montar-status-destino').value;
    const endereco_destino_id = parseInt(document.getElementById('montar-caixa-destino').value, 10);
    const observacao         = document.getElementById('montar-obs').value.trim();

    if (status_destino === 'ag_triagem' && !endereco_destino_id) {
      Toast.warning('Selecione um endereço de destino para Ag. Triagem.');
      return;
    }

    // Para 'venda', endereco_destino_id pode ser null (sai do WMS)
    const payload = {
      equipamento_ids,
      status_destino,
      endereco_destino_id: status_destino === 'venda' ? (endereco_destino_id || null) : endereco_destino_id,
      observacao,
    };

    Modal.abrir({
      titulo: 'Confirmar Montagem de Pallet',
      corpo: `
        <p>Você está prestes a transferir <strong>${equipamento_ids.length} item(ns)</strong> para:</p>
        <ul style="margin:1rem 0;padding-left:1.5rem">
          <li>Destino: <strong>${status_destino === 'ag_triagem' ? 'Ag. Triagem (criará reparos)' : 'Venda / Sucata (sai do WMS)'}</strong></li>
          ${status_destino === 'ag_triagem' ? `<li>Caixa: <strong>${escapeHtml(document.getElementById('montar-caixa-destino').selectedOptions[0]?.text || '')}</strong></li>` : ''}
        </ul>
        <p style="color:var(--c-text-secondary);font-size:13px">Esta operação não pode ser desfeita facilmente.</p>
      `,
      rodape: `
        <button class="btn btn-outline" onclick="Modal.fechar()">Cancelar</button>
        <button class="btn btn-primary" onclick="Recebimento._executarMontarPallet(${JSON.stringify(payload).replace(/"/g, '&quot;')})">
          Confirmar Transferência
        </button>
      `,
    });
  }

  async function _executarMontarPallet(payload) {
    Modal.fechar();
    try {
      const res = await Api.equipamento.montarPallet(payload);
      Toast.success('Pallet montado!', res.message);
      // Desmarca todos e recarrega
      document.getElementById('montar-check-all').checked = false;
      await carregarPrateleiras();
      _atualizarBadge();
    } catch (err) {
      Toast.error('Erro ao montar pallet', err.message);
    }
  }

  async function _atualizarBadge() {
    try {
      const [pt, pv] = await Promise.all([
        Api.equipamento.listar('pre_triagem'),
        Api.equipamento.listar('pre_venda'),
      ]);
      const total = (pt.data?.length || 0) + (pv.data?.length || 0);
      const badge = document.getElementById('badge-recebimento');
      if (badge) {
        badge.textContent = total;
        badge.style.display = total > 0 ? 'inline-flex' : 'none';
      }
    } catch (_) { /* silencioso */ }
  }

  return {
    carregar, trocarAba,
    limparFormCatalogacao,
    carregarPrateleiras,
    selecionarTodos,
    _atualizarContadorSelecionados,
    confirmarMontarPallet,
    _executarMontarPallet,
  };
})();
