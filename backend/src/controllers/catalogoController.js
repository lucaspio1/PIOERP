'use strict';

const db = require('../config/database');

// ── Listar com snapshot de estoque ───────────────────────────────────────────
exports.list = async (req, res, next) => {
  try {
    const { rows } = await db.query(`
      SELECT
        id, codigo, nome, categoria,
        estoque_minimo, estoque_maximo,
        qtd_reposicao, qtd_ag_triagem, qtd_venda, qtd_total,
        deficit, estoque_critico,
        ativo
      FROM v_estoque_por_catalogo
      ORDER BY estoque_critico DESC, nome ASC
    `);
    res.json({ success: true, data: rows });
  } catch (err) { next(err); }
};

// ── Buscar por ID ────────────────────────────────────────────────────────────
exports.getById = async (req, res, next) => {
  try {
    const { id } = req.params;
    const { rows } = await db.query(
      `SELECT * FROM v_estoque_por_catalogo WHERE id = $1`,
      [id]
    );
    if (!rows.length) {
      const err = new Error('Item de catálogo não encontrado.'); err.status = 404; throw err;
    }
    res.json({ success: true, data: rows[0] });
  } catch (err) { next(err); }
};

// ── Criar ────────────────────────────────────────────────────────────────────
exports.create = async (req, res, next) => {
  try {
    const { nome, categoria, codigo, estoque_minimo = 0, estoque_maximo = 0 } = req.body;

    if (!nome?.trim())      { const e = new Error('Campo "nome" é obrigatório.');      e.status = 400; throw e; }
    if (!categoria?.trim()) { const e = new Error('Campo "categoria" é obrigatório.'); e.status = 400; throw e; }
    if (estoque_maximo < estoque_minimo) {
      const e = new Error('Estoque máximo não pode ser menor que o mínimo.'); e.status = 400; throw e;
    }

    const { rows } = await db.query(
      `INSERT INTO item_catalogo (nome, categoria, codigo, estoque_minimo, estoque_maximo)
       VALUES ($1, $2, $3, $4, $5) RETURNING *`,
      [nome.trim(), categoria.trim(), codigo?.trim() || null, estoque_minimo, estoque_maximo]
    );
    res.status(201).json({ success: true, data: rows[0] });
  } catch (err) { next(err); }
};

// ── Atualizar ────────────────────────────────────────────────────────────────
exports.update = async (req, res, next) => {
  try {
    const { id } = req.params;
    const { nome, categoria, codigo, estoque_minimo, estoque_maximo, ativo } = req.body;

    // Buscar valores atuais para merge
    const cur = await db.query('SELECT * FROM item_catalogo WHERE id = $1', [id]);
    if (!cur.rows.length) {
      const e = new Error('Item de catálogo não encontrado.'); e.status = 404; throw e;
    }
    const prev = cur.rows[0];

    const novoNome         = (nome      !== undefined) ? nome.trim()      : prev.nome;
    const novaCategoria    = (categoria !== undefined) ? categoria.trim() : prev.categoria;
    const novoCodigo       = (codigo    !== undefined) ? (codigo?.trim() || null) : prev.codigo;
    const novoMin          = (estoque_minimo  !== undefined) ? Number(estoque_minimo)  : prev.estoque_minimo;
    const novoMax          = (estoque_maximo  !== undefined) ? Number(estoque_maximo)  : prev.estoque_maximo;
    const novoAtivo        = (ativo !== undefined) ? Boolean(ativo) : prev.ativo;

    if (novoMax < novoMin) {
      const e = new Error('Estoque máximo não pode ser menor que o mínimo.'); e.status = 400; throw e;
    }

    const { rows } = await db.query(
      `UPDATE item_catalogo
         SET nome = $1, categoria = $2, codigo = $3, estoque_minimo = $4, estoque_maximo = $5, ativo = $6
       WHERE id = $7
       RETURNING *`,
      [novoNome, novaCategoria, novoCodigo, novoMin, novoMax, novoAtivo, id]
    );
    res.json({ success: true, data: rows[0] });
  } catch (err) { next(err); }
};

// ── Desativar (soft delete) ──────────────────────────────────────────────────
exports.remove = async (req, res, next) => {
  try {
    const { id } = req.params;

    // Verifica se há equipamentos ativos associados
    const check = await db.query(
      `SELECT COUNT(*) AS total FROM equipamento_fisico
       WHERE item_catalogo_id = $1 AND status != 'venda'`,
      [id]
    );
    if (parseInt(check.rows[0].total, 10) > 0) {
      const e = new Error(
        'Não é possível desativar: existem equipamentos físicos ativos vinculados a este catálogo.'
      );
      e.status = 409; throw e;
    }

    const { rows } = await db.query(
      `UPDATE item_catalogo SET ativo = FALSE WHERE id = $1 RETURNING id, nome, ativo`,
      [id]
    );
    if (!rows.length) {
      const e = new Error('Item de catálogo não encontrado.'); e.status = 404; throw e;
    }
    res.json({ success: true, data: rows[0], message: 'Item desativado com sucesso.' });
  } catch (err) { next(err); }
};
