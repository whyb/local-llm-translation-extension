export const ERROR_LOG_KEY = 'lbt.errorLog';
export const ERROR_LOG_LEVELS = Object.freeze(['debug', 'info', 'warn', 'error']);
export const ERROR_LOG_LEVEL_RANK = Object.freeze({ debug: 10, info: 20, warn: 30, error: 40 });
export const DEFAULT_ERROR_LOG_LEVEL = 'error';
export const DEFAULT_ERROR_RETENTION_DAYS = 7;
export const MAX_ERROR_LOG_ENTRIES = 1000;

export function normalizeErrorLevel(value, fallback = DEFAULT_ERROR_LOG_LEVEL) {
  const level = String(value ?? '').toLowerCase();
  return ERROR_LOG_LEVELS.includes(level) ? level : fallback;
}

export function shouldRecordError(level, minimumLevel) {
  return (ERROR_LOG_LEVEL_RANK[normalizeErrorLevel(level)] ?? 0) >= (ERROR_LOG_LEVEL_RANK[normalizeErrorLevel(minimumLevel)] ?? 0);
}

export function sanitizeErrorText(value, maxLength = 12000) {
  return String(value ?? '')
    .replace(/\bBearer\s+[A-Za-z0-9._~+/=:-]+/gi, '[redacted]')
    .replace(/\bsk-[A-Za-z0-9_-]{8,}/g, '[redacted]')
    .replace(/\b(?:api[-_]?key|token|secret|password)\s*[:=]\s*["']?[^\s,;"']+/gi, '[redacted-key]')
    .replace(/[?&](?:key|access_token)=[A-Za-z0-9._~+/=-]+/gi, '[redacted-query-key]')
    .slice(0, maxLength);
}

export function sanitizeErrorUrl(value) {
  const raw = String(value ?? '');
  try {
    const url = new URL(raw);
    return `${url.origin}${url.pathname}`.slice(0, 2000);
  } catch {
    return sanitizeErrorText(raw, 2000);
  }
}

export function normalizeErrorRecord(value, now = Date.now()) {
  const input = value && typeof value === 'object' ? value : {};
  const timestamp = Number.isFinite(Number(input.timestamp)) ? Number(input.timestamp) : now;
  return {
    id: sanitizeErrorText(input.id || `${timestamp.toString(36)}-${Math.random().toString(36).slice(2, 8)}`, 120),
    timestamp,
    level: normalizeErrorLevel(input.level),
    source: sanitizeErrorText(input.source || 'unknown', 80),
    message: sanitizeErrorText(input.message || 'Unknown error', 4000),
    stack: sanitizeErrorText(input.stack || '', 12000),
    url: sanitizeErrorUrl(input.url || ''),
    runId: sanitizeErrorText(input.runId || '', 160),
    documentKey: sanitizeErrorText(input.documentKey || '', 160),
    userAgent: sanitizeErrorText(input.userAgent || '', 500),
    details: sanitizeErrorText(input.details || '', 4000),
    count: Math.max(1, Math.floor(Number(input.count) || 1))
  };
}

export function errorFingerprint(record) {
  return `${record.source}|${record.level}|${record.message}|${String(record.stack || '').slice(0, 500)}`;
}

export function pruneErrorLog(entries, retentionDays = DEFAULT_ERROR_RETENTION_DAYS, now = Date.now()) {
  const days = Math.min(90, Math.max(1, Math.floor(Number(retentionDays) || DEFAULT_ERROR_RETENTION_DAYS)));
  const cutoff = now - days * 86400000;
  return (Array.isArray(entries) ? entries : [])
    .map((entry) => normalizeErrorRecord(entry, now))
    .filter((entry) => entry.timestamp >= cutoff)
    .sort((left, right) => left.timestamp - right.timestamp)
    .slice(-MAX_ERROR_LOG_ENTRIES);
}
