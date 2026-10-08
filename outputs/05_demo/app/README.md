# Hybrid team chat (demo app)

Next.js 16 (App Router, TypeScript strict), Vitest and ESLint. Named agent personas from `outputs/04_agents/` with a team chat and one 1:1 room per agent.

## Run

From this folder (`outputs/05_demo/app`).

### Set up once

1. **Node 24** (pinned in `.node-version`). Check with `node --version`. On a Mac where `node@24` is installed beside an older default `node`, put it first in your terminal: `export PATH="/opt/homebrew/opt/node@24/bin:$PATH"`. If your tool cannot use `$PATH`, put the full path in front of each command instead: `PATH=/opt/homebrew/opt/node@24/bin:/opt/homebrew/bin:/usr/bin:/bin npm run smoke`.
2. **Your own model settings (first time only; this overwrites an existing `.env.local`):** `cp env.example .env.local && chmod 600 .env.local`, then fill in your own values. `.env.local` is git-ignored: never commit it or share your key. For the model, the app reads only `LLM_*` names; `ANTHROPIC_*` and `OPENAI_*` are ignored.
3. **Install:** `npm ci`.

### Each time you present

1. **Connect to the VPN.** The model gateway is only reachable from the company network.
2. **Check the connection:** `npm run smoke`. The agents plain and agents stream lines should say `OK`. It prints no key and no host.
3. **Start:** `npm run build`, then `npm start`. The app listens on this machine only, at http://127.0.0.1:3200. It has no login, so leave `HOST` unset (or 127.0.0.1). While you change code, use `npm run dev` instead (same address).
4. **Open** http://127.0.0.1:3200. `HOST` and `PORT` change the address: if port 3200 is taken, start with `PORT=3201 npm start` and open http://127.0.0.1:3201.
5. **Demo:** follow `LIVE-DEMO.md`, starting with its checklist.

### Stop and restart

- **Stop:** press Ctrl+C in the terminal where the app runs.
- **Restart**, for example after changing `.env.local`: run `npm start` again. No new build is needed.
- **After a rehearsal with the fake model**, switch back to your real settings: see the end of the next section.

### Practise offline with the fake model

`npm run fake-llm` starts a local stand-in for the gateway (`scripts/fake-llm.mjs`) on http://127.0.0.1:4011/v1. It is not a model: every reply starts with "Fake reply from <Name>". Use it to rehearse the clicks and the routing without the VPN. The rehearsal app uses port 3200 too, so stop the real app first.

Terminal 1:

```sh
npm run fake-llm -- --no-addition=Dara
```

Terminal 2: start the app with every `LLM_*` name set to a fake value on the command line. Next.js still loads `.env.local`, but a value set on the command line wins. The app treats an empty value as missing, so give each name a value. `CHAT_DB_PATH` keeps rehearsal turns out of the real chat database (`.data/chat.db`).

```sh
npm run build
CHAT_DB_PATH=.data/practice.db \
LLM_BASE_URL=http://127.0.0.1:4011/v1 LLM_API_KEY=fake-key LLM_API_KEY_HEADER=authorization \
LLM_MODEL=fake-model LLM_MAX_TOKENS=1500 \
LLM_JUDGE_BASE_URL=http://127.0.0.1:4011/v1 LLM_JUDGE_API_KEY=fake-judge-key \
LLM_JUDGE_API_KEY_HEADER=authorization LLM_JUDGE_MODEL=fake-judge-model \
npm start
```

Then open http://127.0.0.1:3200.

- Keys must start with `fake`.
- `--no-addition=Dara,Lena`: those agents reply `NO_ADDITION`, which the team chat shows as "Dara had nothing to add." Other options: `--port`, `--host`, `--delay-ms` and `--slow-delay-ms` (or `FAKE_LLM_PORT`, `FAKE_LLM_HOST`, `FAKE_LLM_DELAY_MS`, `FAKE_LLM_SLOW_DELAY_MS`, `FAKE_LLM_NO_ADDITION`).
- The model name picks a failure mode, to see the error states: `LLM_MODEL=fake-truncate` (a cut-off reply), `fake-break` (a reply that breaks off), `fake-slow`, `fake-empty`, `fake-fail-500`, `fake-fail-429`, `fake-fail-401` or `fake-fail-model`. Restart the app after changing it.

**Switch back to your real settings** when you finish: stop both (Ctrl+C in each terminal), then start the app again with plain `npm start`. The fake values were set for that one command only, so the app uses your own settings in `.env.local` and the real chat database again. Before you present, send one warm-up question: a reply that starts with "Fake reply from" means the app is still on the rehearsal settings.

## Scripts

| Script | What it does |
|---|---|
| `npm run gate` | typecheck, lint, tests, production build. Run it before saying anything is done. |
| `npm run typecheck` | `tsc --noEmit` |
| `npm test` | Vitest, offline |
| `npm run lint` | ESLint (eslint-config-next) |
| `npm run build` | `next build`; set `NEXT_DIST_DIR=.next-<label>` when several people build in this folder, and set the same value for `npm start` |
| `npm run smoke` | Live model check (`scripts/smoke.ts`); prints no key and no host |
| `npm run avatars` | Regenerates `public/avatars/` (`scripts/make-avatars.mjs`) |
| `npm run fake-llm` | Local stand-in model server for manual runs (`scripts/fake-llm.mjs`) |

## Conventions

- **Contracts:** shared types live in `src/shared/contracts.ts` (types only, safe for client and server). Server modules start with `import 'server-only'`.
- **Next.js docs for the installed version** ship in `node_modules/next/dist/docs/`. Prefer them to memory: Next.js 16 changed many APIs. (When `next dev` detects an AI coding agent it writes an `AGENTS.md` here saying the same.)
- **Dependencies are pinned** (`.npmrc` has `save-exact=true`). Do not add or upgrade packages without asking.
- **SQLite:** open databases with `openDatabase` from `src/server/db/sqlite.ts`. It loads `node:sqlite` through `process.getBuiltinModule`, so the bundler never resolves it. Never `import` `node:sqlite` directly (type imports are fine).
- **Tests are offline.** `tests/setup.ts` deletes every `LLM_*`, `ANTHROPIC_*` and `OPENAI_*` variable and makes `fetch` throw "network is blocked in tests". Code that calls HTTP takes an injected `fetch`. Use a fresh temporary directory for data, and freeze the clock where time matters.
- **Test files:** `src/**/*.test.ts(x)`, `tests/**/*.test.ts(x)` or `scripts/**/*.test.ts`. Vitest globals are off: import `describe`, `it` and `expect` from `vitest`. Component tests start with the line `// @vitest-environment jsdom`; they get the jest-dom matchers and a DOM cleanup after each test. `server-only` resolves to an empty module in tests, and `@/` to `src/`.
- **Types and builds:** `tsconfig.json` extends `tsconfig.base.json` so that `next build` never rewrites it. Generated files (`next-env.d.ts`, `.next*/types`) are left out of the type check, so do not use the generated global helpers `PageProps`, `LayoutProps` or `RouteContext`: type params explicitly, e.g. `{ params: Promise<{ agentId: string }> }`.
- **Responses stream:** `compress` is off in `next.config.ts` because gzip buffers server-sent events.
