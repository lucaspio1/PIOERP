'use strict';

const router = require('express').Router();
const ctrl   = require('../controllers/internalizacaoController');

router.get('/',  ctrl.listPallets);
router.post('/', ctrl.createPallet);

module.exports = router;
