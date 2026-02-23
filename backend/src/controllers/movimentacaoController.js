'use strict';

const db = require('../config/database');

// ── Listar histórico de movimentações ────────────────────────────────────────
exports.list = async (req, res, next) => {
  try {
    const { equipamento_id, tipo, limit = 100, offset = 0 } = req.query;
    const params = [];
    const conditions = [];

    if (equipamento_id) conditions.push(`hm.equipamento_id = $${params.push(equipamento_id)}`);
    if (tipo)           conditions.push(`hm.tipo = $${params.push(tipo)}`);

    const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';

    const { rows } = await db.query(`
      SELECT
        hm.id, hm.tipo, hm.status_anterior, hm.status_novo,
        hm.observacao, hm.created_at,
        ef.numero_serie, ef.imobilizado,
        ic.nome AS modelo,
        eo.codigo AS origem_codigo,
        ed.codigo AS destino_codigo
      FROM historico_movimentacao hm
      JOIN equipamento_fisico ef ON ef.id = hm.equipamento_id
      JOIN item_catalogo ic      ON ic.id = ef.item_catalogo_id
      LEFT JOIN endereco_fisico eo ON eo.id = hm.endereco_origem_id
      LEFT JOIN endereco_fisico ed ON ed.id = hm.endereco_destino_id
      ${where}
      ORDER BY hm.created_at DESC
      LIMIT $${params.push(Math.min(Number(limit), 500))}
      OFFSET $${params.push(Number(offset))}
    `, params);

    res.json({ success: true, data: rows });
  } catch (err) { next(err); }
};

// ── Estoque crítico: catálogos abaixo do mínimo ──────────────────────────────
exports.getEstoqueCritico = async (req, res, next) => {
  try {
    const { rows } = await db.query(`
      SELECT *
      FROM v_estoque_por_catalogo
      WHERE estoque_critico = TRUE
      ORDER BY deficit DESC, nome ASC
    `);
    res.json({ success: true, data: rows, total: rows.length });
  } catch (err) { next(err); }
};

// ── Resumo do dashboard ───────────────────────────────────────────────────────
exports.getDashboard = async (req, res, next) => {
  try {
    const [totais, criticos, recentes] = await Promise.all([
      db.query(`
        SELECT
          COUNT(*)                                        AS total_equipamentos,
          COUNT(*) FILTER (WHERE status = 'reposicao')   AS em_reposicao,
          COUNT(*) FILTER (WHERE status = 'ag_triagem')  AS em_triagem,
          COUNT(*) FILTER (WHERE status = 'venda')       AS em_venda
        FROM equipamento_fisico
      `),
      db.query(`SELECT COUNT(*) AS total FROM v_estoque_por_catalogo WHERE estoque_critico = TRUE`),
      db.query(`
        SELECT
          hm.tipo, hm.status_novo, hm.created_at,
          ef.numero_serie, ic.nome AS modelo
        FROM historico_movimentacao hm
        JOIN equipamento_fisico ef ON ef.id = hm.equipamento_id
        JOIN item_catalogo ic      ON ic.id = ef.item_catalogo_id
        ORDER BY hm.created_at DESC
        LIMIT 10
      `),
    ]);

    res.json({
      success: true,
      data: {
        totais:          totais.rows[0],
        alertas_criticos: parseInt(criticos.rows[0].total, 10),
        movimentacoes_recentes: recentes.rows,
      },
    });
  } catch (err) { next(err); }
};
