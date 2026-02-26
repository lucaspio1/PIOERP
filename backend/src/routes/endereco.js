'use strict';

const router = require('express').Router();
const ctrl   = require('../controllers/enderecoController');

router.get('/',     ctrl.list);
router.post('/',    ctrl.create);
router.put('/:id',  ctrl.update);

module.exports = router;
