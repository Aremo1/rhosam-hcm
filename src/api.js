/**
 * RHoSAM HCM — API Router
 * Exposes all server functions as POST /api/:fn endpoints.
 */
const express = require('express');
const router = express.Router();
const core = require('./core');
const modules = require('./modules');

// Build allowlist from core + modules exports
const allFunctions = { ...core, ...modules };
const API_ALLOWED = new Set(Object.keys(allFunctions));

// Functions that don't require a token
const NO_TOKEN = new Set([
  'login',
  'requestPasswordReset',
  'completePasswordReset',
  'sendDailyNotificationDigest',
  'installDigestTrigger'
]);

router.post('/:fn', (req, res) => {
  const fn = req.params.fn;
  
  // Check if function is allowed
  if (!API_ALLOWED.has(fn)) {
    return res.status(404).json({ error: `Unknown function: ${fn}` });
  }
  
  const args = req.body.args || [];
  
  // Check token requirement
  if (!NO_TOKEN.has(fn)) {
    const token = req.headers.authorization?.replace('Bearer ', '');
    if (!token) {
      return res.status(401).json({ error: 'Authentication required' });
    }
    // Verify session exists
    const session = core.getSession(token);
    if (!session) {
      return res.status(401).json({ error: 'Invalid or expired session' });
    }
    // Inject token as first argument if not already present
    if (args.length === 0 || args[0] !== token) {
      args.unshift(token);
    }
  }
  
  // Execute function
  try {
    const result = allFunctions[fn](...args);
    res.json(result);
  } catch (err) {
    console.error(`[api] ${fn} ERROR:`, err.message);
    res.status(500).json({ error: err.message });
  }
});

// Health check
router.get('/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

module.exports = router;
