/**
 * RHoSAM HCM — Monitoring Service
 * Uptime tracking, error logging, performance metrics
 */
require('dotenv').config();
const { Pool } = require('pg');

/* ---- Postgres pool for monitoring ---- */
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_SSL === 'false' ? false : { rejectUnauthorized: false },
  max: 5,
  connectionTimeoutMillis: 5000
});

/* ---- In-memory metrics ---- */
const metrics = {
  startTime: Date.now(),
  requests: 0,
  errors: 0,
  apiCalls: new Map(),
  recentErrors: [],
  healthChecks: [],
  responseTimes: []
};

/* ---- Track API call ---- */
function trackApiCall(fnName, durationMs, success = true) {
  metrics.requests++;
  if (!success) metrics.errors++;
  
  if (!metrics.apiCalls.has(fnName)) {
    metrics.apiCalls.set(fnName, { count: 0, errors: 0, totalMs: 0, maxMs: 0 });
  }
  const stat = metrics.apiCalls.get(fnName);
  stat.count++;
  if (!success) stat.errors++;
  stat.totalMs += durationMs;
  if (durationMs > stat.maxMs) stat.maxMs = durationMs;
  
  // Keep last 100 response times
  metrics.responseTimes.push({ fn: fnName, ms: durationMs, ts: Date.now() });
  if (metrics.responseTimes.length > 100) metrics.responseTimes.shift();
}

/* ---- Track error ---- */
function trackError(context, error) {
  const entry = {
    timestamp: new Date().toISOString(),
    context,
    message: error.message || String(error),
    stack: error.stack || ''
  };
  metrics.recentErrors.push(entry);
  if (metrics.recentErrors.length > 50) metrics.recentErrors.shift();
  console.error(`[MONITOR-ERROR] ${context}:`, error.message);
}

/* ---- Health check ---- */
async function checkHealth() {
  const checks = {
    app: { status: 'ok', uptime: Math.floor((Date.now() - metrics.startTime) / 1000) },
    database: { status: 'unknown' },
    memory: { status: 'ok' }
  };

  // Database check
  try {
    const start = Date.now();
    await pool.query('SELECT 1');
    checks.database = { status: 'ok', latencyMs: Date.now() - start };
  } catch (err) {
    checks.database = { status: 'error', message: err.message };
  }

  // Memory check
  const mem = process.memoryUsage();
  checks.memory = {
    status: 'ok',
    rss: `${Math.round(mem.rss / 1024 / 1024)}MB`,
    heap: `${Math.round(mem.heapUsed / 1024 / 1024)}MB`,
    heapTotal: `${Math.round(mem.heapTotal / 1024 / 1024)}MB`
  };

  // Overall status
  const overall = Object.values(checks).every(c => c.status === 'ok') ? 'healthy' : 'degraded';

  const result = {
    status: overall,
    timestamp: new Date().toISOString(),
    uptime: checks.app.uptime,
    checks,
    metrics: {
      totalRequests: metrics.requests,
      totalErrors: metrics.errors,
      errorRate: metrics.requests > 0 ? ((metrics.errors / metrics.requests) * 100).toFixed(2) + '%' : '0%',
      avgResponseTime: getAvgResponseTime()
    }
  };

  metrics.healthChecks.push({ timestamp: result.timestamp, status: overall });
  if (metrics.healthChecks.length > 100) metrics.healthChecks.shift();

  return result;
}

/* ---- Get average response time ---- */
function getAvgResponseTime() {
  if (metrics.responseTimes.length === 0) return 0;
  const total = metrics.responseTimes.reduce((sum, r) => sum + r.ms, 0);
  return Math.round(total / metrics.responseTimes.length);
}

/* ---- Get detailed metrics ---- */
function getMetrics() {
  const apiStats = {};
  for (const [fn, stat] of metrics.apiCalls) {
    apiStats[fn] = {
      calls: stat.count,
      errors: stat.errors,
      avgMs: stat.count > 0 ? Math.round(stat.totalMs / stat.count) : 0,
      maxMs: stat.maxMs
    };
  }

  return {
    uptime: Math.floor((Date.now() - metrics.startTime) / 1000),
    totalRequests: metrics.requests,
    totalErrors: metrics.errors,
    errorRate: metrics.requests > 0 ? ((metrics.errors / metrics.requests) * 100).toFixed(2) + '%' : '0%',
    avgResponseTime: getAvgResponseTime(),
    apiStats,
    recentErrors: metrics.recentErrors.slice(-10),
    healthCheckHistory: metrics.healthChecks.slice(-20)
  };
}

/* ---- Uptime checker (for external monitoring) ---- */
async function checkUptime() {
  const start = Date.now();
  try {
    // Check app
    const appOk = true;
    
    // Check database
    await pool.query('SELECT 1');
    const dbLatency = Date.now() - start;
    
    // Check response time
    const avgResponse = getAvgResponseTime();
    
    return {
      status: 'up',
      timestamp: new Date().toISOString(),
      app: appOk,
      database: true,
      dbLatencyMs: dbLatency,
      avgResponseMs: avgResponse,
      uptime: Math.floor((Date.now() - metrics.startTime) / 1000)
    };
  } catch (err) {
    return {
      status: 'down',
      timestamp: new Date().toISOString(),
      error: err.message
    };
  }
}

module.exports = { trackApiCall, trackError, checkHealth, getMetrics, checkUptime };
