/**
 * Alert Routing - Forward events to Telegram with rate limiting
 */

const { execSync } = require('child_process');
const crypto = require('crypto');

class Alerts {
  constructor(storage) {
    this.storage = storage;
    this.minSeverity = process.env.ALERT_MIN_SEVERITY || 'warning';
    this.rateLimit = parseInt(process.env.ALERT_RATE_LIMIT || '1');
    this.rateLimitWindow = parseInt(process.env.ALERT_RATE_WINDOW_SECS || '3600');
    this.telegramGroupId = process.env.TELEGRAM_GROUP_ID;
    this.useOpenClawCli = process.env.USE_OPENCLAW_CLI !== 'false';
    this.botToken = process.env.TELEGRAM_BOT_TOKEN;
    
    // Business hours configuration
    this.businessHoursStart = parseInt(process.env.ALERT_BUSINESS_HOURS_START || '9');
    this.businessHoursEnd = parseInt(process.env.ALERT_BUSINESS_HOURS_END || '17');
    this.businessHoursTz = process.env.ALERT_BUSINESS_HOURS_TZ || 'America/New_York';

    if (!this.telegramGroupId) {
      console.warn('[Alerts] TELEGRAM_GROUP_ID not set - alerts disabled');
    }

    const severityLevels = { debug: 0, info: 1, warning: 2, critical: 3 };
    this.minSeverityLevel = severityLevels[this.minSeverity] || 2;
    
    console.log(`[Alerts] Configured: ${this.minSeverity}+, ${this.rateLimit} alert(s) per ${this.rateLimitWindow}s, business hours ${this.businessHoursStart}-${this.businessHoursEnd} ${this.businessHoursTz}`);
  }

  isBusinessHours() {
    const now = new Date();
    const estFormatter = new Intl.DateTimeFormat('en-US', {
      timeZone: this.businessHoursTz,
      hour: '2-digit',
      hour12: false
    });
    
    const estHour = parseInt(estFormatter.format(now));
    const isOpen = estHour >= this.businessHoursStart && estHour < this.businessHoursEnd;
    
    if (!isOpen) {
      console.log(`[Alerts] Outside business hours (${estHour}:00 EST, window ${this.businessHoursStart}-${this.businessHoursEnd})`);
    }
    
    return isOpen;
  }

  shouldAlert(event) {
    const severityLevels = { debug: 0, info: 1, warning: 2, critical: 3 };
    const eventLevel = severityLevels[event.severity] || 1;
    return eventLevel >= this.minSeverityLevel;
  }

  formatAlertMessage(event) {
    const severityEmoji = {
      critical: '🚨',
      warning: '⚠️',
      info: 'ℹ️',
      debug: '🐛'
    }[event.severity] || '📬';

    const lines = [
      `${severityEmoji} ${event.severity.toUpperCase()} | ${event.agent}`,
      `Title: ${event.title}`
    ];

    if (event.task_id) {
      lines.push(`Task: ${event.task_id}`);
    }

    if (event.detail) {
      // Truncate long details
      const detail = event.detail.substring(0, 200);
      lines.push(`Detail: ${detail}${event.detail.length > 200 ? '...' : ''}`);
    }

    lines.push(`Time: ${event.timestamp}`);

    return lines.join('\n');
  }

  getEventHash(event) {
    const data = `${event.agent}:${event.type}:${event.severity}:${event.title}`;
    return crypto.createHash('md5').update(data).digest('hex');
  }

  async checkRateLimit(event) {
    try {
      const state = await this.storage.getRateLimitState();
      const now = new Date();

      if (!state) {
        // New window
        await this.storage.updateRateLimitState(now.toISOString(), 1, this.getEventHash(event));
        return true;
      }

      const windowStart = new Date(state.window_start);
      const windowAge = (now - windowStart) / 1000;

      if (windowAge > this.rateLimitWindow) {
        // Window expired, start new one
        await this.storage.updateRateLimitState(now.toISOString(), 1, this.getEventHash(event));
        return true;
      }

      // Check if at limit
      if (state.alert_count >= this.rateLimit) {
        console.log(`[Alerts] Rate limit hit (${state.alert_count}/${this.rateLimit})`);
        return false;
      }

      // Check for duplicate within window
      const eventHash = this.getEventHash(event);
      if (state.last_alert_hash === eventHash) {
        console.log(`[Alerts] Duplicate alert suppressed (${eventHash})`);
        return false;
      }

      // Increment and update
      await this.storage.updateRateLimitState(
        state.window_start,
        state.alert_count + 1,
        eventHash
      );

      return true;
    } catch (err) {
      console.error('[Alerts] Error checking rate limit:', err);
      return false;
    }
  }

  async sendViaOpenClawCli(message) {
    try {
      const cmd = `openclaw message send --channel telegram --target ${this.telegramGroupId} --message "${message.replace(/"/g, '\\"')}"`;
      execSync(cmd, { stdio: 'pipe' });
      console.log('[Alerts] Sent via OpenClaw CLI');
      return { success: true, method: 'openclaw-cli' };
    } catch (err) {
      console.error('[Alerts] OpenClaw CLI error:', err.message);
      throw err;
    }
  }

  async sendViaTelegramApi(message) {
    try {
      if (!this.botToken) {
        throw new Error('TELEGRAM_BOT_TOKEN not set');
      }

      const url = `https://api.telegram.org/bot${this.botToken}/sendMessage`;
      const fetch = require('node-fetch');

      const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          chat_id: this.telegramGroupId,
          text: message,
          parse_mode: 'HTML'
        })
      });

      if (!response.ok) {
        throw new Error(`Telegram API error: ${response.statusCode}`);
      }

      console.log('[Alerts] Sent via Telegram API');
      return { success: true, method: 'telegram-api' };
    } catch (err) {
      console.error('[Alerts] Telegram API error:', err.message);
      throw err;
    }
  }

  async routeAlert(event) {
    // Check if should alert
    if (!this.shouldAlert(event) || !this.telegramGroupId) {
      return;
    }

    // Check business hours (only send during 9am-5pm EST)
    if (!this.isBusinessHours()) {
      console.log(`[Alerts] Suppressed (outside business hours): ${event.severity} | ${event.title}`);
      return;
    }

    // Check rate limit (with de-duplication) - 1 alert per hour during business hours
    const allowed = await this.checkRateLimit(event);
    if (!allowed) {
      return;
    }

    // Format message
    const message = this.formatAlertMessage(event);

    // Send via preferred method
    let result = null;
    try {
      if (this.useOpenClawCli) {
        result = await this.sendViaOpenClawCli(message);
      } else {
        result = await this.sendViaTelegramApi(message);
      }

      // Log successful alert
      await this.storage.logAlert(event.id, 'telegram', 'sent');
      console.log(`[Alerts] Alert routed: ${event.severity} | ${event.title}`);
    } catch (err) {
      console.error(`[Alerts] Failed to route alert: ${err.message}`);
      await this.storage.logAlert(event.id, 'telegram', 'failed', err.message);
    }
  }
}

module.exports = Alerts;
