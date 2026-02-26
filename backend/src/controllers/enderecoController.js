'use strict';

const db = require('../config/database');

// ── Listar endereços ──────────────────────────────────────────────────────────
exports.list = async (req, res, next) => {
  try {
    const { ativo = 'true' } = req.query;
    const { rows } = await db.query(`
      SELECT id, codigo, descricao, ativo, created_at
      FROM endereco_fisico
      WHERE ativo = $1
      ORDER BY codigo
    `, [ativo !== 'false']);

    res.json({ success: true, data: rows });
  } catch (err) { next(err); }
};

// ── Criar ─────────────────────────────────────────────────────────────────────
exports.create = async (req, res, next) => {
  try {
    const { codigo, descricao } = req.body;

    if (!codigo?.trim()) {
      const e = new Error('"codigo" é obrigatório.'); e.status = 400; throw e;
    }

    const { rows } = await db.query(
      `INSERT INTO endereco_fisico (codigo, descricao)
       VALUES ($1, $2) RETURNING *`,
      [codigo.trim(), descricao?.trim() || null]
    );
    res.status(201).json({ success: true, data: rows[0] });
  } catch (err) { next(err); }
};

// ── Atualizar ─────────────────────────────────────────────────────────────────
exports.update = async (req, res, next) => {
  try {
    const { id } = req.params;
    const { codigo, descricao, ativo } = req.body;

    const cur = await db.query('SELECT * FROM endereco_fisico WHERE id = $1', [id]);
    if (!cur.rows.length) {
      const e = new Error('Endereço não encontrado.'); e.status = 404; throw e;
    }
    const prev = cur.rows[0];

    const { rows } = await db.query(
      `UPDATE endereco_fisico
         SET codigo = $1, descricao = $2, ativo = $3
       WHERE id = $4 RETURNING *`,
      [
        codigo?.trim()    ?? prev.codigo,
        descricao?.trim() ?? prev.descricao,
        ativo !== undefined ? Boolean(ativo) : prev.ativo,
        id,
      ]
    );
    res.json({ success: true, data: rows[0] });
  } catch (err) { next(err); }
};
