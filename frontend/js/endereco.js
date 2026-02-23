/**
 * PIOERP — Módulo: Endereços WMS
 * Gerenciamento da hierarquia fisica porta_pallet > sessao > pallet > caixa.
 */

const Endereco = (() => {
  let _dados = [];

  // ── Listar ──────────────────────────────────────────────
  async function carregar(nivel) {
    const tbody = document.getElementById('tbody-enderecos');
    tbody.innerHTML = `<tr><td colspan="7" class="empty-row"><span class="spinner"></span></td></tr>`;
    try {
      const res = await Api.endereco.listar(nivel || '');
      _dados = res.data;
      renderizar(_dados);
    } catch (err) {
      tbody.innerHTML = `<tr><td colspan="7" class="empty-row" style="color:var(--c-danger)">${escapeHtml(err.message)}</td></tr>`;
      Toast.error('Erro ao carregar endereços', err.message);
    }
  }

  function renderizar(lista) {
    const tbody = document.getElementById('tbody-enderecos');
    if (!lista.length) {
      tbody.innerHTML = `<tr><td colspan="7" class="empty-row">Nenhum endereço cadastrado.</td></tr>`;
      return;
    }
    tbody.innerHTML = lista.map(r => `
      <tr data-id="${r.id}">
        <td><span style="color:var(--c-text-muted);font-size:12px">#${r.id}</span></td>
        <td><code style="font-size:12px">${escapeHtml(r.codigo)}</code></td>
        <td>${escapeHtml(r.descricao || '—')}</td>
        <td>${badgeNivel(r.nivel)}</td>
        <td>${r.parent_codigo ? `<code style="font-size:12px">${escapeHtml(r.parent_codigo)}</code>` : '—'}</td>
        <td>${r.ativo
          ? `<span class="badge badge-success">Ativo</span>`
          : `<span class="badge badge-gray">Inativo</span>`
        }</td>
        <td>
          <div class="action-group">
            <button class="btn btn-sm btn-outline" onclick="Endereco.abrirModalEdicao(${r.id})" title="Editar">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="14" height="14"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
              Editar
            </button>
          </div>
        </td>
      </tr>
    `).join('');
  }

  // ── Modal Criação ────────────────────────────────────────
  async function abrirModalCriacao() {
    // Precisamos dos endereços pai disponíveis
    let pais = [];
    try {
      const res = await Api.endereco.listar();
      pais = res.data;
    } catch {}

    Modal.abrir({
      titulo: 'Novo Endereço WMS',
      corpo: _formHtml({}, pais),
      rodape: `
        <button class="btn btn-outline" onclick="Modal.fechar()">Cancelar</button>
        <button class="btn btn-primary" onclick="Endereco._submitCriacao()">Criar Endereço</button>
      `,
    });
    // Bind para atualizar o select de pai ao mudar o nível
    document.getElementById('end-nivel')?.addEventListener('change', () => {
      _atualizarSelectPai(pais);
    });
  }

  function _atualizarSelectPai(pais) {
    const nivel = document.getElementById('end-nivel')?.value;
    const selectPai = document.getElementById('end-parent');
    if (!selectPai) return;

    const nivelPaiEsperado = {
      sessao: 'porta_pallet',
      pallet: 'sessao',
      caixa:  'pallet',
    }[nivel];

    if (!nivelPaiEsperado) {
      selectPai.innerHTML = '<option value="">N/A — Porta-Pallets não têm pai</option>';
      selectPai.disabled = true;
      return;
    }

    const filtrados = pais.filter(p => p.nivel === nivelPaiEsperado && p.ativo);
    selectPai.disabled = false;
    selectPai.innerHTML = `<option value="">Selecione o pai (${nivelPaiEsperado.replace('_', '-')})...</option>` +
      filtrados.map(p => `<option value="${p.id}">${escapeHtml(p.codigo)} — ${escapeHtml(p.descricao || '')}</option>`).join('');
  }

  async function _submitCriacao() {
    const codigo    = document.getElementById('end-codigo')?.value.trim();
    const descricao = document.getElementById('end-descricao')?.value.trim();
    const nivel     = document.getElementById('end-nivel')?.value;
    const parent_id = document.getElementById('end-parent')?.value || null;

    if (!codigo)  { Toast.warning('Informe o código do endereço.'); return; }
    if (!nivel)   { Toast.warning('Selecione o nível.');            return; }

    try {
      await Api.endereco.criar({ codigo, descricao, nivel, parent_id: parent_id || undefined });
      Modal.fechar();
      Toast.success('Endereço criado com sucesso!', codigo);
      carregar(document.getElementById('filter-nivel')?.value || '');
    } catch (err) {
      Toast.error('Erro ao criar endereço', err.message);
    }
  }

  // ── Modal Edição ─────────────────────────────────────────
  async function abrirModalEdicao(id) {
    const item = _dados.find(d => d.id === id);
    if (!item) return;

    Modal.abrir({
      titulo: `Editar: ${item.codigo}`,
      corpo: `
        <div class="form-grid-1">
          <div class="form-group">
            <label for="edit-end-codigo">Código</label>
            <input id="edit-end-codigo" class="input-text" type="text" value="${escapeHtml(item.codigo)}" />
          </div>
          <div class="form-group">
            <label for="edit-end-descricao">Descrição</label>
            <input id="edit-end-descricao" class="input-text" type="text" value="${escapeHtml(item.descricao || '')}" />
          </div>
          <div class="form-group">
            <label>Nível (não editável)</label>
            <div>${badgeNivel(item.nivel)}</div>
          </div>
          <div class="form-group">
            <label for="edit-end-ativo">Status</label>
            <select id="edit-end-ativo" class="input-select">
              <option value="true"  ${item.ativo ? 'selected' : ''}>Ativo</option>
              <option value="false" ${!item.ativo ? 'selected' : ''}>Inativo</option>
            </select>
          </div>
        </div>
      `,
      rodape: `
        <button class="btn btn-outline" onclick="Modal.fechar()">Cancelar</button>
        <button class="btn btn-primary" onclick="Endereco._submitEdicao(${id})">Salvar</button>
      `,
    });
  }

  async function _submitEdicao(id) {
    const codigo    = document.getElementById('edit-end-codigo')?.value.trim();
    const descricao = document.getElementById('edit-end-descricao')?.value.trim();
    const ativo     = document.getElementById('edit-end-ativo')?.value === 'true';

    try {
      await Api.endereco.atualizar(id, { codigo, descricao, ativo });
      Modal.fechar();
      Toast.success('Endereço atualizado!');
      carregar(document.getElementById('filter-nivel')?.value || '');
    } catch (err) {
      Toast.error('Erro ao atualizar endereço', err.message);
    }
  }

  // ── Helpers ──────────────────────────────────────────────
  function _formHtml(r, pais) {
    return `
      <div class="form-grid-1">
        <div class="form-group">
          <label for="end-codigo">Código *</label>
          <input id="end-codigo" class="input-text" type="text" value="${escapeHtml(r.codigo || '')}" placeholder="Ex: PP-01-A-P01-CX03" />
        </div>
        <div class="form-group">
          <label for="end-descricao">Descrição</label>
          <input id="end-descricao" class="input-text" type="text" value="${escapeHtml(r.descricao || '')}" placeholder="Descrição opcional..." />
        </div>
        <div class="form-group">
          <label for="end-nivel">Nível *</label>
          <select id="end-nivel" class="input-select">
            <option value="">Selecione o nível...</option>
            <option value="porta_pallet">Nível 1 — Porta-Pallet</option>
            <option value="sessao">Nível 2 — Sessão</option>
            <option value="pallet">Nível 3 — Pallet</option>
            <option value="caixa">Nível 4 — Caixa</option>
          </select>
        </div>
        <div class="form-group">
          <label for="end-parent">Endereço Pai</label>
          <select id="end-parent" class="input-select" disabled>
            <option value="">Selecione o nível primeiro...</option>
          </select>
        </div>
      </div>
    `;
  }

  return { carregar, renderizar, abrirModalCriacao, abrirModalEdicao, _submitCriacao, _submitEdicao };
})();
