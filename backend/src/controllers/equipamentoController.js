'use strict';

const db = require('../config/database');

// ── Listar equipamentos com info de catálogo e localização ───────────────────
exports.list = async (req, res, next) => {
  try {
    const { status, item_catalogo_id } = req.query;
    const params = [];
    const conditions = [];

    if (status) {
      const validos = ['reposicao', 'ag_triagem', 'venda', 'em_uso', 'pre_triagem', 'pre_venda', 'ag_internalizacao'];
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
        ef.alocacao_filial, ef.created_at, ef.updated_at,
        ic.id   AS item_catalogo_id,
        ic.nome AS modelo,
        ic.categoria,
        end_f.id     AS endereco_id,
        end_f.codigo AS endereco_codigo,
        cx.id        AS caixa_id,
        cx.codigo    AS caixa_codigo,
        p.id         AS pallet_id,
        p.codigo     AS pallet_codigo,
        end_p.codigo AS pallet_endereco_codigo
      FROM equipamento_fisico ef
      JOIN item_catalogo ic ON ic.id = ef.item_catalogo_id
      LEFT JOIN endereco_fisico end_f ON end_f.id = ef.endereco_id
      LEFT JOIN caixa cx              ON cx.id    = ef.caixa_id
      LEFT JOIN pallet p              ON p.id     = cx.pallet_id
      LEFT JOIN endereco_fisico end_p ON end_p.id = p.endereco_id
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
        end_f.codigo AS endereco_codigo,
        cx.id        AS caixa_id,
        cx.codigo    AS caixa_codigo,
        p.id         AS pallet_id,
        p.codigo     AS pallet_codigo,
        end_p.codigo AS pallet_endereco_codigo
      FROM equipamento_fisico ef
      JOIN item_catalogo ic ON ic.id = ef.item_catalogo_id
      LEFT JOIN endereco_fisico end_f ON end_f.id = ef.endereco_id
      LEFT JOIN caixa cx              ON cx.id    = ef.caixa_id
      LEFT JOIN pallet p              ON p.id     = cx.pallet_id
      LEFT JOIN endereco_fisico end_p ON end_p.id = p.endereco_id
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

    const { item_catalogo_id, numero_serie, imobilizado, endereco_id, caixa_id, tipo_entrada, observacao } = req.body;
    const enderecoDestino = endereco_id || caixa_id; // aceita ambos por compatibilidade

    // Validações
    if (!item_catalogo_id)     { const e = new Error('"item_catalogo_id" é obrigatório.'); e.status = 400; throw e; }
    if (!numero_serie?.trim()) { const e = new Error('"numero_serie" é obrigatório.');     e.status = 400; throw e; }
    if (!imobilizado?.trim())  { const e = new Error('"imobilizado" é obrigatório.');      e.status = 400; throw e; }
    if (!enderecoDestino)      { const e = new Error('"endereco_id" é obrigatório.');      e.status = 400; throw e; }

const tiposValidos = ['entrada_compra', 'entrada_retorno_reparo', 'entrada_recebimento'];
    const tipo = tipo_entrada || 'entrada_compra';
    
    if (!tiposValidos.includes(tipo)) {
      const e = new Error(`"tipo_entrada" inválido. Aceitos: ${tiposValidos.join(', ')}`); 
      e.status = 400; 
      throw e;
    }

    // Mapeia o status inicial baseado no tipo de entrada
    let statusInicial = 'reposicao';
    if (tipo === 'entrada_recebimento') {
      statusInicial = 'pre_triagem';
    }

    // Verifica se o catálogo existe
    const cat = await client.query('SELECT id FROM item_catalogo WHERE id = $1 AND ativo = TRUE', [item_catalogo_id]);
    if (!cat.rows.length) {
      const e = new Error('Item de catálogo não encontrado ou inativo.'); 
      e.status = 404; 
      throw e;
    }

    // Verifica se o endereço existe e está ativo
    const endCheck = await client.query(
      `SELECT id FROM endereco_fisico WHERE id = $1 AND ativo = TRUE`, [enderecoDestino]
    );
    if (!endCheck.rows.length) {
      const e = new Error('Endereço de destino não encontrado ou inativo.');
      e.status = 400;
      throw e;
    }

    // Insere o equipamento
    const equip = await client.query(
      `INSERT INTO equipamento_fisico
         (item_catalogo_id, numero_serie, imobilizado, status, endereco_id, observacoes)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING *`,
      [item_catalogo_id, numero_serie.trim(), imobilizado.trim(), statusInicial, enderecoDestino, observacao?.trim() || null]
    );

    // Registra no histórico
    await client.query(
      `INSERT INTO historico_movimentacao
         (equipamento_id, tipo, status_anterior, status_novo, endereco_destino_id, observacao)
       VALUES ($1, $2, NULL, $3, $4, $5)`,
      [equip.rows[0].id, tipo, statusInicial, enderecoDestino, observacao?.trim() || null]
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
    const { status_destino, endereco_destino_id, caixa_destino_id, observacao } = req.body;
    const enderecoDestino = endereco_destino_id || caixa_destino_id; // aceita ambos

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
  saida_uso:     { novo_status: 'em_uso',     tipo: 'saida_uso',     descricao: 'Enviado para uso (removido do estoque)' },
  ag_triagem:    { novo_status: 'ag_triagem', tipo: 'saida_triagem', descricao: 'Alocado em pallet para triagem' },
  venda:         { novo_status: 'venda',      tipo: 'saida_venda',   descricao: 'Baixado para venda/sucata' },
  pre_venda:     { novo_status: 'pre_venda',  tipo: 'movimentacao',  descricao: 'Movido para prateleira de pré-venda' },
  reposicao:     { novo_status: 'reposicao',  tipo: 'movimentacao',  descricao: 'Retornado ao estoque pronto' }
};

    // Aceitar 'reposicao' para retorno (ex: saiu para uso, voltou)
    if (status_destino === 'reposicao') {
      statusMap.reposicao = { novo_status: 'reposicao', tipo: 'entrada_retorno_reparo', descricao: 'Retornado ao estoque' };
    }

    const acao = statusMap[status_destino];
    if (!acao) {
      const e = new Error(`"status_destino" inválido. Aceitos: ${Object.keys(statusMap).join(', ')}`); e.status = 400; throw e;
    }

// Se for saída para uso ou venda (baixa), o equipamento perde o endereço físico (sai do estoque WMS)
const vaiSairDoEstoque = (acao.novo_status === 'em_uso' || acao.novo_status === 'venda');
const novoEnderecoId = vaiSairDoEstoque ? null : (enderecoDestino || atual.endereco_id);

await client.query(
  `UPDATE equipamento_fisico SET status = $1, endereco_id = $2 WHERE id = $3`,
  [acao.novo_status, novoEnderecoId, id]
);

    // Registra no histórico
    await client.query(
      `INSERT INTO historico_movimentacao
         (equipamento_id, tipo, status_anterior, status_novo, endereco_origem_id, endereco_destino_id, observacao)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [id, acao.tipo, atual.status, acao.novo_status, atual.endereco_id, novoEnderecoId, observacao?.trim() || null]
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

// ── MONTAR PALLET / TRANSFERÊNCIA EM LOTE ────────────────────────────────────
// POST /api/equipamento/montar-pallet
// Transfere múltiplos equipamentos em pré-triagem ou pré-venda para uma caixa
// definitiva no porta-pallet, alterando o status para ag_triagem ou venda.
exports.montarPallet = async (req, res, next) => {
  const client = await db.getClient();
  try {
    await client.query('BEGIN');

    const { equipamento_ids, endereco_destino_id, caixa_destino_id, status_destino, observacao } = req.body;
    const enderecoDestino = endereco_destino_id || caixa_destino_id;

    // Validações
    if (!Array.isArray(equipamento_ids) || !equipamento_ids.length) {
      const e = new Error('"equipamento_ids" deve ser um array não vazio.'); e.status = 400; throw e;
    }
    if (!enderecoDestino) {
      const e = new Error('"endereco_destino_id" é obrigatório.'); e.status = 400; throw e;
    }

    const statusPermitidos = ['ag_triagem', 'venda'];
    if (!statusPermitidos.includes(status_destino)) {
      const e = new Error(`"status_destino" inválido. Aceitos: ${statusPermitidos.join(', ')}`); e.status = 400; throw e;
    }

    // Valida que o endereço de destino existe e está ativo
    const endCheck = await client.query(
      `SELECT id FROM endereco_fisico WHERE id = $1 AND ativo = TRUE`, [enderecoDestino]
    );
    if (!endCheck.rows.length) {
      const e = new Error('Endereço de destino não encontrado ou inativo.'); e.status = 400; throw e;
    }

    // Busca todos os equipamentos selecionados de uma vez
    const equipRes = await client.query(
      `SELECT id, status, item_catalogo_id, endereco_id
       FROM equipamento_fisico
       WHERE id = ANY($1::int[])`,
      [equipamento_ids]
    );

    if (equipRes.rows.length !== equipamento_ids.length) {
      const e = new Error('Um ou mais equipamentos não foram encontrados.'); e.status = 404; throw e;
    }

    // Valida que todos estão em status permitido para esta operação
    const statusOrigem = ['pre_triagem', 'pre_venda'];
    const invalidos = equipRes.rows.filter(e => !statusOrigem.includes(e.status));
    if (invalidos.length) {
      const e = new Error(
        `${invalidos.length} equipamento(s) não estão em pré-triagem ou pré-venda e não podem ser transferidos.`
      ); e.status = 409; throw e;
    }

    const resultados = [];

    for (const equip of equipRes.rows) {
      // Atualiza status e endereço
      const novoEndDest = status_destino === 'venda' ? null : enderecoDestino;
      await client.query(
        `UPDATE equipamento_fisico SET status = $1, endereco_id = $2 WHERE id = $3`,
        [status_destino, novoEndDest, equip.id]
      );

      // Registra histórico
      await client.query(
        `INSERT INTO historico_movimentacao
           (equipamento_id, tipo, status_anterior, status_novo, endereco_origem_id, endereco_destino_id, observacao)
         VALUES ($1, 'transferencia_lote', $2, $3, $4, $5, $6)`,
        [equip.id, equip.status, status_destino, equip.endereco_id, novoEndDest, observacao?.trim() || null]
      );

      // Se vai para triagem, cria ordem de reparo automaticamente
      if (status_destino === 'ag_triagem') {
        const reparoAtivo = await client.query(
          `SELECT id FROM reparo WHERE equipamento_id = $1 AND status != 'finalizado' LIMIT 1`,
          [equip.id]
        );
        if (!reparoAtivo.rows.length) {
          await client.query(
            `INSERT INTO reparo (equipamento_id, status, descricao_problema)
             VALUES ($1, 'aguardando', $2)`,
            [equip.id, observacao?.trim() || null]
          );
        }
      }

      resultados.push({ equipamento_id: equip.id, status_novo: status_destino });
    }

    await client.query('COMMIT');
    res.json({
      success: true,
      message: `${resultados.length} equipamento(s) transferidos para ${status_destino === 'ag_triagem' ? 'Ag. Triagem' : 'Venda'}.`,
      data: resultados,
    });
  } catch (err) {
    await client.query('ROLLBACK');
    next(err);
  } finally {
    client.release();
  }
};
