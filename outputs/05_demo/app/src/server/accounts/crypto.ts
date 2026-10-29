import 'server-only';
import { createHash, randomBytes, randomInt, scrypt, timingSafeEqual, type ScryptOptions } from 'node:crypto';

// Passwords, one-time passwords and session tokens for the accounts of a hosted copy (src/server/accounts/store.ts).
//
// Passwords are scrypt hashes, computed on Node's thread pool (never the blocking variant) and at most two at a time, so a
// burst of sign-ins cannot tie up the processor or the memory of a small container. Stored as
// "scrypt$n=<N>,r=<r>,p=<p>$<salt>$<key>" (base64url), so the cost can be raised later without breaking old hashes.

export interface ScryptCost {
  N: number;
  r: number;
  p: number;
}

/** OWASP's minimum for scrypt. About 32 MiB per hash; measure in the container (N=2^14, p=5 is the equivalent fallback). */
export const SCRYPT_COST: ScryptCost = { N: 2 ** 15, r: 8, p: 3 };
/** Node's default (32 MiB) is too small for N=2^15, r=8: the call throws before it starts. */
const SCRYPT_MAXMEM = 64 * 1024 * 1024;
const SALT_BYTES = 16;
const KEY_BYTES = 32;
/** A stored hash asking for more than this is refused unread, so a tampered row cannot exhaust the server. */
const MAX_N = 2 ** 17;
const MAX_P = 10;

export class HashingBusyError extends Error {
  constructor() {
    super('too many passwords are being checked at once');
    this.name = 'HashingBusyError';
  }
}

export interface PasswordHasher {
  hash(password: string): Promise<string>;
  /** False for a wrong password and for any stored value that is not a hash this hasher accepts. Throws HashingBusyError. */
  verify(password: string, stored: string): Promise<boolean>;
  /** A well-formed hash at this hasher's cost that no password matches: checking an unknown name against it takes as long. */
  readonly dummy: string;
}

export interface PasswordHasherOptions {
  cost?: ScryptCost;
  /** Hashes computed at once. Default 2. */
  maxConcurrent?: number;
  /** Hashes waiting for a turn; beyond that, HashingBusyError. Default 10. */
  maxWaiting?: number;
}

function deriveKey(password: string, salt: Buffer, cost: ScryptCost): Promise<Buffer> {
  const options: ScryptOptions = { N: cost.N, r: cost.r, p: cost.p, maxmem: SCRYPT_MAXMEM };
  return new Promise((resolve, reject) => {
    scrypt(password.normalize('NFC'), salt, KEY_BYTES, options, (error, key) => (error ? reject(error) : resolve(key)));
  });
}

function format(cost: ScryptCost, salt: Buffer, key: Buffer): string {
  return `scrypt$n=${cost.N},r=${cost.r},p=${cost.p}$${salt.toString('base64url')}$${key.toString('base64url')}`;
}

const STORED = /^scrypt\$n=(\d+),r=(\d+),p=(\d+)\$([A-Za-z0-9_-]{22})\$([A-Za-z0-9_-]{43})$/;

function parse(stored: string): { cost: ScryptCost; salt: Buffer; key: Buffer } | null {
  const match = STORED.exec(stored);
  if (match === null) return null;
  const cost = { N: Number(match[1]), r: Number(match[2]), p: Number(match[3]) };
  const powerOfTwo = cost.N >= 2 && (cost.N & (cost.N - 1)) === 0;
  if (!powerOfTwo || cost.N > MAX_N || cost.r !== 8 || cost.p < 1 || cost.p > MAX_P) return null;
  return { cost, salt: Buffer.from(match[4], 'base64url'), key: Buffer.from(match[5], 'base64url') };
}

export function createPasswordHasher(options: PasswordHasherOptions = {}): PasswordHasher {
  const cost = options.cost ?? SCRYPT_COST;
  const maxConcurrent = options.maxConcurrent ?? 2;
  const maxWaiting = options.maxWaiting ?? 10;
  let running = 0;
  const waiting: Array<() => void> = [];

  /** Runs `work` when a slot is free; refuses at once when the queue is full. */
  async function limited<T>(work: () => Promise<T>): Promise<T> {
    if (running >= maxConcurrent) {
      if (waiting.length >= maxWaiting) throw new HashingBusyError();
      await new Promise<void>((resolve) => waiting.push(resolve));
    }
    running += 1;
    try {
      return await work();
    } finally {
      running -= 1;
      waiting.shift()?.();
    }
  }

  return {
    hash(password) {
      return limited(async () => {
        const salt = randomBytes(SALT_BYTES);
        return format(cost, salt, await deriveKey(password, salt, cost));
      });
    },
    async verify(password, stored) {
      const parsed = parse(stored);
      if (parsed === null) return false;
      const key = await limited(() => deriveKey(password, parsed.salt, parsed.cost));
      return key.length === parsed.key.length && timingSafeEqual(key, parsed.key);
    },
    dummy: format(cost, Buffer.alloc(SALT_BYTES), Buffer.alloc(KEY_BYTES)),
  };
}

/** No 0/1, i/l or o: people copy it from a message. 31 symbols, 16 of them: about 79 bits. */
const ONE_TIME_ALPHABET = '23456789abcdefghjkmnpqrstuvwxyz';

/** A one-time password for a new or reset account, shown as xxxx-xxxx-xxxx-xxxx. Compare it through canonicalOneTimePassword. */
export function newOneTimePassword(): string {
  const chars = Array.from({ length: 16 }, () => ONE_TIME_ALPHABET[randomInt(ONE_TIME_ALPHABET.length)]);
  return [0, 4, 8, 12].map((start) => chars.slice(start, start + 4).join('')).join('-');
}

/** 32 random bytes, base64url: the session cookie's value. The database keeps only its SHA-256. */
export function newSessionToken(): string {
  return randomBytes(32).toString('base64url');
}

/** Whole-value comparison of two secrets in constant time (over their digests, so the length does not leak). Empty never matches. */
export function secretEquals(a: string, b: string): boolean {
  if (a === '' || b === '') return false;
  const digest = (value: string) => createHash('sha256').update(value, 'utf8').digest();
  return timingSafeEqual(digest(a), digest(b));
}
