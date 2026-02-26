/**
 * PIOERP — Módulo: Movimentações (Entrada e Saída)
 * Gerencia o formulário de entrada, saída e listagem de equipamentos.
 */

const Movimentacao = (() => {
  // Cache de endereços para os selects hierárquicos
  let _todosEnderecos = [];
  let _equipamentos   = [];

  // ════════════════════════════════════════════════════════
  // FORMULÁRIO DE ENTRADA
  // ════════════════════════════════════════════════════════

  async function inicializarFormEntrada() {
    try {
      const [catRes, endRes] = await Promise.all([
        Api.catalogo.listar(),
        Api.endereco.listar(),
      ]);

      _todosEnderecos = endRes.data;

      // Popular dropdown de catálogo
      const selCat = document.getElementById('entrada-catalogo');
      selCat.innerHTML = '<option value="">Selecione o modelo...</option>' +
        catRes.data
          .filter(c => c.ativo)
          .map(c => `<option value="${c.id}">${escapeHtml(c.nome)} — ${escapeHtml(c.categoria)}</option>`)
          .join('');

      // Popular dropdown de endereços (plano)
      const endAtivos = _todosEnderecos.filter(e => e.ativo && !e.codigo.startsWith('RECV-'));
      const selEnd = document.getElementById('entrada-endereco');
      selEnd.innerHTML = '<option value="">Selecione o endereço...</option>' +
        endAtivos.map(e => `<option value="${e.id}">${escapeHtml(e.codigo)}</option>`).join('');
      selEnd.disabled = false;

    } catch (err) {
      Toast.error('Erro ao inicializar formulário de entrada', err.message);
    }

    // Bind submit
    const form = document.getElementById('form-entrada');
    form.onsubmit = async (e) => {
      e.preventDefault();
      await _submitEntrada();
    };
  }

  async function _submitEntrada() {
    const item_catalogo_id = document.getElementById('entrada-catalogo').value;
    const numero_serie     = document.getElementById('entrada-serie').value.trim();
    const imobilizado      = document.getElementById('entrada-imobilizado').value.trim();
    const tipo_entrada     = document.getElementById('entrada-tipo').value;
    const endereco_id      = document.getElementById('entrada-endereco').value;
    const observacao       = document.getElementById('entrada-obs').value.trim();

    if (!item_catalogo_id) { Toast.warning('Selecione o modelo (catálogo).');        return; }
    if (!numero_serie)     { Toast.warning('Informe o Número de Série.');            return; }
    if (!imobilizado)      { Toast.warning('Informe o Patrimônio (Imobilizado).');   return; }
    if (!endereco_id)      { Toast.warning('Selecione o endereço de destino.');      return; }

    const btn = document.querySelector('#form-entrada [type="submit"]');
    btn.disabled = true;
    btn.textContent = 'Salvando...';

    try {
      await Api.equipamento.entrada({
        item_catalogo_id: parseInt(item_catalogo_id, 10),
        numero_serie, imobilizado, tipo_entrada,
        endereco_id: parseInt(endereco_id, 10),
        observacao,
      });
      Toast.success('Equipamento registrado com sucesso!', `Nº Série: ${numero_serie}`);
      limparFormEntrada();
    } catch (err) {
      Toast.error('Erro ao registrar entrada', err.message);
    } finally {
      btn.disabled = false;
      btn.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="20 6 9 17 4 12"/></svg> Registrar Entrada`;
    }
  }

  function limparFormEntrada() {
    document.getElementById('form-entrada').reset();
  }

  // ════════════════════════════════════════════════════════
  // FORMULÁRIO DE SAÍDA
  // ════════════════════════════════════════════════════════

  let _equipSaidaAtual = null;

  async function buscarEquipamentoSaida() {
    const serie = document.getElementById('saida-serie').value.trim();
    if (!serie) { Toast.warning('Digite o número de série.'); return; }

    try {
      // Busca por série na listagem (não há endpoint de busca por série diretamente)
      const res = await Api.equipamento.listar();
      const equip = res.data.find(e =>
        e.numero_serie.toLowerCase() === serie.toLowerCase()
      );

      if (!equip) {
        Toast.warning('Equipamento não encontrado', `Nº Série: ${serie}`);
        document.getElementById('saida-info-panel').style.display = 'none';
        document.getElementById('saida-actions-area').style.display = 'none';
        return;
      }

      _equipSaidaAtual = equip;
      document.getElementById('saida-modelo').textContent     = equip.modelo;
      document.getElementById('saida-imobilizado').textContent = equip.imobilizado;
      document.getElementById('saida-status-atual').innerHTML  = badgeStatus(equip.status);
      document.getElementById('saida-local').textContent       = montarLocalizacao(equip);
      document.getElementById('saida-equip-id').value          = equip.id;

      document.getElementById('saida-info-panel').style.display = 'block';
      document.getElementById('saida-actions-area').style.display = 'block';

      // Popula opções de destino baseado no status atual
      const selDestino = document.getElementById('saida-destino');
      selDestino.innerHTML = '<option value="">Selecione a ação...</option>';

      if (equip.status === 'reposicao') {
        selDestino.innerHTML += `
          <option value="saida_uso">Enviar para Uso (sai do estoque)</option>
          <option value="ag_triagem">Enviar para Ag. Triagem (reparo)</option>
          <option value="venda">Baixar para Venda / Sucata</option>
        `;
      } else if (equip.status === 'em_uso') {
        selDestino.innerHTML += `
          <option value="reposicao">Retornar ao Estoque (Reposição)</option>
          <option value="ag_triagem">Enviar para Ag. Triagem (reparo)</option>
          <option value="venda">Baixar para Venda / Sucata</option>
        `;
      } else if (equip.status === 'ag_triagem') {
        selDestino.innerHTML += `
          <option value="reposicao">Retornar ao Estoque (Reposição)</option>
          <option value="venda">Baixar para Venda / Sucata</option>
        `;
      } else if (equip.status === 'venda') {
        Toast.info('Atenção', 'Este equipamento já está na categoria "Venda".');
      }

    } catch (err) {
      Toast.error('Erro ao buscar equipamento', err.message);
    }
  }

  // Bind submit saída
  document.addEventListener('DOMContentLoaded', () => {
    document.getElementById('form-saida')?.addEventListener('submit', async (e) => {
      e.preventDefault();
      await _submitSaida();
    });
  });

  async function _submitSaida() {
    const equipId   = document.getElementById('saida-equip-id').value;
    const destino   = document.getElementById('saida-destino').value;
    const observacao= document.getElementById('saida-obs').value.trim();

    if (!equipId) { Toast.warning('Localize um equipamento primeiro.'); return; }
    if (!destino) { Toast.warning('Selecione o destino.');              return; }

    try {
      const res = await Api.equipamento.saida(equipId, {
        status_destino: destino,
        observacao,
      });
      Toast.success('Movimentação realizada!', res.message);
      document.getElementById('form-saida').reset();
      document.getElementById('saida-info-panel').style.display  = 'none';
      document.getElementById('saida-actions-area').style.display = 'none';
      _equipSaidaAtual = null;
    } catch (err) {
      Toast.error('Erro ao movimentar equipamento', err.message);
    }
  }

  // ════════════════════════════════════════════════════════
  // LISTAGEM DE EQUIPAMENTOS
  // ════════════════════════════════════════════════════════

  async function carregarEquipamentos() {
    const tbody  = document.getElementById('tbody-equipamentos');
    const status = document.getElementById('filter-status-equip')?.value || '';
    tbody.innerHTML = `<tr><td colspan="8" class="empty-row"><span class="spinner"></span></td></tr>`;
    try {
      const res = await Api.equipamento.listar(status);
      _equipamentos = res.data;
      renderizarEquipamentos(_equipamentos);
    } catch (err) {
      tbody.innerHTML = `<tr><td colspan="8" class="empty-row" style="color:var(--c-danger)">${escapeHtml(err.message)}</td></tr>`;
      Toast.error('Erro ao carregar equipamentos', err.message);
    }
  }

  function renderizarEquipamentos(lista) {
    const tbody = document.getElementById('tbody-equipamentos');
    if (!lista.length) {
      tbody.innerHTML = `<tr><td colspan="8" class="empty-row">Nenhum equipamento encontrado.</td></tr>`;
      return;
    }
    tbody.innerHTML = lista.map(r => `
      <tr data-id="${r.id}">
        <td><span style="color:var(--c-text-muted);font-size:12px">#${r.id}</span></td>
        <td>
          <div><strong>${escapeHtml(r.modelo)}</strong></div>
          <div style="font-size:11px;color:var(--c-text-muted)">${escapeHtml(r.categoria)}</div>
        </td>
        <td><code>${escapeHtml(r.numero_serie)}</code></td>
        <td><code>${escapeHtml(r.imobilizado)}</code></td>
        <td>${badgeStatus(r.status)}</td>
        <td><code style="font-size:12px">${escapeHtml(r.endereco_codigo || r.caixa_codigo || '—')}</code></td>
        <td style="font-size:12px;color:var(--c-text-secondary)">${escapeHtml(montarLocalizacao(r))}</td>
        <td>
          <div class="action-group">
            <button class="btn btn-sm btn-outline" onclick="Movimentacao.abrirSaida('${escapeHtml(r.numero_serie)}')" title="Movimentar">
              Movimentar
            </button>
          </div>
        </td>
      </tr>
    `).join('');
  }

  async function abrirSaida(numeroSerie) {
    App.navegar('saida');
    // Aguarda o DOM da seção estar visível antes de preencher
    setTimeout(async () => {
      const input = document.getElementById('saida-serie');
      if (input) {
        input.value = numeroSerie;
        await buscarEquipamentoSaida();
      }
    }, 50);
  }

  function filtrarEquipamentos(termo) {
    const t = termo.toLowerCase();
    const filtrado = _equipamentos.filter(r =>
      r.numero_serie.toLowerCase().includes(t) ||
      r.imobilizado.toLowerCase().includes(t)  ||
      r.modelo.toLowerCase().includes(t)
    );
    renderizarEquipamentos(filtrado);
  }

  // ── Util ────────────────────────────────────────────────
  function _resetSelect(id, placeholder) {
    const sel = document.getElementById(id);
    if (!sel) return;
    sel.innerHTML = `<option value="">${placeholder}</option>`;
    sel.disabled  = true;
  }

  return {
    inicializarFormEntrada,
    limparFormEntrada, buscarEquipamentoSaida,
    carregarEquipamentos, filtrarEquipamentos,
    abrirSaida,
  };
})();
