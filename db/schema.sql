-- Agent Oversight Portal - SQLite Schema

-- Events table
CREATE TABLE IF NOT EXISTS events (
  id TEXT PRIMARY KEY,
  timestamp TEXT NOT NULL,
  agent TEXT NOT NULL,
  type TEXT NOT NULL,
  severity TEXT NOT NULL,
  title TEXT NOT NULL,
  detail TEXT,
  task_id TEXT,
  metadata TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Create indexes for events table
CREATE INDEX IF NOT EXISTS idx_timestamp ON events(timestamp);
CREATE INDEX IF NOT EXISTS idx_agent ON events(agent);
CREATE INDEX IF NOT EXISTS idx_severity ON events(severity);
CREATE INDEX IF NOT EXISTS idx_task_id ON events(task_id);

-- Alerts log (tracks forwarded alerts)
CREATE TABLE IF NOT EXISTS alerts_log (
  id TEXT PRIMARY KEY,
  event_id TEXT NOT NULL,
  forwarded_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  destination TEXT,
  status TEXT,
  error TEXT,
  FOREIGN KEY (event_id) REFERENCES events(id)
);

-- Alert rate limiting state (rolling window)
CREATE TABLE IF NOT EXISTS alert_rate_limit (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  window_start DATETIME,
  alert_count INTEGER DEFAULT 0,
  last_alert_hash TEXT
);

-- Create index for alert_rate_limit
CREATE INDEX IF NOT EXISTS idx_window_start ON alert_rate_limit(window_start);
