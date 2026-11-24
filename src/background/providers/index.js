import { normalizeLanguage } from '../../shared/urls.js';

export class ProviderError extends Error {
  constructor(message, { kind = 'network', status = null, detail = null, retryAfterMs = null, cause = null } = {}) {
    super(message, cause ? { cause } : undefined);
    this.name = 'ProviderError';
    this.kind = kind;
    this.status = status;
    this.detail = detail;
    this.retryAfterMs = retryAfterMs;
  }
}

export function errorKindForStatus(status) {
  if (status === 401 || status === 403) return 'auth';
  if (status === 429) return 'rate-limit';
  if (status === 400 || status === 404 || status === 422) return 'bad-param';
  if (status === 408) return 'timeout';
  return 'network';
}

export function retryAfterMs(headers) {
  const value = headers?.get?.('retry-after');
  if (!value) return null;
  const seconds = Number(value);
  if (Number.isFinite(seconds)) return Math.max(0, seconds * 1000);
  const date = Date.parse(value);
  return Number.isNaN(date) ? null : Math.max(0, date - Date.now());
}

export function joinUrl(baseUrl, path) {
  const base = String(baseUrl || '').replace(/\/+$/, '');
  const suffix = String(path || '');
  if (!suffix) return base;
  return suffix.startsWith('/') ? `${base}${suffix}` : `${base}/${suffix}`;
}

export function baseUrlWithoutV1(baseUrl) {
  return String(baseUrl || '').replace(/\/+$/, '').replace(/\/v1$/i, '');
}

function ollamaApiUrl(baseUrl, path) {
  const base = String(baseUrl || '').replace(/\/+$/, '');
  const suffix = String(path || '').replace(/^\/api(?=\/)/i, '');
  return /\/api$/i.test(base) ? joinUrl(base, suffix) : joinUrl(base, path);
}

function anthropicMessagesUrl(baseUrl) {
  const base = String(baseUrl || '').replace(/\/+$/, '').replace(/\/v1$/i, '');
  return joinUrl(base, '/v1/messages');
}

export function headersForApiKey(apiKey) {
  return apiKey ? { Authorization: `Bearer ${apiKey}` } : {};
}

export function parseJsonText(text) {
  try {
    return JSON.parse(text);
  } catch (error) {
    throw new ProviderError('Endpoint returned invalid JSON', { kind: 'malformed', detail: String(text).slice(0, 500), cause: error });
  }
}

export async function readErrorResponse(response) {
  let detail = '';
  try { detail = await response.text(); } catch { /* noop */ }
  const kind = errorKindForStatus(response.status);
  let message = `HTTP ${response.status}${response.statusText ? ` ${response.statusText}` : ''}`;
  try {
    const parsed = JSON.parse(detail);
    const candidate = parsed?.error?.message ?? parsed?.error ?? parsed?.message;
    if (typeof candidate === 'string' && candidate.trim()) message = candidate.trim();
  } catch { /* keep status message */ }
  return new ProviderError(message, {
    kind,
    status: response.status,
    detail: detail ? detail.slice(0, 2000) : null,
    retryAfterMs: retryAfterMs(response.headers)
  });
}

export function createAbortContext(externalSignal, timeoutMs, defaultTimeoutMs = 120000) {
  const controller = new AbortController();
  let timedOut = false;
  let timer = null;
  const forwardAbort = () => controller.abort(externalSignal?.reason ?? new DOMException('Aborted', 'AbortError'));
  if (externalSignal) {
    if (externalSignal.aborted) forwardAbort();
    else externalSignal.addEventListener('abort', forwardAbort, { once: true });
  }
  const timeout = Number(timeoutMs) > 0 ? Number(timeoutMs) : defaultTimeoutMs;
  if (timeout > 0) {
    timer = setTimeout(() => {
      timedOut = true;
      controller.abort(new DOMException(`Request timed out after ${timeout}ms`, 'TimeoutError'));
    }, timeout);
  }
  return {
    signal: controller.signal,
    timedOut: () => timedOut,
    release() {
      if (timer) clearTimeout(timer);
      externalSignal?.removeEventListener?.('abort', forwardAbort);
    }
  };
}

export async function fetchRequest(url, options, timeoutMs, externalSignal, defaultTimeoutMs) {
  const context = createAbortContext(externalSignal, timeoutMs, defaultTimeoutMs);
  try {
    const response = await fetch(url, { ...options, signal: context.signal });
    return response;
  } catch (error) {
    if (context.timedOut()) {
      throw new ProviderError('Request timed out', { kind: 'timeout', cause: error });
    }
    if (externalSignal?.aborted) throw error;
    throw new ProviderError('Network request failed', { kind: 'network', cause: error });
  } finally {
    context.release();
  }
}

async function* parseSse(body) {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let eventName = null;
  let data = [];
  const flush = () => {
    if (!data.length && eventName === null) return null;
    const value = { event: eventName, data: data.join('\n') };
    eventName = null;
    data = [];
    return value;
  };
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      let newline;
      while ((newline = buffer.indexOf('\n')) !== -1) {
        let line = buffer.slice(0, newline);
        buffer = buffer.slice(newline + 1);
        if (line.endsWith('\r')) line = line.slice(0, -1);
        if (line === '') {
          const event = flush();
          if (event) yield event;
        } else if (!line.startsWith(':')) {
          const separator = line.indexOf(':');
          const field = separator === -1 ? line : line.slice(0, separator);
          let content = separator === -1 ? '' : line.slice(separator + 1);
          if (content.startsWith(' ')) content = content.slice(1);
          if (field === 'event') eventName = content;
          else if (field === 'data') data.push(content);
        }
      }
    }
    buffer += decoder.decode();
    if (buffer.trim()) {
      if (buffer.startsWith('data:')) data.push(buffer.slice(5).replace(/^ /, ''));
      const event = flush();
      if (event) yield event;
    }
  } finally {
    reader.releaseLock();
  }
}

export function responseFormatForOpenAI(mode) {
  if (mode === 'json_object') return { type: 'json_object' };
  if (mode === 'json_schema') {
    return {
      type: 'json_schema',
      json_schema: {
        name: 'translation_envelope',
        strict: true,
        schema: {
          type: 'object',
          properties: {
            r: {
              type: 'array',
              items: {
                type: 'object',
                properties: { i: { type: 'integer' }, t: { type: 'string' } },
                required: ['i', 't'],
                additionalProperties: false
              }
            }
          },
          required: ['r'],
          additionalProperties: false
        }
      }
    };
  }
  return undefined;
}

function parseOpenAIResponse(value) {
  if (!value || typeof value !== 'object') throw new ProviderError('Chat completion response was not a JSON object', { kind: 'malformed' });
  const choice = Array.isArray(value.choices) ? value.choices[0] : null;
  if (!choice || typeof choice !== 'object') throw new ProviderError('Chat completion response had no choices', { kind: 'malformed' });
  const message = choice.message && typeof choice.message === 'object' ? choice.message : null;
  const content = typeof message?.content === 'string'
    ? message.content
    : Array.isArray(message?.content)
      ? message.content.map((part) => typeof part?.text === 'string' ? part.text : '').join('')
      : '';
  return {
    content,
    finishReason: typeof choice.finish_reason === 'string' ? choice.finish_reason : null,
    usage: value.usage && typeof value.usage === 'object'
      ? { promptTokens: Number(value.usage.prompt_tokens) || 0, completionTokens: Number(value.usage.completion_tokens) || 0 }
      : null,
    model: typeof value.model === 'string' ? value.model : null
  };
}

function positiveInteger(...values) {
  for (const value of values) {
    const number = typeof value === 'string' ? Number.parseFloat(value) : value;
    if (Number.isFinite(number) && number > 0) return Math.floor(number);
  }
  return null;
}

function contextLengthFromMetadata(value) {
  if (!value || typeof value !== 'object') return null;
  const nestedModelInfo = [];
  if (value.model_info && typeof value.model_info === 'object') {
    for (const [key, entry] of Object.entries(value.model_info)) {
      if (/(?:^|\.)(?:context_length|max_position_embeddings|n_ctx_train)$/i.test(key)) nestedModelInfo.push(entry);
    }
  }
  return positiveInteger(
    value.context_length,
    value.contextLength,
    value.max_model_len,
    value.max_context_length,
    value.max_context_window_tokens,
    value.context_window,
    value.contextWindow,
    value.inputTokenLimit,
    value.input_token_limit,
    value.max_input_tokens,
    value.maxInputTokens,
    value.limits?.max_context_length,
    value.limits?.context_length,
    value.top_provider?.context_length,
    value.capabilities?.context_length,
    value.meta?.n_ctx_train,
    ...nestedModelInfo
  );
}

function selectedModelContextLength(models, preferredId = null) {
  const selected = preferredId ? models.find((model) => model.id === preferredId) : null;
  return selected?.contextLength ?? models[0]?.contextLength ?? null;
}

function normalizeModels(value) {
  const data = Array.isArray(value?.data) ? value.data : Array.isArray(value?.models) ? value.models : [];
  return data
    .map((entry) => entry && typeof entry === 'object' ? {
      id: entry.id ?? entry.name ?? entry.model,
      contextLength: contextLengthFromMetadata(entry)
    } : null)
    .filter((entry) => entry?.id && typeof entry.id === 'string')
    .map((entry) => ({ id: entry.id.replace(/^models\//, ''), contextLength: entry.contextLength }));
}
export class OpenAIAdapter {
  constructor(profile) {
    this.profile = profile;
    this.baseUrl = String(profile.baseUrl || '').replace(/\/+$/, '');
    this.apiKey = profile.apiKey || null;
  }

  requestUrl(path) {
    return joinUrl(this.baseUrl, path);
  }

  headers(extra = {}) {
    return {
      'Content-Type': 'application/json',
      ...headersForApiKey(this.apiKey),
      ...extra
    };
  }

  buildBody(request) {
    const mode = request.responseFormat ?? this.profile.structuredOutput;
    const responseFormat = responseFormatForOpenAI(mode);
    const body = {
      model: request.model ?? this.profile.model,
      messages: request.messages.map((message) => ({ role: message.role, content: message.content }))
    };
    if (Number.isFinite(request.maxTokens)) body.max_tokens = request.maxTokens;
    else if (Number.isFinite(this.profile.maxTokens)) body.max_tokens = this.profile.maxTokens;
    if (Number.isFinite(request.temperature)) body.temperature = request.temperature;
    else if (Number.isFinite(this.profile.temperature)) body.temperature = this.profile.temperature;
    if (responseFormat) body.response_format = responseFormat;
    if (request.extraBody && typeof request.extraBody === 'object') Object.assign(body, request.extraBody);
    if (this.profile.rawRequestJson) {
      try {
        const extra = JSON.parse(this.profile.rawRequestJson);
        if (extra && typeof extra === 'object' && !Array.isArray(extra)) Object.assign(body, extra);
      } catch { /* UI displays validation separately. */ }
    }
    return body;
  }

  async chat(request) {
    const response = await fetchRequest(
      this.requestUrl('/chat/completions'),
      { method: 'POST', headers: this.headers(), body: JSON.stringify(this.buildBody(request)) },
      request.timeoutMs ?? this.profile.timeoutMs,
      request.signal,
      this.profile.timeoutMs
    );
    if (!response.ok) throw await readErrorResponse(response);
    return parseOpenAIResponse(parseJsonText(await response.text()));
  }

  async *chatStream(request) {
    const response = await fetchRequest(
      this.requestUrl('/chat/completions'),
      {
        method: 'POST',
        headers: this.headers(),
        body: JSON.stringify({ ...this.buildBody(request), stream: true })
      },
      request.timeoutMs ?? this.profile.timeoutMs,
      request.signal,
      this.profile.timeoutMs
    );
    if (!response.ok) throw await readErrorResponse(response);
    if (!response.body) throw new ProviderError('Streaming response had no body', { kind: 'malformed' });
    for await (const event of parseSse(response.body)) {
      if (!event.data || event.data === '[DONE]') continue;
      let value;
      try { value = JSON.parse(event.data); } catch { continue; }
      const delta = value?.choices?.[0]?.delta?.content;
      if (typeof delta === 'string' && delta) yield { delta, usage: value.usage ?? null };
    }
  }

  async listModels(options = {}) {
    const response = await fetchRequest(
      this.requestUrl('/models'),
      { method: 'GET', headers: this.headers() },
      options.timeoutMs ?? this.profile.timeoutMs,
      options.signal,
      this.profile.timeoutMs
    );
    if (!response.ok) throw await readErrorResponse(response);
    return normalizeModels(parseJsonText(await response.text()));
  }

  async probe(options = {}) {
    const started = performance.now();
    const models = await this.listModels(options);
    let contextLength = selectedModelContextLength(models, this.profile.model);
    if (!contextLength && this.profile.model) {
      try {
        const response = await fetchRequest(
          this.requestUrl(`/models/${encodeURIComponent(this.profile.model)}`),
          { method: 'GET', headers: this.headers() },
          options.timeoutMs ?? this.profile.timeoutMs,
          options.signal,
          this.profile.timeoutMs
        );
        if (response.ok) contextLength = contextLengthFromMetadata(await response.json());
      } catch { /* Model detail endpoints are optional. */ }
    }
    return {
      models,
      contextLength,
      structuredOutput: 'prompt-only',
      streaming: true,
      reasoning: { mechanism: 'none', values: null },
      latencyMs: performance.now() - started
    };
  }
}
export class LlamaCppAdapter extends OpenAIAdapter {
  propUrl() {
    return `${baseUrlWithoutV1(this.baseUrl)}/props`;
  }

  buildBody(request) {
    const body = super.buildBody(request);
    body.chat_template_kwargs = { enable_thinking: request.reasoningEffort !== 'off' };
    if (request.reasoningEffort && request.reasoningEffort !== 'off') body.reasoning_effort = request.reasoningEffort;
    return body;
  }

  async probe(options = {}) {
    const started = performance.now();
    const [models, props] = await Promise.all([
      this.listModels(options).catch(() => []),
      fetchRequest(this.propUrl(), { method: 'GET' }, options.timeoutMs ?? this.profile.timeoutMs, options.signal, this.profile.timeoutMs)
        .then((response) => response.ok ? response.json() : null)
        .catch(() => null)
    ]);
    const contextLength = Number(props?.default_generation_settings?.n_ctx) || selectedModelContextLength(models, this.profile.model);
    return {
      models,
      contextLength,
      structuredOutput: 'json_schema',
      streaming: true,
      reasoning: { mechanism: 'chat-template-kwargs', values: null },
      latencyMs: performance.now() - started
    };
  }
}

export class VllmAdapter extends OpenAIAdapter {
  buildBody(request) {
    const body = super.buildBody(request);
    body.chat_template_kwargs = { enable_thinking: request.reasoningEffort !== 'off' };
    if (request.reasoningEffort && request.reasoningEffort !== 'off') body.reasoning_effort = request.reasoningEffort;
    return body;
  }
}

export class SglangAdapter extends OpenAIAdapter {
  buildBody(request) {
    const body = super.buildBody(request);
    body.chat_template_kwargs = { enable_thinking: request.reasoningEffort !== 'off' };
    if (request.reasoningEffort && request.reasoningEffort !== 'off') body.reasoning_effort = request.reasoningEffort;
    body.separate_reasoning = true;
    return body;
  }

  parseResponse(value) {
    return parseOpenAIResponse(value);
  }
}

export class OllamaAdapter {
  constructor(profile) {
    this.profile = profile;
    this.baseUrl = String(profile.baseUrl || '').replace(/\/+$/, '');
    this.apiKey = profile.apiKey || null;
  }

  headers() {
    return { 'Content-Type': 'application/json', ...headersForApiKey(this.apiKey) };
  }

  usesOpenAICompatibility() {
    return /\/v1$/i.test(this.baseUrl);
  }

  openAIAdapter() {
    return new OpenAIAdapter({ ...this.profile, adapter: 'openai', baseUrl: this.baseUrl });
  }

  async showModel(model, options = {}, baseUrl = this.baseUrl) {
    if (!model) return null;
    try {
      const response = await fetchRequest(
        ollamaApiUrl(baseUrl, '/api/show'),
        { method: 'POST', headers: this.headers(), body: JSON.stringify({ model }) },
        options.timeoutMs ?? this.profile.timeoutMs,
        options.signal,
        this.profile.timeoutMs
      );
      return response.ok ? await response.json() : null;
    } catch {
      return null;
    }
  }

  buildBody(request, stream = false) {
    const body = {
      model: request.model ?? this.profile.model,
      messages: request.messages.map((message) => ({ role: message.role, content: message.content })),
      stream
    };
    const options = {};
    if (Number.isFinite(request.maxTokens)) options.num_predict = request.maxTokens;
    else if (Number.isFinite(this.profile.maxTokens)) options.num_predict = this.profile.maxTokens;
    if (Number.isFinite(request.temperature)) options.temperature = request.temperature;
    else if (Number.isFinite(this.profile.temperature)) options.temperature = this.profile.temperature;
    if (Object.keys(options).length) body.options = options;
    if (request.reasoningEffort && request.reasoningEffort !== 'off') body.think = request.reasoningEffort;
    if (request.extraBody && typeof request.extraBody === 'object') Object.assign(body, request.extraBody);
    return body;
  }

  parse(value) {
    if (!value || typeof value !== 'object') throw new ProviderError('Ollama response was not a JSON object', { kind: 'malformed' });
    const content = value?.message?.content ?? value?.response ?? '';
    return {
      content: typeof content === 'string' ? content : '',
      finishReason: value.done ? 'stop' : null,
      usage: value.eval_count || value.prompt_eval_count
        ? { promptTokens: Number(value.prompt_eval_count) || 0, completionTokens: Number(value.eval_count) || 0 }
        : null,
      model: typeof value.model === 'string' ? value.model : null
    };
  }

  async chat(request) {
    if (this.usesOpenAICompatibility()) return this.openAIAdapter().chat(request);
    const response = await fetchRequest(
      ollamaApiUrl(this.baseUrl, '/api/chat'),
      { method: 'POST', headers: this.headers(), body: JSON.stringify(this.buildBody(request, false)) },
      request.timeoutMs ?? this.profile.timeoutMs,
      request.signal,
      this.profile.timeoutMs
    );
    if (!response.ok) throw await readErrorResponse(response);
    return this.parse(parseJsonText(await response.text()));
  }

  async *chatStream(request) {
    if (this.usesOpenAICompatibility()) {
      for await (const chunk of this.openAIAdapter().chatStream(request)) yield chunk;
      return;
    }
    const response = await fetchRequest(
      ollamaApiUrl(this.baseUrl, '/api/chat'),
      { method: 'POST', headers: this.headers(), body: JSON.stringify(this.buildBody(request, true)) },
      request.timeoutMs ?? this.profile.timeoutMs,
      request.signal,
      this.profile.timeoutMs
    );
    if (!response.ok) throw await readErrorResponse(response);
    if (!response.body) throw new ProviderError('Streaming response had no body', { kind: 'malformed' });
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    try {
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        let newline;
        while ((newline = buffer.indexOf('\n')) !== -1) {
          const line = buffer.slice(0, newline).trim();
          buffer = buffer.slice(newline + 1);
          if (!line) continue;
          try { yield this.parse(JSON.parse(line)); } catch { /* ignore malformed chunk */ }
        }
      }
    } finally {
      reader.releaseLock();
    }
  }

  async listModels(options = {}) {
    if (this.usesOpenAICompatibility()) return this.openAIAdapter().listModels(options);
    const response = await fetchRequest(
      ollamaApiUrl(this.baseUrl, '/api/tags'),
      { method: 'GET', headers: this.headers() },
      options.timeoutMs ?? this.profile.timeoutMs,
      options.signal,
      this.profile.timeoutMs
    );
    if (!response.ok) throw await readErrorResponse(response);
    const value = parseJsonText(await response.text());
    const entries = Array.isArray(value?.models) ? value.models : [];
    return entries.filter((entry) => entry && typeof entry.name === 'string').map((entry) => ({ id: entry.name, contextLength: contextLengthFromMetadata(entry) }));
  }

  async probe(options = {}) {
    const started = performance.now();
    let models = [];
    let contextLength = null;
    let thinkingValues = null;
    if (this.usesOpenAICompatibility()) {
      const compatible = await this.openAIAdapter().probe(options);
      models = compatible.models ?? [];
      contextLength = compatible.contextLength ?? selectedModelContextLength(models, this.profile.model);
    } else {
      models = await this.listModels(options).catch(() => []);
      contextLength = selectedModelContextLength(models, this.profile.model);
    }
    const model = this.profile.model ?? models[0]?.id ?? null;
    const details = await this.showModel(model, options, this.baseUrl.replace(/\/v1$/i, ''));
    if (details) {
      contextLength = contextLengthFromMetadata(details) ?? contextLength;
      if (Array.isArray(details?.thinking?.values)) thinkingValues = details.thinking.values.filter((item) => typeof item === 'string');
    }
    return {
      models,
      contextLength,
      structuredOutput: 'prompt-only',
      streaming: true,
      reasoning: { mechanism: 'ollama-think', values: thinkingValues },
      latencyMs: performance.now() - started
    };
  }
}

function anthropicHeaders(apiKey) {
  return {
    'Content-Type': 'application/json',
    'anthropic-version': '2023-06-01',
    ...apiKey ? { 'x-api-key': apiKey } : {}
  };
}

function splitSystemMessages(messages) {
  const system = [];
  const rest = [];
  for (const message of messages) {
    if (message.role === 'system') system.push(message.content);
    else rest.push({ role: message.role, content: message.content });
  }
  return { system: system.length ? system.join('\n\n') : null, messages: rest };
}

function anthropicModelsUrl(baseUrl) {
  const base = String(baseUrl || '').replace(/\/+$/, '').replace(/\/v1$/i, '');
  const url = new URL(joinUrl(base, '/v1/models'));
  url.searchParams.set('limit', '1000');
  return url.toString();
}

export class AnthropicAdapter {
  constructor(profile) {
    this.profile = profile;
    this.baseUrl = String(profile.baseUrl || '').replace(/\/+$/, '');
    this.apiKey = profile.apiKey || null;
  }

  buildBody(request, stream = false) {
    const { system, messages } = splitSystemMessages(request.messages);
    const body = {
      model: request.model ?? this.profile.model,
      max_tokens: request.maxTokens ?? this.profile.maxTokens ?? 4096,
      messages,
      ...system ? { system } : {},
      ...Number.isFinite(request.temperature) ? { temperature: request.temperature } : {},
      ...stream ? { stream: true } : {}
    };
    if (request.reasoningEffort && request.reasoningEffort !== 'off') {
      const budget = { low: 1024, medium: 4096, high: 16000, max: 32000 }[request.reasoningEffort] ?? 4096;
      body.thinking = { type: 'enabled', budget_tokens: budget };
    }
    if (request.extraBody && typeof request.extraBody === 'object') Object.assign(body, request.extraBody);
    return body;
  }

  parse(value) {
    if (!value || typeof value !== 'object') throw new ProviderError('Anthropic response was not a JSON object', { kind: 'malformed' });
    const content = Array.isArray(value.content)
      ? value.content.filter((part) => part?.type === 'text' && typeof part.text === 'string').map((part) => part.text).join('')
      : '';
    return {
      content,
      finishReason: typeof value.stop_reason === 'string' ? value.stop_reason : null,
      usage: value.usage ? { promptTokens: Number(value.usage.input_tokens) || 0, completionTokens: Number(value.usage.output_tokens) || 0 } : null,
      model: typeof value.model === 'string' ? value.model : null
    };
  }

  async chat(request) {
    const response = await fetchRequest(
      anthropicMessagesUrl(this.baseUrl),
      { method: 'POST', headers: anthropicHeaders(this.apiKey), body: JSON.stringify(this.buildBody(request)) },
      request.timeoutMs ?? this.profile.timeoutMs,
      request.signal,
      this.profile.timeoutMs
    );
    if (!response.ok) throw await readErrorResponse(response);
    return this.parse(parseJsonText(await response.text()));
  }

  async *chatStream(request) {
    const response = await fetchRequest(
      anthropicMessagesUrl(this.baseUrl),
      { method: 'POST', headers: anthropicHeaders(this.apiKey), body: JSON.stringify(this.buildBody(request, true)) },
      request.timeoutMs ?? this.profile.timeoutMs,
      request.signal,
      this.profile.timeoutMs
    );
    if (!response.ok) throw await readErrorResponse(response);
    if (!response.body) throw new ProviderError('Anthropic streaming response had no body', { kind: 'malformed' });
    for await (const event of parseSse(response.body)) {
      if (!event.data || event.data === '[DONE]') continue;
      let value;
      try { value = JSON.parse(event.data); } catch { continue; }
      if (value.type === 'content_block_delta' && value.delta?.type === 'text_delta' && typeof value.delta.text === 'string') {
        yield { delta: value.delta.text, usage: null };
      }
    }
  }

  async listModels(options = {}) {
    const response = await fetchRequest(
      anthropicModelsUrl(this.baseUrl),
      { method: 'GET', headers: anthropicHeaders(this.apiKey) },
      options.timeoutMs ?? this.profile.timeoutMs,
      options.signal,
      this.profile.timeoutMs
    );
    if (!response.ok) throw await readErrorResponse(response);
    const value = parseJsonText(await response.text());
    return Array.isArray(value?.data)
      ? value.data.filter((model) => model && typeof model.id === 'string').map((model) => ({
        id: model.id,
        contextLength: contextLengthFromMetadata(model)
      }))
      : [];
  }

  async probe(options = {}) {
    const started = performance.now();
    const models = await this.listModels(options).catch(() => []);
    return {
      models,
      contextLength: selectedModelContextLength(models, this.profile.model),
      structuredOutput: 'prompt-only',
      streaming: true,
      reasoning: { mechanism: 'anthropic-budget', values: null },
      latencyMs: performance.now() - started
    };
  }
}

function geminiUrl(baseUrl, path, apiKey) {
  const base = String(baseUrl || '').replace(/\/+$/, '').replace(/\/v1beta$/i, '');
  const url = new URL(joinUrl(base, path));
  if (apiKey) url.searchParams.set('key', apiKey);
  return url.toString();
}

function geminiContents(messages) {
  const system = [];
  const contents = [];
  for (const message of messages) {
    if (message.role === 'system') system.push(message.content);
    else contents.push({ role: message.role === 'assistant' ? 'model' : 'user', parts: [{ text: message.content }] });
  }
  return { system, contents };
}

export class GeminiAdapter {
  constructor(profile) {
    this.profile = profile;
    this.baseUrl = String(profile.baseUrl || '').replace(/\/+$/, '');
    this.apiKey = profile.apiKey || null;
  }

  usesOpenAICompatibility() {
    return /\/v1beta\/openai$/i.test(this.baseUrl);
  }

  openAIAdapter() {
    return new OpenAIAdapter({ ...this.profile, adapter: 'openai', baseUrl: this.baseUrl });
  }

  buildBody(request) {
    const { system, contents } = geminiContents(request.messages);
    const generationConfig = {};
    if (Number.isFinite(request.maxTokens ?? this.profile.maxTokens)) generationConfig.maxOutputTokens = request.maxTokens ?? this.profile.maxTokens;
    if (Number.isFinite(request.temperature ?? this.profile.temperature)) generationConfig.temperature = request.temperature ?? this.profile.temperature;
    if (request.responseFormat === 'json_object') generationConfig.responseMimeType = 'application/json';
    if (request.responseFormat === 'json_schema') {
      generationConfig.responseMimeType = 'application/json';
      generationConfig.responseSchema = request.responseSchema ?? undefined;
    }
    if (request.reasoningEffort && request.reasoningEffort !== 'off') {
      generationConfig.thinkingConfig = {
        thinkingBudget: { low: 1024, medium: 4096, high: 16000, max: 32000 }[request.reasoningEffort] ?? 4096
      };
    }
    return {
      contents,
      ...system.length ? { systemInstruction: { parts: [{ text: system.join('\n\n') }] } } : {},
      ...Object.keys(generationConfig).length ? { generationConfig } : {},
      ...request.extraBody && typeof request.extraBody === 'object' ? request.extraBody : {}
    };
  }

  parse(value) {
    const content = Array.isArray(value?.candidates?.[0]?.content?.parts)
      ? value.candidates[0].content.parts.map((part) => typeof part?.text === 'string' ? part.text : '').join('')
      : '';
    return {
      content,
      finishReason: value?.candidates?.[0]?.finishReason ?? null,
      usage: value?.usageMetadata ? {
        promptTokens: Number(value.usageMetadata.promptTokenCount) || 0,
        completionTokens: Number(value.usageMetadata.candidatesTokenCount) || 0
      } : null,
      model: typeof value?.modelVersion === 'string' ? value.modelVersion : null
    };
  }

  async chat(request) {
    if (this.usesOpenAICompatibility()) return this.openAIAdapter().chat(request);
    const model = String(request.model ?? this.profile.model ?? '').replace(/^models\//, '');
    const response = await fetchRequest(
      geminiUrl(this.baseUrl, `/v1beta/models/${encodeURIComponent(model)}:generateContent`, this.apiKey),
      { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(this.buildBody(request)) },
      request.timeoutMs ?? this.profile.timeoutMs,
      request.signal,
      this.profile.timeoutMs
    );
    if (!response.ok) throw await readErrorResponse(response);
    return this.parse(parseJsonText(await response.text()));
  }

  async *chatStream(request) {
    if (this.usesOpenAICompatibility()) {
      for await (const chunk of this.openAIAdapter().chatStream(request)) yield chunk;
      return;
    }
    const model = String(request.model ?? this.profile.model ?? '').replace(/^models\//, '');
    const url = geminiUrl(this.baseUrl, `/v1beta/models/${encodeURIComponent(model)}:streamGenerateContent`, this.apiKey);
    const parsed = new URL(url);
    parsed.searchParams.set('alt', 'sse');
    const response = await fetchRequest(
      parsed.toString(),
      { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(this.buildBody(request)) },
      request.timeoutMs ?? this.profile.timeoutMs,
      request.signal,
      this.profile.timeoutMs
    );
    if (!response.ok) throw await readErrorResponse(response);
    if (!response.body) throw new ProviderError('Gemini streaming response had no body', { kind: 'malformed' });
    for await (const event of parseSse(response.body)) {
      if (!event.data || event.data === '[DONE]') continue;
      let value;
      try { value = JSON.parse(event.data); } catch { continue; }
      const result = this.parse(value);
      if (result.content) yield { delta: result.content, usage: result.usage };
    }
  }

  async listModels(options = {}) {
    if (this.usesOpenAICompatibility()) return this.openAIAdapter().listModels(options);
    const response = await fetchRequest(
      geminiUrl(this.baseUrl, '/v1beta/models', this.apiKey),
      { method: 'GET', headers: { 'Content-Type': 'application/json' } },
      options.timeoutMs ?? this.profile.timeoutMs,
      options.signal,
      this.profile.timeoutMs
    );
    if (!response.ok) throw await readErrorResponse(response);
    const value = parseJsonText(await response.text());
    return Array.isArray(value?.models)
      ? value.models.filter((model) => typeof model?.name === 'string').map((model) => ({ id: model.name.replace(/^models\//, ''), contextLength: contextLengthFromMetadata(model) }))
      : [];
  }

  async probe(options = {}) {
    const started = performance.now();
    if (this.usesOpenAICompatibility()) {
      const compatible = await this.openAIAdapter().probe(options);
      let contextLength = compatible.contextLength ?? selectedModelContextLength(compatible.models ?? [], this.profile.model);
      if (!contextLength) {
        try {
          const nativeBase = this.baseUrl.replace(/\/v1beta\/openai$/i, '');
          const nativeModels = await new GeminiAdapter({ ...this.profile, baseUrl: nativeBase }).listModels(options);
          contextLength = selectedModelContextLength(nativeModels, this.profile.model);
        } catch { /* Native metadata endpoint is optional. */ }
      }
      return { ...compatible, contextLength, latencyMs: performance.now() - started };
    }
    const models = await this.listModels(options).catch(() => []);
    return {
      models,
      contextLength: selectedModelContextLength(models, this.profile.model),
      structuredOutput: 'json_schema',
      streaming: true,
      reasoning: { mechanism: 'gemini-thinking-budget', values: null },
      latencyMs: performance.now() - started
    };
  }
}

export function createAdapter(profile) {
  switch (profile.adapter) {
    case 'llamacpp': return new LlamaCppAdapter(profile);
    case 'ollama': return new OllamaAdapter(profile);
    case 'vllm': return new VllmAdapter(profile);
    case 'sglang': return new SglangAdapter(profile);
    case 'anthropic': return new AnthropicAdapter(profile);
    case 'gemini': return new GeminiAdapter(profile);
    case 'openai':
    default: return new OpenAIAdapter(profile);
  }
}

export function profilesForRole(settings, role) {
  return settings.providers.profiles.filter((profile) => profile.role === role);
}

export function primaryProfile(settings, role = 'primary', preferredId = null) {
  const allProfiles = settings.providers.profiles;
  if (preferredId) {
    const preferred = allProfiles.find((profile) => profile.id === preferredId);
    if (preferred) return preferred;
  }
  if (role === 'primary' && settings.providers.selectedProfileId) {
    const selected = allProfiles.find((profile) => profile.id === settings.providers.selectedProfileId);
    if (selected) return selected;
  }
  const profiles = profilesForRole(settings, role);
  return profiles[0] ?? allProfiles[0] ?? null;
}

export function fallbackProfile(settings, primaryId = null) {
  const profiles = profilesForRole(settings, 'fallback');
  return profiles.find((profile) => profile.id !== primaryId) ?? null;
}

export function reasoningEffort(profile) {
  if (profile.reasoning?.mode === 'custom' && profile.reasoning?.effort) return profile.reasoning.effort;
  if (profile.reasoning?.mode === 'default') return 'medium';
  return 'off';
}

export async function probeProfile(profile) {
  const adapter = createAdapter(profile);
  const probe = await adapter.probe();
  const model = profile.model ?? probe.models?.[0]?.id ?? null;
  const capability = {
    profileId: profile.id,
    probedAt: Date.now(),
    models: probe.models ?? [],
    contextLength: probe.contextLength ?? profile.contextLength ?? null,
    structuredOutput: probe.structuredOutput ?? 'prompt-only',
    streaming: probe.streaming ?? true,
    reasoning: probe.reasoning ?? { mechanism: 'none', values: null },
    latencyMs: Math.round(probe.latencyMs ?? 0),
    tokensPerSecond: null,
    model,
    connectionOk: false,
    completionError: null
  };
  if (model) {
    try {
      const request = {
        model,
        messages: [{ role: 'user', content: 'Reply with the single word: ok' }],
        maxTokens: 16,
        timeoutMs: profile.timeoutMs
      };
      const started = performance.now();
      const result = await adapter.chat(request);
      const duration = performance.now() - started;
      capability.connectionOk = true;
      if (result.usage?.completionTokens > 0 && duration > 0) {
        capability.tokensPerSecond = result.usage.completionTokens / (duration / 1000);
      }
    } catch (error) {
      capability.completionError = error instanceof Error ? error.message : String(error);
    }
  } else {
    capability.connectionOk = capability.models.length > 0 || capability.contextLength !== null;
    if (!capability.connectionOk) capability.completionError = 'No model is selected or returned by the endpoint.';
  }
  return capability;
}

export async function testConnection(profile) {
  const started = performance.now();
  const capability = await probeProfile(profile);
  if (!capability.connectionOk) {
    throw new ProviderError(capability.completionError || 'Provider test completed without a successful inference', {
      kind: 'network',
      detail: `Profile ${profile.id} did not complete the minimal inference probe.`
    });
  }
  return {
    ok: true,
    latencyMs: Math.round(performance.now() - started),
    capabilities: capability
  };
}




