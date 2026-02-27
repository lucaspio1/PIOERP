/**
 * PIOERP — Módulo: Catálogo de Equipamentos
 * CRUD completo via modal + tabela com filtro em tempo real.
 */

const Catalogo = (() => {
  let _dados = [];

  // ── Listar ──────────────────────────────────────────────
  async function carregar() {
    const tbody = document.getElementById('tbody-catalogo');
    tbody.innerHTML = `<tr><td colspan="10" class="empty-row"><span class="spinner"></span></td></tr>`;
    try {
      const res = await Api.catalogo.listar();
      _dados = res.data;
      renderizar(_dados);
    } catch (err) {
      tbody.innerHTML = `<tr><td colspan="10" class="empty-row" style="color:var(--c-danger)">${escapeHtml(err.message)}</td></tr>`;
      Toast.error('Erro ao carregar catálogo', err.message);
    }
  }

  function renderizar(lista) {
    const tbody = document.getElementById('tbody-catalogo');
    if (!lista.length) {
      tbody.innerHTML = `<tr><td colspan="10" class="empty-row">Nenhum item no catálogo.</td></tr>`;
      return;
    }
    tbody.innerHTML = lista.map(r => `
      <tr class="${r.estoque_critico ? 'row-critical' : ''}" data-id="${r.id}">
        <td><span style="color:var(--c-text-muted);font-size:12px">#${r.id}</span></td>
        <td><code>${escapeHtml(r.codigo || '—')}</code></td>
        <td>
          <strong>${escapeHtml(r.nome)}</strong>
          ${r.estoque_critico ? `<span class="badge badge-danger" style="margin-left:6px">Crítico</span>` : ''}
        </td>
        <td>${escapeHtml(r.categoria)}</td>
        <td>${r.estoque_minimo}</td>
        <td>${r.estoque_maximo}</td>
        <td>
          <strong style="color:${r.estoque_critico ? 'var(--c-danger)' : 'var(--c-success)'}">
            ${r.qtd_reposicao}
          </strong>
        </td>
        <td>${r.qtd_ag_triagem}</td>
        <td>${r.ativo
          ? `<span class="badge badge-success">Ativo</span>`
          : `<span class="badge badge-gray">Inativo</span>`
        }</td>
        <td>
          <div class="action-group">
            <button class="btn btn-sm btn-outline" onclick="Catalogo.abrirModalEdicao(${r.id})" title="Editar">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="14" height="14"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
              Editar
            </button>
            <button class="btn btn-sm btn-secondary" onclick="Catalogo.confirmarRemocao(${r.id}, '${escapeHtml(r.nome)}')" title="Desativar">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="14" height="14"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/></svg>
            </button>
          </div>
        </td>
      </tr>
    `).join('');
  }

  function filtrar(termo) {
    const t = termo.toLowerCase();
    const filtrado = _dados.filter(r =>
      r.nome.toLowerCase().includes(t) ||
      r.categoria.toLowerCase().includes(t) ||
      (r.codigo && r.codigo.toLowerCase().includes(t))
    );
    renderizar(filtrado);
  }

  // ── Modal Criação ────────────────────────────────────────
  function abrirModalCriacao() {
    Modal.abrir({
      titulo: 'Novo Item de Catálogo',
      corpo: _formHtml({}),
      rodape: `
        <button class="btn btn-outline" onclick="Modal.fechar()">Cancelar</button>
        <button class="btn btn-primary" onclick="Catalogo._submitCriacao()">Salvar Item</button>
      `,
    });
  }

  async function _submitCriacao() {
    const dados = _lerForm();
    if (!dados) return;
    try {
      await Api.catalogo.criar(dados);
      Modal.fechar();
      Toast.success('Item criado com sucesso!', dados.nome);
      carregar();
    } catch (err) {
      Toast.error('Erro ao criar item', err.message);
    }
  }

  // ── Modal Edição ─────────────────────────────────────────
  async function abrirModalEdicao(id) {
    try {
      const res = await Api.catalogo.buscarId(id);
      const r = res.data;
      Modal.abrir({
        titulo: `Editar: ${r.nome}`,
        corpo: _formHtml(r),
        rodape: `
          <button class="btn btn-outline" onclick="Modal.fechar()">Cancelar</button>
          <button class="btn btn-primary" onclick="Catalogo._submitEdicao(${id})">Salvar Alterações</button>
        `,
      });
    } catch (err) {
      Toast.error('Erro ao buscar item', err.message);
    }
  }

  async function _submitEdicao(id) {
    const dados = _lerForm();
    if (!dados) return;
    try {
      await Api.catalogo.atualizar(id, dados);
      Modal.fechar();
      Toast.success('Item atualizado com sucesso!');
      carregar();
    } catch (err) {
      Toast.error('Erro ao atualizar item', err.message);
    }
  }

  // ── Remover ──────────────────────────────────────────────
  function confirmarRemocao(id, nome) {
    Modal.abrir({
      titulo: 'Confirmar Desativação',
      corpo: `
        <div style="text-align:center;padding:1rem 0">
          <svg viewBox="0 0 24 24" fill="none" stroke="var(--c-warning)" stroke-width="1.5" width="48" height="48" style="margin:0 auto 1rem">
            <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/>
            <line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/>
          </svg>
          <p>Deseja desativar o item <strong>${escapeHtml(nome)}</strong>?</p>
          <p style="font-size:12px;color:var(--c-text-muted);margin-top:8px">O item não poderá ser usado em novas entradas.</p>
        </div>
      `,
      rodape: `
        <button class="btn btn-outline" onclick="Modal.fechar()">Cancelar</button>
        <button class="btn btn-danger" onclick="Catalogo._remover(${id})">Desativar</button>
      `,
    });
  }

  async function _remover(id) {
    try {
      await Api.catalogo.remover(id);
      Modal.fechar();
      Toast.warning('Item desativado.');
      carregar();
    } catch (err) {
      Modal.fechar();
      Toast.error('Erro ao desativar item', err.message);
    }
  }

  // ── Helpers ──────────────────────────────────────────────
  function _formHtml(r) {
    return `
      <div class="form-grid-1">
        <div class="form-grid-2">
          <div class="form-group">
            <label for="cat-codigo">Código</label>
            <input id="cat-codigo" class="input-text" type="text" value="${escapeHtml(r.codigo || '')}" placeholder="Ex: NB-001, MON-003..." />
          </div>
          <div class="form-group">
            <label for="cat-nome">Nome / Modelo *</label>
            <input id="cat-nome" class="input-text" type="text" value="${escapeHtml(r.nome || '')}" placeholder="Ex: Notebook Dell Latitude 5420" required />
          </div>
        </div>
        <div class="form-group">
          <label for="cat-categoria">Categoria *</label>
          <input id="cat-categoria" class="input-text" type="text" value="${escapeHtml(r.categoria || '')}" placeholder="Ex: Notebooks" required list="categorias-list" />
          <datalist id="categorias-list">
            <option value="Notebooks">
            <option value="Desktops">
            <option value="Monitores">
            <option value="Periféricos">
            <option value="Networking">
            <option value="Infraestrutura">
            <option value="Servidores">
            <option value="Impressoras">
          </datalist>
        </div>
        <div class="form-grid-2">
          <div class="form-group">
            <label for="cat-min">Estoque Mínimo</label>
            <input id="cat-min" class="input-text" type="number" min="0" value="${r.estoque_minimo ?? 0}" />
          </div>
          <div class="form-group">
            <label for="cat-max">Estoque Máximo</label>
            <input id="cat-max" class="input-text" type="number" min="0" value="${r.estoque_maximo ?? 0}" />
          </div>
        </div>
      </div>
    `;
  }

  function _lerForm() {
    const codigo    = document.getElementById('cat-codigo')?.value.trim() || null;
    const nome      = document.getElementById('cat-nome')?.value.trim();
    const categoria = document.getElementById('cat-categoria')?.value.trim();
    const min       = parseInt(document.getElementById('cat-min')?.value || '0', 10);
    const max       = parseInt(document.getElementById('cat-max')?.value || '0', 10);

    if (!nome) { Toast.warning('Informe o nome do modelo.'); return null; }
    if (!categoria) { Toast.warning('Informe a categoria.'); return null; }
    if (max < min) { Toast.warning('Estoque máximo não pode ser menor que o mínimo.'); return null; }

    return { codigo, nome, categoria, estoque_minimo: min, estoque_maximo: max };
  }

  return { carregar, filtrar, abrirModalCriacao, abrirModalEdicao, confirmarRemocao, _submitCriacao, _submitEdicao, _remover };
})();
