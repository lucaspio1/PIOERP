'use strict';

const db = require('../config/database');

// ── Dashboard de prioridades (query complexa) ────────────────────────────────
exports.getPrioridades = async (req, res, next) => {
  try {
    const { rows } = await db.query('SELECT * FROM v_prioridades_reparo');
    res.json({ success: true, data: rows, total: rows.length });
  } catch (err) { next(err); }
};

// ── Buscar reparo por ID com sessões ─────────────────────────────────────────
exports.getById = async (req, res, next) => {
  try {
    const { id } = req.params;

    const [reparo, sessoes] = await Promise.all([
      db.query(`
        SELECT
          r.*,
          ef.numero_serie, ef.imobilizado, ef.status AS status_equip,
          ic.nome AS modelo, ic.categoria
        FROM reparo r
        JOIN equipamento_fisico ef ON ef.id = r.equipamento_id
        JOIN item_catalogo ic      ON ic.id = ef.item_catalogo_id
        WHERE r.id = $1
      `, [id]),
      db.query(`
        SELECT
          id, inicio, fim,
          CASE
            WHEN fim IS NOT NULL
              THEN EXTRACT(EPOCH FROM (fim - inicio))::INTEGER / 60
            ELSE NULL
          END AS minutos
        FROM sessao_reparo
        WHERE reparo_id = $1
        ORDER BY inicio ASC
      `, [id]),
    ]);

    if (!reparo.rows.length) {
      const e = new Error('Reparo não encontrado.'); e.status = 404; throw e;
    }

    res.json({ success: true, data: { ...reparo.rows[0], sessoes: sessoes.rows } });
  } catch (err) { next(err); }
};

// ── Atualizar campos descritivos do reparo ───────────────────────────────────
exports.update = async (req, res, next) => {
  try {
    const { id } = req.params;
    const { descricao_problema, diagnostico, observacoes_finais } = req.body;

    const { rows } = await db.query(`
      UPDATE reparo
        SET descricao_problema  = COALESCE($1, descricao_problema),
            diagnostico         = COALESCE($2, diagnostico),
            observacoes_finais  = COALESCE($3, observacoes_finais)
      WHERE id = $4 RETURNING *
    `, [
      descricao_problema  ?? null,
      diagnostico         ?? null,
      observacoes_finais  ?? null,
      id,
    ]);

    if (!rows.length) {
      const e = new Error('Reparo não encontrado.'); e.status = 404; throw e;
    }
    res.json({ success: true, data: rows[0] });
  } catch (err) { next(err); }
};

// ── INICIAR reparo (ou RETOMAR após pausa) ────────────────────────────────────
// Abre uma nova sessao_reparo e muda status → 'em_progresso'
exports.iniciar = async (req, res, next) => {
  const client = await db.getClient();
  try {
    await client.query('BEGIN');

    const { id } = req.params;

    const rep = await client.query('SELECT * FROM reparo WHERE id = $1', [id]);
    if (!rep.rows.length) {
      const e = new Error('Reparo não encontrado.'); e.status = 404; throw e;
    }
    const reparo = rep.rows[0];

    if (reparo.status === 'finalizado') {
      const e = new Error('Este reparo já foi finalizado.'); e.status = 409; throw e;
    }
    if (reparo.status === 'em_progresso') {
      const e = new Error('Reparo já está em progresso.'); e.status = 409; throw e;
    }

    // Garante que não existe sessão aberta (sem fim)
    await client.query(
      `UPDATE sessao_reparo SET fim = NOW() WHERE reparo_id = $1 AND fim IS NULL`, [id]
    );

    // Cria nova sessão
    const sessao = await client.query(
      `INSERT INTO sessao_reparo (reparo_id, inicio) VALUES ($1, NOW()) RETURNING *`,
      [id]
    );

    // Atualiza reparo
    const { rows } = await client.query(`
      UPDATE reparo
        SET status = 'em_progresso',
            iniciado_em = COALESCE(iniciado_em, NOW())
      WHERE id = $1 RETURNING *
    `, [id]);

    await client.query('COMMIT');
    res.json({
      success: true,
      message: reparo.status === 'pausado' ? 'Reparo retomado.' : 'Reparo iniciado.',
      data: { reparo: rows[0], sessao: sessao.rows[0] },
    });
  } catch (err) {
    await client.query('ROLLBACK');
    next(err);
  } finally {
    client.release();
  }
};

// ── PAUSAR reparo ─────────────────────────────────────────────────────────────
// Fecha a sessao_reparo corrente, acumula minutos no reparo, status → 'pausado'
exports.pausar = async (req, res, next) => {
  const client = await db.getClient();
  try {
    await client.query('BEGIN');

    const { id } = req.params;

    const rep = await client.query('SELECT * FROM reparo WHERE id = $1', [id]);
    if (!rep.rows.length) {
      const e = new Error('Reparo não encontrado.'); e.status = 404; throw e;
    }
    if (rep.rows[0].status !== 'em_progresso') {
      const e = new Error('Só é possível pausar um reparo em andamento.'); e.status = 409; throw e;
    }

    // Fecha sessão aberta e calcula minutos
    const sessao = await client.query(`
      UPDATE sessao_reparo
        SET fim = NOW()
      WHERE reparo_id = $1 AND fim IS NULL
      RETURNING *,
        EXTRACT(EPOCH FROM (fim - inicio))::INTEGER / 60 AS minutos_sessao
    `, [id]);

    const minutosSessao = sessao.rows.length
      ? Math.max(0, parseInt(sessao.rows[0].minutos_sessao || 0, 10))
      : 0;

    // Acumula no reparo e muda status
    const { rows } = await client.query(`
      UPDATE reparo
        SET status = 'pausado',
            total_minutos_trabalhados = total_minutos_trabalhados + $1
      WHERE id = $2 RETURNING *
    `, [minutosSessao, id]);

    await client.query('COMMIT');
    res.json({
      success: true,
      message: `Reparo pausado. +${minutosSessao} minutos registrados.`,
      data: { reparo: rows[0], minutos_sessao: minutosSessao },
    });
  } catch (err) {
    await client.query('ROLLBACK');
    next(err);
  } finally {
    client.release();
  }
};

// ── FINALIZAR reparo ─────────────────────────────────────────────────────────
// Fecha a sessão, acumula tempo, e permite direcionar o equipamento para
// reposição (padrão), pre_venda ou venda.
exports.finalizar = async (req, res, next) => {
  const client = await db.getClient();
  try {
    await client.query('BEGIN');

    const { id } = req.params;
    // status_destino vem do frontend com o local escolhido pelo técnico
    const { observacoes_finais, diagnostico, status_destino = 'reposicao', caixa_destino_id } = req.body || {};

    // Alteração importante: fazer o JOIN para buscar a `caixa_id` atual no equipamento_fisico
    const rep = await client.query(`
      SELECT r.*, ef.caixa_id AS equip_caixa_id
      FROM reparo r
      JOIN equipamento_fisico ef ON ef.id = r.equipamento_id
      WHERE r.id = $1
    `, [id]);

    if (!rep.rows.length) {
      const e = new Error('Reparo não encontrado.'); e.status = 404; throw e;
    }
    const reparo = rep.rows[0];

    if (reparo.status === 'finalizado') {
      const e = new Error('Este reparo já foi finalizado.'); e.status = 409; throw e;
    }

    // Fecha sessão aberta, se houver
    let minutosSessao = 0;
    if (reparo.status === 'em_progresso') {
      const sessao = await client.query(`
        UPDATE sessao_reparo
          SET fim = NOW()
        WHERE reparo_id = $1 AND fim IS NULL
        RETURNING EXTRACT(EPOCH FROM (fim - inicio))::INTEGER / 60 AS minutos_sessao
      `, [id]);
      minutosSessao = sessao.rows.length
        ? Math.max(0, parseInt(sessao.rows[0].minutos_sessao || 0, 10))
        : 0;
    }

    const totalFinal = reparo.total_minutos_trabalhados + minutosSessao;

    // Finaliza reparo
    const { rows } = await client.query(`
      UPDATE reparo
        SET status = 'finalizado',
            finalizado_em = NOW(),
            total_minutos_trabalhados = $1,
            diagnostico = COALESCE($2, diagnostico),
            observacoes_finais = COALESCE($3, observacoes_finais)
      WHERE id = $4 RETURNING *
    `, [totalFinal, diagnostico || null, observacoes_finais || null, id]);

    // Define se o item continua no WMS
    const removerDoWms = (status_destino === 'venda');
    const novaCaixa = removerDoWms ? null : (caixa_destino_id || reparo.equip_caixa_id);

    // Atualiza o status do equipamento e, se aplicável, desvincula do endereço físico
    await client.query(
      `UPDATE equipamento_fisico SET status = $1, caixa_id = $2 WHERE id = $3`,
      [status_destino, novaCaixa, reparo.equipamento_id]
    );

    // Registra histórico
    await client.query(`
      INSERT INTO historico_movimentacao
        (equipamento_id, tipo, status_anterior, status_novo, observacao)
      VALUES ($1, 'movimentacao', 'ag_triagem', $2, $3)
    `, [reparo.equipamento_id, status_destino, `Reparo finalizado. Tempo: ${totalFinal} min. Destino: ${status_destino}. ${observacoes_finais || ''}`]);

    await client.query('COMMIT');
    res.json({
      success: true,
      message: `Reparo finalizado. Tempo total: ${totalFinal} minutos. Destino: ${status_destino}`,
      data: { reparo: rows[0], total_minutos: totalFinal, status_destino },
    });
  } catch (err) {
    await client.query('ROLLBACK');
    next(err);
  } finally {
    client.release();
  }
};

// ── Modelos críticos com visibilidade expandida (para painel da Central) ──────
// GET /api/reparo/criticos
// Retorna modelos abaixo do estoque mínimo, com contagem de pré-triagem e
// indicação de solicitação de pallet ativa para cada modelo.
exports.getCriticos = async (req, res, next) => {
  try {
    const { rows } = await db.query(`
      SELECT
        ic.id, ic.nome, ic.categoria, ic.estoque_minimo,
        v.qtd_reposicao, v.qtd_ag_triagem, v.deficit, v.estoque_critico,
        COUNT(ef.id) FILTER (WHERE ef.status = 'pre_triagem') AS qtd_pre_triagem,
        COUNT(ef.id) FILTER (WHERE ef.status = 'pre_venda')   AS qtd_pre_venda,
        EXISTS(
          SELECT 1 FROM solicitacao_pallet sp
          WHERE sp.item_catalogo_id = ic.id
            AND sp.status IN ('pendente', 'em_andamento')
        ) AS tem_solicitacao_ativa
      FROM v_estoque_por_catalogo v
      JOIN item_catalogo ic      ON ic.id = v.id
      LEFT JOIN equipamento_fisico ef ON ef.item_catalogo_id = ic.id
      WHERE v.estoque_critico = TRUE
      GROUP BY ic.id, ic.nome, ic.categoria, ic.estoque_minimo,
               v.qtd_reposicao, v.qtd_ag_triagem, v.deficit, v.estoque_critico
      ORDER BY v.deficit DESC, ic.nome ASC
    `);
    res.json({ success: true, data: rows, total: rows.length });
  } catch (err) { next(err); }
};

// ── SOLICITAR LOTE (pedir ao almoxarife para descer pallet) ──────────────────
// POST /api/reparo/solicitar-lote
exports.solicitarLote = async (req, res, next) => {
  try {
    const { item_catalogo_id, observacao } = req.body;

    if (!item_catalogo_id) {
      const e = new Error('"item_catalogo_id" é obrigatório.'); e.status = 400; throw e;
    }

    // Valida que o catálogo existe
    const cat = await db.query('SELECT id, nome FROM item_catalogo WHERE id = $1 AND ativo = TRUE', [item_catalogo_id]);
    if (!cat.rows.length) {
      const e = new Error('Item de catálogo não encontrado.'); e.status = 404; throw e;
    }

    // Verifica se já existe solicitação pendente/em_andamento para este modelo
    const ativa = await db.query(
      `SELECT id FROM solicitacao_pallet WHERE item_catalogo_id = $1 AND status IN ('pendente', 'em_andamento') LIMIT 1`,
      [item_catalogo_id]
    );
    if (ativa.rows.length) {
      const e = new Error('Já existe uma solicitação ativa para este modelo. Aguarde o atendimento.'); e.status = 409; throw e;
    }

    const { rows } = await db.query(
      `INSERT INTO solicitacao_pallet (item_catalogo_id, observacao)
       VALUES ($1, $2) RETURNING *`,
      [item_catalogo_id, observacao?.trim() || null]
    );

    res.status(201).json({
      success: true,
      message: `Solicitação criada para "${cat.rows[0].nome}". O almoxarife será notificado.`,
      data: rows[0],
    });
  } catch (err) { next(err); }
};

// ── LISTAR SOLICITAÇÕES DE PALLET ─────────────────────────────────────────────
// GET /api/reparo/solicitacoes?status=pendente
exports.listarSolicitacoes = async (req, res, next) => {
  try {
    const { status } = req.query;
    const params = [];
    const conditions = [];

    if (status) {
      const validos = ['pendente', 'em_andamento', 'atendida', 'cancelada'];
      if (!validos.includes(status)) {
        const e = new Error(`Status inválido. Aceitos: ${validos.join(', ')}`); e.status = 400; throw e;
      }
      conditions.push(`sp.status = $${params.push(status)}`);
    }

    const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';

    const { rows } = await db.query(`
      SELECT
        sp.*,
        ic.nome AS modelo, ic.categoria,
        ic.estoque_minimo,
        v.qtd_reposicao, v.deficit
      FROM solicitacao_pallet sp
      JOIN item_catalogo ic ON ic.id = sp.item_catalogo_id
      LEFT JOIN v_estoque_por_catalogo v ON v.id = ic.id
      ${where}
      ORDER BY
        CASE sp.status
          WHEN 'pendente'     THEN 1
          WHEN 'em_andamento' THEN 2
          WHEN 'atendida'     THEN 3
          WHEN 'cancelada'    THEN 4
          ELSE 5
        END,
        sp.created_at DESC
    `, params);

    res.json({ success: true, data: rows, total: rows.length });
  } catch (err) { next(err); }
};

// ── ATUALIZAR STATUS DE SOLICITAÇÃO (almoxarife atende) ───────────────────────
// PUT /api/reparo/solicitacoes/:id
exports.atualizarSolicitacao = async (req, res, next) => {
  try {
    const { id } = req.params;
    const { status, observacao } = req.body;

    const validos = ['pendente', 'em_andamento', 'atendida', 'cancelada'];
    if (!status || !validos.includes(status)) {
      const e = new Error(`"status" é obrigatório. Aceitos: ${validos.join(', ')}`); e.status = 400; throw e;
    }

    const atendidaEm = status === 'atendida' ? 'NOW()' : 'atendida_em';

    const { rows } = await db.query(`
      UPDATE solicitacao_pallet
        SET status       = $1,
            observacao   = COALESCE($2, observacao),
            atendida_em  = CASE WHEN $1 = 'atendida' THEN NOW() ELSE atendida_em END,
            updated_at   = NOW()
      WHERE id = $3
      RETURNING *
    `, [status, observacao?.trim() || null, id]);

    if (!rows.length) {
      const e = new Error('Solicitação não encontrada.'); e.status = 404; throw e;
    }

    res.json({ success: true, data: rows[0], message: `Solicitação marcada como "${status}".` });
  } catch (err) { next(err); }
};