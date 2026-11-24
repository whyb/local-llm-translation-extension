import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const read = (path) => readFile(new URL(path, import.meta.url), 'utf8');

test('run completion waits for quiet queues and late units can reactivate it', async () => {
  const source = await read('../src/background/index.js');
  const settlement = source.slice(source.indexOf('function scheduleRunSettlement'), source.indexOf('function progressSummary'));
  assert.match(settlement, /runQueuesDrained\(run\)/);
  assert.match(settlement, /\}, 2500\);/);

  const reportStart = source.indexOf('async function handleUnitsReport');
  const report = source.slice(reportStart, source.indexOf('async function handleSelection', reportStart));
  assert.match(report, /run\.state === 'complete'[\s\S]*?run\.state = 'translating'/);
  assert.match(report, /scheduleRunSettlement\(run\)/);
  assert.doesNotMatch(report, /run\.state = 'complete';/);
});

test('content notifications do not block run startup on frame responses', async () => {
  const source = await read('../src/background/index.js');
  const start = source.indexOf('function sendToFrame');
  const body = source.slice(start, source.indexOf('async function broadcastRun', start));
  assert.match(body, /Promise\.resolve\(sendTabMessage\(tabId, message, options\)\)\.catch/);
  assert.match(body, /return Promise\.resolve\(\);/);
});