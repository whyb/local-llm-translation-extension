import test from 'node:test';
import assert from 'node:assert/strict';
import {
  MAX_ERROR_LOG_ENTRIES, normalizeErrorRecord, pruneErrorLog, sanitizeErrorText, shouldRecordError
} from '../src/shared/error-log.js';
import { MESSAGE, validateContentMessage } from '../src/shared/messages.js';

test('error log levels and redaction are bounded', () => {
  assert.equal(shouldRecordError('error', 'warn'), true);
  assert.equal(shouldRecordError('info', 'error'), false);
  assert.match(sanitizeErrorText('Authorization: Bearer secret-token api_key=abc123'), /redacted/);
  assert.doesNotMatch(sanitizeErrorText('Authorization: Bearer secret-token api_key=abc123'), /secret-token|abc123/);
});

test('error log retention prunes old records and keeps the newest entries', () => {
  const now = Date.UTC(2026, 10, 25, 12, 0, 0);
  const old = normalizeErrorRecord({ timestamp: now - 8 * 86400000, message: 'old' }, now);
  const recent = normalizeErrorRecord({ timestamp: now - 86400000, message: 'recent' }, now);
  assert.deepEqual(pruneErrorLog([old, recent], 7, now).map((entry) => entry.message), ['recent']);
  const many = Array.from({ length: MAX_ERROR_LOG_ENTRIES + 20 }, (_, index) => ({ timestamp: now - index, message: String(index) }));
  assert.equal(pruneErrorLog(many, 7, now).length, MAX_ERROR_LOG_ENTRIES);
});

test('client error messages are accepted and retained by the background protocol', () => {
  assert.equal(validateContentMessage({
    type: MESSAGE.CLIENT_ERROR,
    source: 'content',
    level: 'error',
    message: 'boom',
    stack: 'stack',
    url: 'https://example.com/article',
    details: { phase: 'test' }
  }), true);
  assert.equal(validateContentMessage({ type: MESSAGE.CLIENT_ERROR, source: 'content', message: 'x'.repeat(4001) }), false);
  assert.equal(validateContentMessage({ type: MESSAGE.ERROR_LOG_REQUEST }), true);
  assert.equal(validateContentMessage({ type: MESSAGE.ERROR_LOG_CLEAR_REQUEST }), true);
});
