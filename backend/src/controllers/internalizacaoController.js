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

// ── Gerar próximo código de caixa automático ─────────────────────────────────
// GET /api/caixas/proximo-codigo
// Retorna o próximo código sequencial no formato CX-001, CX-002, etc.
exports.proximoCodigoCaixa = async (_req, res, next) => {
  try {
    // Busca o maior número já utilizado no padrão CX-NNN
    const { rows } = await db.query(`
      SELECT codigo FROM caixa
      WHERE codigo ~ '^CX-[0-9]+$'
      ORDER BY CAST(SUBSTRING(codigo FROM 4) AS INTEGER) DESC
      LIMIT 1
    `);

    let proximo = 1;
    if (rows.length) {
      const ultimo = parseInt(rows[0].codigo.replace('CX-', ''), 10);
      proximo = ultimo + 1;
    }

    const codigo = `CX-${String(proximo).padStart(3, '0')}`;
    res.json({ success: true, data: { codigo, numero: proximo } });
  } catch (err) { next(err); }
};

// ── Criar caixa com código automático (CX-NNN) ─────────────────────────────
// POST /api/caixas/auto
// Cria uma caixa com numeração sequencial automática vinculada a um pallet.
exports.createCaixaAuto = async (req, res, next) => {
  const client = await db.getClient();
  try {
    await client.query('BEGIN');

    const { pallet_id } = req.body;
    if (!pallet_id) { const e = new Error('"pallet_id" é obrigatório.'); e.status = 400; throw e; }

    const pal = await client.query('SELECT id FROM pallet WHERE id = $1', [pallet_id]);
    if (!pal.rows.length) { const e = new Error('Pallet não encontrado.'); e.status = 404; throw e; }

    // Utiliza a SEQUENCE nativa do PostgreSQL para garantir a sequência (Migration 007)
    // O LPAD formata com zeros à esquerda (ex: 001, 002, 010...)
    const { rows } = await client.query(`
      INSERT INTO caixa (codigo, pallet_id)
      VALUES (
        'CX-' || LPAD(nextval('caixa_numero_seq')::TEXT, 3, '0'),
        $1
      )
      RETURNING *
    `, [pallet_id]);

    await client.query('COMMIT');
    
    // LINHA CORRIGIDA ABAIXO (sem as barras invertidas):
    res.status(201).json({ success: true, data: rows[0], message: `Caixa ${rows[0].codigo} criada com sucesso.` });
  } catch (err) {
    await client.query('ROLLBACK');
    next(err);
  } finally {
    client.release();
  }
};

// Gera múltiplas caixas de uma vez para o Lote
exports.gerarCaixasLote = async (req, res) => {
    const { quantidade, lote_id } = req.body;
    // CORREÇÃO: Usar db.getClient() em vez de pool.connect()
    const client = await db.getClient(); 

    try {
        await client.query('BEGIN');
        const caixasGeradas = [];

        for (let i = 0; i < quantidade; i++) {
            const resultSeq = await client.query("SELECT nextval('caixa_numero_seq') AS num");
            const codigoCaixa = `CX-${String(resultSeq.rows[0].num).padStart(5, '0')}`;

            const resultInsert = await client.query(
                `INSERT INTO caixa (codigo, status, lote_id) 
                 VALUES ($1, 'aberta', $2) RETURNING id, codigo, status`,
                [codigoCaixa, lote_id]
            );
            caixasGeradas.push(resultInsert.rows[0]);
        }

        await client.query('COMMIT');
        res.status(201).json({ success: true, caixas: caixasGeradas });
    } catch (error) {
        await client.query('ROLLBACK');
        console.error(error); // Bom para debugar se der erro
        res.status(500).json({ error: 'Erro ao gerar lote de caixas.' });
    } finally {
        client.release();
    }
};

// Vincula um equipamento recém-bipado à caixa
exports.biparEquipamento = async (req, res) => {
    const { numero_serie, imobilizado, caixa_codigo, item_catalogo_id } = req.body;

    try {
        // CORREÇÃO: Usar db.query() em vez de pool.query()
        const caixaRes = await db.query(`SELECT id FROM caixa WHERE codigo = $1 AND status = 'aberta'`, [caixa_codigo]);
        if (caixaRes.rowCount === 0) {
            return res.status(400).json({ error: 'Caixa inválida ou já fechada.' });
        }
        const caixa_id = caixaRes.rows[0].id;

        const equipRes = await db.query(
            `INSERT INTO equipamento_fisico (item_catalogo_id, numero_serie, imobilizado, status, caixa_id)
             VALUES ($1, $2, $3, 'ag_triagem', $4) RETURNING id`,
            [item_catalogo_id, numero_serie, imobilizado, caixa_id]
        );

        await db.query(
            `INSERT INTO historico_movimentacao (equipamento_id, tipo, status_novo, observacao)
             VALUES ($1, 'entrada_recebimento', 'ag_triagem', 'Recebimento em Lote via Scanner')`,
            [equipRes.rows[0].id]
        );

        res.status(200).json({ success: true, message: 'Equipamento bipado com sucesso!' });
    } catch (error) {
        if (error.code === '23505') {
            return res.status(400).json({ error: 'Número de série ou patrimônio já cadastrado.' });
        }
        res.status(500).json({ error: 'Erro ao registrar equipamento.' });
    }
};

// Finaliza a caixa e aloca no Pallet
exports.alocarCaixaPallet = async (req, res) => {
    const { caixa_codigo, pallet_codigo } = req.body;

    try {
        // CORREÇÃO: Usar db.query()
        const palletRes = await db.query(`SELECT id FROM pallet WHERE codigo = $1`, [pallet_codigo]);
        if (palletRes.rowCount === 0) {
            return res.status(400).json({ error: 'Pallet não encontrado.' });
        }
        const pallet_id = palletRes.rows[0].id;

        const updateCaixa = await db.query(
            `UPDATE caixa SET pallet_id = $1, status = 'alocada' 
             WHERE codigo = $2 AND status = 'aberta' RETURNING id`,
            [pallet_id, caixa_codigo]
        );

        if (updateCaixa.rowCount === 0) {
            return res.status(400).json({ error: 'Caixa não encontrada ou já alocada.' });
        }

        res.status(200).json({ success: true, message: 'Caixa vinculada ao pallet com sucesso!' });
    } catch (error) {
        res.status(500).json({ error: 'Erro ao alocar caixa.' });
    }
};