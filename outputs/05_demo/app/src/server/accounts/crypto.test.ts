import { scryptSync } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { canonicalOneTimePassword } from '@/shared/accounts';
import {
  HashingBusyError,
  SCRYPT_COST,
  createPasswordHasher,
  newOneTimePassword,
  newSessionToken,
  secretEquals,
} from './crypto';

// A cheap cost keeps the tests fast; one test uses the production cost.
const CHEAP = { N: 2 ** 10, r: 8, p: 1 };

describe('createPasswordHasher', () => {
  it('verifies the password it hashed, and nothing else', async () => {
    const hasher = createPasswordHasher({ cost: CHEAP });
    const stored = await hasher.hash('correct horse battery staple');
    expect(stored).toMatch(/^scrypt\$n=1024,r=8,p=1\$[A-Za-z0-9_-]{22}\$[A-Za-z0-9_-]{43}$/);
    expect(await hasher.verify('correct horse battery staple', stored)).toBe(true);
    expect(await hasher.verify('correct horse battery stapl', stored)).toBe(false);
    expect(await hasher.verify('', stored)).toBe(false);
  });

  it('salts every hash', async () => {
    const hasher = createPasswordHasher({ cost: CHEAP });
    expect(await hasher.hash('same password')).not.toBe(await hasher.hash('same password'));
  });

  it('treats the two Unicode spellings of the same text as the same password', async () => {
    const hasher = createPasswordHasher({ cost: CHEAP });
    const stored = await hasher.hash('café au lait please');
    expect(await hasher.verify('café au lait please', stored)).toBe(true);
  });

  it('works at the production cost, which needs more memory than Node allows by default', async () => {
    expect(() => scryptSync('x', 'salt', 32, SCRYPT_COST)).toThrow(/memory limit/i);
    const hasher = createPasswordHasher();
    const stored = await hasher.hash('a production password');
    expect(stored.startsWith(`scrypt$n=${SCRYPT_COST.N},r=${SCRYPT_COST.r},p=${SCRYPT_COST.p}$`)).toBe(true);
    expect(await hasher.verify('a production password', stored)).toBe(true);
  });

  it('refuses a stored hash whose cost would tie up the server, or that is malformed, without computing it', async () => {
    const hasher = createPasswordHasher({ cost: CHEAP });
    const good = await hasher.hash('a password here');
    const [, , salt, key] = good.split('$');
    for (const params of ['n=1048576,r=8,p=1', 'n=65536,r=8,p=1', 'n=131072,r=8,p=1', 'n=1024,r=16,p=1', 'n=1024,r=8,p=50', 'n=1000,r=8,p=1', 'n=1024,r=8']) {
      expect(await hasher.verify('a password here', `scrypt$${params}$${salt}$${key}`), params).toBe(false);
    }
    for (const junk of ['', 'scrypt$', 'bcrypt$x', `scrypt$n=1024,r=8,p=1$${salt}`, `scrypt$n=1024,r=8,p=1$${salt}$short`]) {
      expect(await hasher.verify('a password here', junk), junk).toBe(false);
    }
  });

  it('refuses a cost above what the memory limit holds before it asks for a hashing slot', async () => {
    const hasher = createPasswordHasher({ cost: CHEAP, maxConcurrent: 1, maxWaiting: 0 });
    const good = await hasher.hash('a password here');
    const [, , salt, key] = good.split('$');
    const busy = hasher.hash('keeps the only slot busy');
    // Refused unread: with the one slot taken and no queue, any attempt to compute would answer busy instead.
    for (const n of [65536, 131072, 1048576]) {
      await expect(hasher.verify('a password here', `scrypt$n=${n},r=8,p=1$${salt}$${key}`), String(n)).resolves.toBe(false);
    }
    await busy;
  });

  it('runs at most the allowed number of hashes at once and answers busy beyond the queue', async () => {
    const hasher = createPasswordHasher({ cost: CHEAP, maxConcurrent: 1, maxWaiting: 1 });
    const first = hasher.hash('one password here');
    const second = hasher.hash('two password here');
    await expect(hasher.hash('three password here')).rejects.toBeInstanceOf(HashingBusyError);
    await expect(first).resolves.toMatch(/^scrypt\$/);
    await expect(second).resolves.toMatch(/^scrypt\$/);
    await expect(hasher.hash('four password here')).resolves.toMatch(/^scrypt\$/);
  });

  it('has a dummy hash at its own cost, which no password matches, for names that do not exist', async () => {
    const hasher = createPasswordHasher({ cost: CHEAP });
    expect(hasher.dummy.startsWith('scrypt$n=1024,r=8,p=1$')).toBe(true);
    expect(await hasher.verify('anything at all', hasher.dummy)).toBe(false);
  });
});

describe('newOneTimePassword', () => {
  it('is 16 characters from an alphabet without look-alikes, in groups of four', () => {
    for (let i = 0; i < 50; i++) {
      const password = newOneTimePassword();
      expect(password).toMatch(/^[2-9a-hjkmnp-z]{4}(-[2-9a-hjkmnp-z]{4}){3}$/);
      expect(canonicalOneTimePassword(password)).toHaveLength(16);
    }
  });

  it('differs each time', () => {
    expect(new Set(Array.from({ length: 100 }, () => newOneTimePassword())).size).toBe(100);
  });
});

describe('newSessionToken', () => {
  it('is 32 random bytes as base64url, different each time', () => {
    const token = newSessionToken();
    expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(newSessionToken()).not.toBe(token);
  });
});

describe('secretEquals', () => {
  it('compares whole values only', () => {
    expect(secretEquals('a-long-admin-password-1', 'a-long-admin-password-1')).toBe(true);
    expect(secretEquals('a-long-admin-password-1', 'a-long-admin-password-2')).toBe(false);
    expect(secretEquals('a-long-admin-password', 'a-long-admin-password-1')).toBe(false);
    expect(secretEquals('', '')).toBe(false);
  });
});
