'use strict';

const db = require('../config/database');

// ── Listar equipamentos aguardando internalização ─────────────────────────────
// GET /api/internalizacao
exports.list = async (req, res, next) => {
  try {
    const { rows } = await db.query(`
      SELECT
        ef.id, ef.numero_serie, ef.imobilizado, ef.status,
        ef.alocacao_filial, ef.updated_at,
        ic.id   AS item_catalogo_id,
        ic.nome AS modelo,
        ic.categoria,
        end_f.codigo AS endereco_codigo
      FROM equipamento_fisico ef
      JOIN item_catalogo ic      ON ic.id = ef.item_catalogo_id
      LEFT JOIN endereco_fisico end_f ON end_f.id = ef.endereco_id
      WHERE ef.status = 'ag_internalizacao'
      ORDER BY ef.updated_at ASC
    `);
    res.json({ success: true, data: rows, total: rows.length });
  } catch (err) { next(err); }
};

// ── Caixas que já possuem esse modelo (para sugestão de endereçamento) ────────
// GET /api/internalizacao/locais-por-modelo/:catalogo_id
exports.locaisPorModelo = async (req, res, next) => {
  try {
    const { catalogo_id } = req.params;
    const { rows } = await db.query(`
      SELECT
        cx.id        AS caixa_id,
        cx.codigo    AS caixa_codigo,
        p.id         AS pallet_id,
        p.codigo     AS pallet_codigo,
        end_f.id     AS endereco_id,
        end_f.codigo AS endereco_codigo
      FROM caixa cx
      JOIN pallet p           ON p.id      = cx.pallet_id
      JOIN endereco_fisico end_f ON end_f.id = p.endereco_id
      WHERE EXISTS (
        SELECT 1 FROM equipamento_fisico eq
        WHERE eq.caixa_id         = cx.id
          AND eq.item_catalogo_id = $1
          AND eq.status           = 'reposicao'
      )
      ORDER BY end_f.codigo, p.codigo, cx.codigo
    `, [catalogo_id]);
    res.json({ success: true, data: rows, total: rows.length });
  } catch (err) { next(err); }
};

// ── Aprovar internalização ────────────────────────────────────────────────────
// POST /api/internalizacao/:id/aprovar
exports.aprovar = async (req, res, next) => {
  const client = await db.getClient();
  try {
    await client.query('BEGIN');

    const { id } = req.params;
    const { caixa_id } = req.body;

    if (!caixa_id) {
      const e = new Error('"caixa_id" é obrigatório para aprovar a internalização.'); e.status = 400; throw e;
    }

    // Verifica equipamento
    const eq = await client.query(
      'SELECT * FROM equipamento_fisico WHERE id = $1', [id]
    );
    if (!eq.rows.length) {
      const e = new Error('Equipamento não encontrado.'); e.status = 404; throw e;
    }
    if (eq.rows[0].status !== 'ag_internalizacao') {
      const e = new Error('Equipamento não está aguardando internalização.'); e.status = 409; throw e;
    }

    // Verifica caixa
    const cx = await client.query('SELECT id FROM caixa WHERE id = $1', [caixa_id]);
    if (!cx.rows.length) {
      const e = new Error('Caixa não encontrada.'); e.status = 404; throw e;
    }

    // Aprova: status → reposicao, filial → 324, vincula caixa, limpa endereco_id
    await client.query(`
      UPDATE equipamento_fisico
        SET status          = 'reposicao',
            alocacao_filial = '324',
            caixa_id        = $1,
            endereco_id     = NULL,
            updated_at      = NOW()
      WHERE id = $2
    `, [caixa_id, id]);

    // Histórico
    await client.query(`
      INSERT INTO historico_movimentacao
        (equipamento_id, tipo, status_anterior, status_novo, observacao)
      VALUES ($1, 'movimentacao', 'ag_internalizacao', 'reposicao',
              'Internalização aprovada pelo administrador. Filial alterada para 324.')
    `, [id]);

    await client.query('COMMIT');
    res.json({ success: true, message: 'Internalização aprovada. Equipamento disponível para reposição.' });
  } catch (err) {
    await client.query('ROLLBACK');
    next(err);
  } finally {
    client.release();
  }
};

// ── Listar pallets por endereço ───────────────────────────────────────────────
// GET /api/pallets?endereco_id=X
exports.listPallets = async (req, res, next) => {
  try {
    const { endereco_id } = req.query;
    const params = [];
    const where  = endereco_id ? `WHERE p.endereco_id = $${params.push(endereco_id)}` : '';

    const { rows } = await db.query(`
      SELECT p.id, p.codigo, p.endereco_id, p.created_at,
             end_f.codigo AS endereco_codigo
      FROM pallet p
      JOIN endereco_fisico end_f ON end_f.id = p.endereco_id
      ${where}
      ORDER BY p.codigo
    `, params);
    res.json({ success: true, data: rows });
  } catch (err) { next(err); }
};

// ── Criar pallet ──────────────────────────────────────────────────────────────
// POST /api/pallets
exports.createPallet = async (req, res, next) => {
  try {
    const { codigo, endereco_id } = req.body;
    if (!codigo?.trim())  { const e = new Error('"codigo" é obrigatório.');      e.status = 400; throw e; }
    if (!endereco_id)     { const e = new Error('"endereco_id" é obrigatório.');  e.status = 400; throw e; }

    const end = await db.query('SELECT id FROM endereco_fisico WHERE id = $1', [endereco_id]);
    if (!end.rows.length) { const e = new Error('Endereço não encontrado.'); e.status = 404; throw e; }

    const { rows } = await db.query(`
      INSERT INTO pallet (codigo, endereco_id) VALUES ($1, $2) RETURNING *
    `, [codigo.trim().toUpperCase(), endereco_id]);

    res.status(201).json({ success: true, data: rows[0] });
  } catch (err) { next(err); }
};

// ── Listar caixas por pallet ──────────────────────────────────────────────────
// GET /api/caixas?pallet_id=X
exports.listCaixas = async (req, res, next) => {
  try {
    const { pallet_id } = req.query;
    const params = [];
    const where  = pallet_id ? `WHERE c.pallet_id = $${params.push(pallet_id)}` : '';

    const { rows } = await db.query(`
      SELECT c.id, c.codigo, c.pallet_id, c.created_at,
             p.codigo AS pallet_codigo
      FROM caixa c
      JOIN pallet p ON p.id = c.pallet_id
      ${where}
      ORDER BY c.codigo
    `, params);
    res.json({ success: true, data: rows });
  } catch (err) { next(err); }
};

// ── Criar caixa ───────────────────────────────────────────────────────────────
// POST /api/caixas
exports.createCaixa = async (req, res, next) => {
  try {
    const { codigo, pallet_id } = req.body;
    if (!codigo?.trim()) { const e = new Error('"codigo" é obrigatório.');     e.status = 400; throw e; }
    if (!pallet_id)      { const e = new Error('"pallet_id" é obrigatório.');  e.status = 400; throw e; }

    const pal = await db.query('SELECT id FROM pallet WHERE id = $1', [pallet_id]);
    if (!pal.rows.length) { const e = new Error('Pallet não encontrado.'); e.status = 404; throw e; }

    const { rows } = await db.query(`
      INSERT INTO caixa (codigo, pallet_id) VALUES ($1, $2) RETURNING *
    `, [codigo.trim().toUpperCase(), pallet_id]);

    res.status(201).json({ success: true, data: rows[0] });
  } catch (err) { next(err); }
};
