/**
 * PIOERP — Módulo Mapa WMS
 * Gerencia a renderização do Porta-Pallet e o drill-down de endereços.
 */

const WmsMapa = (() => {
  const RACK_PREFIX = 'PP01';
  const TOTAL_SESSOES = 18;
  const TOTAL_NIVEIS = 7;
  
  // Elementos do DOM
  let gridEl, offcanvasEl, overlayEl, contentEl, titleEl, breadcrumbEl;

  function init() {
    gridEl = document.getElementById('rack-grid');
    offcanvasEl = document.getElementById('wms-offcanvas');
    overlayEl = document.getElementById('offcanvas-overlay');
    contentEl = document.getElementById('offcanvas-content');
    titleEl = document.getElementById('offcanvas-title');
    breadcrumbEl = document.getElementById('wms-breadcrumb');

    if (!gridEl) return;

    renderizarGrid();
    configurarEventos();
  }

  function renderizarGrid() {
    gridEl.innerHTML = '';
    for (let s = 1; s <= TOTAL_SESSOES; s++) {
      const col = document.createElement('div');
      col.className = 'rack-column';

      for (let l = TOTAL_NIVEIS; l >= 1; l--) {
        const cell = document.createElement('div');
        // Por padrão inicia verde (vazio). O ideal seria uma rota na API que retorne a ocupação
        cell.className = 'rack-cell status-empty'; 
        cell.innerText = `N${l}`;
        cell.title = `${RACK_PREFIX}.S${s}.N${l}`;
        
        cell.onclick = () => abrirDetalhes(s, l);
        col.appendChild(cell);
      }

      const header = document.createElement('div');
      header.className = 'col-header';
      header.innerText = `S${s}`;
      col.appendChild(header);
      gridEl.appendChild(col);
    }
  }

  function configurarEventos() {
    const closeBtn = document.getElementById('close-offcanvas');
    const fechar = () => {
      offcanvasEl.classList.remove('open');
      overlayEl.classList.remove('open');
      setTimeout(() => { overlayEl.style.display = 'none'; }, 200);
    };

    closeBtn.addEventListener('click', fechar);
    overlayEl.addEventListener('click', fechar);
  }

  async function abrirDetalhes(sessao, nivel) {
    const prefixo = `${RACK_PREFIX}.S${sessao}.N${nivel}`; // Ex: PP01.S1.N3
    
    overlayEl.style.display = 'flex';
    // Pequeno delay para a transição do CSS aplicar sobre o display:flex
    setTimeout(() => {
        overlayEl.classList.add('open');
        offcanvasEl.classList.add('open');
    }, 10);

    titleEl.innerText = prefixo;
    contentEl.innerHTML = '<div style="text-align:center"><div class="spinner"></div><p>Buscando lados...</p></div>';
    atualizarBreadcrumb([{ nome: 'Lados' }]);

    try {
      // Usando sua API real
      const res = await Api.endereco.listar();
      const lados = res.data.filter(end => end.codigo.startsWith(prefixo));
      renderizarLados(prefixo, lados);
    } catch (error) {
      contentEl.innerHTML = `<p style="color:var(--c-danger)">Erro: ${error.message}</p>`;
    }
  }

  function renderizarLados(prefixo, lados) {
    contentEl.innerHTML = '';
    atualizarBreadcrumb([{ nome: 'Lados', acao: () => renderizarLados(prefixo, lados) }]);

    if(lados.length === 0) {
      contentEl.innerHTML = '<p style="color:var(--c-text-muted)">Nenhum endereço cadastrado para esta célula física.</p>';
      return;
    }

    lados.forEach(lado => {
      const sufixo = lado.codigo.replace(prefixo + '.', '');
      const div = document.createElement('div');
      div.className = 'wms-list-item';
      div.innerHTML = `
        <div>
          <div class="wms-item-title">Lado ${sufixo} ${lado.ativo ? '' : '<span class="badge badge-danger">Inativo</span>'}</div>
          <div class="wms-item-meta">${lado.codigo}</div>
        </div>
        <div class="wms-item-meta" style="color:var(--c-primary)">Ver Pallets &rarr;</div>
      `;
      div.onclick = () => carregarPallets(prefixo, lados, lado);
      contentEl.appendChild(div);
    });
  }

  async function carregarPallets(prefixo, todosLados, lado) {
    contentEl.innerHTML = '<div style="text-align:center"><div class="spinner"></div><p>Buscando pallets...</p></div>';
    atualizarBreadcrumb([
      { nome: 'Lados', acao: () => renderizarLados(prefixo, todosLados) },
      { nome: lado.codigo.split('.').pop() }
    ]);

    try {
      const res = await Api.pallets.listar(lado.id);
      renderizarPallets(prefixo, todosLados, lado, res.data || []);
    } catch (error) {
      contentEl.innerHTML = `<p style="color:var(--c-danger)">Erro: ${error.message}</p>`;
    }
  }

  function renderizarPallets(prefixo, todosLados, lado, pallets) {
    contentEl.innerHTML = '';
    if(pallets.length === 0) {
      contentEl.innerHTML = '<p style="color:var(--c-text-muted)">Nenhum pallet neste lado.</p>';
      return;
    }

    pallets.forEach(pallet => {
      const div = document.createElement('div');
      div.className = 'wms-list-item';
      div.innerHTML = `
        <div class="wms-item-title">📦 ${pallet.codigo || pallet.id}</div>
        <div class="wms-item-meta" style="color:var(--c-primary)">Ver Caixas &rarr;</div>
      `;
      div.onclick = () => carregarCaixas(prefixo, todosLados, lado, pallet);
      contentEl.appendChild(div);
    });
  }

  async function carregarCaixas(prefixo, todosLados, lado, pallet) {
    contentEl.innerHTML = '<div style="text-align:center"><div class="spinner"></div><p>Buscando caixas...</p></div>';
    atualizarBreadcrumb([
      { nome: 'Lados', acao: () => renderizarLados(prefixo, todosLados) },
      { nome: lado.codigo.split('.').pop(), acao: () => carregarPallets(prefixo, todosLados, lado) },
      { nome: pallet.codigo || pallet.id }
    ]);

    try {
      const res = await Api.caixas.listar(pallet.id);
      renderizarCaixas(prefixo, todosLados, lado, pallet, res.data || []);
    } catch (error) {
      contentEl.innerHTML = `<p style="color:var(--c-danger)">Erro: ${error.message}</p>`;
    }
  }

  function renderizarCaixas(prefixo, todosLados, lado, pallet, caixas) {
    contentEl.innerHTML = '';
    if(caixas.length === 0) {
      contentEl.innerHTML = '<p style="color:var(--c-text-muted)">Nenhuma caixa neste pallet.</p>';
      return;
    }

    caixas.forEach(caixa => {
      const div = document.createElement('div');
      div.className = 'wms-list-item';
      div.innerHTML = `
        <div class="wms-item-title">📥 ${caixa.codigo || caixa.id}</div>
        <div class="wms-item-meta" style="color:var(--c-primary)">Equipamentos &rarr;</div>
      `;
      div.onclick = () => carregarEquipamentos(prefixo, todosLados, lado, pallet, caixa);
      contentEl.appendChild(div);
    });
  }

  async function carregarEquipamentos(prefixo, todosLados, lado, pallet, caixa) {
    contentEl.innerHTML = '<div style="text-align:center"><div class="spinner"></div><p>Buscando equipamentos...</p></div>';
    atualizarBreadcrumb([
      { nome: 'Lados', acao: () => renderizarLados(prefixo, todosLados) },
      { nome: lado.codigo.split('.').pop(), acao: () => carregarPallets(prefixo, todosLados, lado) },
      { nome: pallet.codigo || pallet.id, acao: () => carregarCaixas(prefixo, todosLados, lado, pallet) },
      { nome: caixa.codigo || caixa.id }
    ]);

    try {
      const res = await Api.get(`/equipamento?caixa_id=${caixa.id}`);
      renderizarEquipamentos(res.data || []);
    } catch (error) {
      contentEl.innerHTML = `<p style="color:var(--c-danger)">Erro: ${error.message}</p>`;
    }
  }

  function renderizarEquipamentos(equipamentos) {
    contentEl.innerHTML = '';
    if(equipamentos.length === 0) {
      contentEl.innerHTML = '<p style="color:var(--c-text-muted)">Nenhum equipamento nesta caixa.</p>';
      return;
    }

    equipamentos.forEach(eq => {
      const div = document.createElement('div');
      div.className = 'wms-equipment-card';
      div.innerHTML = `
        <div style="margin-bottom:4px"><strong>S/N:</strong> ${eq.numero_serie}</div>
        <div><strong>Patrimônio:</strong> ${eq.imobilizado || 'N/A'}</div>
      `;
      contentEl.appendChild(div);
    });
  }

  function atualizarBreadcrumb(passos) {
    breadcrumbEl.innerHTML = '';
    passos.forEach((passo, i) => {
      const span = document.createElement('span');
      span.innerText = passo.nome;
      if (passo.acao) {
        span.className = 'link';
        span.onclick = passo.acao;
      }
      breadcrumbEl.appendChild(span);
      
      if (i < passos.length - 1) {
        const sep = document.createElement('span');
        sep.innerText = ' > ';
        breadcrumbEl.appendChild(sep);
      }
    });
  }

  // Auto-iniciar quando o DOM carregar
  document.addEventListener('DOMContentLoaded', init);

  return { init };
})();