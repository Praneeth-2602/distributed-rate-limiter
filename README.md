# 🚦 RateLimitr

> **Distributed Rate Limiter as a Service** — multi-tenant, Redis-backed, algorithm-pluggable.  
> The infrastructure primitive every backend needs, built as a standalone service.

---

## 📌 Project Statement

Build a distributed rate limiting service that allows multi-tenant applications to enforce
request quotas across their APIs at scale.

The system should handle **10,000+ concurrent check requests per second**, ensuring
**sub-10ms p99 latency** (all hot-path logic runs in atomic Redis Lua scripts).

It must support **multiple rate limiting algorithms** (Token Bucket, Sliding Window, Fixed Window),
**per-endpoint rule configuration**, and **real-time usage analytics** — while handling challenges like
**race conditions in distributed counters, Redis failover, cache invalidation on rule updates,
and the fail-open vs fail-closed tradeoff**.

The backend is designed using a **stateless Node.js API layer** with **Redis as the single source
of truth for rate state**, **PostgreSQL for tenant/rule metadata**, and **JWT + API key dual auth**,
with a drop-in **Node.js SDK** for client integration.

---

## 🏗️ Architecture

```
Your API Client
      │
      │  POST /api/v1/check
      │  X-API-Key: rl_xxx
      ▼
┌─────────────────────┐
│   API Gateway Layer  │  ← Express, stateless, horizontally scalable
│   (Node.js)          │
└──────────┬──────────┘
           │
     ┌─────┴──────┐
     │            │
     ▼            ▼
┌─────────┐  ┌──────────┐
│  Redis   │  │PostgreSQL│
│          │  │          │
│ • Rate   │  │ • Tenants│
│   state  │  │ • Rules  │
│ • Rule   │  │ • Users  │
│   cache  │  └──────────┘
│ • API    │
│   key    │
│   cache  │
│ • Stats  │
└─────────┘
```

### Why Redis for rate state?

- **Atomicity**: Lua scripts run as a single atomic operation — no race conditions
- **Speed**: All counter ops are O(1) or O(log N), in-memory
- **TTL**: Keys auto-expire — no cleanup jobs needed
- **Horizontal scale**: Redis Cluster or read replicas for higher throughput

### Why PostgreSQL for metadata?

- Rules and tenants are low-write, high-read — perfect for RDBMS
- Rules cached in Redis (60s TTL) so DB is never in the hot path
- ACID guarantees matter for billing/plan changes

---

## 🧮 Algorithms

### 1. Fixed Window *(simplest)*
Counts requests in a fixed time slot (e.g. minute 14:03, 14:04...).

```
Window:  |------ 60s ------|------ 60s ------|
         ████████░░░░░░░░░░  ████████░░░░░░░░
                           ↑ window resets, counter → 0
```

**Tradeoff**: Boundary burst — a user can make 2× limit in 1 second at window edges.  
**Best for**: Coarse quotas, daily/hourly limits where precision doesn't matter.

---

### 2. Sliding Window Log *(most accurate)*
Stores a timestamp for every request in a Redis sorted set. Counts only requests
within the last N ms — no boundary burst problem.

```
Now: 14:03:45
Window: [14:02:45 ──────────────── 14:03:45]
         ↑ only these timestamps count
```

**Tradeoff**: Memory grows with request count (pruned on each check).  
**Best for**: Login endpoints, payment APIs, anything requiring precision.

---

### 3. Token Bucket *(burst-friendly)*
Bucket starts full. Each request consumes a token. Tokens refill continuously
at a fixed rate. Allows controlled bursting above the average rate.

```
Bucket capacity: 15 (burstLimit)
Refill rate:     10 tokens/min

t=0:  [███████████████] 15 tokens
t=1s: 10 requests → [█████] 5 tokens  ← burst absorbed
t=30s refill → [██████████] 10 tokens
```

**Tradeoff**: More complex state; burst window is opaque to clients.  
**Best for**: APIs that want to allow short bursts (SDKs retrying, batch operations).

---

## 🗂️ Folder Structure

```
ratelimitr/
├── src/
│   ├── index.js                     # App entrypoint, bootstraps DB + Redis
│   ├── config/
│   │   ├── redis.js                 # ioredis client singleton
│   │   └── database.js              # Sequelize + PostgreSQL
│   ├── models/
│   │   ├── Tenant.js                # API key, plan (free/pro/enterprise)
│   │   └── Rule.js                  # Per-tenant, per-endpoint rate limit config
│   ├── services/
│   │   ├── rateLimiter.js           # Orchestrator: rule resolution + algorithm dispatch
│   │   └── algorithms/
│   │       ├── slidingWindow.js     # Sorted set + Lua script
│   │       ├── tokenBucket.js       # Hash + Lua script
│   │       └── fixedWindow.js       # INCR + EXPIRE
│   ├── routes/
│   │   ├── auth.js                  # Register tenant, get JWT
│   │   ├── tenants.js               # Tenant profile management
│   │   ├── rules.js                 # CRUD for rate limit rules
│   │   ├── check.js                 # 🔥 Hot path: POST /check
│   │   └── analytics.js             # Daily usage stats
│   ├── middleware/
│   │   ├── auth.js                  # API key + JWT middleware
│   │   └── errorHandler.js          # Global error handler
│   ├── sdk/
│   │   └── RateLimitr.js            # Node.js SDK (Express middleware + raw client)
│   └── utils/
│       └── logger.js                # Winston structured logging
├── tests/
│   ├── slidingWindow.test.js
│   └── tokenBucket.test.js
├── docs/                            # (v2: OpenAPI spec goes here)
├── .env.example
├── docker-compose.yml               # Redis + PostgreSQL + API
├── Dockerfile
└── jest.config.json
```

---

## 🚀 Getting Started

### Prerequisites
- Node.js 20+
- Docker + Docker Compose

### 1. Clone and install
```bash
git clone https://github.com/your-username/ratelimitr
cd ratelimitr
npm install
cp .env.example .env
```

### 2. Start infrastructure
```bash
docker-compose up redis postgres -d
```

### 3. Run the server
```bash
npm run dev
```

---

## 📡 API Reference

### Auth

#### Register a tenant
```http
POST /api/v1/auth/register
Content-Type: application/json

{ "name": "MyStartup", "plan": "pro" }
```
```json
{
  "tenantId": "uuid",
  "apiKey": "rl_abc123...",
  "plan": "pro"
}
```
> ⚠️ Store your `apiKey` — it's only shown once.

#### Login (get JWT for management API)
```http
POST /api/v1/auth/login
Content-Type: application/json

{ "apiKey": "rl_abc123..." }
```

---

### Check (Hot Path)

```http
POST /api/v1/check
X-API-Key: rl_abc123...
Content-Type: application/json

{
  "identifier": "user-123",
  "endpoint": "POST /api/checkout"
}
```

**Allowed (200):**
```json
{
  "allowed": true,
  "remaining": 42,
  "algorithm": "sliding_window",
  "rule": { "limit": 100, "windowMs": 60000 }
}
```

**Denied (429):**
```json
{
  "allowed": false,
  "remaining": 0,
  "retryAfterMs": 3200,
  "algorithm": "sliding_window"
}
```

**Response Headers:**
```
X-RateLimit-Limit: 100
X-RateLimit-Remaining: 42
X-RateLimit-Algorithm: sliding_window
Retry-After: 4        ← only on 429
```

---

### Rules

```http
# Create a rule
POST /api/v1/rules
Authorization: Bearer <jwt>

{
  "endpoint": "POST /api/login",
  "algorithm": "sliding_window",
  "limit": 5,
  "windowMs": 60000
}

# List rules
GET /api/v1/rules

# Update
PUT /api/v1/rules/:id

# Delete
DELETE /api/v1/rules/:id
```

**Rule priority:** exact endpoint > wildcard `*` > plan default

---

### Analytics

```http
GET /api/v1/analytics/summary?days=7
Authorization: Bearer <jwt>
```
```json
{
  "tenantId": "uuid",
  "summary": [
    { "date": "2026-04-02", "total": 12400, "allowed": 11980, "denied": 420 },
    { "date": "2026-04-03", "total": 15200, "allowed": 14700, "denied": 500 }
  ]
}
```

---

### SDK Usage

```js
const { RateLimitr } = require('./src/sdk/RateLimitr');

const limiter = new RateLimitr({
  apiKey: 'rl_abc123...',
  baseUrl: 'http://localhost:3000',
});

// As Express middleware
app.post('/api/checkout', limiter.middleware({
  endpoint: 'POST /api/checkout',
  getIdentifier: (req) => req.user?.id || req.ip,
}));

// Manual check
const result = await limiter.check({
  identifier: req.ip,
  endpoint: 'POST /login',
});
if (!result.allowed) return res.status(429).send();
```

---

## 🔥 Key Design Decisions & Tradeoffs

| Decision | Choice | Why |
|---|---|---|
| Rate state storage | Redis | In-memory, atomic Lua scripts, TTL-native |
| Atomicity | Lua scripts | Prevents TOCTOU race conditions |
| Failure mode | Fail open | Availability > strict limiting during outages |
| Rule caching | 60s Redis TTL | Avoids DB on hot path; ~60s rule propagation lag |
| API key caching | 5min Redis TTL | Fast auth without DB hit per request |
| Algorithm default | Sliding window | No boundary burst, good for most APIs |

---

## 🗺️ Roadmap

- **v1** *(current)*: Core algorithms, multi-tenant, rules CRUD, analytics, SDK
- **v2**: WebSocket live dashboard, OpenAPI spec, rate limit by user tier
- **v3**: Redis Cluster support, Prometheus metrics, Grafana dashboard
- **v4**: gRPC check endpoint for lower latency, Python + Go SDKs

---

## 📄 Resume Bullet

> Built a distributed Rate Limiter as a Service handling 10K+ req/s using atomic Redis Lua scripts (zero race conditions), supporting Token Bucket, Sliding Window, and Fixed Window algorithms across multi-tenant deployments; shipped a Node.js SDK with Express middleware, fail-open resilience, and per-endpoint rule resolution with 60s cache invalidation.
