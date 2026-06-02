/**
 * Storage Layer - SQLite Event Storage
 */

const sqlite3 = require('sqlite3').verbose();
const fs = require('fs');
const path = require('path');

class Storage {
  constructor() {
    this.dbPath = process.env.DB_PATH || './data/events.db';
    this.ensureDataDir();
    this.initializeDatabase();
  }

  ensureDataDir() {
    const dir = path.dirname(this.dbPath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
  }

  initializeDatabase() {
    this.db = new sqlite3.Database(this.dbPath, (err) => {
      if (err) {
        console.error('Error opening database:', err);
        process.exit(1);
      }
      console.log(`[Storage] Connected to database: ${this.dbPath}`);
      this.createTables();
    });
  }

  createTables() {
    const schema = fs.readFileSync(path.join(__dirname, '../db/schema.sql'), 'utf8');
    this.db.exec(schema, (err) => {
      if (err) {
        console.error('Error creating tables:', err);
        process.exit(1);
      }
      console.log('[Storage] Database schema initialized');
    });
  }

  storeEvent(event) {
    return new Promise((resolve, reject) => {
      const stmt = this.db.prepare(
        `INSERT INTO events (id, timestamp, agent, type, severity, title, detail, task_id, metadata)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
      );

      stmt.run(
        event.id,
        event.timestamp,
        event.agent,
        event.type,
        event.severity,
        event.title,
        event.detail,
        event.task_id,
        JSON.stringify(event.metadata || {})
      );

      stmt.finalize((err) => {
        if (err) {
          console.error('Error storing event:', err);
          reject(err);
        } else {
          resolve(event);
        }
      });
    });
  }

  queryEvents(filters = {}, limit = 100) {
    return new Promise((resolve, reject) => {
      let query = 'SELECT * FROM events WHERE 1=1';
      const params = [];

      if (filters.agent) {
        query += ' AND agent = ?';
        params.push(filters.agent);
      }

      if (filters.type) {
        query += ' AND type = ?';
        params.push(filters.type);
      }

      if (filters.severity) {
        query += ' AND severity = ?';
        params.push(filters.severity);
      }

      if (filters.task_id) {
        query += ' AND task_id = ?';
        params.push(filters.task_id);
      }

      if (filters.since) {
        query += ' AND timestamp >= ?';
        params.push(filters.since);
      }

      query += ' ORDER BY timestamp DESC LIMIT ?';
      params.push(limit);

      this.db.all(query, params, (err, rows) => {
        if (err) {
          console.error('Error querying events:', err);
          reject(err);
        } else {
          // Parse metadata JSON
          const events = (rows || []).map(row => ({
            ...row,
            metadata: JSON.parse(row.metadata || '{}')
          }));
          resolve(events);
        }
      });
    });
  }

  getEventById(id) {
    return new Promise((resolve, reject) => {
      this.db.get('SELECT * FROM events WHERE id = ?', [id], (err, row) => {
        if (err) {
          reject(err);
        } else {
          if (row) {
            row.metadata = JSON.parse(row.metadata || '{}');
          }
          resolve(row);
        }
      });
    });
  }

  logAlert(eventId, destination, status, error = null) {
    return new Promise((resolve, reject) => {
      const stmt = this.db.prepare(
        `INSERT INTO alerts_log (id, event_id, destination, status, error)
         VALUES (?, ?, ?, ?, ?)`
      );

      const alertId = require('uuid').v4();

      stmt.run(alertId, eventId, destination, status, error);
      stmt.finalize((err) => {
        if (err) {
          reject(err);
        } else {
          resolve(alertId);
        }
      });
    });
  }

  getRateLimitState() {
    return new Promise((resolve, reject) => {
      const now = new Date();
      const windowStart = new Date(now - 60 * 1000); // Last minute

      this.db.get(
        `SELECT * FROM alert_rate_limit 
         WHERE window_start > ? 
         ORDER BY window_start DESC LIMIT 1`,
        [windowStart.toISOString()],
        (err, row) => {
          if (err) {
            reject(err);
          } else {
            resolve(row);
          }
        }
      );
    });
  }

  updateRateLimitState(windowStart, alertCount, lastAlertHash) {
    return new Promise((resolve, reject) => {
      this.db.run(
        `INSERT OR REPLACE INTO alert_rate_limit (window_start, alert_count, last_alert_hash)
         VALUES (?, ?, ?)`,
        [windowStart.toISOString(), alertCount, lastAlertHash],
        (err) => {
          if (err) {
            reject(err);
          } else {
            resolve();
          }
        }
      );
    });
  }

  close() {
    return new Promise((resolve, reject) => {
      this.db.close((err) => {
        if (err) {
          reject(err);
        } else {
          resolve();
        }
      });
    });
  }
}

module.exports = Storage;
