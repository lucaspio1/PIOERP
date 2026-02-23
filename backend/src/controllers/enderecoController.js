'use strict';

const db = require('../config/database');

// ── Listar com filtro opcional por nível ─────────────────────────────────────
exports.list = async (req, res, next) => {
  try {
    const { nivel, ativo = 'true' } = req.query;
    const params = [];
    const conditions = [`e.ativo = $${params.push(ativo !== 'false')}`];

    if (nivel) {
      const validos = ['porta_pallet', 'sessao', 'pallet', 'caixa'];
      if (!validos.includes(nivel)) {
        const e = new Error(`Nível inválido. Valores aceitos: ${validos.join(', ')}`); e.status = 400; throw e;
      }
      conditions.push(`e.nivel = $${params.push(nivel)}`);
    }

    const { rows } = await db.query(`
      SELECT
        e.id, e.codigo, e.descricao, e.nivel, e.parent_id, e.ativo,
        p.codigo AS parent_codigo, p.nivel AS parent_nivel
      FROM endereco_fisico e
      LEFT JOIN endereco_fisico p ON p.id = e.parent_id
      WHERE ${conditions.join(' AND ')}
      ORDER BY e.nivel, e.codigo
    `, params);

    res.json({ success: true, data: rows });
  } catch (err) { next(err); }
};

// ── Árvore hierárquica completa ───────────────────────────────────────────────
exports.getTree = async (req, res, next) => {
  try {
    const { rows } = await db.query(`
      SELECT id, codigo, descricao, nivel, parent_id
      FROM endereco_fisico
      WHERE ativo = TRUE
      ORDER BY nivel, codigo
    `);

    // Constrói árvore em memória
    const map = {};
    rows.forEach(r => { map[r.id] = { ...r, filhos: [] }; });

    const raizes = [];
    rows.forEach(r => {
      if (r.parent_id) {
        map[r.parent_id]?.filhos.push(map[r.id]);
      } else {
        raizes.push(map[r.id]);
      }
    });

    res.json({ success: true, data: raizes });
  } catch (err) { next(err); }
};

// ── Criar ────────────────────────────────────────────────────────────────────
exports.create = async (req, res, next) => {
  try {
    const { codigo, descricao, nivel, parent_id } = req.body;

    const niveisValidos = ['porta_pallet', 'sessao', 'pallet', 'caixa'];
    if (!codigo?.trim())           { const e = new Error('"codigo" é obrigatório.');         e.status = 400; throw e; }
    if (!niveisValidos.includes(nivel)) { const e = new Error('"nivel" inválido.');          e.status = 400; throw e; }

    const { rows } = await db.query(
      `INSERT INTO endereco_fisico (codigo, descricao, nivel, parent_id)
       VALUES ($1, $2, $3, $4) RETURNING *`,
      [codigo.trim(), descricao?.trim() || null, nivel, parent_id || null]
    );
    res.status(201).json({ success: true, data: rows[0] });
  } catch (err) { next(err); }
};

// ── Atualizar ────────────────────────────────────────────────────────────────
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
        codigo?.trim()  ?? prev.codigo,
        descricao?.trim() ?? prev.descricao,
        ativo !== undefined ? Boolean(ativo) : prev.ativo,
        id,
      ]
    );
    res.json({ success: true, data: rows[0] });
  } catch (err) { next(err); }
};
