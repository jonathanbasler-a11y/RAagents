#!/usr/bin/env node
// A local stand-in for an OpenAI-compatible chat-completions endpoint, for tests and
// end-to-end runs. It is NOT a model: every reply says it comes from this fake.
//
//   npm run fake-llm -- [--port=4011] [--host=127.0.0.1] [--delay-ms=15]
//                       [--slow-delay-ms=1000] [--no-addition=Carlos,Lena]
//   (env: FAKE_LLM_PORT, FAKE_LLM_HOST, FAKE_LLM_DELAY_MS, FAKE_LLM_SLOW_DELAY_MS,
//    FAKE_LLM_NO_ADDITION)
//
// Point the app at it with fake values only, on the command line:
//   LLM_BASE_URL=http://127.0.0.1:4011/v1 LLM_API_KEY=fake-key LLM_MODEL=fake-model
//
// - Keys must start with "fake" (Bearer, or any *key*/*token*/*auth* header).
// - Plain and streaming replies. Streams send a role chunk, text chunks with a delay, a
//   finish chunk, a usage chunk with empty choices, then [DONE].
// - Modes chosen by the model name: fail-500, fail-429, fail-401, fail-model, slow,
//   truncate (finish_reason "length"), break (stream ends without [DONE]), empty.
// - Agents named in --no-addition reply exactly NO_ADDITION. The agent is read from
//   the brief line "You are <Name>. Your capability: ..." of the system prompt.
// - gpt-* models refuse max_tokens, as the real backend does.
// Tests use createFakeLlm(...).handle(request) in-process, with no socket.

import { createServer } from 'node:http';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

export const NO_ADDITION = 'NO_ADDITION';

const DEFAULTS = Object.freeze({ port: 4011, host: '127.0.0.1', delayMs: 15, slowDelayMs: 1000, noAddition: [] });
const MODES = ['fail-500', 'fail-429', 'fail-401', 'fail-model', 'slow', 'truncate', 'break', 'empty'];
const WORDS_PER_CHUNK = 4;

const encoder = new TextEncoder();

/** @param {unknown} body @param {number} [status] @param {Record<string, string>} [headers] */
function jsonResponse(body, status = 200, headers = {}) {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', ...headers } });
}

/** @param {string} message @param {string} type @param {number} status @param {Record<string, string>} [extra] */
function errorResponse(message, type, status, extra = {}) {
  return jsonResponse({ error: { message, type, ...extra } }, status);
}

/** @param {Headers} headers */
function hasFakeKey(headers) {
  const authorization = headers.get('authorization');
  if (authorization && /^bearer\s+fake/i.test(authorization)) return true;
  for (const [name, value] of headers) {
    if (name !== 'authorization' && /key|token|auth/i.test(name) && /^fake/i.test(value)) return true;
  }
  return false;
}

/** @param {string} model */
function modeOf(model) {
  return MODES.find((mode) => model.includes(mode)) ?? 'normal';
}

/**
 * The agent's first name, from the brief line "You are <Name>. Your capability: ...". The
 * shared rules before the brief also contain lines that start with "You are".
 * @param {unknown[]} messages
 */
function agentName(messages) {
  const system = messages.find((message) => message && typeof message === 'object' && message.role === 'system');
  const match = typeof system?.content === 'string' ? /^You are ([^.\n]{1,40})\. Your capability:/m.exec(system.content) : null;
  return match ? match[1].trim() : 'the agent';
}

/** @param {unknown[]} messages */
function lastQuestion(messages) {
  const users = messages.filter((message) => message && typeof message === 'object' && message.role === 'user');
  const content = users.at(-1)?.content;
  const text = typeof content === 'string' ? content.replace(/\s+/g, ' ').trim() : '';
  return text.length > 120 ? `${text.slice(0, 117)}...` : text;
}

/** @param {string} name @param {string} question */
function replyText(name, question) {
  return (
    `Fake reply from ${name}: this is a stand-in answer from the local fake model (scripts/fake-llm.mjs), not a real model. ` +
    `A real agent would lead with its answer, list what to check and mark open points "to verify". ` +
    `Question received: "${question}".`
  );
}

/** @param {string} text */
function chunksOf(text) {
  const words = text.split(' ');
  const chunks = [];
  for (let index = 0; index < words.length; index += WORDS_PER_CHUNK) {
    const last = index + WORDS_PER_CHUNK >= words.length;
    chunks.push(words.slice(index, index + WORDS_PER_CHUNK).join(' ') + (last ? '' : ' '));
  }
  return chunks;
}

/**
 * The fake endpoint as a fetch-style handler.
 * @param {{ delayMs?: number, slowDelayMs?: number, noAddition?: string[], sleep?: (ms: number) => Promise<void>, log?: (line: string) => void }} [options]
 */
export function createFakeLlm(options = {}) {
  const delayMs = options.delayMs ?? DEFAULTS.delayMs;
  const slowDelayMs = options.slowDelayMs ?? DEFAULTS.slowDelayMs;
  const quiet = new Set((options.noAddition ?? []).map((name) => name.trim().toLowerCase()).filter(Boolean));
  const sleep = options.sleep ?? ((ms) => new Promise((done) => setTimeout(done, ms)));
  const log = options.log ?? (() => {});
  let counter = 0;

  /** @param {Request} request @returns {Promise<Response>} */
  async function handle(request) {
    const url = new URL(request.url);
    if (request.method === 'GET' && (url.pathname === '/' || url.pathname === '/health')) {
      return new Response('fake LLM: ok\n', { status: 200, headers: { 'content-type': 'text/plain' } });
    }
    if (request.method !== 'POST' || !url.pathname.endsWith('/chat/completions')) {
      return errorResponse(`no route for ${request.method} ${url.pathname}`, 'not_found', 404);
    }
    if (!hasFakeKey(request.headers)) return errorResponse('invalid api key: this fake accepts only keys that start with "fake"', 'authentication_error', 401);

    let body;
    try {
      body = await request.json();
    } catch {
      return errorResponse('the request body is not JSON', 'invalid_request_error', 400);
    }
    if (!body || typeof body !== 'object' || typeof body.model !== 'string' || !Array.isArray(body.messages)) {
      return errorResponse('the request needs a model and a messages list', 'invalid_request_error', 400);
    }
    const { model, messages } = body;
    if (/^gpt-/i.test(model) && body.max_tokens !== undefined) {
      return errorResponse("This model rejects max_tokens; send max_completion_tokens (fake gateway).", 'invalid_request_error', 400, {
        param: 'max_tokens',
        code: 'unsupported_parameter',
      });
    }

    const mode = modeOf(model);
    log(`[fake-llm] ${request.method} ${url.pathname} model=${model} mode=${mode} stream=${body.stream === true}`);
    if (mode === 'fail-500') return errorResponse('the fake endpoint failed on purpose (fail-500)', 'server_error', 500);
    if (mode === 'fail-429') return jsonResponse({ error: { message: 'rate limited on purpose (fail-429)', type: 'rate_limit_error' } }, 429, { 'retry-after': '1' });
    if (mode === 'fail-401') return errorResponse('the key was refused on purpose (fail-401)', 'authentication_error', 401);
    if (mode === 'fail-model') {
      return errorResponse(`The model \`${model}\` does not exist or you do not have access to it.`, 'invalid_request_error', 404, { code: 'model_not_found' });
    }

    const name = agentName(messages);
    const text = mode === 'empty' ? '' : quiet.has(name.toLowerCase()) ? NO_ADDITION : replyText(name, lastQuestion(messages));
    const finishReason = mode === 'truncate' ? 'length' : 'stop';
    counter += 1;
    const id = `chatcmpl-fake-${counter}`;
    const created = Math.floor(Date.now() / 1000);
    const usage = { prompt_tokens: 100, completion_tokens: Math.ceil(text.length / 4), total_tokens: 100 + Math.ceil(text.length / 4) };

    if (body.stream !== true) {
      return jsonResponse({
        id,
        object: 'chat.completion',
        created,
        model,
        choices: [{ index: 0, message: { role: 'assistant', content: text }, finish_reason: finishReason }],
        usage,
      });
    }

    const chunk = (delta, finish = null) =>
      `data: ${JSON.stringify({ id, object: 'chat.completion.chunk', created, model, choices: [{ index: 0, delta, finish_reason: finish }] })}\n\n`;
    const pieces = text === '' ? [] : chunksOf(text);
    const sendable = mode === 'break' ? pieces.slice(0, Math.max(1, Math.floor(pieces.length / 2))) : pieces;
    const wait = mode === 'slow' ? slowDelayMs : delayMs;
    const parts = [
      () => chunk({ role: 'assistant' }),
      ...sendable.map((piece) => async () => {
        await sleep(wait);
        return chunk({ content: piece });
      }),
      ...(mode === 'break'
        ? []
        : [
            () => chunk({}, finishReason),
            () => `data: ${JSON.stringify({ id, object: 'chat.completion.chunk', created, model, choices: [], usage })}\n\n`,
            () => 'data: [DONE]\n\n',
          ]),
    ];
    let next = 0;
    const stream = new ReadableStream({
      async pull(controller) {
        if (next >= parts.length) {
          controller.close();
          return;
        }
        const part = await parts[next]();
        next += 1;
        controller.enqueue(encoder.encode(part));
      },
    });
    return new Response(stream, { status: 200, headers: { 'content-type': 'text/event-stream', 'cache-control': 'no-cache' } });
  }

  return { handle };
}

/**
 * Settings from flags, then env, then defaults.
 * @param {string[]} argv @param {Record<string, string | undefined>} env
 */
export function parseArgs(argv, env) {
  const flags = new Map();
  for (const arg of argv) {
    const match = /^--(port|host|delay-ms|slow-delay-ms|no-addition)=(.*)$/.exec(arg);
    if (!match) throw new Error(`unknown option ${arg}`);
    flags.set(match[1], match[2]);
  }
  const pick = (flag, envName) => flags.get(flag) ?? env[envName];
  const number = (flag, envName, fallback, max) => {
    const raw = pick(flag, envName);
    if (raw === undefined || raw.trim() === '') return fallback;
    const value = Number(raw);
    if (!Number.isInteger(value) || value < 0 || value > max) throw new Error(`${flag.replace(/-/g, ' ')} must be a whole number from 0 to ${max}; got "${raw}"`);
    return value;
  };
  const list = pick('no-addition', 'FAKE_LLM_NO_ADDITION');
  return {
    port: number('port', 'FAKE_LLM_PORT', DEFAULTS.port, 65535),
    host: pick('host', 'FAKE_LLM_HOST')?.trim() || DEFAULTS.host,
    delayMs: number('delay-ms', 'FAKE_LLM_DELAY_MS', DEFAULTS.delayMs, 60_000),
    slowDelayMs: number('slow-delay-ms', 'FAKE_LLM_SLOW_DELAY_MS', DEFAULTS.slowDelayMs, 600_000),
    noAddition: list === undefined ? [] : list.split(',').map((name) => name.trim()).filter(Boolean),
  };
}

/** @param {import('node:http').IncomingMessage} incoming @param {string} base */
async function toRequest(incoming, base) {
  const chunks = [];
  for await (const chunk of incoming) chunks.push(chunk);
  const headers = new Headers();
  for (const [name, value] of Object.entries(incoming.headers)) {
    if (Array.isArray(value)) value.forEach((item) => headers.append(name, item));
    else if (value !== undefined) headers.set(name, value);
  }
  const method = incoming.method ?? 'GET';
  return new Request(new URL(incoming.url ?? '/', base), {
    method,
    headers,
    body: method === 'GET' || method === 'HEAD' ? undefined : Buffer.concat(chunks),
  });
}

/** @param {import('node:http').ServerResponse} outgoing @param {Response} response */
async function send(outgoing, response) {
  outgoing.writeHead(response.status, Object.fromEntries(response.headers.entries()));
  if (response.body === null) {
    outgoing.end();
    return;
  }
  const reader = response.body.getReader();
  outgoing.on('close', () => {
    reader.cancel().catch(() => {});
  });
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    outgoing.write(value);
  }
  outgoing.end();
}

function main() {
  let settings;
  try {
    settings = parseArgs(process.argv.slice(2), process.env);
  } catch (error) {
    console.error(`fake-llm: ${error instanceof Error ? error.message : String(error)}`);
    process.exit(2);
  }
  const fake = createFakeLlm({ ...settings, log: (line) => console.log(line) });
  const server = createServer((incoming, outgoing) => {
    const address = server.address();
    const base = `http://${settings.host}:${typeof address === 'object' && address ? address.port : settings.port}`;
    toRequest(incoming, base)
      .then((request) => fake.handle(request))
      .then((response) => send(outgoing, response))
      .catch((error) => {
        console.error(`[fake-llm] request failed: ${error instanceof Error ? error.message : String(error)}`);
        if (!outgoing.headersSent) outgoing.writeHead(500, { 'content-type': 'application/json' });
        outgoing.end(JSON.stringify({ error: { message: 'the fake endpoint crashed', type: 'server_error' } }));
      });
  });
  server.listen(settings.port, settings.host, () => {
    const address = server.address();
    const port = typeof address === 'object' && address ? address.port : settings.port;
    console.log(`fake LLM listening on http://${settings.host}:${port}/v1 (not a model; modes by model name: ${MODES.join(', ')})`);
    if (settings.noAddition.length > 0) console.log(`agents that reply ${NO_ADDITION}: ${settings.noAddition.join(', ')}`);
  });
  const stop = () => server.close(() => process.exit(0));
  process.on('SIGINT', stop);
  process.on('SIGTERM', stop);
}

const invokedPath = process.argv[1] ? pathToFileURL(resolve(process.argv[1])).href : '';
if (invokedPath === import.meta.url) main();
