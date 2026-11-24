import test from 'node:test';
import assert from 'node:assert/strict';
import { AnthropicAdapter, GeminiAdapter, OllamaAdapter, OpenAIAdapter, ProviderError, testConnection } from '../src/background/providers/index.js';
import { ADAPTER_DEFAULT_BASE_URLS, DEFAULT_CONTEXT_LENGTH, createDefaultProfile, normalizeSettings } from '../src/shared/settings.js';

const profile = {
  id: 'test-provider',
  name: 'Test provider',
  role: 'primary',
  adapter: 'llamacpp',
  baseUrl: 'http://127.0.0.1:9931/v1',
  apiKey: null,
  model: 'test-model',
  timeoutMs: 5000,
  reasoning: { mode: 'off', effort: null },
  streaming: true
};

test('provider connection test probes models, props and a tiny completion', async () => {
  const originalFetch = globalThis.fetch;
  const urls = [];
  globalThis.fetch = async (url, options = {}) => {
    urls.push(String(url));
    if (String(url).endsWith('/v1/models')) {
      return new Response(JSON.stringify({ data: [{ id: 'test-model' }] }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    }
    if (String(url).endsWith('/props')) {
      return new Response(JSON.stringify({ default_generation_settings: { n_ctx: 8192 } }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    }
    if (String(url).endsWith('/chat/completions') && options.method === 'POST') {
      return new Response(JSON.stringify({
        choices: [{ message: { content: 'ok' }, finish_reason: 'stop' }],
        usage: { prompt_tokens: 2, completion_tokens: 1 }
      }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    }
    return new Response(JSON.stringify({ error: 'not found' }), { status: 404 });
  };
  try {
    const result = await testConnection(profile);
    assert.equal(result.ok, true);
    assert.equal(result.capabilities.model, 'test-model');
    assert.equal(result.capabilities.contextLength, 8192);
    assert.ok(result.latencyMs >= 0);
    assert.ok(result.capabilities.tokensPerSecond > 0);
    assert.ok(urls.some((url) => url.endsWith('/v1/models')));
    assert.ok(urls.some((url) => url.endsWith('/props')));
    assert.ok(urls.some((url) => url.endsWith('/chat/completions')));
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('provider connection test reports a provider error for an unreachable endpoint', async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => { throw new TypeError('network down'); };
  try {
    await assert.rejects(
      () => testConnection(profile),
      (error) => error instanceof ProviderError && /network/i.test(error.message)
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('adapter defaults match documented provider endpoints', () => {
  assert.equal(ADAPTER_DEFAULT_BASE_URLS.llamacpp, 'http://127.0.0.1:8080/v1');
  assert.equal(ADAPTER_DEFAULT_BASE_URLS.ollama, 'http://localhost:11434/v1');
  assert.equal(ADAPTER_DEFAULT_BASE_URLS.vllm, 'http://localhost:8000/v1');
  assert.equal(ADAPTER_DEFAULT_BASE_URLS.sglang, 'http://127.0.0.1:30000/v1');
  assert.equal(ADAPTER_DEFAULT_BASE_URLS.openai, 'https://api.openai.com/v1');
  assert.equal(ADAPTER_DEFAULT_BASE_URLS.anthropic, 'https://api.anthropic.com');
  assert.equal(ADAPTER_DEFAULT_BASE_URLS.gemini, 'https://generativelanguage.googleapis.com');
  assert.equal(createDefaultProfile(0, 'primary', 'ollama').baseUrl, ADAPTER_DEFAULT_BASE_URLS.ollama);
  assert.equal(createDefaultProfile(0).contextLength, DEFAULT_CONTEXT_LENGTH);
  assert.equal(DEFAULT_CONTEXT_LENGTH, 65535);
  const migrated = normalizeSettings({ providers: { profiles: [{ id: 'legacy', name: 'Legacy', adapter: 'llamacpp', baseUrl: 'http://127.0.0.1:8080/v1', contextLength: null }] } });
  assert.equal(migrated.providers.profiles[0].contextLength, DEFAULT_CONTEXT_LENGTH);
});

test('Ollama and Anthropic base URL suffixes are not duplicated', async () => {
  const originalFetch = globalThis.fetch;
  const urls = [];
  globalThis.fetch = async (url) => {
    urls.push(String(url));
    if (String(url).includes('/api/chat')) {
      return new Response(JSON.stringify({ message: { content: 'ok' }, done: true }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    }
    if (String(url).includes('/v1/chat/completions') || String(url).includes('/v1beta/openai/chat/completions')) {
      return new Response(JSON.stringify({ choices: [{ message: { content: 'ok' }, finish_reason: 'stop' }] }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    }
    if (String(url).includes('/v1/messages')) {
      return new Response(JSON.stringify({ content: [{ type: 'text', text: 'ok' }], stop_reason: 'end_turn' }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    }
    return new Response(JSON.stringify({ error: 'not found' }), { status: 404 });
  };
  try {
    const ollama = new OllamaAdapter({ ...profile, adapter: 'ollama', baseUrl: 'http://localhost:11434/api', timeoutMs: 2000 });
    await ollama.chat({ messages: [{ role: 'user', content: 'hello' }], model: 'test-model', timeoutMs: 2000 });
    const anthropic = new AnthropicAdapter({ ...profile, adapter: 'anthropic', baseUrl: 'https://api.anthropic.com/v1', apiKey: 'test', timeoutMs: 2000 });
    await anthropic.chat({ messages: [{ role: 'user', content: 'hello' }], model: 'test-model', timeoutMs: 2000 });
    const ollamaOpenAI = new OllamaAdapter({ ...profile, adapter: 'ollama', baseUrl: 'http://localhost:11434/v1', timeoutMs: 2000 });
    await ollamaOpenAI.chat({ messages: [{ role: 'user', content: 'hello' }], model: 'test-model', timeoutMs: 2000 });
    const geminiOpenAI = new GeminiAdapter({ ...profile, adapter: 'gemini', baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai', apiKey: 'test', timeoutMs: 2000 });
    await geminiOpenAI.chat({ messages: [{ role: 'user', content: 'hello' }], model: 'test-model', timeoutMs: 2000 });
    assert.equal(urls[0], 'http://localhost:11434/api/chat');
    assert.equal(urls[1], 'https://api.anthropic.com/v1/messages');
    assert.equal(urls[2], 'http://localhost:11434/v1/chat/completions');
    assert.equal(urls[3], 'https://generativelanguage.googleapis.com/v1beta/openai/chat/completions');
  } finally {
    globalThis.fetch = originalFetch;
  }
});
test('provider metadata exposes context length from each supported API shape', async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url) => {
    const target = String(url);
    if (target.endsWith('/v1/models')) {
      return new Response(JSON.stringify({ data: [{ id: 'openai-compatible', max_model_len: 32768 }] }), { status: 200 });
    }
    if (target.endsWith('/api/tags')) {
      return new Response(JSON.stringify({ models: [{ name: 'ollama-model' }] }), { status: 200 });
    }
    if (target.endsWith('/api/show')) {
      return new Response(JSON.stringify({ model_info: { 'llama.context_length': 16384 } }), { status: 200 });
    }
    if (target.includes('/v1beta/models')) {
      return new Response(JSON.stringify({ models: [{ name: 'models/gemini-model', inputTokenLimit: 1048576 }] }), { status: 200 });
    }
    if (target.endsWith('/v1/models?limit=1000')) {
      return new Response(JSON.stringify({ data: [{ id: 'anthropic-model', max_input_tokens: 200000 }] }), { status: 200 });
    }
    return new Response(JSON.stringify({ error: 'not found' }), { status: 404 });
  };
  try {
    const openai = await new OpenAIAdapter({
      ...profile,
      adapter: 'openai',
      baseUrl: 'http://localhost:1234/v1',
      model: 'openai-compatible'
    }).probe();
    assert.equal(openai.contextLength, 32768);

    const ollama = await new OllamaAdapter({
      ...profile,
      adapter: 'ollama',
      baseUrl: 'http://localhost:11434/api',
      model: 'ollama-model'
    }).probe();
    assert.equal(ollama.contextLength, 16384);

    const gemini = await new GeminiAdapter({
      ...profile,
      adapter: 'gemini',
      baseUrl: 'https://generativelanguage.googleapis.com',
      model: 'gemini-model'
    }).probe();
    assert.equal(gemini.contextLength, 1048576);

    const anthropic = await new AnthropicAdapter({
      ...profile,
      adapter: 'anthropic',
      baseUrl: 'https://api.anthropic.com',
      model: 'anthropic-model'
    }).probe();
    assert.equal(anthropic.contextLength, 200000);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

