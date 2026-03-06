'use strict';

const router = require('express').Router();
const ctrl   = require('../controllers/internalizacaoController');

// Internalização
router.get('/',                          ctrl.list);
router.get('/locais-por-modelo/:catalogo_id', ctrl.locaisPorModelo);
router.post('/:id/aprovar',              ctrl.aprovar);
// NOVAS ROTAS PARA O FLUXO DE RECEBIMENTO EM LOTE (Scanner)
router.post('/caixas/lote',              ctrl.gerarCaixasLote);
router.post('/bipar',                    ctrl.biparEquipamento);
router.post('/alocar',                   ctrl.alocarCaixaPallet);

module.exports = router;
