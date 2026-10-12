import { chmodSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { checkEnvFilePermissions } from './index';

// Stand-in files under another name in fresh temporary folders: no real env file is involved.
const FILE_NAME = 'env-file-under-test';
const folders: string[] = [];

function folderWithFile(mode: number): string {
  const folder = mkdtempSync(join(tmpdir(), 'llm-env-check-'));
  folders.push(folder);
  const file = join(folder, FILE_NAME);
  writeFileSync(file, 'NOT_A_REAL_SETTING=1\n');
  chmodSync(file, mode);
  return folder;
}

afterEach(() => {
  for (const folder of folders.splice(0)) {
    chmodSync(join(folder, FILE_NAME), 0o600);
    rmSync(folder, { recursive: true, force: true });
  }
});

describe('checkEnvFilePermissions', () => {
  it('warns once per process when the file is readable by group or others, and says how to fix it', () => {
    const appDir = folderWithFile(0o644);
    const warn = vi.fn();

    const first = checkEnvFilePermissions({ appDir, fileName: FILE_NAME, warn });
    const second = checkEnvFilePermissions({ appDir, fileName: FILE_NAME, warn });

    expect(first).toContain(`chmod 600 ${FILE_NAME}`);
    expect(second).toBe(first);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn).toHaveBeenCalledWith(first);
  });

  it.each([
    ['group', 0o640],
    ['others', 0o604],
  ])('counts a file readable by %s alone', (_who, mode) => {
    const warn = vi.fn();

    expect(checkEnvFilePermissions({ appDir: folderWithFile(mode), fileName: FILE_NAME, warn })).not.toBeNull();
    expect(warn).toHaveBeenCalledTimes(1);
  });

  it('stays quiet for a file only its owner can read (600)', () => {
    const warn = vi.fn();

    expect(checkEnvFilePermissions({ appDir: folderWithFile(0o600), fileName: FILE_NAME, warn })).toBeNull();
    expect(warn).not.toHaveBeenCalled();
  });

  it('stays quiet when the file does not exist', () => {
    const appDir = mkdtempSync(join(tmpdir(), 'llm-env-check-'));
    const warn = vi.fn();

    expect(checkEnvFilePermissions({ appDir, fileName: FILE_NAME, warn })).toBeNull();
    expect(warn).not.toHaveBeenCalled();
    rmSync(appDir, { recursive: true, force: true });
  });

  it('looks only at the mode bits: a file its owner cannot open still gets the warning', () => {
    // 044: group and others may read, the owner may not, so opening it would fail here.
    const warn = vi.fn();

    expect(checkEnvFilePermissions({ appDir: folderWithFile(0o044), fileName: FILE_NAME, warn })).not.toBeNull();
    expect(warn).toHaveBeenCalledTimes(1);
  });

  it('never puts the folder path into the warning', () => {
    const appDir = folderWithFile(0o644);

    const warning = checkEnvFilePermissions({ appDir, fileName: FILE_NAME, warn: () => {} });

    expect(warning).not.toContain(appDir);
  });
});
