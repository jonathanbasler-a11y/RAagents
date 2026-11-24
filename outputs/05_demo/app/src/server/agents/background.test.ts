import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  BACKGROUND_MAX_CHARS,
  BACKGROUND_MAX_QUESTIONS,
  parseBackground,
  readBackground,
  resolveBackgroundDir,
} from './background';

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(path.join(tmpdir(), 'agent-background-'));
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

const DOC = ['# A 2017 strategy paper', '', 'Body line one.', '', '## Findings', 'A finding.', ''].join('\n');

describe('parseBackground', () => {
  it('takes the title from the first heading and keeps the rest as the text', () => {
    expect(parseBackground(DOC)).toEqual({
      ok: true,
      background: { title: 'A 2017 strategy paper', text: 'Body line one.\n\n## Findings\nA finding.', demoQuestions: [] },
    });
  });

  it('turns the "Demo questions" list into demo questions and leaves that section out of the text', () => {
    const text = [
      '# Paper',
      'Intro.',
      '## Demo questions',
      '- How visionary was it?',
      '-   What came true? ',
      '',
      '## Later section',
      'Kept.',
    ].join('\n');

    const result = parseBackground(text);

    expect(result).toEqual({
      ok: true,
      background: { title: 'Paper', text: 'Intro.\n\n## Later section\nKept.', demoQuestions: ['How visionary was it?', 'What came true?'] },
    });
  });

  it('accepts "Demo questions:" with a colon and drops empty items', () => {
    const result = parseBackground(['# Paper', 'Body.', '## Demo questions:', '- First?', '-   ', '* Second?'].join('\n'));

    expect(result).toEqual({ ok: true, background: { title: 'Paper', text: 'Body.', demoQuestions: ['First?', 'Second?'] } });
  });

  it('reads a file saved with a byte order mark and Windows line ends', () => {
    const result = parseBackground(`\uFEFF# Paper\r\nBody.\r\n## Demo questions\r\n- Q one?\r\n`);

    expect(result).toEqual({ ok: true, background: { title: 'Paper', text: 'Body.', demoQuestions: ['Q one?'] } });
  });

  it('refuses a file that does not start with a "# Title" line', () => {
    expect(parseBackground('Body without a title.\n')).toEqual({ ok: false, reason: expect.stringMatching(/first line.*# Title/) });
    expect(parseBackground('## Not a level-one heading\nBody.')).toEqual({ ok: false, reason: expect.stringMatching(/# Title/) });
  });

  it('refuses a file with a title and no text', () => {
    expect(parseBackground('# Title only\n\n## Demo questions\n- Q?\n')).toEqual({ ok: false, reason: expect.stringMatching(/no text/) });
  });

  it('refuses text longer than the limit, and accepts text at the limit', () => {
    const atLimit = `# T\n${'x'.repeat(BACKGROUND_MAX_CHARS)}`;
    const over = `# T\n${'x'.repeat(BACKGROUND_MAX_CHARS + 1)}`;

    expect(parseBackground(atLimit).ok).toBe(true);
    expect(parseBackground(over)).toEqual({ ok: false, reason: expect.stringMatching(/longer than/) });
  });

  it('refuses more demo questions than the limit, and a demo question that is too long', () => {
    const many = Array.from({ length: BACKGROUND_MAX_QUESTIONS + 1 }, (_, index) => `- Question ${index}?`);
    expect(parseBackground(['# T', 'Body.', '## Demo questions', ...many].join('\n'))).toEqual({
      ok: false,
      reason: expect.stringMatching(/demo questions/),
    });
    expect(parseBackground(['# T', 'Body.', '## Demo questions', `- ${'q'.repeat(301)}`].join('\n'))).toEqual({
      ok: false,
      reason: expect.stringMatching(/too long/),
    });
  });
});

describe('readBackground', () => {
  it('finds nothing when the folder or the file does not exist', () => {
    expect(readBackground(path.join(dir, 'missing'), 'label')).toEqual({ kind: 'none' });
    expect(readBackground(dir, 'label')).toEqual({ kind: 'none' });
  });

  it('reads <id>.md from the folder', () => {
    writeFileSync(path.join(dir, 'label.md'), DOC);

    const result = readBackground(dir, 'label');

    expect(result).toEqual({ kind: 'ok', background: expect.objectContaining({ title: 'A 2017 strategy paper' }) });
  });

  it('skips, with the reason, a file it cannot parse or cannot read', () => {
    writeFileSync(path.join(dir, 'label.md'), 'no title\n');
    expect(readBackground(dir, 'label')).toEqual({ kind: 'skipped', reason: expect.stringMatching(/# Title/) });

    mkdirSync(path.join(dir, 'clin.md'));
    expect(readBackground(dir, 'clin')).toEqual({ kind: 'skipped', reason: expect.stringMatching(/cannot read/) });

    writeFileSync(path.join(dir, 'ev.md'), DOC);
    chmodSync(path.join(dir, 'ev.md'), 0o000);
    try {
      expect(readBackground(dir, 'ev')).toEqual({ kind: 'skipped', reason: expect.stringMatching(/cannot read/) });
    } finally {
      chmodSync(path.join(dir, 'ev.md'), 0o600);
    }
  });
});

describe('readBackground: size', () => {
  it('skips, without reading it, a file far larger than the text limit', () => {
    writeFileSync(path.join(dir, 'label.md'), `# T\n${'x'.repeat(BACKGROUND_MAX_CHARS * 5)}`);

    expect(readBackground(dir, 'label')).toEqual({ kind: 'skipped', reason: expect.stringMatching(/too large/) });
  });
});

describe('resolveBackgroundDir', () => {
  it('uses the option, else AGENT_BACKGROUND_DIR, else .data/background in the working directory', () => {
    vi.spyOn(process, 'cwd').mockReturnValue('/app');
    vi.stubEnv('AGENT_BACKGROUND_DIR', '');
    expect(resolveBackgroundDir()).toBe(path.resolve('/app', '.data', 'background'));

    vi.stubEnv('AGENT_BACKGROUND_DIR', 'elsewhere/bg');
    expect(resolveBackgroundDir()).toBe(path.resolve('/app', 'elsewhere', 'bg'));

    expect(resolveBackgroundDir('/explicit')).toBe('/explicit');
  });
});
