import { spawn, spawnSync } from 'node:child_process';
import {
  chmodSync,
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  realpathSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, describe, expect, it } from 'vitest';
import { applyPreset, scanStagedTree } from './build-lib.mjs';
import { parseSettings, settingsReport } from './launcher-lib.mjs';

// The double-click starters, the settings template and the plain-text guides that go into
// the ZIPs. They run on someone else's computer where nothing can be fixed by hand, so the
// byte-level details (line endings, quoting, modes) are pinned here, the Mac starters are run
// for real against stand-in programs, and the Windows starters are stepped through by a tiny
// batch-file reader (there is no Windows machine in the test run).

const HERE = dirname(fileURLToPath(import.meta.url));
const STARTERS = join(HERE, 'starters');
const APP = join(HERE, '..', '..');
const SLOW = 60_000;

const MODES = ['practice', 'live', 'stop'] as const;
type Mode = (typeof MODES)[number];
const MAC_NAMES = ['Start practice demo.command', 'Start live demo.command', 'Stop demo.command'];
const WIN_NAMES = ['Start practice demo.cmd', 'Start live demo.cmd', 'Stop demo.cmd'];
const MODE_BY_STEM: Record<string, Mode> = {
  'Start practice demo': 'practice',
  'Start live demo': 'live',
  'Stop demo': 'stop',
};
const FAIL_MESSAGE: Record<Mode, string> = {
  practice: 'The practice demo did not start.',
  live: 'The live demo did not start.',
  stop: 'Stopping did not work.',
};

const read = (...parts: string[]) => readFileSync(join(STARTERS, ...parts), 'utf8');
const stem = (name: string) => name.replace(/\.(command|cmd)$/, '');
/** Whitespace folded to single spaces, so a sentence can wrap in the file and still be found. */
const flat = (text: string) => text.replace(/\s+/g, ' ');

/** Lines that are not comments, with every double-quoted string removed. */
function unquotedCode(text: string, comment: RegExp): string[] {
  return text
    .split(/\r?\n/)
    .filter((line) => !comment.test(line.trim()))
    .map((line) => line.replace(/"[^"]*"/g, '""'));
}

describe('starter files exist exactly as the bundle contract names them', () => {
  it('has the three Mac and the three Windows starters, and nothing else', () => {
    expect(readdirSync(join(STARTERS, 'mac')).sort()).toEqual([...MAC_NAMES].sort());
    expect(readdirSync(join(STARTERS, 'windows')).sort()).toEqual([...WIN_NAMES].sort());
  });

  it('has the guides and the settings template', () => {
    expect(readdirSync(STARTERS).sort()).toEqual(
      ['READ-ME-FIRST.mac.txt', 'READ-ME-FIRST.windows.txt', 'mac', 'my-settings.template.txt', 'windows'].sort(),
    );
  });

  // A file the repository will not commit exists only on the machine that made it: a fresh clone
  // could not build the ZIPs. The template was once named *.env, which .gitignore and the pre-commit
  // hook both refuse, so it was never committed.
  const starterFiles = () =>
    [
      ...readdirSync(STARTERS).filter((name) => !['mac', 'windows'].includes(name)),
      ...MAC_NAMES.map((name) => join('mac', name)),
      ...WIN_NAMES.map((name) => join('windows', name)),
    ].map((name) => join(STARTERS, name));
  // A demo copy is a plain folder with no .git: the git question cannot be asked there, so that half skips.
  const insideGit = spawnSync('git', ['rev-parse', '--is-inside-work-tree'], { cwd: APP, encoding: 'utf8' }).stdout.trim() === 'true';

  it('no starter source file has a name the pre-commit hook refuses', () => {
    const hookRefuses = /(^|\/)(\.env(\..*)?|[^/]*\.env)$/;
    expect(starterFiles().filter((file) => hookRefuses.test(file))).toEqual([]);
  });

  it.skipIf(!insideGit)('no starter source file is git-ignored', () => {
    const ignored = spawnSync('git', ['check-ignore', '--', ...starterFiles()], { cwd: APP, encoding: 'utf8' });
    // Exit 1: none of them is ignored. Exit 0 prints the ignored ones; anything else is a git problem.
    expect({ status: ignored.status, ignored: ignored.stdout.trim() }).toEqual({ status: 1, ignored: '' });
  });
});

describe('Mac starters (.command), read as text', () => {
  for (const name of MAC_NAMES) {
    describe(name, () => {
      const text = read('mac', name);
      const mode = MODE_BY_STEM[stem(name)];

      it('uses LF line endings only, no BOM, no tabs', () => {
        expect(text).not.toContain('\r');
        expect(text.charCodeAt(0)).not.toBe(0xfeff);
        expect(text).not.toContain('\t');
      });

      it('is plain ASCII (the Terminal and the launcher both read it)', () => {
        expect(text).toMatch(/^[\x20-\x7e\n]*$/);
      });

      it('starts with a shell shebang on the first line', () => {
        expect(text.startsWith('#!/bin/sh\n')).toBe(true);
      });

      it('is executable (mode 755), or double-click does nothing', () => {
        expect(statSync(join(STARTERS, 'mac', name)).mode & 0o777).toBe(0o755);
      });

      it('changes to its own folder, quoted', () => {
        expect(text).toContain('cd "$(dirname "$0")" || exit 1');
      });

      it('picks the bundled Node by hardware, with the contract paths', () => {
        expect(text).toContain('sysctl -n hw.optional.arm64');
        expect(text).toContain('NODE="runtime/darwin-arm64/bin/node"');
        expect(text).toContain('NODE="runtime/darwin-x64/bin/node"');
      });

      it('adds the folders that hold sysctl to PATH, behind the existing entries and before it asks', () => {
        const pathLine = 'PATH="$PATH:/usr/sbin:/sbin"';
        expect(text).toContain(`\n${pathLine}\n`);
        expect(text.indexOf(pathLine)).toBeLessThan(text.indexOf('sysctl -n hw.optional.arm64'));
      });

      it('leaves the "downloaded from the internet" marks alone: no xattr, no mention of quarantine', () => {
        expect(text).not.toMatch(/xattr/);
        expect(text).not.toMatch(/quarantine/i);
      });

      it('runs the launcher with its own mode as the last word, and no other mode', () => {
        expect(text).toContain(`"$NODE" "launcher/bundle/launcher.mjs" ${mode}\n`);
        for (const other of MODES.filter((m) => m !== mode)) {
          expect(text).not.toContain(`launcher.mjs" ${other}`);
        }
      });

      it('checks that the runtime and the launcher are there, and says so when they are not', () => {
        expect(text).toContain('if [ ! -f "$NODE" ] || [ ! -f "launcher/bundle/launcher.mjs" ]');
        expect(text).toContain('Part of the demo is missing');
      });

      it('waits for Return so the window stays readable, and passes the exit code on', () => {
        expect(text).toMatch(/\nread -r _answer\nexit "\$exitcode"\n$/);
      });

      it('uses no variable name that zsh reserves (the Terminal fallback may run it with zsh)', () => {
        expect(text).not.toMatch(/\bstatus=/);
        expect(text).not.toMatch(/\$status\b/);
      });

      it('quotes every path and variable', () => {
        const code = unquotedCode(text.replace('"$(dirname "$0")"', 'OWN_DIR'), /^#/).join('\n');
        expect(code).not.toMatch(/runtime\//);
        expect(code).not.toMatch(/launcher\//);
        expect(code).not.toMatch(/\$NODE/);
        expect(code).not.toMatch(/\$0/);
      });

      it('keeps every message in one pair of quotes, with no quote inside (a nested quote is silently dropped)', () => {
        const echoes = text.split('\n').filter((line) => line.trim().startsWith('echo "'));
        expect(echoes.length).toBeGreaterThan(0);
        for (const line of echoes) {
          expect(line.split('"').length - 1, line).toBe(2);
          expect(line.endsWith('"'), line).toBe(true);
        }
      });

      it('does not use PowerShell', () => {
        expect(text.toLowerCase()).not.toContain('powershell');
      });
    });
  }
});

// ---------------------------------------------------------------------------------------------
// The Mac starters, run for real
// ---------------------------------------------------------------------------------------------

const POSIX = process.platform !== 'win32';
const scratch: string[] = [];
afterAll(() => {
  for (const dir of scratch) rmSync(dir, { recursive: true, force: true });
});

interface MacWorld {
  /** The HybridDemo folder; its parent path has spaces and brackets on purpose. */
  folder: string;
  /** Holds the stand-in sysctl and xattr that come first on PATH. */
  bin: string;
  xattrLog: string;
}

const STUB_NODE = (arch: string) => `#!/bin/sh
echo "NODE-STUB arch=${arch} args=$*"
echo "NODE-CWD=$(pwd -P)"
exit "\${STUB_EXIT:-0}"
`;

// Apple silicon answers 1; an Intel Mac has no such key and fails with no output.
const STUB_SYSCTL = `#!/bin/sh
if [ "$1" = "-n" ] && [ "$2" = "hw.optional.arm64" ]; then
  [ -n "$STUB_ARM64" ] || exit 1
  echo "$STUB_ARM64"
  exit 0
fi
exit 1
`;

const STUB_XATTR = `#!/bin/sh
echo "xattr $* in $(pwd -P)" >> "$XATTR_LOG"
`;

function makeMacWorld(options: { runtime?: boolean; launcher?: boolean } = {}): MacWorld {
  const { runtime = true, launcher = true } = options;
  const root = mkdtempSync(join(tmpdir(), 'hybrid-starters-'));
  scratch.push(root);
  const folder = join(root, 'My Documents (work)', 'HybridDemo');
  const bin = join(root, 'bin');
  mkdirSync(folder, { recursive: true });
  mkdirSync(bin);
  for (const name of MAC_NAMES) {
    copyFileSync(join(STARTERS, 'mac', name), join(folder, name));
    chmodSync(join(folder, name), 0o755);
  }
  if (runtime) {
    for (const arch of ['arm64', 'x64']) {
      mkdirSync(join(folder, 'runtime', `darwin-${arch}`, 'bin'), { recursive: true });
      // 644 on purpose: a ZIP tool may drop the executable bit, and the starter must cope.
      writeFileSync(join(folder, 'runtime', `darwin-${arch}`, 'bin', 'node'), STUB_NODE(arch), { mode: 0o644 });
    }
  }
  if (launcher) {
    mkdirSync(join(folder, 'launcher', 'bundle'), { recursive: true });
    writeFileSync(join(folder, 'launcher', 'bundle', 'launcher.mjs'), '// stand-in\n');
  }
  writeFileSync(join(bin, 'sysctl'), STUB_SYSCTL, { mode: 0o755 });
  writeFileSync(join(bin, 'xattr'), STUB_XATTR, { mode: 0o755 });
  return { folder, bin, xattrLog: join(root, 'xattr.log') };
}

interface MacRunOptions {
  /** What the stand-in sysctl answers: '1' Apple silicon, '0' something else, undefined an Intel Mac. */
  arm64?: string;
  /** The exit code of the stand-in Node (the launcher's result). */
  exit?: number;
  shell?: string;
  /** Run from this folder with the bare file name instead of from elsewhere with the full path. */
  relative?: boolean;
}

function macRun(world: MacWorld, name: string, options: MacRunOptions = {}) {
  const env: NodeJS.ProcessEnv = {
    NODE_ENV: 'test',
    PATH: `${world.bin}:/usr/bin:/bin`,
    XATTR_LOG: world.xattrLog,
    STUB_EXIT: String(options.exit ?? 0),
  };
  if (options.arm64 !== undefined) env.STUB_ARM64 = options.arm64;
  const where = options.relative ? { cwd: world.folder, script: name } : { cwd: dirname(world.folder), script: join(world.folder, name) };
  return { env, ...where, shell: options.shell ?? '/bin/sh' };
}

function macRunSync(world: MacWorld, name: string, options: MacRunOptions = {}) {
  const run = macRun(world, name, options);
  const result = spawnSync(run.shell, [run.script], { cwd: run.cwd, env: run.env, input: '\n', encoding: 'utf8', timeout: SLOW });
  const log = existsSync(world.xattrLog) ? readFileSync(world.xattrLog, 'utf8') : '';
  return { out: result.stdout + result.stderr, code: result.status, xattr: log };
}

describe.skipIf(!POSIX)('Mac starters, run against stand-in programs', () => {
  it.each(MAC_NAMES)('%s hands its own mode to the launcher, from the folder, with the Apple-silicon Node', (name) => {
    const world = makeMacWorld();
    const { out, code } = macRunSync(world, name, { arm64: '1' });
    const mode = MODE_BY_STEM[stem(name)];
    expect(out).toContain(`NODE-STUB arch=arm64 args=launcher/bundle/launcher.mjs ${mode}\n`);
    expect(out).toContain(`NODE-CWD=${realpathSync(world.folder)}\n`);
    expect(code).toBe(0);
  });

  it('picks the Intel Node when the Mac has no Apple-silicon key', () => {
    const world = makeMacWorld();
    expect(macRunSync(world, MAC_NAMES[0]).out).toContain('NODE-STUB arch=x64');
  });

  it('picks the Intel Node when the Apple-silicon key answers something other than 1', () => {
    const world = makeMacWorld();
    expect(macRunSync(world, MAC_NAMES[0], { arm64: '0' }).out).toContain('NODE-STUB arch=x64');
  });

  // A bare PATH (no /usr/sbin) used to send an Apple-silicon Mac to the Intel Node. The real sysctl is used, so this
  // test is meaningful on an Apple-silicon Mac and passes trivially on an Intel one.
  it.skipIf(!existsSync('/usr/sbin/sysctl'))('finds the real sysctl even when PATH does not list /usr/sbin', () => {
    const world = makeMacWorld();
    rmSync(join(world.bin, 'sysctl'));
    const real = spawnSync('/usr/sbin/sysctl', ['-n', 'hw.optional.arm64'], { encoding: 'utf8' });
    const expected = real.status === 0 && real.stdout.trim() === '1' ? 'arm64' : 'x64';
    const { out } = macRunSync(world, MAC_NAMES[0]);
    expect(out).toContain(`NODE-STUB arch=${expected}`);
  });

  it('never calls xattr: it does not change the marks the Mac put on the downloaded files', () => {
    for (const name of MAC_NAMES) {
      const world = makeMacWorld();
      const { xattr, out } = macRunSync(world, name, { arm64: '1' });
      expect(out).toContain('NODE-STUB arch=arm64');
      expect(xattr).toBe('');
    }
  });

  it('makes the bundled Node executable when the ZIP tool dropped the bit', () => {
    const world = makeMacWorld();
    expect(statSync(join(world.folder, 'runtime', 'darwin-arm64', 'bin', 'node')).mode & 0o111).toBe(0);
    const { out, code } = macRunSync(world, MAC_NAMES[1], { arm64: '1' });
    expect(out).toContain('NODE-STUB arch=arm64');
    expect(code).toBe(0);
  });

  it('works when started by its bare file name from inside the folder', () => {
    const world = makeMacWorld();
    const { out, code } = macRunSync(world, MAC_NAMES[2], { arm64: '1', relative: true });
    expect(out).toContain('args=launcher/bundle/launcher.mjs stop');
    expect(code).toBe(0);
  });

  it('works when the Terminal fallback runs it with zsh', () => {
    if (!existsSync('/bin/zsh')) return;
    const world = makeMacWorld();
    const { out, code } = macRunSync(world, MAC_NAMES[0], { arm64: '1', shell: '/bin/zsh' });
    expect(out).toContain('args=launcher/bundle/launcher.mjs practice');
    expect(code).toBe(0);
  });

  it.each(MAC_NAMES)('%s says nothing about a running demo when the launcher succeeds (the launcher says what happened)', (name) => {
    const world = makeMacWorld();
    const { out } = macRunSync(world, name, { arm64: '1' });
    expect(out).not.toMatch(/is running|did not start|did not work/);
    expect(out).toContain('Press Return to close this window.');
  });

  it.each(MAC_NAMES)('%s passes the launcher failure on and says which step failed', (name) => {
    const world = makeMacWorld();
    const { out, code } = macRunSync(world, name, { arm64: '1', exit: 3 });
    expect(code).toBe(3);
    expect(out).toContain(`${FAIL_MESSAGE[MODE_BY_STEM[stem(name)]]} Read the message above.`);
  });

  it.each([
    ['the runtime folder is missing', { runtime: false }],
    ['the launcher is missing', { launcher: false }],
  ])('says the demo is incomplete and starts nothing when %s', (_label, options) => {
    const world = makeMacWorld(options);
    const { out, code } = macRunSync(world, MAC_NAMES[0], { arm64: '1' });
    expect(out).toContain('Part of the demo is missing. Unzip the whole ZIP again');
    expect(out).not.toContain('NODE-STUB');
    expect(code).toBe(1);
  });

  it('waits for Return before it closes the window', async () => {
    const world = makeMacWorld();
    const run = macRun(world, MAC_NAMES[0], { arm64: '1' });
    const child = spawn(run.shell, [run.script], { cwd: run.cwd, env: run.env, stdio: ['pipe', 'pipe', 'pipe'] });
    let out = '';
    let exited = false;
    child.stdout.on('data', (chunk: Buffer) => {
      out += chunk.toString();
    });
    const done = new Promise<number | null>((resolve) =>
      child.on('exit', (code) => {
        exited = true;
        resolve(code);
      }),
    );
    try {
      const deadline = Date.now() + 30_000;
      while (!out.includes('Press Return') && Date.now() < deadline) await new Promise((r) => setTimeout(r, 50));
      expect(out).toContain('Press Return to close this window.');
      await new Promise((r) => setTimeout(r, 500));
      expect(exited).toBe(false);
      child.stdin.write('\n');
      const timeout = new Promise<'timeout'>((resolve) => setTimeout(() => resolve('timeout'), 30_000));
      expect(await Promise.race([done, timeout])).toBe(0);
    } finally {
      child.kill('SIGKILL');
    }
  }, SLOW);
});

// ---------------------------------------------------------------------------------------------
// The Windows starters
// ---------------------------------------------------------------------------------------------

describe('Windows starters (.cmd), read as text', () => {
  for (const name of WIN_NAMES) {
    describe(name, () => {
      const text = read('windows', name);
      const mode = MODE_BY_STEM[stem(name)];

      it('uses CRLF line endings only (no bare LF, no bare CR), no BOM, no tabs', () => {
        expect(text.replace(/\r\n/g, '')).not.toMatch(/[\r\n]/);
        expect(text.endsWith('\r\n')).toBe(true);
        expect(text.charCodeAt(0)).not.toBe(0xfeff);
        expect(text).not.toContain('\t');
      });

      it('is plain ASCII', () => {
        expect(text).toMatch(/^[\x20-\x7e\r\n]*$/);
      });

      it('begins with the quiet, UTF-8, change-to-own-folder preamble', () => {
        const lines = text.split('\r\n');
        expect(lines[0]).toBe('@echo off');
        expect(lines[1]).toBe('chcp 65001 >nul');
        // pushd, not cd /d: cd cannot switch to a network folder (\\server\share, a redirected Desktop); pushd maps a drive letter.
        expect(lines[2]).toBe('pushd "%~dp0"');
      });

      it('runs the launcher with its own mode, using the contract paths, and no other mode', () => {
        expect(text).toContain(`"runtime\\win32-x64\\node.exe" "launcher\\bundle\\launcher.mjs" ${mode}\r\n`);
        for (const other of MODES.filter((m) => m !== mode)) {
          expect(text).not.toContain(`launcher.mjs" ${other}`);
        }
      });

      it('checks that the runtime and the launcher are there, and says so when they are not', () => {
        expect(text).toContain('if not exist "runtime\\win32-x64\\node.exe" goto missing');
        expect(text).toContain('if not exist "launcher\\bundle\\launcher.mjs" goto missing');
        expect(text).toContain('Part of the demo is missing');
      });

      it('waits with pause and passes the exit code on', () => {
        expect(text).toContain('\r\npause\r\n');
        expect(text.endsWith('exit /b %EXITCODE%\r\n')).toBe(true);
        expect(text).toContain('set "EXITCODE=%ERRORLEVEL%"');
      });

      it('quotes every path', () => {
        const code = unquotedCode(text, /^(rem\b|::)/i).join('\n');
        expect(code).not.toMatch(/runtime\\/);
        expect(code).not.toMatch(/launcher\\/);
        expect(code).not.toContain('%~dp0');
      });

      it('jumps only to labels that exist, and has no label nobody jumps to', () => {
        const lines = text.split('\r\n');
        const labels = lines.filter((l) => l.startsWith(':')).map((l) => l.slice(1));
        const targets = [...text.matchAll(/\bgoto (\w+)/g)].map((m) => m[1]);
        expect(new Set(labels).size).toBe(labels.length);
        for (const target of targets) expect(labels).toContain(target);
        for (const label of labels) expect(targets).toContain(label);
      });

      it('keeps every message free of characters that cmd treats as commands, and uses no parenthesised blocks', () => {
        for (const line of text.split('\r\n')) {
          const message = /\becho (.*)$/.exec(line)?.[1];
          if (message !== undefined) expect(message, line).not.toMatch(/["&|<>^%]/);
          expect(line, line).not.toMatch(/\bif\b.*\(/i);
          expect(line, line).not.toMatch(/^\s*\)|\(\s*$/);
        }
      });

      it('does not use PowerShell or set /p', () => {
        const lower = text.toLowerCase();
        expect(lower).not.toContain('powershell');
        expect(lower).not.toMatch(/set\s+\/p/);
      });
    });
  }
});

interface CmdWorld {
  /** Paths for which `if exist` is true, written as in the file. */
  present: string[];
  /** What the launcher returns. */
  launcherExit: number;
}

/**
 * A reader for exactly the batch commands the starters use. It throws on any other line, so a new
 * construct cannot slip into a starter without being understood here.
 */
function runCmd(text: string, world: CmdWorld) {
  const lines = text.split('\r\n');
  if (lines[lines.length - 1] === '') lines.pop();
  const labels = new Map<string, number>();
  lines.forEach((line, index) => {
    if (line.startsWith(':')) labels.set(line.slice(1), index);
  });
  const vars = new Map<string, string>();
  const output: string[] = [];
  const launched: string[] = [];
  let errorlevel = 0;
  let paused = false as boolean;
  let exit = null as number | null;
  const expand = (value: string) =>
    value.replace(/%([A-Z]+)%/g, (_all, name: string) => (name === 'ERRORLEVEL' ? String(errorlevel) : (vars.get(name) ?? '')));
  const jump = (label: string) => {
    const target = labels.get(label);
    if (target === undefined) throw new Error(`goto ${label}: no such label`);
    return target;
  };

  let pc = 0;
  /** Runs one simple command; returns a new program counter for goto, or null. */
  const execute = (command: string): number | null => {
    let m: RegExpExecArray | null;
    if (command === '@echo off' || command.startsWith('chcp ') || command.startsWith('pushd ')) return null;
    if (command === 'echo.') output.push('');
    else if ((m = /^echo (.*)$/.exec(command))) output.push(m[1]);
    else if ((m = /^set "([A-Z]+)=(.*)"$/.exec(command))) vars.set(m[1], expand(m[2]));
    else if ((m = /^goto (\w+)$/.exec(command))) return jump(m[1]);
    else if ((m = /^"runtime\\win32-x64\\node\.exe" "launcher\\bundle\\launcher\.mjs" (\w+)$/.exec(command))) {
      launched.push(m[1]);
      errorlevel = world.launcherExit;
    } else if (command === 'pause') paused = true;
    else if ((m = /^exit \/b (\S+)$/.exec(command))) exit = Number(expand(m[1]));
    else throw new Error(`the batch reader does not know this line: ${command}`);
    return null;
  };

  for (let steps = 0; pc < lines.length && exit === null; steps += 1) {
    if (steps > 200) throw new Error('the starter loops');
    const line = lines[pc];
    pc += 1;
    let m: RegExpExecArray | null;
    if (line.startsWith(':')) continue;
    if ((m = /^if not exist "([^"]+)" goto (\w+)$/.exec(line))) {
      if (!world.present.includes(m[1])) pc = jump(m[2]);
    } else if ((m = /^if (not )?"%([A-Z]+)%"=="(\w+)" (.+)$/.exec(line))) {
      const equal = expand(`%${m[2]}%`) === m[3];
      if (m[1] ? !equal : equal) {
        const next = execute(m[4]);
        if (next !== null) pc = next;
      }
    } else {
      const next = execute(line);
      if (next !== null) pc = next;
    }
  }
  return { output, launched, paused, exit };
}

const WIN_RUNTIME = 'runtime\\win32-x64\\node.exe';
const WIN_LAUNCHER = 'launcher\\bundle\\launcher.mjs';

describe('Windows starters, stepped through', () => {
  it.each(WIN_NAMES)('%s starts the launcher with its mode and says nothing is wrong when it succeeds', (name) => {
    const result = runCmd(read('windows', name), { present: [WIN_RUNTIME, WIN_LAUNCHER], launcherExit: 0 });
    expect(result.launched).toEqual([MODE_BY_STEM[stem(name)]]);
    expect(result.output.join('\n')).not.toMatch(/missing|did not start|did not work|is running/);
    expect(result.paused).toBe(true);
    expect(result.exit).toBe(0);
  });

  it.each(WIN_NAMES)('%s passes the launcher failure on, names the step and still waits', (name) => {
    const result = runCmd(read('windows', name), { present: [WIN_RUNTIME, WIN_LAUNCHER], launcherExit: 3 });
    expect(result.output).toContain(`${FAIL_MESSAGE[MODE_BY_STEM[stem(name)]]} Read the message above.`);
    expect(result.output.join('\n')).not.toContain('Part of the demo is missing');
    expect(result.paused).toBe(true);
    expect(result.exit).toBe(3);
  });

  it.each([
    ['the runtime', [WIN_LAUNCHER]],
    ['the launcher', [WIN_RUNTIME]],
    ['both', []],
  ])('says the demo is incomplete, starts nothing, and waits when %s is missing', (_label, present) => {
    for (const name of WIN_NAMES) {
      const result = runCmd(read('windows', name), { present, launcherExit: 0 });
      expect(result.launched).toEqual([]);
      expect(result.output.join('\n')).toContain('Part of the demo is missing. Unzip the whole ZIP again');
      expect(result.paused).toBe(true);
      expect(result.exit).toBe(1);
    }
  });

  it('the batch reader refuses a line it does not know (so it cannot pass a new construct by mistake)', () => {
    expect(() => runCmd('@echo off\r\nstart notepad\r\n', { present: [], launcherExit: 0 })).toThrow(/does not know/);
  });
});

// ---------------------------------------------------------------------------------------------
// The guides and the settings template
// ---------------------------------------------------------------------------------------------

/** The Node path each starter picks, read from the starter itself so the guide cannot drift from it. */
const macNodePaths = [...read('mac', MAC_NAMES[0]).matchAll(/NODE="([^"]+)"/g)].map((m) => m[1]);

describe('plain-text guides (READ ME FIRST)', () => {
  const guides = [
    { file: 'READ-ME-FIRST.mac.txt', eol: '\n', command: `./${macNodePaths[0]} launcher/bundle/launcher.mjs practice` },
    { file: 'READ-ME-FIRST.windows.txt', eol: '\r\n', command: `${WIN_RUNTIME} ${WIN_LAUNCHER} practice` },
  ];

  for (const { file, eol, command } of guides) {
    describe(file, () => {
      const text = read(file);
      const lines = text.split(eol);
      if (lines[lines.length - 1] === '') lines.pop();

      it('is plain ASCII with consistent line endings, so it opens everywhere', () => {
        expect(text).toMatch(/^[\x20-\x7e\r\n]*$/);
        expect(text.split(eol).join('')).not.toMatch(/[\r\n]/);
      });

      it('stays short: about 40 lines, none wider than 78 characters', () => {
        expect(lines.length).toBeLessThanOrEqual(45);
        expect(Math.max(...lines.map((l) => l.length))).toBeLessThanOrEqual(78);
      });

      it('has the Terminal fallback with the exact command the starters run', () => {
        expect(text).toContain(command);
      });

      it('names the three files by their real names', () => {
        for (const starter of Object.keys(MODE_BY_STEM)) expect(text).toContain(`"${starter}"`);
        expect(text).toContain('my-settings.env');
      });

      it('names the three settings to fill in', () => {
        for (const name of ['LLM_BASE_URL', 'LLM_API_KEY', 'LLM_MODEL']) expect(text).toContain(name);
      });

      it("says plainly what practice and live do with the user's data", () => {
        const words = flat(text);
        expect(words).toContain('stand-in, not AI');
        expect(words).toContain('Every question you type, and the documents of the data room, go to the model gateway you set up');
        expect(words).toContain('Never type anything confidential');
        expect(words).toMatch(/your own key only/i);
        expect(words).toContain('Never share this file');
      });

      it('says how to start again and how to remove everything', () => {
        const words = flat(text);
        expect(words).toContain('delete the "data" folder');
        expect(words).toContain('delete the folder "HybridDemo"');
      });

      it('has a short table of what to do when something goes wrong', () => {
        expect(text).toContain('IF SOMETHING GOES WRONG');
        expect(flat(text)).toContain('Check my-settings.env');
      });

      it('names no host, address or e-mail', () => {
        expect(text).not.toMatch(/https?:\/\/|www\.|@/i);
      });

      it('does not use PowerShell', () => {
        expect(text.toLowerCase()).not.toContain('powershell');
      });
    });
  }

  it('Mac guide explains Open Anyway, and the Intel Mac path', () => {
    const words = flat(read('READ-ME-FIRST.mac.txt'));
    expect(words).toContain('Privacy & Security');
    expect(words).toContain('Open Anyway');
    expect(words).toContain('the message about "Start practice demo"');
    expect(words).toContain('cannot be opened because Apple cannot check it');
    expect(words).toContain('Intel Mac: use darwin-x64 instead');
    expect(macNodePaths).toEqual(['runtime/darwin-arm64/bin/node', 'runtime/darwin-x64/bin/node']);
  });

  it('Windows guide explains Unblock and both one-time warnings', () => {
    const words = flat(read('READ-ME-FIRST.windows.txt'));
    expect(words).toContain('Unblock');
    expect(words).toContain('More info, then Run anyway');
    expect(words).toContain('The publisher could not be verified');
  });
});

describe('my-settings.template.txt', () => {
  const text = read('my-settings.template.txt');
  const lines = text.split('\n');
  const assignments = lines.filter((l) => /^[A-Z_]+=/.test(l));

  it('is LF-only ASCII with no BOM', () => {
    expect(text).not.toContain('\r');
    expect(text).toMatch(/^[\x20-\x7e\n]*$/);
  });

  it('holds exactly the five LLM_* names the app reads, each on a plain NAME= line', () => {
    expect(assignments.map((l) => l.split('=')[0])).toEqual([
      'LLM_BASE_URL',
      'LLM_API_KEY',
      'LLM_MODEL',
      'LLM_API_KEY_HEADER',
      'LLM_MAX_TOKENS',
    ]);
  });

  it('ships every value empty, the key included', () => {
    for (const line of assignments) expect(line.endsWith('=')).toBe(true);
    expect(text).not.toMatch(/^LLM_API_KEY=.+/m);
  });

  it('has no judge settings (only evaluations use them) and names no host', () => {
    expect(text).not.toContain('JUDGE');
    expect(text).not.toMatch(/https?:\/\/[a-z0-9-]+\./i);
  });

  it('every name is also in env.example, so the two cannot drift apart', () => {
    const example = readFileSync(join(APP, 'env.example'), 'utf8');
    for (const line of assignments) {
      const name = line.split('=')[0];
      expect(example).toMatch(new RegExp(`^${name}=`, 'm'));
    }
  });

  it('opens with the instruction to fill in your own values and keep the file private', () => {
    const header = lines.slice(0, 8).join('\n');
    expect(header).toContain('Fill in your OWN values');
    expect(header).toContain('"Start live demo"');
    expect(header).toContain('Never send this file to anyone');
  });

  it('comments every setting with a line starting with #', () => {
    for (const line of assignments) {
      const i = lines.indexOf(line);
      const above = lines.slice(0, i).reverse().find((l) => l.trim() !== '');
      expect(above?.startsWith('#'), line).toBe(true);
    }
  });

  it('is read by the launcher as "nothing filled in yet": all three required settings are missing', () => {
    const report = settingsReport(parseSettings(text));
    expect(report.filled).toBe(false);
    expect(report.missing).toEqual(['LLM_BASE_URL', 'LLM_API_KEY', 'LLM_MODEL']);
    expect(report.holdsKey).toBe(false);
  });

  it('is read by the launcher as filled in once a person types the three values after the = signs', () => {
    const typed = text
      .replace('LLM_BASE_URL=', 'LLM_BASE_URL=https://gateway.example.invalid/v1')
      .replace('LLM_API_KEY=', 'LLM_API_KEY=k-1234')
      .replace('LLM_MODEL=', 'LLM_MODEL=some-model');
    const report = settingsReport(parseSettings(typed));
    expect(report.filled).toBe(true);
    expect(report.llm).toEqual({ LLM_BASE_URL: 'https://gateway.example.invalid/v1', LLM_API_KEY: 'k-1234', LLM_MODEL: 'some-model' });
  });

  it('takes the builder\'s preset: fills the non-secret lines, keeps the key line empty, refuses a key', () => {
    const preset = '# Use the shared gateway.\nLLM_BASE_URL=https://gateway.example.invalid/v1\nLLM_MODEL=some-model\nLLM_MAX_TOKENS=2000\n';
    const merged = applyPreset(text, preset);
    expect(merged.applied).toEqual(['LLM_BASE_URL', 'LLM_MODEL', 'LLM_MAX_TOKENS']);
    const settings = parseSettings(merged.text);
    expect(settings.LLM_BASE_URL).toBe('https://gateway.example.invalid/v1');
    expect(settings.LLM_MODEL).toBe('some-model');
    expect(settings.LLM_MAX_TOKENS).toBe('2000');
    expect(settings.LLM_API_KEY).toBe('');
    expect(merged.text).not.toContain('Use the shared gateway');
    expect(merged.notesLeftOut).toBe(1);
    expect(() => applyPreset(text, `${preset}LLM_API_KEY=abc\n`)).toThrow(/LLM_API_KEY/);
  });
});

describe("the builder's own scan of what goes into each ZIP", () => {
  // The files are laid out as the builder lays them out, then scanned by the builder's scanner,
  // so a text of mine that looks like a key, a home folder or a non-ASCII .cmd stops the build here
  // first and not on the owner's Mac.
  function stage(target: 'mac' | 'windows') {
    const root = mkdtempSync(join(tmpdir(), 'hybrid-stage-'));
    scratch.push(root);
    const top = join(root, 'HybridDemo');
    mkdirSync(top);
    for (const name of target === 'mac' ? MAC_NAMES : WIN_NAMES) copyFileSync(join(STARTERS, target, name), join(top, name));
    copyFileSync(join(STARTERS, `READ-ME-FIRST.${target}.txt`), join(top, 'READ ME FIRST.txt'));
    copyFileSync(join(STARTERS, 'my-settings.template.txt'), join(top, 'my-settings.env'));
    return { root, top };
  }

  it.each(['mac', 'windows'] as const)('finds nothing in the %s files', (target) => {
    expect(scanStagedTree(stage(target).root)).toEqual([]);
  });

  it('would catch a key-shaped value in the settings file (so the scan above can fail)', () => {
    const { root, top } = stage('mac');
    writeFileSync(join(top, 'my-settings.env'), `${read('my-settings.template.txt')}LLM_API_KEY=${['sk', '0123456789abcdef0123456789'].join('-')}\n`);
    expect(scanStagedTree(root)).toEqual([{ file: 'HybridDemo/my-settings.env', rule: 'api-key-value' }]);
  });
});

// ---------------------------------------------------------------------------------------------
// The documents for people
// ---------------------------------------------------------------------------------------------

describe('user documents', () => {
  const sendText = readFileSync(join(HERE, 'SEND-TO-COLLEAGUES.md'), 'utf8');
  const tryIt = readFileSync(join(APP, 'TRY-IT.md'), 'utf8');
  const pkg = JSON.parse(readFileSync(join(APP, 'package.json'), 'utf8')) as { scripts: Record<string, string> };

  const [, shortMessage, longMessage] = sendText.split(/^## \d\. /m);
  const messages = { 'the short e-mail': shortMessage, 'the longer note': longMessage };

  it('SEND-TO-COLLEAGUES holds exactly the two messages', () => {
    expect(shortMessage).toContain('Short e-mail');
    expect(longMessage).toContain('Longer note');
  });

  for (const [label, message] of Object.entries(messages)) {
    describe(`SEND-TO-COLLEAGUES, ${label}`, () => {
      const words = flat(message);

      it('has a placeholder for the download link', () => {
        expect(message).toContain('[DOWNLOAD LINK]');
      });

      it('gives the three steps with the real file and folder names', () => {
        expect(words).toContain('open the folder "HybridDemo"');
        expect(words).toContain('Double-click "Start practice demo"');
        expect(words).toContain('double-click "Stop demo"');
      });

      it('describes the first-time warning on both systems', () => {
        expect(words).toContain('cannot be opened because Apple cannot check it');
        expect(words).toContain('Windows protected your PC');
      });

      it('says practice needs no key and its replies are stand-ins', () => {
        expect(words).toMatch(/needs no key/);
        expect(words).toContain('stand-ins, not AI');
      });

      it('says live needs their own key and that every question goes to their gateway', () => {
        expect(words).toMatch(/your own (gateway )?key/i);
        expect(words).toMatch(/every question you type[^.]*(go(es)?|are sent) to (that|the) gateway/i);
      });

      it('says not to put in anything confidential', () => {
        expect(words).toMatch(/confidential/i);
      });

      it('names no host, address, e-mail or company', () => {
        expect(message).not.toMatch(/https?:\/\/|@/);
      });
    });
  }

  it('SEND-TO-COLLEAGUES warns that a preset ZIP carries the gateway address and must stay inside the company', () => {
    const words = flat(sendText.split(/^---$/m)[0]);
    expect(words).toMatch(/preset holds your gateway's address/);
    expect(words).toMatch(/only to people inside your own company/);
    expect(words).toMatch(/never a key/);
  });

  it('TRY-IT leads with the ZIP path and says the ZIPs are built, not in the repository', () => {
    expect(tryIt).toContain('npm run bundle');
    expect(tryIt).toMatch(/not in the repository/i);
    expect(tryIt).toContain('HybridTeamDemo-mac.zip');
    expect(tryIt).toContain('HybridTeamDemo-windows.zip');
    expect(tryIt.indexOf('Path A')).toBeGreaterThan(-1);
    expect(tryIt.indexOf('Path A')).toBeLessThan(tryIt.indexOf('Path B'));
    expect(tryIt.indexOf('HybridTeamDemo-mac.zip')).toBeLessThan(tryIt.indexOf('npm run demo:practice'));
  });

  it('TRY-IT names the starters and the settings file as they are called in the ZIP', () => {
    for (const starter of Object.keys(MODE_BY_STEM)) expect(tryIt).toContain(starter);
    expect(tryIt).toContain('my-settings.env');
    expect(tryIt).toContain('READ ME FIRST.txt');
    expect(tryIt).toContain('HybridDemo');
  });

  it('TRY-IT keeps the Terminal commands for Mac and Linux', () => {
    expect(tryIt).toContain('npm ci --ignore-scripts');
    expect(tryIt).toContain('npm run demo:practice');
    expect(tryIt).toContain('npm run demo');
    expect(tryIt).toContain('npm run demo:stop');
    expect(tryIt).toContain('install -m 600 env.example .env.local');
  });

  it('the npm scripts and files the documents point to exist', () => {
    for (const script of ['bundle', 'demo', 'demo:practice', 'demo:stop', 'smoke']) expect(pkg.scripts).toHaveProperty(script);
    expect(existsSync(join(APP, 'env.example'))).toBe(true);
    expect(existsSync(join(HERE, 'SEND-TO-COLLEAGUES.md'))).toBe(true);
    expect(tryIt).toContain('scripts/bundle/SEND-TO-COLLEAGUES.md');
  });

  it('none of the user documents or guides use PowerShell', () => {
    for (const text of [sendText, tryIt]) expect(text.toLowerCase()).not.toContain('powershell');
  });
});
