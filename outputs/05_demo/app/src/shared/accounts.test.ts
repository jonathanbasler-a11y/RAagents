import { describe, expect, it } from 'vitest';
import {
  MAX_PASSWORD_CHARS,
  MIN_PASSWORD_CHARS,
  canonicalOneTimePassword,
  checkNewPassword,
  checkUsername,
  normalizeUsername,
} from './accounts';

describe('checkUsername', () => {
  it('accepts lower-case names of 2 to 32 characters with digits, dots, dashes and underscores', () => {
    for (const name of ['ab', 'a.b_c-1', 'member-one', '7th', 'x'.repeat(32)]) {
      expect(checkUsername(name), name).toEqual({ ok: true });
    }
  });

  it('refuses anything the database would refuse', () => {
    for (const name of ['', 'a', 'x'.repeat(33), 'Member', 'with space', 'émile', '-lead', '.lead', '_lead', 'a/b', 'a@b']) {
      expect(checkUsername(name).ok, name).toBe(false);
    }
  });

  it('keeps "server" free for the record of what the server itself did', () => {
    expect(checkUsername('server').ok).toBe(false);
  });
});

describe('normalizeUsername', () => {
  it('trims and lower-cases what a person typed', () => {
    expect(normalizeUsername('  Member-One ')).toBe('member-one');
  });
});

describe('checkNewPassword', () => {
  const context = { username: 'member-one' };

  it(`accepts ${MIN_PASSWORD_CHARS} to ${MAX_PASSWORD_CHARS} characters`, () => {
    expect(checkNewPassword('a'.repeat(MIN_PASSWORD_CHARS - 1) + 'b', context)).toEqual({ ok: true });
    expect(checkNewPassword('ab'.repeat(MAX_PASSWORD_CHARS / 2), context)).toEqual({ ok: true });
  });

  it('refuses one character too short or too long, counting characters, not bytes', () => {
    expect(checkNewPassword('abcdefghijk', context)).toMatchObject({ ok: false, rule: 'too_short' });
    expect(checkNewPassword('ab'.repeat(MAX_PASSWORD_CHARS / 2) + 'c', context)).toMatchObject({ ok: false, rule: 'too_long' });
    // Twelve characters, more than twelve bytes.
    expect(checkNewPassword('äöüäöüäöüäöz', context)).toEqual({ ok: true });
  });

  it('refuses a password that contains the username, in any case', () => {
    expect(checkNewPassword('my-MEMBER-ONE-secret', context)).toMatchObject({ ok: false, rule: 'contains_username' });
  });

  it('refuses one character repeated', () => {
    expect(checkNewPassword('aaaaaaaaaaaaaaaa', context)).toMatchObject({ ok: false, rule: 'repeated' });
  });

  it('refuses the current password', () => {
    expect(checkNewPassword('correct horse battery', { ...context, current: 'correct horse battery' })).toMatchObject({ ok: false, rule: 'same_as_current' });
    expect(checkNewPassword('correct horse battery', { ...context, current: 'another phrase entirely' })).toEqual({ ok: true });
  });
});

describe('canonicalOneTimePassword', () => {
  it('ignores case, dashes and spaces, as a person may type a code from a message', () => {
    expect(canonicalOneTimePassword(' K7QM-2xvd 9hpt-4WCN ')).toBe('k7qm2xvd9hpt4wcn');
  });
});
