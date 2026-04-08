const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { v4: uuidv4 } = require('uuid');
const Tenant = require('../models/Tenant');

const router = express.Router();

// POST /api/v1/auth/register
router.post('/register', async (req, res) => {
  const { name, plan } = req.body;
  if (!name) return res.status(400).json({ error: 'name is required' });

  const apiKey = `rl_${uuidv4().replace(/-/g, '')}`;
  const tenant = await Tenant.create({ name, apiKey, plan: plan || 'free' });

  res.status(201).json({
    message: 'Tenant registered. Store your API key — it won\'t be shown again.',
    tenantId: tenant.id,
    apiKey,
    plan: tenant.plan,
  });
});

// POST /api/v1/auth/login  (get JWT for management API)
router.post('/login', async (req, res) => {
  const { apiKey } = req.body;
  const tenant = await Tenant.findOne({ where: { apiKey, isActive: true } });
  if (!tenant) return res.status(401).json({ error: 'Invalid API key' });

  const token = jwt.sign(
    { tenantId: tenant.id, name: tenant.name, plan: tenant.plan },
    process.env.JWT_SECRET,
    { expiresIn: process.env.JWT_EXPIRES_IN || '7d' }
  );

  res.json({ token, tenantId: tenant.id, plan: tenant.plan });
});

module.exports = router;
