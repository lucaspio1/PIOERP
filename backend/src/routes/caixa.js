'use strict';

const router = require('express').Router();
const ctrl   = require('../controllers/internalizacaoController');

router.get('/',  ctrl.listCaixas);
router.post('/', ctrl.createCaixa);

module.exports = router;
