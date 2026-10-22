// Builds the two demo ZIPs for colleagues. Run on the owner's Mac: `npm run bundle -- --help`.
// The decisions live in build-lib.mjs; this file does the steps in order and prints plain progress.
// It never writes inside the repository except the temporary build folder the payload step uses.

import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import {
  HELP,
  LAUNCHER_FILES,
  STARTER_NAMES,
  TARGETS,
  TOP_FOLDER,
  applyPreset,
  assertKeysEmpty,
  ensureArchive,
  extractRuntime,
  formatFindings,
  formatSize,
  isInside,
  listZip,
  makeZip,
  normalizeTree,
  parseArgs,
  parseDenyList,
  parseRuntimes,
  runtimesFor,
  scanStagedTree,
  sha256OfFile,
  sha256SumsText,
  targetsFor,
  zipProblems,
} from './build-lib.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const DEFAULT_APP_DIR = resolve(HERE, '..', '..');
/** The build folder the payload step may use inside the app folder (next.config.ts allows ".next-<label>"). */
export const BUNDLE_DIST_DIR = '.next-bundle';

const STARTERS = {
  mac: { dir: 'scripts/bundle/starters/mac', names: STARTER_NAMES.mac, readme: 'scripts/bundle/starters/READ-ME-FIRST.mac.txt' },
  windows: { dir: 'scripts/bundle/starters/windows', names: STARTER_NAMES.windows, readme: 'scripts/bundle/starters/READ-ME-FIRST.windows.txt' },
};
// Not *.env: .gitignore and the pre-commit hook refuse that pattern, so a file named so is never committed.
const SETTINGS_TEMPLATE = 'scripts/bundle/starters/my-settings.template.txt';
const MANIFEST_FILE = 'scripts/bundle/node-runtimes.json';

/** The folder holding the assembled app (server.js inside), whichever way the payload step lays it out. @param {string} payloadDir */
export function findPayloadRoot(payloadDir) {
  if (existsSync(join(payloadDir, 'app', 'server.js'))) return join(payloadDir, 'app');
  if (existsSync(join(payloadDir, 'server.js'))) return payloadDir;
  return null;
}

/** @param {string} path @param {string} what */
function readText(path, what) {
  try {
    return readFileSync(path, 'utf8');
  } catch {
    throw new Error(`cannot read ${what}.`);
  }
}

/**
 * @typedef {{ out: string, cache: string, preset: string | null, only: 'mac' | 'windows' | null, skipBuild: boolean, denyList: string | null }} BuildOptions
 * @typedef {(args: { appDir: string, repoRoot: string, outDir: string, distDir: string, log: (line: string) => void }) => Promise<unknown>} AssembleFn
 * @typedef {{
 *   appDir?: string, repoRoot?: string, homeDir?: string, manifest?: ReturnType<typeof parseRuntimes>,
 *   assemble?: AssembleFn, loadAssemble?: () => Promise<AssembleFn>,
 *   makeZip?: typeof makeZip, fetchImpl?: typeof fetch, log?: (line: string) => void,
 * }} BuildDeps
 */

/** Loads the payload step. A missing module is reported in plain words; any other load error is passed on as it is. @returns {Promise<AssembleFn>} */
async function importAssemble() {
  return (await import('./assemble-payload.mjs')).assemblePayload;
}

/**
 * @param {BuildOptions} options @param {BuildDeps} [deps]
 * @returns {Promise<{ zips: { name: string, path: string, size: number, sha256: string }[] }>}
 */
export async function runBuild(options, deps = {}) {
  const log = deps.log ?? ((/** @type {string} */ line) => console.log(line));
  const appDir = deps.appDir ?? DEFAULT_APP_DIR;
  const repoRoot = deps.repoRoot ?? resolve(appDir, '..', '..', '..');
  const out = resolve(options.out);
  const cache = resolve(options.cache);
  const targets = targetsFor(options.only);
  // Folders of this machine. Their text must not end up in a ZIP that goes to colleagues.
  // (The app folder is inside the repository folder, so the repository path covers it.)
  const buildPaths = [...new Set([deps.homeDir ?? homedir(), repoRoot, out, cache])];

  if (isInside(repoRoot, out)) throw new Error('the output folder must be outside the repository (a ZIP must never be committed). Use --out.');
  if (isInside(repoRoot, cache)) throw new Error('the cache folder must be outside the repository. Use --cache.');

  // 1. Everything that can be wrong is checked before the slow steps.
  log('Checking the inputs ...');
  const manifest = deps.manifest ?? parseRuntimes(JSON.parse(readText(join(appDir, MANIFEST_FILE), MANIFEST_FILE)));
  const needed = [
    ...LAUNCHER_FILES.map(([source]) => source),
    SETTINGS_TEMPLATE,
    ...targets.flatMap((target) => [STARTERS[target].readme, ...STARTERS[target].names.map((name) => `${STARTERS[target].dir}/${name}`)]),
  ];
  const missing = needed.filter((path) => !existsSync(join(appDir, path)));
  if (missing.length > 0) throw new Error(`these files are missing, so the ZIPs cannot be built yet:\n${missing.map((m) => `  ${m}`).join('\n')}`);

  let settingsText = readText(join(appDir, SETTINGS_TEMPLATE), SETTINGS_TEMPLATE);
  assertKeysEmpty(settingsText);
  if (options.preset) {
    const preset = applyPreset(settingsText, readText(options.preset, 'the preset file'));
    settingsText = preset.text;
    log(`Preset: filled ${preset.applied.length ? preset.applied.join(', ') : 'no lines'}.`);
    if (preset.ignored.length > 0) log(`Preset: ignored these other names: ${preset.ignored.join(', ')}.`);
    if (preset.notesLeftOut > 0) {
      log(`Preset: left out ${preset.notesLeftOut} comment line${preset.notesLeftOut === 1 ? '' : 's'}; notes never go into the ZIPs (put them in your message instead).`);
    }
  }

  /** @type {string[]} */
  let denyTerms = [];
  if (options.denyList) denyTerms = parseDenyList(readText(options.denyList, 'the deny-list file'));
  log(denyTerms.length > 0 ? `Deny list: ${denyTerms.length} terms.` : 'Deny list: none.');

  // 2. The Node.js runtimes, verified against the pinned hashes.
  /** @type {Map<string, string>} */
  const archives = new Map();
  for (const target of targets) {
    for (const entry of runtimesFor(manifest, TARGETS[target].platform)) {
      archives.set(entry.file, await ensureArchive({ entry, version: manifest.version, cacheDir: cache, fetchImpl: deps.fetchImpl, log }));
    }
  }
  log(`Node.js ${manifest.version}: ${archives.size} archive${archives.size === 1 ? '' : 's'} verified.`);

  // 3. The app, built once and shared by both ZIPs.
  mkdirSync(out, { recursive: true });
  const payloadDir = join(out, '.payload');
  // Written beside the payload (so it is never zipped) only after the payload step succeeded with every check.
  const verifiedMarker = join(out, '.payload-verified');
  if (options.skipBuild) {
    if (!findPayloadRoot(payloadDir)) throw new Error('--skip-build: there is no assembled app to reuse yet. Run once without --skip-build.');
    if (!existsSync(verifiedMarker)) {
      throw new Error('--skip-build: the app assembled by the earlier run did not pass its checks (or comes from an older version). Run once without --skip-build.');
    }
    log('Reusing the app assembled by the earlier run.');
  } else {
    rmSync(verifiedMarker, { force: true });
    let assemble = deps.assemble;
    if (!assemble) {
      try {
        assemble = await (deps.loadAssemble ?? importAssemble)();
      } catch (error) {
        // Node words a missing file as "Cannot find module '<that file>'". A missing import INSIDE the file names a different path.
        if (/^Cannot find module '[^']*assemble-payload\.mjs'/.test(/** @type {{ message?: string }} */ (error)?.message ?? '')) {
          throw new Error('scripts/bundle/assemble-payload.mjs is missing, so the app cannot be built yet.');
        }
        throw error;
      }
    }
    rmSync(payloadDir, { recursive: true, force: true });
    mkdirSync(payloadDir, { recursive: true });
    log('Building the app (this takes a few minutes) ...');
    await assemble({ appDir, repoRoot, outDir: payloadDir, distDir: BUNDLE_DIST_DIR, log });
  }
  const payloadRoot = findPayloadRoot(payloadDir);
  if (!payloadRoot) throw new Error('the app build produced no server.js, so there is nothing to ship.');
  if (!options.skipBuild) writeFileSync(verifiedMarker, 'The payload step finished with every check passed.\n');

  // 4. Stage and scan EVERY target first. Nothing is zipped, and nothing in the output folder is touched,
  //    until all of them are clean.
  const stageDir = mkdtempSync(join(out, '.stage-'));
  /** @type {{ name: string, path: string, size: number, sha256: string }[]} */
  const zips = [];
  try {
    /** @type {{ target: 'mac' | 'windows', zipName: string, stageRoot: string }[]} */
    const staged = [];
    for (const target of targets) {
      const { platform, zipName } = TARGETS[target];
      log(`Staging ${zipName} ...`);
      const stageRoot = join(stageDir, target);
      const top = join(stageRoot, TOP_FOLDER);
      mkdirSync(top, { recursive: true });
      cpSync(payloadRoot, join(top, 'app'), { recursive: true });
      for (const [source, destination] of LAUNCHER_FILES) {
        mkdirSync(dirname(join(top, destination)), { recursive: true });
        cpSync(join(appDir, source), join(top, destination));
      }
      for (const name of STARTERS[target].names) cpSync(join(appDir, STARTERS[target].dir, name), join(top, name));
      cpSync(join(appDir, STARTERS[target].readme), join(top, 'READ ME FIRST.txt'));
      writeFileSync(join(top, 'my-settings.env'), settingsText);
      for (const entry of runtimesFor(manifest, platform)) {
        extractRuntime({ entry, archivePath: /** @type {string} */ (archives.get(entry.file)), topDir: top, scratchRoot: join(stageDir, 'scratch') });
      }
      rmSync(join(stageDir, 'scratch'), { recursive: true, force: true });
      normalizeTree(top, platform);

      const findings = scanStagedTree(top, { denyTerms, buildPaths });
      if (findings.length > 0) {
        throw new Error(`the scan found ${findings.length} problem${findings.length === 1 ? '' : 's'} in ${zipName}; nothing was zipped:\n${formatFindings(findings)}`);
      }
      staged.push({ target, zipName, stageRoot });
    }

    // 5. Zip into the stage folder and check each ZIP as a person would meet it. Only a complete, checked
    //    set is moved into the output folder, so an earlier set is never left half replaced.
    const zipDir = join(stageDir, 'zips');
    mkdirSync(zipDir, { recursive: true });
    const zip = deps.makeZip ?? makeZip;
    for (const { target, zipName, stageRoot } of staged) {
      log(`Zipping ${zipName} ...`);
      const zipPath = join(zipDir, zipName);
      zip({ stageRoot, zipPath });
      const problems = zipProblems(listZip(zipPath), { target, runtimeEntries: runtimesFor(manifest, TARGETS[target].platform) });
      if (problems.length > 0) throw new Error(`${zipName} failed the final check; nothing was published:\n${problems.map((p) => `  ${p}`).join('\n')}`);
      zips.push({ name: zipName, path: join(out, zipName), size: statSync(zipPath).size, sha256: await sha256OfFile(zipPath) });
    }
    for (const { name, path } of zips) renameSync(join(zipDir, name), path);
  } finally {
    rmSync(stageDir, { recursive: true, force: true });
  }

  // 6. Checksums of every ZIP in the folder, so the file always matches what is on disk.
  /** @type {{ name: string, sha256: string }[]} */
  const sums = [];
  for (const { zipName } of Object.values(TARGETS)) {
    const built = zips.find((zip) => zip.name === zipName);
    if (built) sums.push({ name: zipName, sha256: built.sha256 });
    else if (existsSync(join(out, zipName))) sums.push({ name: zipName, sha256: await sha256OfFile(join(out, zipName)) });
  }
  writeFileSync(join(out, 'SHA256SUMS.txt'), sha256SumsText(sums));

  log('');
  for (const zip of zips) log(`${zip.name}  ${formatSize(zip.size)}  sha256 ${zip.sha256}`);
  log(`Done. The files are in ${out}`);
  return { zips };
}

/**
 * @param {string[]} argv
 * @returns {Promise<number>} the exit code
 */
export async function main(argv) {
  try {
    const args = parseArgs(argv);
    if (args.help) {
      console.log(HELP);
      return 0;
    }
    let denyList = args.denyList;
    if (denyList === null) {
      const fallback = join(homedir(), '.config', 'raagents', 'bundle-deny.txt');
      if (existsSync(fallback)) denyList = fallback;
    }
    await runBuild({ ...args, denyList });
    return 0;
  } catch (error) {
    console.error(`Build stopped: ${error instanceof Error ? error.message : String(error)}`);
    return 1;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exitCode = await main(process.argv.slice(2));
}
