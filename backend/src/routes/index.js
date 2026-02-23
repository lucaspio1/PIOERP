'use strict';

const router = require('express').Router();

router.use('/catalogo',     require('./catalogo'));
router.use('/endereco',     require('./endereco'));
router.use('/equipamento',  require('./equipamento'));
router.use('/movimentacao', require('./movimentacao'));
router.use('/reparo',       require('./reparo'));

// Health check
router.get('/health', (_req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

module.exports = router;
