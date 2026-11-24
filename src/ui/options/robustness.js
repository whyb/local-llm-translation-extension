import { card, check, controlGrid, el, field, formSection, numberInput } from './ui-utils.js';

export function renderRobustness(ctx) {
  const { settings, content, markDirty } = ctx;
  const robustness = settings.robustness;
  const hostileToggles = el('div', 'toggle-grid');
  hostileToggles.append(
    check('Hostile-page guard', robustness.hostilePage.enabled, (value) => { robustness.hostilePage.enabled = value; markDirty(); }),
    check('Guard stylesheet', robustness.hostilePage.guardStylesheet, (value) => { robustness.hostilePage.guardStylesheet = value; markDirty(); })
  );
  const hostileFields = controlGrid(
    'three',
    field('Echo window (ms)', numberInput(robustness.hostilePage.echoWindowMs, (value) => { robustness.hostilePage.echoWindowMs = value ?? 400; markDirty(); }, { min: '0', step: '50' })),
    field('Max echo cycles', numberInput(robustness.hostilePage.maxEchoCycles, (value) => { robustness.hostilePage.maxEchoCycles = value ?? 8; markDirty(); }, { min: '0', step: '1' })),
    field('Cycle window (ms)', numberInput(robustness.hostilePage.cycleWindowMs, (value) => { robustness.hostilePage.cycleWindowMs = value ?? 10000; markDirty(); }, { min: '100', step: '100' })),
    field('Max removed nodes', numberInput(robustness.hostilePage.maxRemovedNodes, (value) => { robustness.hostilePage.maxRemovedNodes = value ?? 200; markDirty(); }, { min: '0', step: '10' })),
    field('Stylesheet recheck (ms)', numberInput(robustness.hostilePage.stylesheetRecheckMs, (value) => { robustness.hostilePage.stylesheetRecheckMs = value ?? 1000; markDirty(); }, { min: '100', step: '100' }))
  );
  const keepAlive = el('div', 'toggle-grid');
  keepAlive.append(check('Run keepalive', robustness.runKeepAlive.enabled, (value) => { robustness.runKeepAlive.enabled = value; markDirty(); }));
  const diagnostics = el('div', 'toggle-grid');
  diagnostics.append(check('Verbose logging', robustness.verboseLogging, (value) => { robustness.verboseLogging = value; markDirty(); }));
  content.append(card(
    'Runtime protection',
    'These controls protect long runs on aggressive pages. Verbose logging is off by default.',
    formSection('Hostile-page guard', 'Detect pages that repeatedly mutate translation targets or replace guarded stylesheets.', hostileToggles, hostileFields),
    formSection('Long-running translation', 'Keep the service worker responsive and control diagnostic detail.', keepAlive, controlGrid('two', field('Keepalive interval (ms)', numberInput(robustness.runKeepAlive.intervalMs, (value) => { robustness.runKeepAlive.intervalMs = value ?? 12000; markDirty(); }, { min: '1000', step: '1000' })), diagnostics))
  ));
}
