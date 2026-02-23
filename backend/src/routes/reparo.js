'use strict';

const router = require('express').Router();
const ctrl   = require('../controllers/reparoController');

router.get('/prioridades',        ctrl.getPrioridades);      // deve vir antes de /:id
router.get('/criticos',           ctrl.getCriticos);
router.get('/solicitacoes',       ctrl.listarSolicitacoes);
router.post('/solicitar-lote',    ctrl.solicitarLote);
router.put('/solicitacoes/:id',   ctrl.atualizarSolicitacao);
router.get('/:id',                ctrl.getById);
router.put('/:id',                ctrl.update);
router.post('/:id/iniciar',       ctrl.iniciar);
router.post('/:id/pausar',        ctrl.pausar);
router.post('/:id/finalizar',     ctrl.finalizar);

module.exports = router;
