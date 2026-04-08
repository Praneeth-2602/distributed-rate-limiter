const { DataTypes } = require('sequelize');
const { sequelize } = require('../config/database');
const Tenant = require('./Tenant');

/**
 * A Rule defines rate limiting behaviour for a specific (tenant, endpoint) pair.
 * If no rule exists for an endpoint, the tenant's plan defaults apply.
 *
 * Example rule:
 *   tenantId: "abc-123"
 *   endpoint: "POST /api/checkout"        ← supports wildcards: "/api/*"
 *   algorithm: "token_bucket"
 *   limit: 10
 *   windowMs: 60000                       ← 10 req/min
 *   burstLimit: 15                        ← token bucket only
 */
const Rule = sequelize.define('Rule', {
  id: {
    type: DataTypes.UUID,
    defaultValue: DataTypes.UUIDV4,
    primaryKey: true,
  },
  tenantId: {
    type: DataTypes.UUID,
    allowNull: false,
    references: { model: Tenant, key: 'id' },
  },
  endpoint: {
    type: DataTypes.STRING,
    allowNull: false,       // e.g. "POST /login" or "*" for catch-all
  },
  algorithm: {
    type: DataTypes.ENUM('token_bucket', 'sliding_window', 'fixed_window'),
    defaultValue: 'sliding_window',
  },
  limit: {
    type: DataTypes.INTEGER,
    allowNull: false,
  },
  windowMs: {
    type: DataTypes.INTEGER,
    allowNull: false,
  },
  burstLimit: {
    type: DataTypes.INTEGER,
    allowNull: true,        // only meaningful for token_bucket
  },
}, {
  tableName: 'rules',
  timestamps: true,
  indexes: [
    { unique: true, fields: ['tenantId', 'endpoint'] },
  ],
});

Tenant.hasMany(Rule, { foreignKey: 'tenantId' });
Rule.belongsTo(Tenant, { foreignKey: 'tenantId' });

module.exports = Rule;
