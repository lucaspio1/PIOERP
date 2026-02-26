/**
 * PIOERP — Módulo Mapa WMS V3
 * Otimização de Drill-down (Salta Pallet) e Enriquecimento de Dados (Catálogo).
 */
const WmsMapa = (() => {
  const RACK_PREFIX = 'PP01';
  const TOTAL_SESSOES = 18;
  const TOTAL_NIVEIS = 7;
  
  let gridEl;
  let catalogoCache = {}; // Cache do catálogo para cruzar nomes e categorias instantaneamente

  async function init() {
    gridEl = document.getElementById('rack-grid');
    if (!gridEl) return;

    gridEl.innerHTML = `
      <div style="padding: 40px; width: 100%; text-align: center;">
        <div class="spinner"></div>
        <p style="color: var(--c-text-muted); margin-top: 10px;">Calculando ocupação e sincronizando catálogo...</p>
      </div>
    `;

    try {
      // Busca tudo de uma vez (em paralelo), incluindo o Catálogo
      const [resEnderecos, resPallets, resCaixas, resCatalogo] = await Promise.all([
        Api.endereco.listar(),
        Api.pallets.listar(), 
        Api.caixas.listar(),
        Api.catalogo.listar() // Busca o catálogo para enriquecer os dados depois
      ]);

      // Popula o cache do catálogo (ID -> Objeto do Catálogo)
      if (resCatalogo.data) {
        resCatalogo.data.forEach(item => {
          catalogoCache[item.id] = item;
        });
      }

      const mapaOcupacaoReal = calcularOcupacao(resEnderecos.data, resPallets.data, resCaixas.data);
      renderizarGrid(mapaOcupacaoReal);
      
    } catch (error) {
      gridEl.innerHTML = `<p style="color:var(--c-danger); padding:20px;">Erro ao carregar dados: ${error.message}</p>`;
    }
  }

  function calcularOcupacao(enderecos, pallets, caixas) {
    const ocupacao = {};
    const endIdParaCodigo = {};
    (enderecos || []).forEach(e => {
      endIdParaCodigo[e.id] = e.codigo;
      ocupacao[e.codigo] = 0; 
    });

    const palletParaEndereco = {};
    (pallets || []).forEach(p => {
      if (p.endereco_id) palletParaEndereco[p.id] = endIdParaCodigo[p.endereco_id];
    });

    (caixas || []).forEach(c => {
      if (c.pallet_id) {
        const codigoEndereco = palletParaEndereco[c.pallet_id];
        if (codigoEndereco !== undefined) ocupacao[codigoEndereco] += 1;
      }
    });

    return ocupacao;
  }

  function obterClasseStatus(qtdCaixas) {
    if (!qtdCaixas || qtdCaixas === 0) return 'cell-vazio'; // Verde
    if (qtdCaixas >= 1 && qtdCaixas <= 11) return 'cell-parcial'; // Amarelo
    return 'cell-cheio'; // Vermelho
  }

  function renderizarGrid(mapaOcupacao) {
    gridEl.innerHTML = '';
    
    for (let s = 1; s <= TOTAL_SESSOES; s++) {
      const sessionWrapper = document.createElement('div');
      sessionWrapper.className = 'rack-session-wrapper';
      const sessionBox = document.createElement('div');
      sessionBox.className = 'rack-session';

      [0, 1].forEach(lado => {
        const col = document.createElement('div');
        col.className = 'rack-column';
        
        const ladoTitle = document.createElement('div');
        ladoTitle.className = 'lado-header';
        ladoTitle.innerText = `L${lado}`;
        col.appendChild(ladoTitle);

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

  // =========================================================
  // V3: NAVEGAÇÃO OTIMIZADA (PULA PALLET) E DADOS RICOS
  // =========================================================

  function iniciarDrillDown(codigoEnderecoLado) {
    Modal.abrir({
      titulo: `Endereço Físico: ${codigoEnderecoLado}`,
      tamanho: 'lg',
      corpo: `
        <div class="wms-modal-header-custom">
          <div id="wms-breadcrumb" class="breadcrumb"></div>
        </div>
        <div id="wms-modal-content">
          <div style="text-align:center"><div class="spinner"></div><p>Acessando célula...</p></div>
        </div>
      `
    });

    setTimeout(async () => {
      try {
        const contentEl = document.getElementById('wms-modal-content');
        const resEnderecos = await Api.endereco.listar();
        const ladoObj = resEnderecos.data.find(e => e.codigo === codigoEnderecoLado);

        if (!ladoObj) {
          contentEl.innerHTML = `<p style="color:var(--c-danger)">O endereço <strong>${codigoEnderecoLado}</strong> não existe na base de dados.</p>`;
          return;
        }

        // Busca o Pallet deste endereço (Regra: 1 endereço = 1 pallet principal)
        const resPallets = await Api.pallets.listar(ladoObj.id);
        const pallets = resPallets.data || [];

        if (pallets.length === 0) {
          atualizarBreadcrumb([{ nome: 'Vazio' }]);
          contentEl.innerHTML = '<p style="color:var(--c-text-muted)">Nenhum pallet/caixa alocado neste endereço.</p>';
          return;
        }

        // Pula a tela de Pallet e vai direto para as Caixas do Pallet[0]
        carregarCaixas(ladoObj, pallets[0]);
      } catch (error) {
        document.getElementById('wms-modal-content').innerHTML = `<p style="color:var(--c-danger)">Erro: ${error.message}</p>`;
      }
    }, 50);
  }

  async function carregarCaixas(ladoObj, pallet) {
    const contentEl = document.getElementById('wms-modal-content');
    contentEl.innerHTML = '<div style="text-align:center"><div class="spinner"></div><p>Lendo conteúdo das caixas...</p></div>';
    
    atualizarBreadcrumb([
      { nome: `Visão Geral (${ladoObj.codigo})` }
    ]);

    try {
      const resCaixas = await Api.caixas.listar(pallet.id);
      const caixas = resCaixas.data || [];

      if (caixas.length === 0) {
        contentEl.innerHTML = '<p style="color:var(--c-text-muted)">Pallet alocado, mas sem caixas registradas.</p>';
        return;
      }

      // Para enriquecer a caixa, buscamos os equipamentos de TODAS as caixas em paralelo
      const reqsEquipamentos = caixas.map(c => Api.get(`/equipamento?caixa_id=${c.id}`).catch(() => ({ data: [] })));
      const respostasEquipamentos = await Promise.all(reqsEquipamentos);

      contentEl.innerHTML = '';

      caixas.forEach((caixa, index) => {
        const equipamentosDaCaixa = respostasEquipamentos[index].data || [];
        
        // Descobre a Categoria predominante usando o Cache do Catálogo
        let categoriaCaixa = 'Diversos / Vazio';
        if (equipamentosDaCaixa.length > 0) {
          const catId = equipamentosDaCaixa[0].catalogo_id;
          if (catId && catalogoCache[catId]) {
            categoriaCaixa = catalogoCache[catId].categoria;
          }
        }

        const div = document.createElement('div');
        div.className = 'wms-list-item';
        div.innerHTML = `
          <div>
            <div class="wms-item-title">📥 Caixa: ${caixa.codigo || caixa.id}</div>
            <div class="wms-item-meta" style="margin-top:4px;">
              <span class="badge badge-gray">${categoriaCaixa}</span> 
              <span style="margin-left: 8px;">📦 ${equipamentosDaCaixa.length} itens</span>
            </div>
          </div>
          <div class="wms-item-meta" style="color:var(--c-primary); font-weight:600">Ver Equipamentos &rarr;</div>
        `;
        div.onclick = () => renderEquipamentos(ladoObj, pallet, caixa, equipamentosDaCaixa);
        contentEl.appendChild(div);
      });
    } catch (err) {
      contentEl.innerHTML = `<p style="color:var(--c-danger)">Erro: ${err.message}</p>`;
    }
  }

  // Recebe os equipamentos já cacheados pela função anterior e renderiza rico
  function renderEquipamentos(ladoObj, pallet, caixa, equipamentos) {
    const contentEl = document.getElementById('wms-modal-content');
    
    atualizarBreadcrumb([
      { nome: `Visão Geral (${ladoObj.codigo})`, acao: () => carregarCaixas(ladoObj, pallet) },
      { nome: `Caixa ${caixa.codigo || caixa.id}` }
    ]);

    contentEl.innerHTML = '';

    if (equipamentos.length === 0) {
      contentEl.innerHTML = '<p style="color:var(--c-text-muted)">A caixa está vazia.</p>';
      return;
    }

    equipamentos.forEach(eq => {
      // Puxa os dados ricos do catálogo
      const cat = catalogoCache[eq.catalogo_id] || { modelo: 'Modelo Desconhecido', categoria: 'Sem Categoria' };

      const div = document.createElement('div');
      div.className = 'wms-equipment-card rich-card';
      
      div.innerHTML = `
        <div class="rich-card-header">
          <span class="rich-card-title">💻 ${cat.modelo}</span>
          <span class="badge badge-gray">${cat.categoria}</span>
        </div>
        <div class="rich-card-body">
          <div><strong>S/N:</strong> <span class="mono">${eq.numero_serie}</span></div>
          <div><strong>Patrimônio:</strong> <span class="mono">${eq.imobilizado || 'N/A'}</span></div>
        </div>
        <div style="margin-top: 8px; display:flex; justify-content:flex-end;">
          ${badgeStatus(eq.status)}
        </div>
      `;
      contentEl.appendChild(div);
    });
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

  return { init };
})();