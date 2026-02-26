/**
 * PIOERP — Módulo: Internalização
 *
 * Tela do Administrador para validar e alocar fisicamente equipamentos
 * que retornaram do reparo como "bom para uso" (ag_internalizacao → reposicao).
 *
 * Fluxo:
 *   1. Lista equipamentos em ag_internalizacao
 *   2. Admin clica "Aprovar" em um item
 *   3. Sistema busca caixas que já têm o mesmo modelo
 *      - Cenário A: sugere caixas existentes → admin seleciona → confirma
 *      - Cenário B: nenhuma caixa → admin cria Endereço → Pallet → Caixa → confirma
 */

const Internalizacao = (() => {
  let _lista = [];

  // ════════════════════════════════════════════════════════
  // LISTA DE ITENS AGUARDANDO
  // ════════════════════════════════════════════════════════

  async function carregar() {
    const tbody = document.getElementById('tbody-internalizacao');
    if (!tbody) return;
    tbody.innerHTML = `<tr><td colspan="6" class="empty-row"><span class="spinner"></span></td></tr>`;
    try {
      const res = await Api.internalizacao.listar();
      _lista = res.data;
      _renderizar(_lista);
    } catch (err) {
      tbody.innerHTML = `<tr><td colspan="6" class="empty-row" style="color:var(--c-danger)">${escapeHtml(err.message)}</td></tr>`;
      Toast.error('Erro ao carregar internalização', err.message);
    }
  }

  function _renderizar(lista) {
    const tbody = document.getElementById('tbody-internalizacao');
    const badge = document.getElementById('badge-internalizacao');

    if (badge) {
      badge.textContent = lista.length;
      badge.style.display = lista.length > 0 ? 'inline-flex' : 'none';
    }

    if (!lista.length) {
      tbody.innerHTML = `<tr><td colspan="6" class="empty-row">Nenhum equipamento aguardando internalização.</td></tr>`;
      return;
    }

    tbody.innerHTML = lista.map(r => `
      <tr>
        <td>
          <div><strong>${escapeHtml(r.modelo)}</strong></div>
          <div style="font-size:11px;color:var(--c-text-muted)">${escapeHtml(r.categoria)}</div>
        </td>
        <td><code>${escapeHtml(r.numero_serie)}</code></td>
        <td><code>${escapeHtml(r.imobilizado)}</code></td>
        <td><span class="badge badge-info">${escapeHtml(r.alocacao_filial || '—')}</span></td>
        <td style="font-size:12px;color:var(--c-text-muted)">${formatDateTime(r.updated_at)}</td>
        <td>
          <div class="action-group">
            <button class="btn btn-sm btn-primary"
              onclick="Internalizacao.abrirModalAprovar(${r.id}, ${r.item_catalogo_id}, '${escapeHtml(r.modelo)}')">
              Aprovar
            </button>
          </div>
        </td>
      </tr>
    `).join('');
  }

  // ════════════════════════════════════════════════════════
  // MODAL DE APROVAÇÃO
  // ════════════════════════════════════════════════════════

  async function abrirModalAprovar(equipId, catalogoId, modeloNome) {
    Modal.abrir({
      titulo: `Aprovar Internalização — ${modeloNome}`,
      tamanho: 'lg',
      corpo: `<div class="empty-row"><span class="spinner"></span> Verificando locais...</div>`,
      rodape: '',
    });

    try {
      const res = await Api.internalizacao.locaisPorModelo(catalogoId);
      const locais = res.data;

      if (locais.length > 0) {
        _renderModalCenarioA(equipId, locais);
      } else {
        await _renderModalCenarioB(equipId);
      }
    } catch (err) {
      document.getElementById('modal-body').innerHTML =
        `<p style="color:var(--c-danger)">${escapeHtml(err.message)}</p>`;
    }
  }

  // ── Cenário A: Há caixas com esse modelo ─────────────────
  function _renderModalCenarioA(equipId, locais) {
    document.getElementById('modal-body').innerHTML = `
      <div class="form-group">
        <p style="margin-bottom:12px">
          <strong>Este modelo já está armazenado nos seguintes locais.</strong><br>
          Selecione a caixa de destino:
        </p>
        <label for="int-caixa-select">Local de Destino *</label>
        <select id="int-caixa-select" class="input-select">
          <option value="">Selecione...</option>
          ${locais.map(l => `
            <option value="${l.caixa_id}">
              ${escapeHtml(l.caixa_codigo)} &nbsp;(Pallet ${escapeHtml(l.pallet_codigo)} — ${escapeHtml(l.endereco_codigo)})
            </option>
          `).join('')}
        </select>
      </div>
    `;
    document.getElementById('modal-footer').innerHTML = `
      <button class="btn btn-outline" onclick="Modal.fechar()">Cancelar</button>
      <button class="btn btn-primary" onclick="Internalizacao._confirmarAprovar(${equipId})">
        Confirmar Aprovação
      </button>
    `;
  }

  // ── Cenário B: Nenhum local com esse modelo ───────────────
  async function _renderModalCenarioB(equipId) {
    // Carrega endereços disponíveis
    let enderecos = [];
    try {
      const res = await Api.endereco.listar();
      enderecos = (res.data || []).filter(e => e.ativo && !e.codigo.startsWith('RECV-'));
    } catch (_) {}

    document.getElementById('modal-body').innerHTML = `
      <div class="form-group">
        <p class="badge badge-warning" style="display:inline-block;margin-bottom:12px;padding:6px 10px">
          Nenhum local com este modelo. É necessário endereçar.
        </p>
      </div>

      <div class="form-group">
        <label for="int-end-select">1. Endereço Físico (Porta-Pallet) *</label>
        <select id="int-end-select" class="input-select" onchange="Internalizacao._onEnderecoChange(this.value, ${equipId})">
          <option value="">Selecione o endereço...</option>
          ${enderecos.map(e => `<option value="${e.id}">${escapeHtml(e.codigo)}</option>`).join('')}
        </select>
      </div>

      <div class="form-group" id="int-pallet-group" style="display:none">
        <label>2. Pallet *</label>
        <div class="input-with-btn">
          <select id="int-pallet-select" class="input-select" onchange="Internalizacao._onPalletChange(this.value, ${equipId})">
            <option value="">Selecione o pallet...</option>
          </select>
          <button type="button" class="btn btn-secondary" id="int-btn-criar-pallet"
            onclick="Internalizacao._mostrarCriarPallet(${equipId})">+ Pallet</button>
        </div>
        <div id="int-criar-pallet-inline" style="display:none;margin-top:8px">
          <div style="display:flex;gap:8px;align-items:center">
            <input type="text" id="int-novo-pallet-codigo" class="input-text" style="flex:1"
              placeholder="Código ex: P-001" />
            <button class="btn btn-sm btn-primary" onclick="Internalizacao._criarPallet(${equipId})">Criar</button>
            <button class="btn btn-sm btn-outline" onclick="Internalizacao._ocultarCriarPallet()">✕</button>
          </div>
        </div>
      </div>

      <div class="form-group" id="int-caixa-group" style="display:none">
        <label>3. Caixa *</label>
        <div class="input-with-btn">
          <select id="int-caixa-select" class="input-select">
            <option value="">Selecione a caixa...</option>
          </select>
          <button type="button" class="btn btn-secondary" id="int-btn-criar-caixa"
            onclick="Internalizacao._mostrarCriarCaixa(${equipId})">+ Caixa</button>
        </div>
        <div id="int-criar-caixa-inline" style="display:none;margin-top:8px">
          <div style="display:flex;gap:8px;align-items:center">
            <input type="text" id="int-nova-caixa-codigo" class="input-text" style="flex:1"
              placeholder="Código ex: CX-001" />
            <button class="btn btn-sm btn-primary" onclick="Internalizacao._criarCaixa(${equipId})">Criar</button>
            <button class="btn btn-sm btn-outline" onclick="Internalizacao._ocultarCriarCaixa()">✕</button>
          </div>
        </div>
      </div>
    `;

    document.getElementById('modal-footer').innerHTML = `
      <button class="btn btn-outline" onclick="Modal.fechar()">Cancelar</button>
      <button class="btn btn-primary" onclick="Internalizacao._confirmarAprovar(${equipId})">
        Confirmar Aprovação
      </button>
    `;
  }

  // ── Cascata: Endereço → Pallet ────────────────────────────
  async function _onEnderecoChange(enderecoId, equipId) {
    const palletGroup  = document.getElementById('int-pallet-group');
    const palletSelect = document.getElementById('int-pallet-select');
    const caixaGroup   = document.getElementById('int-caixa-group');

    _ocultarCriarPallet();
    _ocultarCriarCaixa();
    if (caixaGroup) caixaGroup.style.display = 'none';

    if (!enderecoId) {
      palletGroup.style.display = 'none';
      return;
    }

    palletGroup.style.display = 'block';
    palletSelect.innerHTML = '<option value="">Carregando pallets...</option>';

    try {
      const res = await Api.pallets.listar(enderecoId);
      palletSelect.innerHTML = '<option value="">Selecione o pallet...</option>' +
        res.data.map(p => `<option value="${p.id}">${escapeHtml(p.codigo)}</option>`).join('');
    } catch (err) {
      palletSelect.innerHTML = '<option value="">Erro ao carregar</option>';
      Toast.error('Erro', err.message);
    }
  }

  // ── Cascata: Pallet → Caixa ───────────────────────────────
  async function _onPalletChange(palletId, equipId) {
    const caixaGroup  = document.getElementById('int-caixa-group');
    const caixaSelect = document.getElementById('int-caixa-select');

    _ocultarCriarCaixa();

    if (!palletId) {
      caixaGroup.style.display = 'none';
      return;
    }

    caixaGroup.style.display = 'block';
    caixaSelect.innerHTML = '<option value="">Carregando caixas...</option>';

    try {
      const res = await Api.caixas.listar(palletId);
      caixaSelect.innerHTML = '<option value="">Selecione a caixa...</option>' +
        res.data.map(c => `<option value="${c.id}">${escapeHtml(c.codigo)}</option>`).join('');
    } catch (err) {
      caixaSelect.innerHTML = '<option value="">Erro ao carregar</option>';
      Toast.error('Erro', err.message);
    }
  }

  // ── Criar Pallet inline ────────────────────────────────────
  function _mostrarCriarPallet() {
    document.getElementById('int-criar-pallet-inline').style.display = 'block';
    document.getElementById('int-btn-criar-pallet').style.display    = 'none';
    document.getElementById('int-novo-pallet-codigo')?.focus();
  }

  function _ocultarCriarPallet() {
    const el = document.getElementById('int-criar-pallet-inline');
    const btn = document.getElementById('int-btn-criar-pallet');
    if (el)  el.style.display  = 'none';
    if (btn) btn.style.display = '';
    const input = document.getElementById('int-novo-pallet-codigo');
    if (input) input.value = '';
  }

  async function _criarPallet(equipId) {
    const codigo     = document.getElementById('int-novo-pallet-codigo')?.value.trim();
    const enderecoId = document.getElementById('int-end-select')?.value;

    if (!codigo)     { Toast.warning('Informe o código do pallet.');  return; }
    if (!enderecoId) { Toast.warning('Selecione o endereço primeiro.'); return; }

    try {
      const res = await Api.pallets.criar({ codigo, endereco_id: parseInt(enderecoId, 10) });
      Toast.success('Pallet criado!', res.data.codigo);
      _ocultarCriarPallet();
      // Recarrega lista e seleciona o novo
      await _onEnderecoChange(enderecoId, equipId);
      const sel = document.getElementById('int-pallet-select');
      if (sel) sel.value = res.data.id;
      await _onPalletChange(res.data.id, equipId);
    } catch (err) {
      Toast.error('Erro ao criar pallet', err.message);
    }
  }

  // ── Criar Caixa inline ─────────────────────────────────────
  function _mostrarCriarCaixa() {
    document.getElementById('int-criar-caixa-inline').style.display = 'block';
    document.getElementById('int-btn-criar-caixa').style.display    = 'none';
    document.getElementById('int-nova-caixa-codigo')?.focus();
  }

  function _ocultarCriarCaixa() {
    const el  = document.getElementById('int-criar-caixa-inline');
    const btn = document.getElementById('int-btn-criar-caixa');
    if (el)  el.style.display  = 'none';
    if (btn) btn.style.display = '';
    const input = document.getElementById('int-nova-caixa-codigo');
    if (input) input.value = '';
  }

  async function _criarCaixa(equipId) {
    const codigo   = document.getElementById('int-nova-caixa-codigo')?.value.trim();
    const palletId = document.getElementById('int-pallet-select')?.value;

    if (!codigo)   { Toast.warning('Informe o código da caixa.'); return; }
    if (!palletId) { Toast.warning('Selecione o pallet primeiro.'); return; }

    try {
      const res = await Api.caixas.criar({ codigo, pallet_id: palletId });
      Toast.success('Caixa criada!', res.data.codigo);
      _ocultarCriarCaixa();
      // Recarrega lista e seleciona a nova
      await _onPalletChange(palletId, equipId);
      const sel = document.getElementById('int-caixa-select');
      if (sel) sel.value = res.data.id;
    } catch (err) {
      Toast.error('Erro ao criar caixa', err.message);
    }
  }

  // ── Confirmar aprovação ────────────────────────────────────
  async function _confirmarAprovar(equipId) {
    const caixaId = document.getElementById('int-caixa-select')?.value;

    if (!caixaId) {
      Toast.warning('Selecione uma caixa de destino antes de aprovar.');
      return;
    }

    try {
      const res = await Api.internalizacao.aprovar(equipId, { caixa_id: caixaId });
      Toast.success('Aprovado!', res.message);
      Modal.fechar();
      await carregar();
    } catch (err) {
      Toast.error('Erro ao aprovar', err.message);
    }
  }

  return {
    carregar,
    abrirModalAprovar,
    _onEnderecoChange,
    _onPalletChange,
    _mostrarCriarPallet, _ocultarCriarPallet, _criarPallet,
    _mostrarCriarCaixa,  _ocultarCriarCaixa,  _criarCaixa,
    _confirmarAprovar,
  };
})();
