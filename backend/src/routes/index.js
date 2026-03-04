'use strict';

const router = require('express').Router();
const ctrl = require('../controllers/recebimentoController');

router.use('/catalogo',        require('./catalogo'));
router.use('/endereco',        require('./endereco'));
router.use('/equipamento',     require('./equipamento'));
router.use('/movimentacao',    require('./movimentacao'));
router.use('/reparo',          require('./reparo'));
router.use('/internalizacao',  require('./internalizacao'));
router.use('/pallets',         require('./pallet'));
router.use('/caixas',          require('./caixa'));
router.post('/caixas/lote', ctrl.gerarCaixasLote);
router.post('/bipar', ctrl.biparEquipamento);
router.post('/alocar', ctrl.alocarCaixaPallet);

// Health check
router.get('/health', (_req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

module.exports = router;
