import http from 'node:http';

const port = Number(process.env.PORT || 8080);
const host = '::';

function sendJson(response, status, value) {
  const body = JSON.stringify(value);
  response.writeHead(status, {
    'Content-Type': 'application/json',
    'Content-Length': Buffer.byteLength(body),
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': '*',
    'Access-Control-Allow-Methods': 'GET,POST,OPTIONS'
  });
  response.end(body);
}

function translationRows(body) {
  const messages = Array.isArray(body?.messages) ? body.messages : [];
  const user = [...messages].reverse().find((message) => message?.role === 'user');
  try {
    const payload = JSON.parse(user?.content || '{}');
    const segments = Array.isArray(payload.segments) ? payload.segments : [];
    return segments.map((segment) => ({ i: segment.i, t: `【测试译文】${segment.t}` }));
  } catch {
    return [];
  }
}

const server = http.createServer(async (request, response) => {
  if (request.method === 'OPTIONS') {
    response.writeHead(204, {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Headers': '*',
      'Access-Control-Allow-Methods': 'GET,POST,OPTIONS'
    });
    response.end();
    return;
  }

  if (request.method === 'GET' && request.url === '/v1/models') {
    sendJson(response, 200, { object: 'list', data: [{ id: 'mock-translator', object: 'model' }] });
    return;
  }

  if (request.method === 'POST' && request.url === '/v1/chat/completions') {
    let raw = '';
    for await (const chunk of request) raw += chunk;
    let body = {};
    try { body = JSON.parse(raw); } catch { /* handled below */ }
    const rows = translationRows(body);
    const content = JSON.stringify({ r: rows });
    console.log(`translate request: ${rows.length} segments, stream=${Boolean(body.stream)}`);

    if (body.stream) {
      response.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        Connection: 'keep-alive',
        'Access-Control-Allow-Origin': '*'
      });
      response.write(`data: ${JSON.stringify({ choices: [{ delta: { content } }] })}\n\n`);
      response.write('data: [DONE]\n\n');
      response.end();
      return;
    }

    sendJson(response, 200, {
      id: 'mock-completion',
      object: 'chat.completion',
      model: body.model || 'mock-translator',
      choices: [{ index: 0, message: { role: 'assistant', content }, finish_reason: 'stop' }],
      usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 }
    });
    return;
  }

  sendJson(response, 404, { error: { message: 'Not found' } });
});

server.listen(port, host, () => console.log(`mock OpenAI server listening on http://${host}:${port}/v1`));