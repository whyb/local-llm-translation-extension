const listeners = {};
const event = (name) => ({ addListener(fn) { (listeners[name] ??= []).push(fn); }, removeListener() {} });
globalThis.chrome = {
  runtime: { sendMessage: async () => ({ ok: true }), connect: () => ({ postMessage() {}, disconnect() {} }), onMessage: event('runtimeMessage'), onConnect: event('runtimeConnect'), getManifest: () => ({ version: '2.0.2' }), reload() {}, getURL: (path) => path, openOptionsPage: async () => {} },
  storage: { local: { get: async () => ({}), set: async () => {}, remove: async () => {}, clear: async () => {} }, onChanged: event('storageChanged') },
  tabs: { query: async () => [{ id: 1, url: 'https://example.com/', title: 'Example' }], get: async () => ({ id: 1, url: 'https://example.com/' }), sendMessage: async () => undefined, create: async () => ({}), update: async () => ({}), onUpdated: event('tabUpdated'), onRemoved: event('tabRemoved'), onActivated: event('tabActivated') },
  scripting: { registerContentScripts: async () => {}, unregisterContentScripts: async () => {}, executeScript: async () => [] },
  permissions: { contains: async () => true, request: async () => true, remove: async () => true, getAll: async () => ({ origins: [] }), onAdded: event('permissionsAdded'), onRemoved: event('permissionsRemoved') },
  commands: { onCommand: event('command') },
  action: {}
};
await import('../src/background/index.js');
if (!listeners.runtimeMessage?.length) throw new Error('runtime message listener was not registered synchronously');
if (!listeners.runtimeConnect?.length) throw new Error('runtime connect listener was not registered synchronously');
await new Promise((resolve) => setTimeout(resolve, 100));
function sendToBackground(message, sender = {}) {
  return new Promise((resolve, reject) => {
    const listener = listeners.runtimeMessage[0];
    const keepOpen = listener(message, sender, resolve);
    if (keepOpen !== true) reject(new Error('runtime message listener did not keep the response channel open'));
  });
}

globalThis.fetch = async (url, options = {}) => {
  const target = String(url);
  if (target.endsWith('/v1/models')) {
    return new Response(JSON.stringify({ data: [{ id: 'test-model' }] }), { status: 200, headers: { 'Content-Type': 'application/json' } });
  }
  if (target.endsWith('/props')) {
    return new Response(JSON.stringify({ default_generation_settings: { n_ctx: 4096 } }), { status: 200, headers: { 'Content-Type': 'application/json' } });
  }
  if (target.endsWith('/chat/completions') && options.method === 'POST') {
    return new Response(JSON.stringify({
      choices: [{ message: { content: 'ok' }, finish_reason: 'stop' }],
      usage: { prompt_tokens: 2, completion_tokens: 1 }
    }), { status: 200, headers: { 'Content-Type': 'application/json' } });
  }
  return new Response(JSON.stringify({ error: 'not found' }), { status: 404 });
};

const connectionTest = await sendToBackground({
  type: 'test-connection-request',
  profile: {
    id: 'smoke-provider',
    name: 'Smoke provider',
    role: 'primary',
    adapter: 'llamacpp',
    baseUrl: 'http://127.0.0.1:9931/v1',
    model: 'test-model',
    timeoutMs: 5000,
    reasoning: { mode: 'off', effort: null }
  }
});
if (!connectionTest?.ok || !connectionTest.capabilities?.connectionOk) {
  throw new Error(`provider connection test failed: ${JSON.stringify(connectionTest)}`);
}

const pong = await sendToBackground({ type: 'ping', sentAt: Date.now() });
if (pong?.type !== 'pong') throw new Error(`unexpected background response: ${JSON.stringify(pong)}`);
const enabled = await sendToBackground({ type: 'set-site-mode', url: 'https://example.com/', mode: 'ask' });
if (!enabled?.ok) throw new Error(`site activation failed: ${JSON.stringify(enabled)}`);
const run = await sendToBackground({ type: 'translate-page', url: 'https://example.com/', tabId: 1 });
if (run?.error) throw new Error(`translation startup failed: ${JSON.stringify(run)}`);
if (run?.state !== 'translating') throw new Error(`unexpected run state: ${JSON.stringify(run)}`);
const duplicate = await sendToBackground({ type: 'translate-page', url: 'https://example.com/', tabId: 1 });
if (duplicate?.runId !== run.runId) throw new Error('duplicate translation did not reuse the active run');

const paused = await sendToBackground({ type: 'run-paused', url: 'https://example.com/', runId: run.runId, reason: 'mutation-storm' });
if (!paused?.ok) throw new Error(`pause failed: ${JSON.stringify(paused)}`);
const pausedState = await sendToBackground({ type: 'get-progress', url: 'https://example.com/', tabId: 1 });
if (pausedState?.state !== 'paused' || !/too many page mutations/.test(pausedState.notice?.message || '')) throw new Error(`pause state mismatch: ${JSON.stringify(pausedState)}`);
const restartedAfterPause = await sendToBackground({ type: 'translate-page', url: 'https://example.com/', tabId: 1 });
if (restartedAfterPause?.error || restartedAfterPause?.runId === run.runId || restartedAfterPause?.state !== 'translating') throw new Error(`translation after pause failed: ${JSON.stringify(restartedAfterPause)}`);
const stopped = await sendToBackground({ type: 'stop', url: 'https://example.com/', tabId: 1 });
if (!stopped?.ok) throw new Error(`stop failed: ${JSON.stringify(stopped)}`);
const restarted = await sendToBackground({ type: 'translate-page', url: 'https://example.com/', tabId: 1 });
if (restarted?.error || restarted?.runId === run.runId) throw new Error(`translation restart failed: ${JSON.stringify(restarted)}`);
await sendToBackground({ type: 'stop', url: 'https://example.com/', tabId: 1 });
listeners.command[0]('translate-page');
await new Promise((resolve) => setTimeout(resolve, 30));
const commanded = await sendToBackground({ type: 'get-progress', url: 'https://example.com/', tabId: 1 });
if (commanded?.state !== 'translating') throw new Error(`command did not start translation: ${JSON.stringify(commanded)}`);
listeners.command[0]('revert-page');
await new Promise((resolve) => setTimeout(resolve, 30));
const reverted = await sendToBackground({ type: 'get-progress', url: 'https://example.com/', tabId: 1 });
if (reverted?.state !== 'idle') throw new Error(`command did not revert translation: ${JSON.stringify(reverted)}`);
console.log('background module smoke OK');
