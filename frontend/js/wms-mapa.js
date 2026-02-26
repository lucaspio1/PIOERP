/**
 * PIOERP — Módulo Mapa WMS V2
 * Gerencia a renderização do Porta-Pallet (Lados Colados) e o drill-down em Modal Centralizado.
 */
const WmsMapa = (() => {
  const RACK_PREFIX = 'PP01';
  const TOTAL_SESSOES = 18;
  const TOTAL_NIVEIS = 7;
  
  let gridEl;

  function init() {
    gridEl = document.getElementById('rack-grid');
    if (!gridEl) return;

    // Em produção, isso seria um `await Api.endereco.mapaOcupacao()`
    const ocupacaoMock = simularOcupacaoNoLoad();
    renderizarGrid(ocupacaoMock);
  }

  // Define as regras de cores baseadas na quantidade de caixas
  function obterClasseStatus(qtdCaixas) {
    if (!qtdCaixas || qtdCaixas === 0) return 'cell-vazio'; // 0 Caixas
    if (qtdCaixas >= 1 && qtdCaixas <= 11) return 'cell-parcial'; // 1 a 11 Caixas
    return 'cell-cheio'; // 12+ Caixas
  }

  function renderizarGrid(mapaOcupacao) {
    gridEl.innerHTML = '';
    
    for (let s = 1; s <= TOTAL_SESSOES; s++) {
      const sessionWrapper = document.createElement('div');
      sessionWrapper.className = 'rack-session-wrapper';
      
      const sessionBox = document.createElement('div');
      sessionBox.className = 'rack-session';

      // Dois lados por sessão (0 e 1) colados
      [0, 1].forEach(lado => {
        const col = document.createElement('div');
        col.className = 'rack-column';
        
        const ladoTitle = document.createElement('div');
        ladoTitle.className = 'lado-header';
        ladoTitle.innerText = `L${lado}`;
        col.appendChild(ladoTitle);

        // Níveis do 7 (topo) ao 1 (base)
        for (let n = TOTAL_NIVEIS; n >= 1; n--) {
          const enderecoCodigo = `${RACK_PREFIX}.S${s}.N${n}.${lado}`;
          const qtdCaixas = mapaOcupacao[enderecoCodigo] || 0;

          const cell = document.createElement('div');
          cell.className = `rack-cell ${obterClasseStatus(qtdCaixas)}`;
          cell.innerText = `N${n}`;
          cell.title = `Endereço: ${enderecoCodigo}\nOcupação: ${qtdCaixas} caixas`;
          
          cell.onclick = () => iniciarDrillDown(enderecoCodigo);
          col.appendChild(cell);
        }
        sessionBox.appendChild(col);
      });
      
      sessionWrapper.appendChild(sessionBox);

      const sessaoHeader = document.createElement('div');
      sessaoHeader.className = 'sessao-header';
      sessaoHeader.innerText = `S${s}`;
      sessionWrapper.appendChild(sessaoHeader);

      gridEl.appendChild(sessionWrapper);
    }
  }

  // --- NAVEGAÇÃO / DRILL-DOWN EM MODAL --- //

  function iniciarDrillDown(codigoEnderecoLado) {
    // 1. Abre o Modal Nativo do Sistema
    Modal.abrir({
      titulo: `Endereço: ${codigoEnderecoLado}`,
      tamanho: 'lg',
      corpo: `
        <div class="wms-modal-header-custom">
          <div id="wms-breadcrumb" class="breadcrumb"></div>
        </div>
        <div id="wms-modal-content">
          <div style="text-align:center"><div class="spinner"></div><p>Sincronizando com o WMS...</p></div>
        </div>
      `
    });

    // 2. Timeout curto para o DOM do modal renderizar as divs injetadas acima
    setTimeout(async () => {
      try {
        const contentEl = document.getElementById('wms-modal-content');
        
        // Precisamos do ID físico do banco para buscar pallets. Buscamos pelo código clicado.
        const resEnderecos = await Api.endereco.listar();
        const ladoObj = resEnderecos.data.find(e => e.codigo === codigoEnderecoLado);

        if (!ladoObj) {
          contentEl.innerHTML = `<p style="color:var(--c-danger)">Endereço físico <strong>${codigoEnderecoLado}</strong> ainda não foi criado no banco de dados.</p>`;
          return;
        }

        // Pula a etapa de escolher lados e vai direto buscar os pallets!
        carregarPallets(ladoObj);
      } catch (error) {
        document.getElementById('wms-modal-content').innerHTML = `<p style="color:var(--c-danger)">Erro de conexão: ${error.message}</p>`;
      }
    }, 50);
  }

  async function carregarPallets(ladoObj) {
    const contentEl = document.getElementById('wms-modal-content');
    contentEl.innerHTML = '<div style="text-align:center"><div class="spinner"></div><p>Buscando pallets...</p></div>';
    
    atualizarBreadcrumb([ { nome: 'Pallets no Lado' } ]);

    try {
      const res = await Api.pallets.listar(ladoObj.id);
      const pallets = res.data || [];
      contentEl.innerHTML = '';

      if (pallets.length === 0) {
        contentEl.innerHTML = '<p style="color:var(--c-text-muted)">Nenhum pallet alocado neste endereço.</p>';
        return;
      }

      pallets.forEach(pallet => {
        const div = document.createElement('div');
        div.className = 'wms-list-item';
        div.innerHTML = `
          <div class="wms-item-title">📦 Pallet: ${pallet.codigo || pallet.id}</div>
          <div class="wms-item-meta" style="color:var(--c-primary); font-weight:600">Ver Caixas &rarr;</div>
        `;
        div.onclick = () => carregarCaixas(ladoObj, pallet);
        contentEl.appendChild(div);
      });
    } catch (err) {
      contentEl.innerHTML = `<p style="color:var(--c-danger)">Erro ao carregar pallets: ${err.message}</p>`;
    }
  }

  async function carregarCaixas(ladoObj, pallet) {
    const contentEl = document.getElementById('wms-modal-content');
    contentEl.innerHTML = '<div style="text-align:center"><div class="spinner"></div><p>Buscando caixas...</p></div>';
    
    atualizarBreadcrumb([
      { nome: 'Pallets', acao: () => carregarPallets(ladoObj) },
      { nome: pallet.codigo || pallet.id }
    ]);

    try {
      const res = await Api.caixas.listar(pallet.id);
      const caixas = res.data || [];
      contentEl.innerHTML = '';

      if (caixas.length === 0) {
        contentEl.innerHTML = '<p style="color:var(--c-text-muted)">Pallet vazio (nenhuma caixa).</p>';
        return;
      }

      caixas.forEach(caixa => {
        const div = document.createElement('div');
        div.className = 'wms-list-item';
        div.innerHTML = `
          <div class="wms-item-title">📥 Caixa: ${caixa.codigo || caixa.id}</div>
          <div class="wms-item-meta" style="color:var(--c-primary); font-weight:600">Equipamentos &rarr;</div>
        `;
        div.onclick = () => carregarEquipamentos(ladoObj, pallet, caixa);
        contentEl.appendChild(div);
      });
    } catch (err) {
      contentEl.innerHTML = `<p style="color:var(--c-danger)">Erro: ${err.message}</p>`;
    }
  }

  async function carregarEquipamentos(ladoObj, pallet, caixa) {
    const contentEl = document.getElementById('wms-modal-content');
    contentEl.innerHTML = '<div style="text-align:center"><div class="spinner"></div><p>Buscando equipamentos...</p></div>';
    
    atualizarBreadcrumb([
      { nome: 'Pallets', acao: () => carregarPallets(ladoObj) },
      { nome: pallet.codigo || pallet.id, acao: () => carregarCaixas(ladoObj, pallet) },
      { nome: caixa.codigo || caixa.id }
    ]);

    try {
      const res = await Api.get(`/equipamento?caixa_id=${caixa.id}`);
      const equipamentos = res.data || [];
      contentEl.innerHTML = '';

      if (equipamentos.length === 0) {
        contentEl.innerHTML = '<p style="color:var(--c-text-muted)">Caixa vazia.</p>';
        return;
      }

      equipamentos.forEach(eq => {
        const div = document.createElement('div');
        div.className = 'wms-equipment-card';
        div.innerHTML = `
          <div style="margin-bottom:4px"><strong>S/N:</strong> ${eq.numero_serie}</div>
          <div><strong>Patrimônio:</strong> ${eq.imobilizado || 'N/A'} <span style="float:right">${badgeStatus(eq.status)}</span></div>
        `;
        contentEl.appendChild(div);
      });
    } catch (err) {
      contentEl.innerHTML = `<p style="color:var(--c-danger)">Erro: ${err.message}</p>`;
    }
  }

  function atualizarBreadcrumb(passos) {
    const breadcrumbEl = document.getElementById('wms-breadcrumb');
    if (!breadcrumbEl) return;
    
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

  // --- Função Mock para Testar as Cores ---
  function simularOcupacaoNoLoad() {
    const map = {};
    for(let s=1; s<=TOTAL_SESSOES; s++) {
      for(let l=1; l<=TOTAL_NIVEIS; l++) {
        // Gera números aleatórios de 0 a 16 caixas para testar os 3 status
        map[`${RACK_PREFIX}.S${s}.N${l}.0`] = Math.floor(Math.random() * 16); 
        map[`${RACK_PREFIX}.S${s}.N${l}.1`] = Math.floor(Math.random() * 16);
      }
    }
    return map;
  }

  return { init };
})();