#!/usr/bin/env node
// The downloadable demo's launcher. The starter files in the HybridDemo folder run it with the
// Node that ships in that folder:
//
//   node launcher/bundle/launcher.mjs practice   the stand-in model, no key needed
//   node launcher/bundle/launcher.mjs live       the person's own model settings (my-settings.env)
//   node launcher/bundle/launcher.mjs stop       stops what this folder started
//
// Plain Node, no dependencies, macOS and Windows. The decisions are in launcher-lib.mjs; this file
// only connects them to the machine. Test hooks (environment): HYBRID_NO_BROWSER=1,
// HYBRID_NO_EDITOR=1, HYBRID_DATA_DIR=<folder>, HYBRID_PORT=<first port to try>, and for tests only
// HYBRID_SERVER_ENTRY=<a program to run instead of app/server.js>. RAAGENTS_ENV_FILE=<file> names
// another settings file for the live demo.

import { execFile, spawn } from 'node:child_process';
import * as fs from 'node:fs';
import { createServer } from 'node:net';
import { uptime } from 'node:os';
import { dirname, resolve } from 'node:path';
import tls from 'node:tls';
import { fileURLToPath } from 'node:url';
import { HOST, TIMEOUTS, interruptCleanup, pathsFor, runCommand, trustSystemCertificates } from './launcher-lib.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
// launcher/bundle/ sits two folders below the HybridDemo folder.
const ROOT = resolve(HERE, '..', '..');
// launcher/fake-llm.mjs in the download, scripts/fake-llm.mjs in the repository: one level up either way.
const FAKE_LLM = resolve(HERE, '..', 'fake-llm.mjs');

/** @param {number} pid */
function isAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return /** @type {{ code?: string }} */ (error).code === 'EPERM';
  }
}

/** The background programs run in their own process group (detached), so the whole group gets the signal. @param {number} pid @param {NodeJS.Signals} signal */
function kill(pid, signal) {
  try {
    process.kill(-pid, signal);
  } catch {
    try {
      process.kill(pid, signal);
    } catch {
      // already gone
    }
  }
}

/** Resolves when `file args` has run, whatever its outcome. @param {string} file @param {string[]} args */
function run(file, args) {
  return new Promise((done) => {
    execFile(file, args, { windowsHide: true }, (error) => done({ ok: error === null }));
  });
}

/** Opens a program that outlives the launcher (the browser, the editor). Resolves true once it started. @param {string} command @param {string[]} args */
function launch(command, args) {
  return new Promise((done) => {
    try {
      const child = spawn(command, args, { stdio: 'ignore', detached: true, windowsHide: false });
      child.once('error', () => done(false));
      child.once('spawn', () => {
        child.unref();
        done(true);
      });
    } catch {
      done(false);
    }
  });
}

/** Is nothing using this port, on loopback or on every address? @param {number} port */
async function isPortFree(port) {
  /** @param {string | undefined} host */
  const tryListen = (host) =>
    new Promise((done) => {
      const server = createServer();
      server.once('error', () => done(false));
      server.listen(port, host, () => server.close(() => done(true)));
    });
  return (await tryListen(HOST)) && (await tryListen(undefined));
}

/** A port the system picks, for the stand-in model. */
function ephemeralPort() {
  return new Promise((done, reject) => {
    const server = createServer();
    server.once('error', reject);
    server.listen(0, HOST, () => {
      const address = server.address();
      const port = typeof address === 'object' && address ? address.port : 0;
      server.close(() => done(port));
    });
  });
}

function main() {
  const command = process.argv[2];
  const platform = process.platform;
  const paths = pathsFor({ platform, root: ROOT, env: process.env, fakeLlm: FAKE_LLM });
  const ctx = {
    platform,
    env: process.env,
    baseEnv: process.env,
    paths,
    fs,
    spawn,
    fetch,
    execPath: process.execPath,
    pid: process.pid,
    trustSystemCertificates: () => trustSystemCertificates({ tls }),
    isAlive,
    kill,
    run,
    launch,
    isPortFree,
    ephemeralPort,
    sleep: (/** @type {number} */ ms) => new Promise((done) => setTimeout(done, ms)),
    now: () => Date.now(),
    bootTimeMs: Date.now() - uptime() * 1000,
    say: (/** @type {string} */ line = '') => process.stdout.write(`${line}\n`),
    timeouts: TIMEOUTS,
    started: /** @type {number[]} */ ([]),
  };
  // Ctrl+C, a closed window (SIGHUP) or a termination while a start is under way: end what it began.
  for (const signal of /** @type {const} */ (['SIGINT', 'SIGTERM', 'SIGHUP'])) {
    process.once(signal, () => {
      if (ctx.started.length > 0) ctx.say('Interrupted. What this start had begun was stopped again.');
      interruptCleanup(ctx).finally(() => process.exit(130));
    });
  }
  return runCommand(ctx, command);
}

main().then(
  (code) => process.exit(code),
  (error) => {
    process.stdout.write(`The launcher failed: ${error instanceof Error ? error.message : String(error)}\n`);
    process.exit(1);
  },
);
