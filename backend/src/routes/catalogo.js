'use strict';

const router = require('express').Router();
const ctrl   = require('../controllers/catalogoController');

router.get('/',     ctrl.list);
router.get('/:id',  ctrl.getById);
router.post('/',    ctrl.create);
router.put('/:id',  ctrl.update);
router.delete('/:id', ctrl.remove);

module.exports = router;
