import { button, card, check, controlGrid, el, field, formSection, numberInput } from './ui-utils.js';

export function renderSpeed(ctx) {
  const { settings, content, markDirty } = ctx;
  const speed = settings.speed;

  const prefetch = el('div', 'toggle-grid');
  prefetch.append(
    check('Hover prefetch', speed.prefetch.hoverPrefetch, (value) => { speed.prefetch.hoverPrefetch = value; markDirty(); }, 'Fetch same-site links on hover. Off by default.'),
    check('Navigation prediction', speed.prefetch.nextNavPrediction, (value) => { speed.prefetch.nextNavPrediction = value; markDirty(); }, 'Warm likely next pages. Off by default.'),
    check('Pause on battery saver', speed.prefetch.pauseOnBatterySaver, (value) => { speed.prefetch.pauseOnBatterySaver = value; markDirty(); }),
    check('Pause on metered connection', speed.prefetch.pauseOnMeteredConnection, (value) => { speed.prefetch.pauseOnMeteredConnection = value; markDirty(); })
  );
  const prefetchBudgets = controlGrid(
    'two',
    field('Hover pages', numberInput(speed.prefetch.hoverPrefetchMaxPages, (value) => { speed.prefetch.hoverPrefetchMaxPages = value ?? 2; markDirty(); }, { min: '0', step: '1' })),
    field('Max pages in flight', numberInput(speed.prefetch.maxPagesInFlight, (value) => { speed.prefetch.maxPagesInFlight = value ?? 1; markDirty(); }, { min: '0', step: '1' })),
    field('Max tokens/min', numberInput(speed.prefetch.maxTokensPerMinute, (value) => { speed.prefetch.maxTokensPerMinute = value ?? 20000; markDirty(); }, { min: '0', step: '1000' }))
  );
  const navigationBudgets = controlGrid(
    'three',
    field('Next-nav links', numberInput(speed.prefetch.nextNavMaxLinks, (value) => { speed.prefetch.nextNavMaxLinks = value ?? 1; markDirty(); }, { min: '0', step: '1' })),
    field('Next-nav long-read minimum', numberInput(speed.prefetch.nextNavLongReadMinChars, (value) => { speed.prefetch.nextNavLongReadMinChars = value ?? 6000; markDirty(); }, { min: '0', step: '500' })),
    field('Next-nav minimum score', numberInput(speed.prefetch.nextNavMinScore, (value) => { speed.prefetch.nextNavMinScore = value ?? 50; markDirty(); }, { min: '0', step: '1' }))
  );
  content.append(card(
    'Speculative work budgets',
    'Prefetch is off by default: it can create page requests and model cost before a user navigates.',
    prefetch,
    formSection('Prefetch budgets', 'Limit speculative work so translation still prioritizes the page the user is viewing.', prefetchBudgets),
    formSection('Navigation prediction', 'Only used when Navigation prediction is enabled.', navigationBudgets)
  ));

  const runaway = controlGrid(
    'three',
    field('Runaway page units', numberInput(speed.runaway.pageUnitCeiling, (value) => { speed.runaway.pageUnitCeiling = value ?? 100000; markDirty(); }, { min: '0', max: '100000', step: '1' })),
    field('Runaway tokens/min', numberInput(speed.runaway.perMinuteTokenCeiling, (value) => { speed.runaway.perMinuteTokenCeiling = value ?? 60000; markDirty(); }, { min: '0', step: '1000' })),
    field('Expansion ratio', numberInput(speed.runaway.responseExpansionRatio, (value) => { speed.runaway.responseExpansionRatio = value ?? 2; markDirty(); }, { min: '1', max: '8', step: '0.1' })),
    field('Retained originals', numberInput(speed.contentMemory.maxRetainedOriginals, (value) => { speed.contentMemory.maxRetainedOriginals = value ?? 5000; markDirty(); }, { min: '100', step: '100' }))
  );
  content.append(card('Run limits', 'Limits protect memory and token budgets during unusually large or rapidly changing pages.', runaway));
}
