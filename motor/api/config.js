const express = require('express');
const store = require('../store');
const { body, schemas } = require('../validate');

const router = express.Router();

router.get('/config', (_, res) => res.json(store.getConfig()));
router.post('/config', body(schemas.configPatch), (req, res) => res.json(store.setConfig(req.body)));

module.exports = router;
