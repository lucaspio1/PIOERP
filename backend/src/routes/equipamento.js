'use strict';

const router = require('express').Router();
const ctrl   = require('../controllers/equipamentoController');

router.get('/',            ctrl.list);
router.get('/:id',         ctrl.getById);
router.post('/entrada',    ctrl.entrada);   // deve vir antes de /:id
router.post('/:id/saida',  ctrl.saida);

module.exports = router;
