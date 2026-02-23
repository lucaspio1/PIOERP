'use strict';

const db = require('../config/database');

// ── Listar equipamentos com info de catálogo e localização ───────────────────
exports.list = async (req, res, next) => {
  try {
    const { status, item_catalogo_id } = req.query;
    const params = [];
    const conditions = [];

    if (status) {
      const validos = ['reposicao', 'ag_triagem', 'venda'];
      if (!validos.includes(status)) {
        const e = new Error(`Status inválido. Aceitos: ${validos.join(', ')}`); e.status = 400; throw e;
      }
      conditions.push(`ef.status = $${params.push(status)}`);
    }
    if (item_catalogo_id) {
      conditions.push(`ef.item_catalogo_id = $${params.push(item_catalogo_id)}`);
    }

    const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';

    const { rows } = await db.query(`
      SELECT
        ef.id, ef.numero_serie, ef.imobilizado, ef.status, ef.observacoes,
        ef.created_at, ef.updated_at,
        ic.id   AS item_catalogo_id,
        ic.nome AS modelo,
        ic.categoria,
        e4.id     AS caixa_id,
        e4.codigo AS caixa_codigo,
        e3.codigo AS pallet_codigo,
        e2.codigo AS sessao_codigo,
        e1.codigo AS porta_pallet_codigo
      FROM equipamento_fisico ef
      JOIN item_catalogo ic ON ic.id = ef.item_catalogo_id
      LEFT JOIN endereco_fisico e4 ON e4.id = ef.caixa_id
      LEFT JOIN endereco_fisico e3 ON e3.id = e4.parent_id
      LEFT JOIN endereco_fisico e2 ON e2.id = e3.parent_id
      LEFT JOIN endereco_fisico e1 ON e1.id = e2.parent_id
      ${where}
      ORDER BY ef.updated_at DESC
    `, params);

    res.json({ success: true, data: rows });
  } catch (err) { next(err); }
};

// ── Buscar por ID ─────────────────────────────────────────────────────────────
exports.getById = async (req, res, next) => {
  try {
    const { id } = req.params;
    const { rows } = await db.query(`
      SELECT
        ef.*, ic.nome AS modelo, ic.categoria,
        ic.estoque_minimo, ic.estoque_maximo,
        e4.codigo AS caixa_codigo, e3.codigo AS pallet_codigo,
        e2.codigo AS sessao_codigo, e1.codigo AS porta_pallet_codigo
      FROM equipamento_fisico ef
      JOIN item_catalogo ic ON ic.id = ef.item_catalogo_id
      LEFT JOIN endereco_fisico e4 ON e4.id = ef.caixa_id
      LEFT JOIN endereco_fisico e3 ON e3.id = e4.parent_id
      LEFT JOIN endereco_fisico e2 ON e2.id = e3.parent_id
      LEFT JOIN endereco_fisico e1 ON e1.id = e2.parent_id
      WHERE ef.id = $1
    `, [id]);

    if (!rows.length) {
      const e = new Error('Equipamento não encontrado.'); e.status = 404; throw e;
    }
    res.json({ success: true, data: rows[0] });
  } catch (err) { next(err); }
};

// ── ENTRADA de equipamento ────────────────────────────────────────────────────
// POST /api/equipamento/entrada
// Cria o registro físico, define status = 'reposicao' e registra o histórico.
exports.entrada = async (req, res, next) => {
  const client = await db.getClient();
  try {
    await client.query('BEGIN');

    const { item_catalogo_id, numero_serie, imobilizado, caixa_id, tipo_entrada, observacao } = req.body;

    // Validações
    if (!item_catalogo_id) { const e = new Error('"item_catalogo_id" é obrigatório.'); e.status = 400; throw e; }
    if (!numero_serie?.trim()) { const e = new Error('"numero_serie" é obrigatório.');  e.status = 400; throw e; }
    if (!imobilizado?.trim())  { const e = new Error('"imobilizado" é obrigatório.');   e.status = 400; throw e; }
    if (!caixa_id)             { const e = new Error('"caixa_id" é obrigatório.');      e.status = 400; throw e; }

    const tiposValidos = ['entrada_compra', 'entrada_retorno_reparo'];
    const tipo = tipo_entrada || 'entrada_compra';
    if (!tiposValidos.includes(tipo)) {
      const e = new Error(`"tipo_entrada" inválido. Aceitos: ${tiposValidos.join(', ')}`); e.status = 400; throw e;
    }

    // Verifica se o catálogo existe
    const cat = await client.query('SELECT id FROM item_catalogo WHERE id = $1 AND ativo = TRUE', [item_catalogo_id]);
    if (!cat.rows.length) {
      const e = new Error('Item de catálogo não encontrado ou inativo.'); e.status = 404; throw e;
    }

    // Verifica se a caixa existe e é do nível correto
    const caixa = await client.query(
      `SELECT id, nivel FROM endereco_fisico WHERE id = $1 AND ativo = TRUE`, [caixa_id]
    );
    if (!caixa.rows.length || caixa.rows[0].nivel !== 'caixa') {
      const e = new Error('Endereço de destino inválido. Deve ser uma caixa (nível 4).'); e.status = 400; throw e;
    }

    // Insere o equipamento
    const equip = await client.query(
      `INSERT INTO equipamento_fisico
         (item_catalogo_id, numero_serie, imobilizado, status, caixa_id, observacoes)
       VALUES ($1, $2, $3, 'reposicao', $4, $5)
       RETURNING *`,
      [item_catalogo_id, numero_serie.trim(), imobilizado.trim(), caixa_id, observacao?.trim() || null]
    );

    // Registra no histórico
    await client.query(
      `INSERT INTO historico_movimentacao
         (equipamento_id, tipo, status_anterior, status_novo, endereco_destino_id, observacao)
       VALUES ($1, $2, NULL, 'reposicao', $3, $4)`,
      [equip.rows[0].id, tipo, caixa_id, observacao?.trim() || null]
    );

    await client.query('COMMIT');
    res.status(201).json({ success: true, data: equip.rows[0], message: 'Equipamento registrado com sucesso.' });
  } catch (err) {
    await client.query('ROLLBACK');
    next(err);
  } finally {
    client.release();
  }
};

// ── SAÍDA / MOVIMENTAÇÃO de equipamento ──────────────────────────────────────
// POST /api/equipamento/:id/saida
// Altera o status do equipamento e registra o histórico.
// Se destino = 'ag_triagem', cria automaticamente um registro de reparo.
exports.saida = async (req, res, next) => {
  const client = await db.getClient();
  try {
    await client.query('BEGIN');

    const { id } = req.params;
    const { status_destino, caixa_destino_id, observacao } = req.body;

    const statusValidos = ['reposicao', 'ag_triagem', 'venda', 'saida_uso'];
    if (!status_destino) {
      const e = new Error('"status_destino" é obrigatório.'); e.status = 400; throw e;
    }

    // Busca equipamento atual
    const equip = await client.query(
      'SELECT * FROM equipamento_fisico WHERE id = $1', [id]
    );
    if (!equip.rows.length) {
      const e = new Error('Equipamento não encontrado.'); e.status = 404; throw e;
    }
    const atual = equip.rows[0];

    // Mapeia destinos permitidos por status atual
    const statusMap = {
      saida_uso:  { novo_status: 'reposicao', tipo: 'saida_uso',     descricao: 'Enviado para uso' },
      ag_triagem: { novo_status: 'ag_triagem',tipo: 'saida_triagem', descricao: 'Enviado para triagem' },
      venda:      { novo_status: 'venda',     tipo: 'saida_venda',   descricao: 'Baixado para venda/sucata' },
    };

    // Aceitar 'reposicao' para retorno (ex: saiu para uso, voltou)
    if (status_destino === 'reposicao') {
      statusMap.reposicao = { novo_status: 'reposicao', tipo: 'entrada_retorno_reparo', descricao: 'Retornado ao estoque' };
    }

    const acao = statusMap[status_destino];
    if (!acao) {
      const e = new Error(`"status_destino" inválido. Aceitos: ${Object.keys(statusMap).join(', ')}`); e.status = 400; throw e;
    }

    const novaCaixaId = caixa_destino_id || atual.caixa_id;

    // Atualiza equipamento
    await client.query(
      `UPDATE equipamento_fisico SET status = $1, caixa_id = $2 WHERE id = $3`,
      [acao.novo_status, novaCaixaId, id]
    );

    // Registra no histórico
    await client.query(
      `INSERT INTO historico_movimentacao
         (equipamento_id, tipo, status_anterior, status_novo, endereco_origem_id, endereco_destino_id, observacao)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [id, acao.tipo, atual.status, acao.novo_status, atual.caixa_id, novaCaixaId, observacao?.trim() || null]
    );

    // Se vai para triagem, cria ordem de reparo automaticamente
    let reparo = null;
    if (acao.novo_status === 'ag_triagem') {
      // Verifica se já não existe reparo ativo
      const reparoAtivo = await client.query(
        `SELECT id FROM reparo WHERE equipamento_id = $1 AND status != 'finalizado' LIMIT 1`,
        [id]
      );
      if (!reparoAtivo.rows.length) {
        const rep = await client.query(
          `INSERT INTO reparo (equipamento_id, status, descricao_problema)
           VALUES ($1, 'aguardando', $2) RETURNING *`,
          [id, observacao?.trim() || null]
        );
        reparo = rep.rows[0];
      }
    }

    await client.query('COMMIT');
    res.json({
      success: true,
      message: acao.descricao,
      data: { equipamento_id: id, status_novo: acao.novo_status, reparo },
    });
  } catch (err) {
    await client.query('ROLLBACK');
    next(err);
  } finally {
    client.release();
  }
};
