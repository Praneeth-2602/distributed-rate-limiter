const express = require('express');
const Tenant = require('../models/Tenant');
const { authenticateJWT } = require('../middleware/auth');

const router = express.Router();
router.use(authenticateJWT);

// GET /api/v1/tenants/me
router.get('/me', async (req, res) => {
  const tenant = await Tenant.findByPk(req.user.tenantId, {
    attributes: { exclude: ['apiKey'] }, // never return apiKey after registration
  });
  res.json(tenant);
});

// PATCH /api/v1/tenants/me
router.patch('/me', async (req, res) => {
  const tenant = await Tenant.findByPk(req.user.tenantId);
  const { name } = req.body;
  await tenant.update({ name });
  res.json({ id: tenant.id, name: tenant.name, plan: tenant.plan });
});

module.exports = router;
