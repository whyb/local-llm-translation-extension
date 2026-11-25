import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { DEFAULT_SETTINGS, normalizeSettings } from '../src/shared/settings.js';
import { MESSAGE, validateContentMessage } from '../src/shared/messages.js';

const read = (path) => readFile(new URL(path, import.meta.url), 'utf8');

function section(source, startMarker, endMarker, label) {
  const start = source.indexOf(startMarker);
  assert.notEqual(start, -1, `${label}: missing ${startMarker}`);
  const end = source.indexOf(endMarker, start + startMarker.length);
  assert.notEqual(end, -1, `${label}: missing ${endMarker}`);
  return source.slice(start, end);
}

function lastSection(source, startMarker, endMarker, label) {
  const start = source.lastIndexOf(startMarker);
  assert.notEqual(start, -1, `${label}: missing ${startMarker}`);
  const end = source.indexOf(endMarker, start + startMarker.length);
  assert.notEqual(end, -1, `${label}: missing ${endMarker}`);
  return source.slice(start, end);
}

test('URL changes invalidate the URL-bound run and abort the previous page', async () => {
  const [main, background] = await Promise.all([
    read('../src/content/main.js'),
    read('../src/background/index.js')
  ]);
  const watcher = section(main, 'function installNavigationWatcher', 'function installHoverIntent', 'navigation watcher');
  const pageChange = section(main, 'function handlePageContextChanged', 'function installNavigationWatcher', 'page context helper');

  assert.match(watcher, /handlePageContextChanged\(/);
  assert.match(watcher, /location\.href/);
  assert.match(watcher, /popstate/);
  assert.match(watcher, /hashchange/);
  assert.match(pageChange, /type:\s*'page-context-changed'/);
  assert.match(pageChange, /(?:previousUrl|runId|documentKey)/);
  assert.match(pageChange, /endPageSession\(/);
  assert.match(pageChange, /location\.href/);
  assert.match(watcher, /(?:popstate|hashchange)/);

  const navigationHandler = section(background, 'case MESSAGE.SPA_NAVIGATE', 'case MESSAGE.RUN_PAUSED', 'background navigation handler');
  assert.match(navigationHandler, /PAGE_CONTEXT_CHANGED/);
  assert.match(navigationHandler, /(?:invalidateTabRuns|stopRun)\(tabId/);
  assert.match(background, /function (?:invalidateTabRuns|stopRun)[\s\S]*?run\.controller\.abort/);
  assert.match(background, /String\(message\?\.documentKey \?\? sender\?\.documentId \?\? ''\)/);
});

test('pagehide cancels an active run before refresh or link navigation', async () => {
  const main = await read('../src/content/main.js');
  const pagehide = lastSection(main, "window.addEventListener('pagehide'", "window.addEventListener('pageshow'", 'pagehide handler');
  const pageshow = section(main, "window.addEventListener('pageshow'", 'boot().catch', 'pageshow handler');

  assert.match(pagehide, /if \(!sessionActive && !runId\) return/);
  assert.match(pagehide, /type:\s*'(?:stop|page-context-changed)'/);
  assert.match(pagehide, /(?:url:\s*(?:runUrl|location\.href)|documentKey)/);
  assert.match(pagehide, /(?:reason:\s*'pagehide'|event\.persisted)/);
  assert.match(pagehide, /endPageSession/);
  assert.match(pageshow, /type:\s*'bfcache-restore'/);
  assert.doesNotMatch(pageshow, /type:\s*'translate-page'/);
});

test('dynamic DOM changes reconcile total/done from a snapshot instead of only appending', async () => {
  const [main, background] = await Promise.all([
    read('../src/content/main.js'),
    read('../src/background/index.js')
  ]);
  const reportPath = section(main, 'async function reportUnits', 'function scheduleExtraction', 'content report path');
  const report = section(background, 'async function handleUnitsReport', 'async function handleSelection', 'units report');

  assert.match(reportPath, /(?:snapshot|reconcile|replace|full)/i);
  assert.match(report, /(?:message\.snapshot|message\.mode\s*===\s*'snapshot'|message\.reconcile|message\.replace)/);
  assert.match(report, /recalculateRunProgress\(run\)/);
  assert.match(background, /function recalculateRunProgress[\s\S]*?run\.total\s*=[\s\S]*?run\.done\s*=/);
  assert.match(background, /function progressSummary[\s\S]*?done:\s*run\.done[\s\S]*?total:\s*run\.total/);
});

test('dynamic continuation defaults on, is user-configurable, and is visible in settings', async () => {
  assert.equal(DEFAULT_SETTINGS.translation.autoTranslateDynamic, true);
  assert.equal(normalizeSettings({ translation: { autoTranslateDynamic: false } }).translation.autoTranslateDynamic, false);

  const [main, popup, translationOptions, uiUtils] = await Promise.all([
    read('../src/content/main.js'),
    read('../src/ui/popup/index.html'),
    read('../src/ui/options/translation.js'),
    read('../src/ui/options/ui-utils.js')
  ]);
  const controls = `${main}\n${popup}\n${translationOptions}\n${uiUtils}`;
  assert.match(controls, /autoTranslateDynamic|auto-dynamic/);
  assert.match(translationOptions, /autoTranslateDynamic/);
  assert.match(uiUtils, /function check[\s\S]*?type\s*=\s*['"]checkbox['"]/);
});

test('auto-continuation is limited to an already-started same-page session after completion', async () => {
  const [main, background] = await Promise.all([
    read('../src/content/main.js'),
    read('../src/background/index.js')
  ]);
  const mutation = section(main, 'function installMutationObserver', 'function stopObserver', 'mutation observer');
  const endSession = section(main, 'function endPageSession', 'function handlePageContextChanged', 'end page session');
  const pageChange = section(main, 'function handlePageContextChanged', 'function installNavigationWatcher', 'page context helper');
  const delivery = section(main, 'function applyDelivery', 'function progress', 'segment delivery');
  const queue = section(background, 'function queueFrameUnits', 'async function processFrameQueue', 'dynamic queue');
  const report = section(background, 'async function handleUnitsReport', 'async function handleSelection', 'units report');

  assert.match(queue, /autoTranslateDynamic[\s\S]*?return 0/);
  assert.match(report, /run\.state === 'complete'[\s\S]*?autoTranslateDynamic[\s\S]*?run\.pending/);
  assert.match(endSession, /sessionActive\s*=\s*false/);
  assert.match(endSession, /runId\s*=\s*null/);
  assert.match(pageChange, /location\.href/);
  assert.match(pageChange, /page-context-changed/);
  assert.match(delivery, /sessionActive/);
  assert.match(delivery, /sessionHref/);
  assert.match(mutation, /scheduleExtraction\(\)/);
  assert.match(main, /documentKey/);
  assert.doesNotMatch(mutation, /type:\s*'translate-page'/);
});

test('lifecycle protocol accepts full snapshots and document-scoped page invalidation', () => {
  const unitsReport = {
    type: MESSAGE.UNITS_REPORT,
    url: 'https://example.com/article',
    runId: 'run-example',
    documentKey: 'document-2',
    snapshot: true,
    units: []
  };
  assert.equal(validateContentMessage(unitsReport), true);
  assert.equal(validateContentMessage({
    type: MESSAGE.PAGE_CONTEXT_CHANGED,
    url: 'https://example.com/article',
    documentKey: 'document-1',
    reason: 'pagehide',
    runId: 'run-example'
  }), true);
  assert.equal(validateContentMessage({
    type: MESSAGE.PAGE_CONTEXT_CHANGED,
    url: 'https://example.com/article',
    documentKey: 'document-1',
    reason: 'bfcache-restore',
    runId: 'run-example'
  }), false);
});


test('late lifecycle notifications from an old run cannot terminate the replacement run', async () => {
  const main = await read('../src/content/main.js');
  const handlers = section(main, "case 'run-cancel':", "case 'toggle-render-mode':", 'content lifecycle messages');
  assert.equal((handlers.match(/if \(message\.runId && runId && message\.runId !== runId\) break;/g) || []).length, 4);
  assert.match(main, /let lastRunId = null/);
  assert.match(main, /type: 'stop'[\s\S]*?runId: runId \|\| lastRunId/);
  assert.match(main, /type: 'revert'[\s\S]*?runId: runId \|\| lastRunId/);
});


test('late stop and revert cleanup cannot delete a newer run with the same URL key', async () => {
  const background = await read('../src/background/index.js');
  const stop = section(background, 'async function stopRun', 'async function revertRun', 'stop run');
  const revert = section(background, 'async function revertRun', 'async function savePageSnapshot', 'revert run');
  const invalidate = section(background, 'async function invalidateTabRuns', 'function rememberFrame', 'invalidate runs');
  for (const body of [stop, revert, invalidate]) {
    assert.match(body, /state\.runs\.get\([^)]*\) === run/);
    assert.doesNotMatch(body, /state\.runs\.delete\([^)]*\);\s*state\.framesByTab\.delete/);
  }
});
