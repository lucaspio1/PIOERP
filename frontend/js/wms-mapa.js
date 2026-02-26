/**
 * PIOERP — Módulo Mapa WMS V2
 * Gerencia a renderização do Porta-Pallet consumindo DADOS REAIS da API.
 * Estrutura: Lados colados, Modal centralizado e status de ocupação (Verde, Amarelo, Vermelho).
 */
const WmsMapa = (() => {
  const RACK_PREFIX = 'PP01';
  const TOTAL_SESSOES = 18;
  const TOTAL_NIVEIS = 7;
  
  let gridEl;

  async function init() {
    gridEl = document.getElementById('rack-grid');
    if (!gridEl) return;

    // Coloca um spinner de carregamento na grid enquanto busca os dados
    gridEl.innerHTML = `
      <div style="padding: 40px; width: 100%; text-align: center;">
        <div class="spinner"></div>
        <p style="color: var(--c-text-muted); margin-top: 10px;">Calculando ocupação real do WMS...</p>
      </div>
    `;

    try {
      // Busca tudo de uma vez (em paralelo) para não sobrecarregar a API com loops de requisição
      const [resEnderecos, resPallets, resCaixas] = await Promise.all([
        Api.endereco.listar(),
        Api.pallets.listar(), 
        Api.caixas.listar()   
      ]);

      const mapaOcupacaoReal = calcularOcupacao(resEnderecos.data, resPallets.data, resCaixas.data);
      renderizarGrid(mapaOcupacaoReal);
      
    } catch (error) {
      gridEl.innerHTML = `<p style="color:var(--c-danger); padding:20px;">Erro ao carregar os dados reais: ${error.message}</p>`;
    }
  }

  // Função que cruza as tabelas em memória para descobrir quantas caixas existem em cada endereço
  function calcularOcupacao(enderecos, pallets, caixas) {
    const ocupacao = {};
    
    // 1. Mapear ID do Endereço -> Código do Endereço (ex: PP01.S1.N3.0)
    const endIdParaCodigo = {};
    (enderecos || []).forEach(e => {
      endIdParaCodigo[e.id] = e.codigo;
      ocupacao[e.codigo] = 0; // Inicializa todos com 0
    });

    // 2. Mapear ID do Pallet -> Código do Endereço onde ele está fisicamente
    const palletParaEndereco = {};
    (pallets || []).forEach(p => {
      if (p.endereco_id) {
        palletParaEndereco[p.id] = endIdParaCodigo[p.endereco_id];
      }
    });

    // 3. Contar as caixas
    (caixas || []).forEach(c => {
      if (c.pallet_id) {
        const codigoEndereco = palletParaEndereco[c.pallet_id];
        if (codigoEndereco !== undefined) {
          ocupacao[codigoEndereco] += 1; // Soma +1 caixa neste endereço específico
        }
      }
    });

    return ocupacao;
  }

  // Define as regras de cores baseadas na quantidade de caixas (Verde para vazio)
  function obterClasseStatus(qtdCaixas) {
    if (!qtdCaixas || qtdCaixas === 0) return 'cell-vazio'; // Verde
    if (qtdCaixas >= 1 && qtdCaixas <= 11) return 'cell-parcial'; // Amarelo
    return 'cell-cheio'; // Vermelho
  }

  // Renderiza a estrutura visual da grid do Porta-Pallet
  function renderizarGrid(mapaOcupacao) {
    gridEl.innerHTML = '';
    
    for (let s = 1; s <= TOTAL_SESSOES; s++) {
      const sessionWrapper = document.createElement('div');
      sessionWrapper.className = 'rack-session-wrapper';
      
      const sessionBox = document.createElement('div');
      sessionBox.className = 'rack-session';

      // Dois lados por sessão (0 e 1) apresentados de forma colada
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
          
          // Obtém a quantidade REAL calculada a partir do cruzamento de dados
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

  // =========================================================
  // NAVEGAÇÃO / DRILL-DOWN EM MODAL
  // =========================================================

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

    // 2. Pequeno timeout para garantir que o DOM do modal foi renderizado na tela
    setTimeout(async () => {
      try {
        const contentEl = document.getElementById('wms-modal-content');
        
        // Precisamos do ID físico no banco de dados para buscar os pallets atrelados
        const resEnderecos = await Api.endereco.listar();
        const ladoObj = resEnderecos.data.find(e => e.codigo === codigoEnderecoLado);

        if (!ladoObj) {
          contentEl.innerHTML = `<p style="color:var(--c-danger)">O endereço físico <strong>${codigoEnderecoLado}</strong> ainda não foi criado na base de dados.</p>`;
          return;
        }

        // Vai direto para a listagem de Pallets (ignora a etapa intermediária de escolher o lado)
        carregarPallets(ladoObj);
      } catch (error) {
        document.getElementById('wms-modal-content').innerHTML = `<p style="color:var(--c-danger)">Erro de conexão: ${error.message}</p>`;
      }
    }, 50);
  }

  async function carregarPallets(ladoObj) {
    const contentEl = document.getElementById('wms-modal-content');
    contentEl.innerHTML = '<div style="text-align:center"><div class="spinner"></div><p>A procurar pallets...</p></div>';
    
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
    contentEl.innerHTML = '<div style="text-align:center"><div class="spinner"></div><p>A procurar caixas...</p></div>';
    
    atualizarBreadcrumb([
      { nome: 'Pallets', acao: () => carregarPallets(ladoObj) },
      { nome: pallet.codigo || pallet.id }
    ]);

    try {
      const res = await Api.caixas.listar(pallet.id);
      const caixas = res.data || [];
      contentEl.innerHTML = '';

      if (caixas.length === 0) {
        contentEl.innerHTML = '<p style="color:var(--c-text-muted)">Pallet vazio (nenhuma caixa registada).</p>';
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
    contentEl.innerHTML = '<div style="text-align:center"><div class="spinner"></div><p>A procurar equipamentos...</p></div>';
    
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
        contentEl.innerHTML = '<p style="color:var(--c-text-muted)">A caixa está vazia.</p>';
        return;
      }

      equipamentos.forEach(eq => {
        const div = document.createElement('div');
        div.className = 'wms-equipment-card';
        // Utiliza o utilitário badgeStatus nativo da SPA
        div.innerHTML = `
          <div style="margin-bottom:4px"><strong>S/N:</strong> ${eq.numero_serie}</div>
          <div><strong>Património:</strong> ${eq.imobilizado || 'N/A'} <span style="float:right">${badgeStatus(eq.status)}</span></div>
        `;
        contentEl.appendChild(div);
      });
    } catch (err) {
      contentEl.innerHTML = `<p style="color:var(--c-danger)">Erro: ${err.message}</p>`;
    }
  }

  // Constrói e atualiza o histórico de navegação (breadcrumb)
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
      
      // Adiciona o separador se não for o último item
      if (i < passos.length - 1) {
        const sep = document.createElement('span');
        sep.innerText = ' > ';
        breadcrumbEl.appendChild(sep);
      }
    });
  }

  return { init };
})();