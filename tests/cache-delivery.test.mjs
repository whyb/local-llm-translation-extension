import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { MESSAGE, validateContentMessage } from '../src/shared/messages.js';

const read = (path) => readFile(new URL(path, import.meta.url), 'utf8');

test('segment acknowledgements have a bounded document-scoped protocol', () => {
  assert.equal(validateContentMessage({
    type: MESSAGE.SEGMENT_APPLIED,
    url: 'https://example.com/article',
    runId: 'run-1',
    documentKey: 'doc-1',
    unitIds: ['u1', 'u2']
  }), true);
  assert.equal(validateContentMessage({
    type: MESSAGE.SEGMENT_APPLIED,
    url: 'https://example.com/article',
    runId: 'run-1',
    unitIds: 'u1'
  }), false);
});

test('background stores delivered cache segments and replays unacknowledged ones', async () => {
  const source = await read('../src/background/index.js');
  assert.match(source, /function replayUnacknowledgedSegments\(run, frameState\)/);
  assert.match(source, /frameState\.acknowledged\.has\(unitId\)/);
  assert.match(source, /frameState\.segments\.set\(segment\.unitId, payload\)/);
  assert.match(source, /replayUnacknowledgedSegments\(run, frameState\)/);
  assert.match(source, /async function handleSegmentApplied\(message, sender\)/);
  assert.match(source, /case MESSAGE\.SEGMENT_APPLIED:[\s\S]*?handleSegmentApplied/);
});

test('content and frames acknowledge only segments that were applied to the DOM', async () => {
  const [main, frame, common] = await Promise.all([
    read('../src/content/main.js'),
    read('../src/content/frame.js'),
    read('../src/content/common.js')
  ]);
  assert.match(main, /if \(renderer\.apply\(segment\.unitId, segment\.text\)\) applied\.push\(segment\.unitId\)/);
  assert.match(main, /type: 'segment-applied'/);
  assert.match(frame, /if \(renderer\.apply\(segment\.unitId, segment\.text\)\) applied\.push\(segment\.unitId\)/);
  assert.match(frame, /type: 'segment-applied'/);
  assert.match(common, /port\.onDisconnect\?\.addListener/);
  assert.match(common, /void api\.runtime\?\.lastError/);
});