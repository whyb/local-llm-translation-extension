import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { MAX_PAGE_UNITS, MESSAGE, validateContentMessage } from '../src/shared/messages.js';

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

test('page unit reports support large chunked inventories', () => {
  assert.equal(MAX_PAGE_UNITS, 100000);
  assert.equal(validateContentMessage({
    type: MESSAGE.UNITS_REPORT,
    url: 'https://example.com/article',
    runId: 'run-1',
    documentKey: 'doc-1',
    snapshot: true,
    inventoryRevision: 1,
    snapshotId: 'run-1:1',
    chunkIndex: 0,
    chunkCount: 20,
    units: []
  }), true);
});

test('background stores delivered cache segments and replays unacknowledged ones', async () => {
  const source = await read('../src/background/index.js');
  assert.match(source, /function replayUnacknowledgedSegments\(run, frameState\)/);
  assert.match(source, /frameState\.acknowledged\.has\(unitId\)/);
  assert.match(source, /frameState\.segments\.set\(segment\.unitId, payload\)/);
  assert.match(source, /replayUnacknowledgedSegments\(run, frameState\)/);
  assert.match(source, /function queueSegmentDelivery\(run, frameState, payload\)/);
  assert.match(source, /function flushSegmentOutbox\(run, frameState\)/);
  assert.match(source, /SEGMENT_DELIVERY_BATCH_SIZE/);
  assert.match(source, /function sendProgressSoon\(run\)/);
  assert.match(source, /reportBuffer/);
  assert.match(source, /chunked: true/);
  assert.match(source, /async function handleSegmentApplied\(message, sender\)/);
  assert.match(source, /case MESSAGE\.SEGMENT_APPLIED:[\s\S]*?handleSegmentApplied/);
});

test('content and frames acknowledge only segments that were applied to the DOM', async () => {
  const [main, frame, common] = await Promise.all([
    read('../src/content/main.js'),
    read('../src/content/frame.js'),
    read('../src/content/common.js')
  ]);
  assert.match(main, /createDeliveryScheduler\(\{/);
  assert.match(main, /applySegment: \(segment\) => mutateWithoutObservation\(\(\) => renderer\.apply\(segment\.unitId, segment\.text\)\)/);
  assert.match(main, /onAck: \(unitIds\) => acknowledgeSegments\(unitIds\)/);
  assert.match(main, /type: 'segment-applied'/);
  assert.match(frame, /createDeliveryScheduler\(\{/);
  assert.match(frame, /applySegment: \(segment\) => mutateWithoutObservation\(\(\) => renderer\.apply\(segment\.unitId, segment\.text\)\)/);
  assert.match(frame, /type: 'segment-applied'/);
  assert.match(common, /function createDeliveryScheduler\(\{ applySegment, onAck, isActive, onFirstApplied \}\)/);
  assert.match(common, /pendingAcks\.add\(unitId\)/);
  assert.match(common, /requestAnimationFrame\(flush\)/);
  assert.doesNotMatch(common, /keepAlivePort|run-port-keepalive/);
});
