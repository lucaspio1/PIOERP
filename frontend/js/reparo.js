/**
 * PIOERP — Módulo: Central de Reparo
 *
 * Novo fluxo de trabalho:
 * 1. Painel de Críticos — modelos abaixo do estoque mínimo (com botão Solicitar Lote)
 * 2. Painel de Solicitações Atendidas — cards de pallets disponibilizados pelo almoxarife
 *    - Técnico clica no card → abre modal de bipagem (leitura de Nº Série ou Imobilizado)
 *    - Após bipar, o sistema busca o equipamento e abre o formulário de manutenção
 * 3. Tabela de prioridades — apenas itens solicitados ativamente pelo técnico
 * 4. Painel de controle com timer de sessão em tempo real
 * 5. Fluxo: Iniciar → Pausar → Retomar → Finalizar (com destino: reposição ou pré-venda)
 */

const Reparo = (() => {
  // ── Estado do timer ──────────────────────────────────────
  let _reparoAtivo = null;   // { reparoId, minutosPrevios, sessaoInicio (Date) }
  let _timerInterval = null;
  let _reparoSelecionadoId = null;

  // ════════════════════════════════════════════════════════
  // CARREGAR TUDO
  // ════════════════════════════════════════════════════════

  async function carregar() {
    await Promise.all([
      _carregarCriticos(),
      _carregarSolicitacoesAtendidas(),
      _carregarFila(),
    ]);
  }

  // ════════════════════════════════════════════════════════
  // PAINEL DE CRÍTICOS (modelos abaixo do mínimo)
  // ════════════════════════════════════════════════════════

  async function _carregarCriticos() {
    const tbody = document.getElementById('tbody-reparo-criticos');
    if (!tbody) return;

    tbody.innerHTML = `<tr><td colspan="7" class="empty-row"><span class="spinner"></span></td></tr>`;
    try {
      const res = await Api.reparo.criticos();
      _renderizarCriticos(res.data);
    } catch (err) {
      tbody.innerHTML = `<tr><td colspan="7" class="empty-row" style="color:var(--c-danger)">${escapeHtml(err.message)}</td></tr>`;
    }
  }

  function _renderizarCriticos(lista) {
    const tbody = document.getElementById('tbody-reparo-criticos');
    const panel = document.getElementById('reparo-criticos-panel');

    if (!lista.length) {
      if (panel) panel.style.display = 'none';
      return;
    }

    if (panel) panel.style.display = 'block';

    tbody.innerHTML = lista.map(r => `
      <tr class="row-critical">
        <td><strong>${escapeHtml(r.nome)}</strong></td>
        <td>${escapeHtml(r.categoria)}</td>
        <td>
          <span style="font-weight:700;color:var(--c-danger)">${r.qtd_reposicao}</span>
          <span style="color:var(--c-text-muted)"> / ${r.estoque_minimo}</span>
        </td>
        <td><span class="badge badge-danger">-${Math.abs(r.deficit)}</span></td>
        <td>
          ${parseInt(r.qtd_pre_triagem, 10) > 0
            ? `<span class="badge badge-warning">${r.qtd_pre_triagem} em Pré-Triagem</span>`
            : `<span class="badge badge-gray">0 em Pré-Triagem</span>`
          }
        </td>
        <td>
          ${r.tem_solicitacao_ativa
            ? `<span class="badge badge-info">Solicitação Ativa</span>`
            : ''
          }
        </td>
        <td>
          <div class="action-group">
            ${!r.tem_solicitacao_ativa ? `
              <button class="btn btn-sm btn-warning" onclick="Reparo.abrirModalSolicitarLote(${r.id}, '${escapeHtml(r.nome)}')" title="Solicitar ao almoxarife para descer um pallet deste modelo">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="14" height="14"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
                Solicitar Lote
              </button>
            ` : `
              <button class="btn btn-sm btn-outline" disabled title="Já existe solicitação ativa">
                Solicitado
              </button>
            `}
          </div>
        </td>
      </tr>
    `).join('');
  }

  // ════════════════════════════════════════════════════════
  // PAINEL DE SOLICITAÇÕES ATENDIDAS (pallets disponibilizados)
  // ════════════════════════════════════════════════════════

  async function _carregarSolicitacoesAtendidas() {
    const container = document.getElementById('reparo-solicitacoes-atendidas');
    if (!container) return;

    container.innerHTML = `<div class="empty-row"><span class="spinner"></span></div>`;
    try {
      const res = await Api.reparo.solicitacoesAtendidas();
      _renderizarSolicitacoesAtendidas(res.data);
    } catch (err) {
      container.innerHTML = `<div class="empty-row" style="color:var(--c-danger)">${escapeHtml(err.message)}</div>`;
    }
  }

  function _renderizarSolicitacoesAtendidas(lista) {
    const container = document.getElementById('reparo-solicitacoes-atendidas');
    const panel = document.getElementById('reparo-atendidas-panel');

    if (!lista.length) {
      if (panel) panel.style.display = 'none';
      return;
    }

    if (panel) panel.style.display = 'block';

    container.innerHTML = lista.map(s => `
      <div class="solicitacao-card" onclick="Reparo.abrirBipagem(${s.id}, '${escapeHtml(s.modelo)}', ${s.item_catalogo_id})"
           style="cursor:pointer;border:1px solid var(--c-border);border-radius:8px;padding:16px;margin-bottom:12px;
                  background:var(--c-bg);transition:all 0.2s;box-shadow:0 1px 3px rgba(0,0,0,0.06);"
           onmouseover="this.style.borderColor='var(--c-primary)';this.style.boxShadow='0 2px 8px rgba(0,0,0,0.12)'"
           onmouseout="this.style.borderColor='var(--c-border)';this.style.boxShadow='0 1px 3px rgba(0,0,0,0.06)'">
        <div style="display:flex;justify-content:space-between;align-items:flex-start">
          <div>
            <div style="font-weight:700;font-size:15px;margin-bottom:4px">${escapeHtml(s.modelo)}</div>
            <div style="font-size:12px;color:var(--c-text-muted)">${escapeHtml(s.categoria)}</div>
          </div>
          <span class="badge badge-success">Pallet Disponível</span>
        </div>
        <div style="display:flex;gap:16px;margin-top:12px;font-size:13px">
          <div>
            <span style="color:var(--c-text-muted)">Itens Ag. Triagem:</span>
            <strong style="color:var(--c-warning)">${s.qtd_aguardando_triagem}</strong>
          </div>
          <div>
            <span style="color:var(--c-text-muted)">Atendido em:</span>
            <strong>${formatDateTime(s.atendida_em)}</strong>
          </div>
          ${s.deficit > 0 ? `
          <div>
            <span style="color:var(--c-text-muted)">Déficit:</span>
            <span class="badge badge-danger">-${Math.abs(s.deficit)}</span>
          </div>
          ` : ''}
        </div>
        <div style="margin-top:10px;font-size:12px;color:var(--c-primary);font-weight:600">
          Clique para bipar um equipamento deste pallet
        </div>
      </div>
    `).join('');
  }

  // ════════════════════════════════════════════════════════
  // MODAL DE BIPAGEM (leitura de Nº Série / Imobilizado)
  // ════════════════════════════════════════════════════════

  function abrirBipagem(solicitacaoId, modelo, catalogoId) {
    Modal.abrir({
      titulo: `Bipar Equipamento — ${modelo}`,
      corpo: `
        <div style="text-align:center;padding:1rem 0">
          <svg viewBox="0 0 24 24" fill="none" stroke="var(--c-primary)" stroke-width="1.5" width="48" height="48" style="margin:0 auto 1rem">
            <rect x="3" y="3" width="18" height="18" rx="2"/>
            <line x1="7" y1="8" x2="7" y2="16"/>
            <line x1="9" y1="7" x2="9" y2="17"/>
            <line x1="11" y1="8" x2="11" y2="16"/>
            <line x1="13" y1="6" x2="13" y2="18"/>
            <line x1="15" y1="8" x2="15" y2="16"/>
            <line x1="17" y1="7" x2="17" y2="17"/>
          </svg>
          <p style="font-size:14px;margin-bottom:16px">
            Leia ou digite o <strong>Número de Série</strong> ou <strong>Imobilizado</strong> do equipamento:
          </p>
          <div class="form-group" style="max-width:400px;margin:0 auto">
            <div class="input-with-btn">
              <input type="text" id="bipagem-input" class="input-text"
                placeholder="Nº Série ou Imobilizado..."
                autofocus
                style="font-size:18px;text-align:center;letter-spacing:1px;font-weight:600" />
            </div>
          </div>
          <div id="bipagem-resultado" style="margin-top:16px"></div>
        </div>
      `,
      rodape: `
        <button class="btn btn-outline" onclick="Modal.fechar()">Cancelar</button>
        <button class="btn btn-primary" id="btn-bipagem-buscar" onclick="Reparo._executarBipagem(${solicitacaoId})">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="16" height="16"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
          Buscar
        </button>
      `,
    });

    // Permite submeter com Enter
    setTimeout(() => {
      const input = document.getElementById('bipagem-input');
      if (input) {
        input.focus();
        input.addEventListener('keydown', (e) => {
          if (e.key === 'Enter') {
            e.preventDefault();
            Reparo._executarBipagem(solicitacaoId);
          }
        });
      }
    }, 150);
  }

  async function _executarBipagem(solicitacaoId) {
    const input = document.getElementById('bipagem-input');
    const resultado = document.getElementById('bipagem-resultado');
    const query = input?.value.trim();

    if (!query) {
      Toast.warning('Informe o Número de Série ou Imobilizado.');
      return;
    }

    resultado.innerHTML = `<span class="spinner"></span> Buscando...`;

    try {
      const res = await Api.reparo.buscarBipagem(query);
      const equip = res.data;

      if (!equip.reparo_id) {
        resultado.innerHTML = `
          <div style="color:var(--c-danger);padding:8px">
            Equipamento encontrado mas não possui reparo ativo.
          </div>
        `;
        return;
      }

      // Vincular reparo à solicitação
      try {
        await Api.reparo.vincularSolicitacao(equip.reparo_id, {
          solicitacao_pallet_id: solicitacaoId,
        });
      } catch (_) {
        // Pode falhar se já vinculado — ignora
      }

      Modal.fechar();

      // Abre o painel de controle para este reparo
      Toast.success('Equipamento localizado!', `${equip.modelo} — ${equip.numero_serie}`);
      await selecionarReparo(equip.reparo_id);
      await _carregarFila();
      await _carregarSolicitacoesAtendidas();

    } catch (err) {
      resultado.innerHTML = `
        <div style="color:var(--c-danger);padding:8px;font-size:13px">
          ${escapeHtml(err.message)}
        </div>
      `;
    }
  }

  // ════════════════════════════════════════════════════════
  // TABELA DE PRIORIDADES (fila de reparo — apenas solicitados)
  // ════════════════════════════════════════════════════════

  async function _carregarFila() {
    const tbody = document.getElementById('tbody-reparo');
    tbody.innerHTML = `<tr><td colspan="8" class="empty-row"><span class="spinner"></span></td></tr>`;
    try {
      const res = await Api.reparo.prioridades();
      renderizarTabela(res.data);
    } catch (err) {
      tbody.innerHTML = `<tr><td colspan="8" class="empty-row" style="color:var(--c-danger)">${escapeHtml(err.message)}</td></tr>`;
      Toast.error('Erro ao carregar Central de Reparo', err.message);
    }
  }

  function renderizarTabela(lista) {
    const tbody = document.getElementById('tbody-reparo');

    if (!lista.length) {
      tbody.innerHTML = `<tr><td colspan="8" class="empty-row">Nenhum equipamento solicitado aguardando reparo. Use o painel acima para bipar itens.</td></tr>`;
      return;
    }

    tbody.innerHTML = lista.map((r, idx) => {
      const isSelected = r.reparo_id === _reparoSelecionadoId;
      const isCritico  = r.critico;

      return `
        <tr
          class="${isCritico ? 'row-critical' : ''} ${isSelected ? 'row-selected' : ''}"
          data-reparo-id="${r.reparo_id}"
          data-equip-id="${r.equipamento_id}"
          style="cursor:pointer"
          onclick="Reparo.selecionarReparo(${r.reparo_id})"
        >
          <td>
            <div class="priority-indicator ${isCritico ? 'priority-critical' : 'priority-normal'}">
              <span class="priority-dot"></span>
              <span>${isCritico ? `#${idx + 1} Crítico` : `#${idx + 1}`}</span>
            </div>
          </td>
          <td>
            <div><strong>${escapeHtml(r.modelo)}</strong></div>
            <div style="font-size:11px;color:var(--c-text-muted)">${escapeHtml(r.categoria)}</div>
          </td>
          <td><code>${escapeHtml(r.numero_serie)}</code></td>
          <td>
            <span style="font-weight:700;color:${isCritico ? 'var(--c-danger)' : 'inherit'}">
              ${r.qtd_reposicao}/${r.estoque_minimo}
            </span>
            ${isCritico
              ? `<span class="badge badge-danger" style="margin-left:4px">-${Math.abs(r.deficit)}</span>`
              : ''
            }
          </td>
          <td>${badgeStatusReparo(r.status_reparo)}</td>
          <td>
            <span id="tabela-timer-${r.reparo_id}" style="font-family:var(--font-mono);font-size:13px">
              ${formatMinutos(r.total_minutos_trabalhados)}
            </span>
          </td>
          <td style="font-size:12px"><code>${escapeHtml(r.endereco_codigo || '—')}</code></td>
          <td>
            <div class="action-group">
              <button
                class="btn btn-sm btn-primary btn-row"
                onclick="event.stopPropagation(); Reparo.selecionarReparo(${r.reparo_id})"
                title="Abrir painel de controle"
              >
                Controlar
              </button>
            </div>
          </td>
        </tr>
      `;
    }).join('');
  }

  // ════════════════════════════════════════════════════════
  // PAINEL DE CONTROLE
  // ════════════════════════════════════════════════════════

  async function selecionarReparo(reparoId) {
    _reparoSelecionadoId = reparoId;

    try {
      const res = await Api.reparo.buscarId(reparoId);
      const r = res.data;

      // Preenche painel
      document.getElementById('reparo-panel-titulo').textContent =
        `Reparo #${r.id} — ${r.modelo}`;
      document.getElementById('reparo-panel-sub').textContent =
        `${r.categoria} | Série: ${r.numero_serie}`;
      document.getElementById('rp-modelo').textContent     = r.modelo;
      document.getElementById('rp-serie').textContent      = r.numero_serie;
      document.getElementById('rp-imobilizado').textContent = r.imobilizado;

      // Endereço físico plano
      document.getElementById('rp-local').textContent = r.endereco_codigo || r.caixa_codigo || '—';

      // Preenche textarea de notas
      document.getElementById('rp-problema').value    = r.descricao_problema   || '';
      document.getElementById('rp-diagnostico').value = r.diagnostico          || '';

      // Mostra painel
      document.getElementById('reparo-control-panel').style.display = 'block';

      // Atualiza botões e timer
      _atualizarBotoes(r.status);

      // Se em progresso: inicia/retoma o timer local
      _pararTimer();
      if (r.status === 'em_progresso') {
        _iniciarTimerLocal(reparoId, r.total_minutos_trabalhados, r.sessoes);
      } else {
        _setTimerDisplay(r.total_minutos_trabalhados * 60);
      }

      // Destaca linha selecionada
      document.querySelectorAll('#tbody-reparo tr').forEach(tr => tr.classList.remove('row-selected'));
      const tr = document.querySelector(`#tbody-reparo tr[data-reparo-id="${reparoId}"]`);
      if (tr) tr.classList.add('row-selected');

    } catch (err) {
      Toast.error('Erro ao carregar reparo', err.message);
    }
  }

  function _atualizarBotoes(status) {
    const btnIniciar   = document.getElementById('btn-iniciar');
    const btnPausar    = document.getElementById('btn-pausar');
    const btnFinalizar = document.getElementById('btn-finalizar');

    // Reset
    [btnIniciar, btnPausar, btnFinalizar].forEach(b => { b.style.display = 'none'; b.disabled = false; });

    switch (status) {
      case 'aguardando':
        btnIniciar.style.display   = 'inline-flex';
        btnIniciar.innerHTML       = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="18" height="18"><polygon points="5 3 19 12 5 21 5 3"/></svg> Iniciar`;
        btnFinalizar.style.display = 'inline-flex';
        btnFinalizar.disabled      = true;  // Só finaliza depois de iniciar
        break;

      case 'em_progresso':
        btnPausar.style.display    = 'inline-flex';
        btnFinalizar.style.display = 'inline-flex';
        break;

      case 'pausado':
        btnIniciar.style.display   = 'inline-flex';
        btnIniciar.innerHTML       = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="18" height="18"><polygon points="5 3 19 12 5 21 5 3"/></svg> Retomar`;
        btnFinalizar.style.display = 'inline-flex';
        break;

      case 'finalizado':
        document.getElementById('timer-display').style.color = 'var(--c-success)';
        break;
    }
  }

  // ════════════════════════════════════════════════════════
  // TIMER
  // ════════════════════════════════════════════════════════

  function _iniciarTimerLocal(reparoId, totalMinutos, sessoes) {
    const sessaoAberta = sessoes?.find(s => !s.fim);
    const sessaoInicio = sessaoAberta ? new Date(sessaoAberta.inicio) : new Date();

    _reparoAtivo = {
      reparoId,
      minutosPrevios:  totalMinutos,
      sessaoInicio,
    };

    _timerInterval = setInterval(_tickTimer, 1000);
    _tickTimer();
  }

  function _tickTimer() {
    if (!_reparoAtivo) return;

    const agora          = new Date();
    const sessaoSegs     = Math.floor((agora - _reparoAtivo.sessaoInicio) / 1000);
    const totalSegs      = (_reparoAtivo.minutosPrevios * 60) + sessaoSegs;

    _setTimerDisplay(totalSegs);

    const tabCel = document.getElementById(`tabela-timer-${_reparoAtivo.reparoId}`);
    if (tabCel) {
      const m = Math.floor(totalSegs / 60);
      tabCel.textContent = formatMinutos(m);
    }
  }

  function _setTimerDisplay(totalSeconds) {
    document.getElementById('timer-display').textContent = formatTimer(totalSeconds);
  }

  function _pararTimer() {
    if (_timerInterval) { clearInterval(_timerInterval); _timerInterval = null; }
    _reparoAtivo = null;
  }

  // ════════════════════════════════════════════════════════
  // AÇÕES DE WORKFLOW
  // ════════════════════════════════════════════════════════

  async function iniciar() {
    if (!_reparoSelecionadoId) return;
    const btn = document.getElementById('btn-iniciar');
    btn.disabled = true;
    try {
      const res = await Api.reparo.iniciar(_reparoSelecionadoId);
      Toast.success(res.message || 'Reparo iniciado!');
      await selecionarReparo(_reparoSelecionadoId);
      await _carregarFila();
    } catch (err) {
      Toast.error('Erro', err.message);
      btn.disabled = false;
    }
  }

  async function pausar() {
    if (!_reparoSelecionadoId) return;
    const btn = document.getElementById('btn-pausar');
    btn.disabled = true;
    _pararTimer();
    try {
      const res = await Api.reparo.pausar(_reparoSelecionadoId);
      Toast.info(res.message || 'Reparo pausado.');
      await selecionarReparo(_reparoSelecionadoId);
      await _carregarFila();
    } catch (err) {
      Toast.error('Erro', err.message);
      btn.disabled = false;
    }
  }

  // ── Modal Finalizar (com opção de destino) ──────────────
  function abrirModalFinalizar() {
    if (!_reparoSelecionadoId) return;

    const obs      = document.getElementById('rp-diagnostico')?.value || '';
    const problema = document.getElementById('rp-problema')?.value    || '';

    Modal.abrir({
      titulo: 'Finalizar Reparo',
      tamanho: 'lg',
      corpo: `
        <div class="form-grid-1">
          <div class="form-group">
            <label for="fin-diagnostico">Diagnóstico Final *</label>
            <textarea id="fin-diagnostico" class="input-textarea" rows="3"
              placeholder="Descreva o que foi feito, peças trocadas, resultado...">${escapeHtml(obs)}</textarea>
          </div>
          <div class="form-group">
            <label for="fin-obs">Observações Finais</label>
            <textarea id="fin-obs" class="input-textarea" rows="2"
              placeholder="Notas adicionais...">${escapeHtml(problema)}</textarea>
          </div>
          <div class="form-group">
            <label for="fin-destino">Destino do Equipamento *</label>
            <select id="fin-destino" class="input-select">
              <option value="reposicao">Reposição (consertado — aguarda validação do administrador)</option>
              <option value="pre_venda">Ag. Venda (sem conserto — aguarda destinação para venda/sucata)</option>
            </select>
            <p style="margin-top:6px;font-size:12px;color:var(--c-text-muted)" id="fin-destino-hint">
              O equipamento irá para Ag. Internalização. O administrador confirmará e alocará no WMS.
            </p>
          </div>
          <div class="form-group" id="fin-filial-group">
            <label for="fin-filial">Filial Sistêmica (Alocação Atual) *</label>
            <input type="text" id="fin-filial" class="input-text" placeholder="Ex: 001, 0324..." />
            <p style="margin-top:4px;font-size:12px;color:var(--c-text-muted)">Informe a filial onde o equipamento está alocado atualmente no sistema.</p>
          </div>
        </div>
      `,
      rodape: `
        <button class="btn btn-outline" onclick="Modal.fechar()">Cancelar</button>
        <button class="btn btn-danger" onclick="Reparo._confirmarFinalizar()">
          Confirmar Finalização
        </button>
      `,
    });

    // Atualiza hint ao mudar destino
    setTimeout(() => {
      document.getElementById('fin-destino')?.addEventListener('change', (e) => {
        const hints = {
          reposicao: 'O equipamento irá para Ag. Internalização. O administrador confirmará e alocará no WMS.',
          pre_venda: 'O equipamento irá para Ag. Venda aguardando destinação final (venda ou sucata).',
        };
        document.getElementById('fin-destino-hint').textContent = hints[e.target.value] || '';
        document.getElementById('fin-filial-group').style.display =
          e.target.value === 'reposicao' ? 'block' : 'none';
      });
    }, 100);
  }

  async function _confirmarFinalizar() {
    const diagnostico        = document.getElementById('fin-diagnostico')?.value.trim();
    const observacoes_finais = document.getElementById('fin-obs')?.value.trim();
    const status_destino     = document.getElementById('fin-destino')?.value || 'reposicao';
    const alocacao_filial    = document.getElementById('fin-filial')?.value.trim();

    if (!diagnostico) { Toast.warning('Preencha o diagnóstico final.'); return; }
    if (status_destino === 'reposicao' && !alocacao_filial) {
      Toast.warning('Informe a Filial Sistêmica de alocação atual.');
      return;
    }

    _pararTimer();
    Modal.fechar();

    try {
      const res = await Api.reparo.finalizar(_reparoSelecionadoId, {
        diagnostico, observacoes_finais, status_destino,
        alocacao_filial: status_destino === 'reposicao' ? alocacao_filial : undefined,
      });
      Toast.success('Reparo finalizado!', res.message);
      document.getElementById('timer-display').style.color = 'var(--c-success)';
      fecharPainel();
      await carregar();
    } catch (err) {
      Toast.error('Erro ao finalizar', err.message);
    }
  }

  // ── Salvar notas (descrição / diagnóstico) ────────────────
  async function salvarNotas() {
    if (!_reparoSelecionadoId) return;
    const descricao_problema = document.getElementById('rp-problema')?.value.trim()    || null;
    const diagnostico        = document.getElementById('rp-diagnostico')?.value.trim() || null;
    try {
      await Api.reparo.atualizar(_reparoSelecionadoId, { descricao_problema, diagnostico });
      Toast.success('Notas salvas com sucesso.');
    } catch (err) {
      Toast.error('Erro ao salvar notas', err.message);
    }
  }

  // ════════════════════════════════════════════════════════
  // SOLICITAR LOTE (botão no painel de críticos)
  // ════════════════════════════════════════════════════════

  function abrirModalSolicitarLote(catalogoId, nomeModelo) {
    Modal.abrir({
      titulo: 'Solicitar Descida de Lote',
      corpo: `
        <p>Você está solicitando ao almoxarife que desça um pallet/lote do modelo:</p>
        <p style="margin:12px 0;font-size:16px;font-weight:700">${escapeHtml(nomeModelo)}</p>
        <div class="form-group">
          <label for="sol-obs">Observações para o almoxarife</label>
          <textarea id="sol-obs" class="input-textarea" rows="3"
            placeholder="Ex: Preciso urgente de 5 unidades para reparos da semana..."></textarea>
        </div>
      `,
      rodape: `
        <button class="btn btn-outline" onclick="Modal.fechar()">Cancelar</button>
        <button class="btn btn-warning" onclick="Reparo._confirmarSolicitarLote(${catalogoId})">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="16" height="16"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
          Enviar Solicitação
        </button>
      `,
    });
  }

  async function _confirmarSolicitarLote(catalogoId) {
    const observacao = document.getElementById('sol-obs')?.value.trim();
    Modal.fechar();

    try {
      const res = await Api.reparo.solicitarLote({
        item_catalogo_id: catalogoId,
        observacao,
      });
      Toast.success('Solicitação enviada!', res.message);
      await _carregarCriticos();
    } catch (err) {
      Toast.error('Erro ao solicitar lote', err.message);
    }
  }

  // ── Fechar painel ─────────────────────────────────────────
  function fecharPainel() {
    _pararTimer();
    _reparoSelecionadoId = null;
    document.getElementById('reparo-control-panel').style.display = 'none';
    document.getElementById('timer-display').textContent = '00:00:00';
    document.getElementById('timer-display').style.color = '';
    document.querySelectorAll('#tbody-reparo tr').forEach(tr => tr.classList.remove('row-selected'));
  }

  return {
    carregar, selecionarReparo, fecharPainel,
    renderizarTabela,
    iniciar, pausar, abrirModalFinalizar, _confirmarFinalizar,
    salvarNotas,
    abrirModalSolicitarLote, _confirmarSolicitarLote,
    abrirBipagem, _executarBipagem,
  };
})();
