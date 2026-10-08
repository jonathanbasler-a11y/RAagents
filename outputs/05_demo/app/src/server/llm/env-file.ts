import 'server-only';
import { statSync } from 'node:fs';
import { join, resolve } from 'node:path';

export interface EnvFileCheckOptions {
  /** Folder that holds the env file. Default: process.cwd() (the app folder under Next.js). */
  appDir?: string;
  /** Default: `.env.local`. */
  fileName?: string;
  /** Where the one warning goes. Default: console.warn (the server log). */
  warn?: (message: string) => void;
}

const GROUP_OR_OTHERS_READ = 0o044;

// Absolute paths already reported, so each problem is logged once per process.
const reported = new Set<string>();

/**
 * Checks whether the app's env file can be read by group or others. Uses the file's mode
 * bits only (fs.statSync): it never opens or reads the file. Logs the problem once per
 * process and returns it on every call; returns null when the file is missing or private.
 * The message names the file, never its folder or contents.
 */
export function checkEnvFilePermissions(options: EnvFileCheckOptions = {}): string | null {
  if (process.platform === 'win32') return null; // mode bits carry no meaning there
  const fileName = options.fileName ?? '.env.local';
  // Runtime paths: the ignore comments keep Turbopack from tracing the whole project.
  const path = resolve(/* turbopackIgnore: true */ join(/* turbopackIgnore: true */ options.appDir ?? process.cwd(), fileName));
  const warn = options.warn ?? ((message: string) => console.warn(message));

  let problem: string | null;
  try {
    const mode = statSync(/* turbopackIgnore: true */ path).mode & 0o777;
    problem =
      (mode & GROUP_OR_OTHERS_READ) === 0
        ? null
        : `${fileName} can be read by other users (mode ${mode.toString(8).padStart(3, '0')}). Run: chmod 600 ${fileName}`;
  } catch (error) {
    const code = (error as { code?: unknown }).code;
    if (code === 'ENOENT') return null;
    problem = `could not check the permissions of ${fileName} (${typeof code === 'string' ? code : 'unknown error'})`;
  }

  if (problem !== null && !reported.has(path)) {
    reported.add(path);
    warn(problem);
  }
  return problem;
}
