'use strict';

const router = require('express').Router();
const ctrl   = require('../controllers/internalizacaoController');

router.get('/proximo-codigo', ctrl.proximoCodigoCaixa);
router.get('/',  ctrl.listCaixas);
router.post('/auto', ctrl.createCaixaAuto);
router.post('/', ctrl.createCaixa);

module.exports = router;
