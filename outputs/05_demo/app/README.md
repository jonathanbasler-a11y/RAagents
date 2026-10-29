# Hybrid team chat (demo app)

Next.js 16 (App Router, TypeScript strict), Vitest and ESLint. Named agent personas from `outputs/04_agents/` with a team chat and one 1:1 room per agent.

**Just want to try it?** `TRY-IT.md` is the short guide for running your own copy, in practice mode without a key or in live mode with your own.

## Run

From this folder (`outputs/05_demo/app`).

### Set up once

1. **Node 24** (pinned in `.node-version`). Check with `node --version`. On a Mac where `node@24` is installed beside an older default `node`, put it first in your terminal: `export PATH="/opt/homebrew/opt/node@24/bin:$PATH"`. If your tool cannot use `$PATH`, put the full path in front of each command instead: `PATH=/opt/homebrew/opt/node@24/bin:/opt/homebrew/bin:/usr/bin:/bin npm run smoke`.
2. **Your own model settings (first time only; this overwrites an existing `.env.local`):** `install -m 600 env.example .env.local` (creates the file private from the start, unlike `cp` then `chmod`), then fill in your own values. `.env.local` is git-ignored: never commit it or share your key. For the model, the app reads only `LLM_*` names; `ANTHROPIC_*` and `OPENAI_*` are ignored.
3. **Install:** `npm ci --ignore-scripts`. Why: no dependency may run code on your machine at install time, and nothing in this app needs an install script. (`.npmrc` sets `ignore-scripts=true` too; the flag keeps the command safe if that file is ever missing.)

### Each time you present

1. **Connect to the VPN.** The model gateway is only reachable from the company network.
2. **Check the connection:** `npm run smoke`. The agents plain and agents stream lines should say `OK`. It prints no key and no host.
3. **Start:** `npm run build`, then `npm start`. The app listens on this machine only, at http://127.0.0.1:3200. It has no login, so leave `HOST` unset (or 127.0.0.1). While you change code, use `npm run dev` instead (same address).
4. **Open** http://127.0.0.1:3200. `HOST` and `PORT` change the address: if port 3200 is taken, start with `PORT=3201 npm start` and open http://127.0.0.1:3201.
5. **Demo:** follow `LIVE-DEMO.md`, starting with its checklist.

### Hosting

Without the settings in the next section the app has no login, so it is built for one person on one machine. If you must serve it beyond loopback without them (set `HOST=0.0.0.0`, as a hosted workspace service does), keep that port private: for example an Ona port that stays creator-only, never shared or public. A warning at startup says so. Without `HOST` the server only accepts the host names `localhost`, `127.0.0.1` and `[::1]` and answers `421 Misdirected Request` to any other `Host` header (this blocks DNS rebinding). Beyond loopback the `Host` check is skipped unless you set `ALLOWED_HOSTS` to the comma-separated name(s) you are served on (exact names, or `*.example.test` for any name under a suffix); set it whenever you can. A POST that carries an `Origin` from a different host is refused with 403. Never set `LLM_ALLOW_PLAIN_HTTP=1` for a remote endpoint: a plain `http` URL to a remote host leaves the model route unconfigured because the key would travel unencrypted. The flag exists only for a test stand-in on a network you control.

### A hosted copy with accounts

For a team, the app can run as one shared copy on a server behind HTTPS, with an account for each person. The container recipe is `outputs/Dockerfile` (build it from the `outputs/` folder: `docker build -t hybrid-team .`). Every setting is an environment variable listed in `env.example`; without them nothing changes.

- **Sign-in.** Set `RAAGENTS_ADMIN_PASSWORD` (16 or more random characters) and, if you like, `RAAGENTS_ADMIN_USERNAME` (default `admin`). The admin signs in with these and creates everyone else on the **People** page (`/admin`): a username, then a one-time password that is shown once, to send privately. At the first sign-in each person chooses their own password (12 characters or more). A one-time password works for 7 days. The admin can reset a password (a new one-time password) or disable a person; both sign the person out everywhere at once. Sessions last 12 hours; signing out, changing a password, a reset and disabling end them at once.
- **Failed sign-ins** are limited per name (10 in 15 minutes) and, behind one load balancer that adds `X-Forwarded-For` (`RAAGENTS_TRUSTED_PROXY_HOPS=1`, which the container image sets), per name and machine (5) and per machine (50). The admin's name has no per-name limit, so nobody can lock the admin out by guessing; without a trusted proxy only the hashing rate slows guesses at it, so make the admin password long and random (16 characters at least, 24 random ones recommended). Successful sign-ins are limited too (20 per account in 15 minutes), because every session is kept as a row. No lockout ever needs the admin to lift it.
- **What is stored.** Accounts, sessions (only a hash of each session's token) and a history of account events (created, reset, disabled, enabled, signed in, signed out) live in the chat database; passwords are scrypt hashes; no IP addresses are kept. Decisions on findings, the checklist and the gates are still recorded as "person (local, not authenticated)", not under the person's name: that comes in a later step.
- **One shared workspace.** Everyone signed in works in the same workspace and sees all of its chats. `RAAGENTS_HOSTED_NOTICE` sets the copy's banner and switches the agents' rule about where chats are kept: say there who may use the copy and what material is allowed.
- **Locked, never open.** The container image requires sign-in (`RAAGENTS_REQUIRE_SIGN_IN=1`; its start script also treats an empty value as set, and only `0` turns it off), so a copy whose admin password is missing or too short starts with sign-in "not set up" instead of starting open. The settings of the earlier shared-password version (`RAAGENTS_ACCESS_PASSWORD`, `RAAGENTS_SESSION_SECRET`) are no longer read; set on their own, they lock the app too.
- **Recovery.** A lost admin password: set a new `RAAGENTS_ADMIN_PASSWORD` and restart; the old one stops working and the admin's sessions end. A person who lost theirs: the admin resets it.
- **HTTPS is required:** the session cookie is `Secure`. Browsers accept it on `http://localhost` for a test.
- **Backup.** On a server whose disk does not survive a restart, set `LITESTREAM_REPLICA_URL` (for example `s3://bucket/path/chat.db?region=eu-central-1`): the database, accounts included, is restored at start and copied continuously while the app runs (`scripts/hosted/start.sh`). Run exactly one copy per backup. The start script refuses to start while another copy is still writing: a running copy writes a heartbeat every 15 seconds, so a backup file younger than a minute means it is still there. If your platform starts the new copy before it stops the old one, stop the old one first. A missing backup is an error, so a wrong path cannot start an empty app; for the very first start only, set `LITESTREAM_ALLOW_EMPTY_START=1`. Schema changes are forward-only: an older version of the app refuses a newer database.

### Stop and restart

- **Stop:** press Ctrl+C in the terminal where `npm start` runs. A demo started with the launcher (`npm run demo`, see "Demo at any time") runs in the background and has no terminal to close: stop it with `npm run demo:stop`.
- **Restart**, for example after changing `.env.local`: run `npm start` again. No new build is needed. For a demo started with the launcher, run `npm run demo:stop`, then `npm run demo`.
- **After a rehearsal with the fake model**, switch back to your real settings: see the end of the next section.

### Practise offline with the fake model

`npm run fake-llm` starts a local stand-in for the gateway (`scripts/fake-llm.mjs`) on http://127.0.0.1:4011/v1. It is not a model: every reply starts with "Fake reply from <Name>". Use it to rehearse the clicks and the routing without the VPN. The rehearsal app uses port 3200 too, so stop the real app first (`npm run demo:stop` if the launcher started it, Ctrl+C if you used `npm start`). For a quicker rehearsal with one command, use `npm run demo:practice` (see "Demo at any time").

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

**Switch back to your real settings** when you finish: stop both (Ctrl+C in each terminal; a practice demo started with the launcher is stopped with `npm run demo:stop`), then start the live demo again with `npm run demo`, or the app with plain `npm start`. The fake values were set for that one command only, so the app uses your own settings in `.env.local` and the real chat database again. Before you present, send one warm-up question: a reply that starts with "Fake reply from" means the app is still on the rehearsal settings.

## Demo at any time

One command starts the demo in the background, on port 3200 (`127.0.0.1` only), and opens the pages in your browser. It builds the app once per commit, into `.next-demo`, so the first start takes a minute or two.

- **`npm run demo`** starts the live demo: the real model. It needs the company VPN and a settings file. The launcher looks for the settings in `$RAAGENTS_ENV_FILE`, else `~/.config/raagents/llm.env`, else the app's `.env.local`. It hands the file's path to Node and never prints or copies it.
- **`npm run demo:practice`** starts the practice demo on the stand-in model. No VPN is needed. A banner on every page and the label "Practice reply · not AI · not sourced" on every reply say so. Practice replies must never be presented as real answers.
- **`npm run demo:stop`** stops the demo started from this folder. A demo started this way has no terminal to close, so Ctrl+C does not stop it.

The same three by double-click (macOS): `scripts/demo/start-demo.command`, `scripts/demo/start-practice.command` and `scripts/demo/stop-demo.command`.

Options:

- `DEMO_PORT=3201 npm run demo` uses another port.
- Add flags after `--`: `npm run demo -- --no-open` does not open the browser; `npm run demo -- --rebuild` builds the app again first (use it after changing code that is not yet committed).
- The live and practice demos each keep their own chat database in `.data/`, apart from `.data/chat.db`. The server's output is in `.data/demo.log`.
- One demo runs at a time on a port. To switch between live and practice, run `npm run demo:stop` first.

## Scripts

| Script | What it does |
|---|---|
| `npm run demo` | Starts the live demo in the background (real model; needs the VPN and a settings file). `DEMO_PORT` sets the port (default 3200); flags after `--`: `--no-open`, `--rebuild` (`scripts/demo/demo.mjs`) |
| `npm run demo:practice` | Starts the practice demo on the stand-in model (no VPN; labelled on every page and reply) |
| `npm run demo:stop` | Stops the demo started from this folder |
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
