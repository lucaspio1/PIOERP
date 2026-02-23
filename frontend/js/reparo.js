/**
 * PIOERP — Módulo: Central de Reparo
 *
 * Funcionalidades:
 * 1. Tabela de prioridades (query complexa do backend)
 * 2. Painel de controle com timer de sessão em tempo real
 * 3. Fluxo: Iniciar → Pausar → Retomar → Finalizar
 */

const Reparo = (() => {
  // ── Estado do timer ──────────────────────────────────────
  let _reparoAtivo = null;   // { reparoId, minutosPrevios, sessaoInicio (Date) }
  let _timerInterval = null;
  let _reparoSelecionadoId = null;

  // ════════════════════════════════════════════════════════
  // TABELA DE PRIORIDADES
  // ════════════════════════════════════════════════════════

  async function carregar() {
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
      tbody.innerHTML = `<tr><td colspan="8" class="empty-row">Nenhum equipamento aguardando reparo.</td></tr>`;
      fecharPainel();
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
          <td style="font-size:12px">${escapeHtml(r.caixa_codigo || '—')}</td>
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

      // Monta localização
      const loc = [r.porta_pallet_codigo, r.sessao_codigo, r.pallet_codigo, r.caixa_codigo]
        .filter(Boolean).join(' › ');
      document.getElementById('rp-local').textContent = loc || '—';

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

  /**
   * Inicia o timer local para o reparo em progresso.
   * Considera o tempo da sessão mais recente (que ainda não tem fim).
   */
  function _iniciarTimerLocal(reparoId, totalMinutos, sessoes) {
    // Encontra a sessão aberta (sem fim)
    const sessaoAberta = sessoes?.find(s => !s.fim);
    const sessaoInicio = sessaoAberta ? new Date(sessaoAberta.inicio) : new Date();

    _reparoAtivo = {
      reparoId,
      minutosPrevios:  totalMinutos,
      sessaoInicio,
    };

    _timerInterval = setInterval(_tickTimer, 1000);
    _tickTimer(); // Primeiro tick imediato
  }

  function _tickTimer() {
    if (!_reparoAtivo) return;

    const agora          = new Date();
    const sessaoSegs     = Math.floor((agora - _reparoAtivo.sessaoInicio) / 1000);
    const totalSegs      = (_reparoAtivo.minutosPrevios * 60) + sessaoSegs;

    _setTimerDisplay(totalSegs);

    // Atualiza também a coluna de tempo na tabela
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
      await carregar(); // Atualiza tabela
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
      await carregar();
    } catch (err) {
      Toast.error('Erro', err.message);
      btn.disabled = false;
    }
  }

  function abrirModalFinalizar() {
    if (!_reparoSelecionadoId) return;

    const obs       = document.getElementById('rp-diagnostico')?.value || '';
    const problema  = document.getElementById('rp-problema')?.value    || '';

    Modal.abrir({
      titulo: 'Finalizar Reparo',
      corpo: `
        <div style="margin-bottom:1rem">
          <p style="color:var(--c-text-secondary);font-size:13px">
            Ao finalizar, o equipamento voltará automaticamente ao status
            <strong>Reposição</strong>.
          </p>
        </div>
        <div class="form-grid-1">
          <div class="form-group">
            <label for="fin-diagnostico">Diagnóstico Final *</label>
            <textarea id="fin-diagnostico" class="input-textarea" rows="3"
              placeholder="Descreva o que foi feito...">${escapeHtml(obs)}</textarea>
          </div>
          <div class="form-group">
            <label for="fin-obs">Observações Finais</label>
            <textarea id="fin-obs" class="input-textarea" rows="2"
              placeholder="Notas adicionais...">${escapeHtml(problema)}</textarea>
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
  }

  async function _confirmarFinalizar() {
    const diagnostico      = document.getElementById('fin-diagnostico')?.value.trim();
    const observacoes_finais = document.getElementById('fin-obs')?.value.trim();

    if (!diagnostico) { Toast.warning('Preencha o diagnóstico final.'); return; }

    _pararTimer();
    Modal.fechar();

    try {
      const res = await Api.reparo.finalizar(_reparoSelecionadoId, {
        diagnostico, observacoes_finais,
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

  // ── Fechar painel ─────────────────────────────────────────
  function fecharPainel() {
    _pararTimer();
    _reparoSelecionadoId = null;
    document.getElementById('reparo-control-panel').style.display = 'none';
    document.getElementById('timer-display').textContent = '00:00:00';
    document.getElementById('timer-display').style.color = '';
    // Remove seleção de linha
    document.querySelectorAll('#tbody-reparo tr').forEach(tr => tr.classList.remove('row-selected'));
  }

  return {
    carregar, selecionarReparo, fecharPainel,
    iniciar, pausar, abrirModalFinalizar, _confirmarFinalizar,
    salvarNotas,
  };
})();
