#!/usr/bin/env node
// LLM endpoint probe for the hybrid team chat app. Dependency-free; Node 18 or later.
//
// Sends one tiny chat-completion per configured route (agents, judge) and reports whether
// this environment can reach the endpoint with your own credentials. It never prints the
// API key or the endpoint host, so its output is safe to paste into an issue or a chat.
//
// Usage:
//   node tools/llm-probe.mjs                                   (reads LLM_* from the environment)
//   node --env-file=outputs/05_demo/app/.env.local tools/llm-probe.mjs
//
// Exit codes: 0 every configured route answered, 1 a configured route failed, 2 nothing configured.

const PLACEHOLDERS = new Set(['', 'changeme', 'change-me', 'dummy', 'none', 'null', 'undefined', 'xxx', 'todo']);
const TIMEOUT_MS = 30_000;
const PROMPT = 'Reply with the single word OK.';

function clean(value) {
  const s = (value ?? '').trim();
  if (PLACEHOLDERS.has(s.toLowerCase()) || /^<.*>$/.test(s)) return '';
  return s;
}

function routeConfig(prefix, inherit) {
  return {
    base: clean(process.env[`${prefix}BASE_URL`]) || (inherit ? inherit.base : ''),
    key: clean(process.env[`${prefix}API_KEY`]),
    header: clean(process.env[`${prefix}API_KEY_HEADER`]) || (inherit ? inherit.header : ''),
    model: clean(process.env[`${prefix}MODEL`]),
  };
}

function missingFields(cfg, prefix) {
  const missing = [];
  if (!cfg.base) missing.push(`${prefix}BASE_URL`);
  if (!cfg.key) missing.push(`${prefix}API_KEY`);
  if (!cfg.model) missing.push(`${prefix}MODEL`);
  return missing;
}

function redactor(cfg) {
  let host = '';
  try { host = new URL(cfg.base).host; } catch { /* invalid URL: nothing to redact */ }
  return (text) => {
    let t = String(text ?? '');
    if (cfg.key) t = t.split(cfg.key).join('<key>');
    if (host) t = t.split(host).join('<host>');
    t = t.replace(/https?:\/\/[^\s"'<>]+/g, '<url>');
    t = t.replace(/(bearer\s+)[A-Za-z0-9._~+/=-]+/gi, '$1<redacted>');
    t = t.replace(/\b(?:\d{1,3}\.){3}\d{1,3}\b/g, '<ip>');
    return t.replace(/\s+/g, ' ').trim();
  };
}

function headersFor(cfg) {
  const headers = { 'content-type': 'application/json', accept: 'application/json, text/event-stream' };
  if (cfg.header && cfg.header.toLowerCase() !== 'authorization') headers[cfg.header] = cfg.key;
  else headers.authorization = `Bearer ${cfg.key}`;
  return headers;
}

function endpoint(cfg) {
  return `${cfg.base.replace(/\/+$/, '')}/chat/completions`;
}

// Walks the error-cause chain and any AggregateError members, because fetch wraps the
// real network error (and dual-stack connects report one error per address tried).
function classify(err) {
  const parts = [];
  const seen = new Set();
  const visit = (e, depth) => {
    if (!e || depth > 6 || seen.has(e)) return;
    seen.add(e);
    if (e.code) parts.push(String(e.code));
    if (e.name) parts.push(String(e.name));
    if (/bad port/i.test(String(e.message))) parts.push('BAD_PORT');
    if (Array.isArray(e.errors)) e.errors.forEach((inner) => visit(inner, depth + 1));
    visit(e.cause, depth + 1);
  };
  visit(err, 0);
  const s = parts.join(' ');
  if (/TimeoutError|AbortError|ETIMEDOUT|UND_ERR_CONNECT_TIMEOUT|UND_ERR_HEADERS_TIMEOUT|UND_ERR_BODY_TIMEOUT/.test(s)) return 'timeout';
  if (/ENOTFOUND|EAI_AGAIN/.test(s)) return 'dns';
  if (/CERT|SELF_SIGNED|UNABLE_TO_VERIFY|ERR_TLS|DEPTH_ZERO|ERR_SSL/.test(s)) return 'tls';
  if (/BAD_PORT/.test(s)) return 'blocked port (fetch refuses this port; check LLM_BASE_URL)';
  if (/ECONNREFUSED/.test(s)) return 'connection refused';
  if (/ECONNRESET|UND_ERR_SOCKET|EPIPE/.test(s)) return 'connection reset';
  return 'network';
}

function family(model) {
  const m = String(model ?? '').toLowerCase();
  if (/anthropic|claude/.test(m)) return 'anthropic';
  if (/openai|gpt|(^|[./:-])o\d|(^|[./:-])sol/.test(m)) return 'openai';
  if (/google|gemini/.test(m)) return 'google';
  if (/meta|llama/.test(m)) return 'meta';
  if (/mistral|mixtral/.test(m)) return 'mistral';
  return 'unknown';
}

function textOf(content) {
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) return content.map((p) => (typeof p?.text === 'string' ? p.text : '')).join('');
  return '';
}

async function plainCall(cfg, red) {
  const t0 = performance.now();
  try {
    const res = await fetch(endpoint(cfg), {
      method: 'POST',
      headers: headersFor(cfg),
      body: JSON.stringify({ model: cfg.model, messages: [{ role: 'user', content: PROMPT }], max_tokens: 16 }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    const body = await res.text();
    const ms = Math.round(performance.now() - t0);
    if (!res.ok) return { ok: false, status: res.status, ms, error: `HTTP ${res.status}`, detail: red(body).slice(0, 240) };
    let json;
    try { json = JSON.parse(body); } catch { return { ok: false, status: res.status, ms, error: 'response is not JSON', detail: red(body).slice(0, 240) }; }
    const choice = Array.isArray(json.choices) ? json.choices[0] : undefined;
    if (!choice) return { ok: false, status: res.status, ms, error: 'no choices in the response (unusable)' };
    const text = textOf(choice.message?.content);
    return {
      ok: text.trim().length > 0,
      status: res.status,
      ms,
      model: json.model,
      finish: choice.finish_reason ?? '(none)',
      chars: text.length,
      error: text.trim() ? undefined : 'empty reply (unusable)',
    };
  } catch (err) {
    return { ok: false, ms: Math.round(performance.now() - t0), error: classify(err), detail: red(err?.message) };
  }
}

async function streamCall(cfg, red) {
  const t0 = performance.now();
  try {
    const res = await fetch(endpoint(cfg), {
      method: 'POST',
      headers: headersFor(cfg),
      body: JSON.stringify({ model: cfg.model, messages: [{ role: 'user', content: PROMPT }], max_tokens: 16, stream: true }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!res.ok) {
      const body = await res.text();
      return { ok: false, status: res.status, ms: Math.round(performance.now() - t0), error: `HTTP ${res.status}`, detail: red(body).slice(0, 240) };
    }
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    let chunks = 0;
    let chars = 0;
    let sawDone = false;
    let finish;
    let model;
    let firstMs;
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      let nl;
      while ((nl = buffer.indexOf('\n')) >= 0) {
        const line = buffer.slice(0, nl).replace(/\r$/, '');
        buffer = buffer.slice(nl + 1);
        if (!line.startsWith('data:')) continue; // blank lines, ":" keep-alives, event names
        const data = line.slice(5).trim();
        if (data === '[DONE]') { sawDone = true; continue; }
        let json;
        try { json = JSON.parse(data); } catch { continue; }
        if (json.error) {
          return { ok: false, status: res.status, ms: Math.round(performance.now() - t0), error: 'error object inside the stream (partial)', detail: red(JSON.stringify(json.error)).slice(0, 240) };
        }
        model ??= json.model;
        const choice = Array.isArray(json.choices) ? json.choices[0] : undefined;
        if (!choice) continue; // e.g. a usage-only chunk
        const delta = textOf(choice.delta?.content);
        if (delta.length) {
          chars += delta.length;
          chunks += 1;
          firstMs ??= Math.round(performance.now() - t0);
        }
        if (choice.finish_reason) finish = choice.finish_reason;
      }
    }
    const ms = Math.round(performance.now() - t0);
    let error;
    if (!sawDone) error = 'stream ended without [DONE] (partial)';
    else if (chars === 0) error = 'no text streamed (unusable)';
    return { ok: !error, status: res.status, ms, firstMs, model, finish: finish ?? '(none)', chunks, chars, error };
  } catch (err) {
    return { ok: false, ms: Math.round(performance.now() - t0), error: classify(err), detail: red(err?.message) };
  }
}

function report(route, kind, r) {
  const head = `${route.padEnd(6)} ${kind.padEnd(6)} ${r.ok ? 'OK  ' : 'FAIL'}`;
  if (r.ok) {
    const extra = kind === 'stream'
      ? `${r.chunks} chunks, first text ${r.firstMs} ms, total ${r.ms} ms`
      : `${r.chars} chars, ${r.ms} ms`;
    console.log(`${head} HTTP ${r.status}  model=${r.model ?? '(not reported)'}  family=${family(r.model)}  finish=${r.finish}  ${extra}`);
  } else {
    const status = r.status && !String(r.error).startsWith('HTTP') ? ` (HTTP ${r.status})` : '';
    console.log(`${head} ${r.error}${status} after ${r.ms} ms${r.detail ? `\n         detail: ${r.detail}` : ''}`);
  }
}

async function main() {
  const agents = routeConfig('LLM_', null);
  const judge = routeConfig('LLM_JUDGE_', agents);
  const agentsMissing = missingFields(agents, 'LLM_');
  const judgeMissing = [...(judge.key ? [] : ['LLM_JUDGE_API_KEY']), ...(judge.model ? [] : ['LLM_JUDGE_MODEL']), ...(judge.base ? [] : ['LLM_JUDGE_BASE_URL or LLM_BASE_URL'])];

  console.log(`node ${process.version}`);
  if (agentsMissing.length && Object.keys(process.env).some((k) => k.startsWith('ANTHROPIC_') || k.startsWith('OPENAI_'))) {
    console.log('note: ANTHROPIC_* or OPENAI_* variables are set, but this app reads only LLM_* names. They are ignored.');
  }

  let configured = 0;
  let failed = 0;
  const models = {};

  if (agentsMissing.length) {
    console.log(`agents not configured: missing ${agentsMissing.join(', ')}`);
  } else {
    configured += 1;
    const red = redactor(agents);
    const p = await plainCall(agents, red);
    report('agents', 'plain', p);
    const s = await streamCall(agents, red);
    report('agents', 'stream', s);
    if (!p.ok || !s.ok) failed += 1;
    models.agents = p.model ?? s.model;
    if (/latest/i.test(agents.model)) console.log('warning: LLM_MODEL looks like a "latest" alias. Pin an exact model id.');
  }

  if (judgeMissing.length) {
    console.log(`judge  not configured: missing ${judgeMissing.join(', ')}`);
  } else {
    configured += 1;
    const p = await plainCall(judge, redactor(judge));
    report('judge', 'plain', p);
    if (!p.ok) failed += 1;
    models.judge = p.model;
    if (/latest/i.test(judge.model)) console.log('warning: LLM_JUDGE_MODEL looks like a "latest" alias. Pin an exact model id.');
  }

  if (models.agents && models.judge) {
    const fa = family(models.agents);
    const fj = family(models.judge);
    if (fa === 'unknown' || fj === 'unknown') console.log('check: could not tell a model family; confirm by hand that the judge is a different family from the agents.');
    else if (fa === fj) { console.log(`FAIL: the judge (${fj}) is the same family as the agents (${fa}). It must be different.`); failed += 1; }
    else console.log(`ok: judge family (${fj}) differs from the agents' (${fa}).`);
  }

  if (configured === 0) {
    console.log('Nothing configured. Set your own LLM_* values (see docs/ONA.md or the app env.example).');
    process.exit(2);
  }
  process.exit(failed ? 1 : 0);
}

main().catch((err) => {
  console.error(`probe crashed: ${err?.name ?? 'Error'}`);
  process.exit(1);
});
