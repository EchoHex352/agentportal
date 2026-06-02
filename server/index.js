/**
 * Agent Oversight Portal - Main Server
 * Real-time event ingestion, storage, and Telegram alert routing
 */

require('dotenv').config();
const express = require('express');
const path = require('path');
const fs = require('fs');
const { v4: uuidv4 } = require('uuid');
const Storage = require('./storage');
const Alerts = require('./alerts');

const app = express();
const PORT = process.env.PORT || 8900;
const BIND_HOST = process.env.BIND_HOST || '127.0.0.1';
const INGEST_TOKEN = process.env.PORTAL_INGEST_TOKEN;

if (!INGEST_TOKEN) {
  throw new Error('PORTAL_INGEST_TOKEN not set in .env');
}

// Initialize storage and alerts
const storage = new Storage();
const alerts = new Alerts(storage);

// Middleware
app.use(express.json({ limit: '10mb' }));
app.use(express.static(path.join(__dirname, '../public')));

// Auth middleware
function verifyToken(req, res, next) {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  const token = authHeader.substring(7);
  if (token !== INGEST_TOKEN) {
    return res.status(403).json({ error: 'Forbidden' });
  }
  next();
}

// SSE subscribers
const subscribers = [];

function broadcastEvent(event) {
  subscribers.forEach(res => {
    res.write(`data: ${JSON.stringify(event)}\n\n`);
  });
}

// ============ ROUTES ============

/**
 * POST /api/events
 * Ingest events from agents
 */
app.post('/api/events', verifyToken, (req, res) => {
  try {
    const event = req.body;

    // Validate event shape
    if (!event.agent || !event.type || !event.severity || !event.title) {
      return res.status(400).json({ 
        error: 'Missing required fields: agent, type, severity, title' 
      });
    }

    // Validate enums
    const validAgents = ['openclaw', 'hermes'];
    const validTypes = ['action', 'tool_call', 'task_start', 'task_end', 'decision', 'error', 'alert'];
    const validSeverities = ['debug', 'info', 'warning', 'critical'];

    if (!validAgents.includes(event.agent)) {
      return res.status(400).json({ error: `Invalid agent: ${event.agent}` });
    }
    if (!validTypes.includes(event.type)) {
      return res.status(400).json({ error: `Invalid type: ${event.type}` });
    }
    if (!validSeverities.includes(event.severity)) {
      return res.status(400).json({ error: `Invalid severity: ${event.severity}` });
    }

    // Add id and timestamp if missing
    const storedEvent = {
      id: event.id || uuidv4(),
      timestamp: event.timestamp || new Date().toISOString(),
      agent: event.agent,
      type: event.type,
      severity: event.severity,
      title: event.title,
      detail: event.detail || null,
      task_id: event.task_id || null,
      metadata: event.metadata || {}
    };

    // Store event
    storage.storeEvent(storedEvent);

    // Broadcast to SSE subscribers
    broadcastEvent(storedEvent);

    // Route alerts if severity warrants
    alerts.routeAlert(storedEvent).catch(err => {
      console.error('Alert routing error:', err);
    });

    // Respond
    res.status(201).json({
      id: storedEvent.id,
      timestamp: storedEvent.timestamp,
      stored: true
    });
  } catch (err) {
    console.error('Error ingesting event:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * GET /api/events
 * Query event history with filters
 */
app.get('/api/events', (req, res) => {
  try {
    const filters = {
      agent: req.query.agent,
      type: req.query.type,
      severity: req.query.severity,
      task_id: req.query.task_id,
      since: req.query.since
    };

    const limit = Math.min(parseInt(req.query.limit) || 100, 1000);
    const events = storage.queryEvents(filters, limit);

    res.json({ events, count: events.length });
  } catch (err) {
    console.error('Error querying events:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * GET /api/stream
 * Server-Sent Events feed for real-time dashboard
 */
app.get('/api/stream', (req, res) => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('Access-Control-Allow-Origin', '*');

  // Send heartbeat every 30 seconds to keep connection alive
  const heartbeat = setInterval(() => {
    res.write(`: heartbeat\n\n`);
  }, 30000);

  // Add to subscribers
  subscribers.push(res);

  // Cleanup on disconnect
  res.on('close', () => {
    clearInterval(heartbeat);
    const idx = subscribers.indexOf(res);
    if (idx > -1) subscribers.splice(idx, 1);
  });

  // Send initial connection message
  res.write(`data: ${JSON.stringify({ type: 'connected', timestamp: new Date().toISOString() })}\n\n`);
});

/**
 * GET /
 * Serve dashboard
 */
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, '../public/dashboard.html'));
});

/**
 * GET /healthz
 * Liveness probe
 */
app.get('/healthz', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// ============ ERROR HANDLING ============

app.use((err, req, res, next) => {
  console.error('Unhandled error:', err);
  res.status(500).json({ error: 'Internal server error' });
});

// ============ STARTUP ============

app.listen(PORT, BIND_HOST, () => {
  console.log(`[Agent Oversight Portal] Listening on http://${BIND_HOST}:${PORT}`);
  console.log(`Dashboard: http://${BIND_HOST}:${PORT}`);
  console.log(`Events API: http://${BIND_HOST}:${PORT}/api/events`);
  console.log(`Stream: http://${BIND_HOST}:${PORT}/api/stream`);
  console.log(`Health: http://${BIND_HOST}:${PORT}/healthz`);
  console.log('');
  console.log(`[Alerts] Routing to Telegram group: ${process.env.TELEGRAM_GROUP_ID}`);
  console.log(`[Alerts] Min severity: ${process.env.ALERT_MIN_SEVERITY || 'warning'}`);
});

module.exports = app;
