'use strict';

const router = require('express').Router();
const ctrl   = require('../controllers/movimentacaoController');

router.get('/dashboard',       ctrl.getDashboard);       // deve vir antes de /
router.get('/estoque-critico', ctrl.getEstoqueCritico);
router.get('/',                ctrl.list);

module.exports = router;
