'use strict';

const router = require('express').Router();
const ctrl   = require('../controllers/internalizacaoController');

// Internalização
router.get('/',                          ctrl.list);
router.get('/locais-por-modelo/:catalogo_id', ctrl.locaisPorModelo);
router.post('/:id/aprovar',              ctrl.aprovar);

module.exports = router;
