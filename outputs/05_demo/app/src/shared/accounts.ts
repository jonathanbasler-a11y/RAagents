// Accounts for a copy hosted for a team: sign-in is on when RAAGENTS_ADMIN_PASSWORD is set (src/server/access-gate.ts).
// Pure, so the server, the pages and the tests use the same rules. A local copy never shows any of this.
//
// Each person has an account the admin created on the People page. The admin from the server settings has one too. The
// admin hands a new person a one-time password; at the first sign-in the person chooses their own.

export const MIN_PASSWORD_CHARS = 12;
export const MAX_PASSWORD_CHARS = 128;
/** A session lasts 12 hours from sign-in, with no renewal. */
export const SESSION_TTL_MS = 12 * 60 * 60 * 1000;
/** A one-time password works for 7 days; after that the admin issues a new one. */
export const ONE_TIME_PASSWORD_TTL_MS = 7 * 24 * 60 * 60 * 1000;

export type AccountRole = 'admin' | 'member';
/** 'server': the admin from the server settings; 'app': a person the admin created on the People page. */
export type AccountManagedBy = 'server' | 'app';

/** The person behind a valid session, as the gate and the pages see them. */
export interface SessionView {
  accountId: string;
  username: string;
  role: AccountRole;
  managedBy: AccountManagedBy;
  /** True until the person has replaced a one-time password with their own. */
  mustChangePassword: boolean;
  expiresAt: string;
  /** With company sign-in: the name the provider sent at the last sign-in; null otherwise. */
  displayName: string | null;
}

/** The person signed in, as the app's header shows them. */
export interface ShellAccount {
  username: string;
  isAdmin: boolean;
  /** False for the admin from the server settings, whose password is set there. */
  canChangePassword: boolean;
}

/**
 * waiting: has a one-time password that still works; expired: that password no longer works; invited: added by company
 * e-mail and has not signed in yet.
 */
export type PersonStatus = 'active' | 'waiting' | 'expired' | 'invited' | 'disabled';

/** How a person signs in: with a password, or with the company account (company sign-in). */
export type SignInMethod = 'password' | 'company';

/** One row of the People page. Never holds a password or a hash. */
export interface PersonSummary {
  username: string;
  role: AccountRole;
  managedBy: AccountManagedBy;
  status: PersonStatus;
  signIn: SignInMethod;
  /** The company e-mail address, for a person who signs in with the company account; null otherwise. */
  email: string | null;
  /** Until when the one-time password works; null when the person has their own password. */
  oneTimeExpiresAt: string | null;
  createdAt: string;
  createdBy: string;
  lastSignInAt: string | null;
  /** Sessions that are neither revoked nor expired. */
  openSessions: number;
}

/** GET /api/admin/people */
export interface PeopleResponse {
  people: PersonSummary[];
}

export const PERSON_ACTIONS = ['reset', 'disable', 'enable'] as const;
export type PersonAction = (typeof PERSON_ACTIONS)[number];

/** POST /api/admin/people and the reset action: the only place a one-time password ever appears, once. */
export interface OneTimePasswordResponse {
  person: PersonSummary;
  oneTimePassword: string;
  expiresAt: string;
}

/** POST /api/admin/people/[username] for disable and enable. */
export interface PersonResponse {
  person: PersonSummary;
}

export type RuleCheck = { ok: true } | { ok: false; message: string };

const USERNAME = /^[a-z0-9][a-z0-9._-]{1,31}$/;
/** "server" is the actor recorded for what the server itself did at start. */
const RESERVED_USERNAMES = new Set(['server']);

/** What a person typed, as a username: trimmed and lower-cased. */
export function normalizeUsername(value: string): string {
  return value.trim().toLowerCase();
}

/** The same rule as the database's CHECK on accounts.username, with a readable message. */
export function checkUsername(username: string): RuleCheck {
  if (!USERNAME.test(username)) {
    return {
      ok: false,
      message:
        'A username has 2 to 32 characters: lower-case letters, digits, dots, dashes or underscores, starting with a letter or a digit.',
    };
  }
  if (RESERVED_USERNAMES.has(username)) return { ok: false, message: `"${username}" is reserved. Choose another username.` };
  return { ok: true };
}

const MIN_USERNAME_CHARS = 2;
const MAX_USERNAME_CHARS = 32;

/**
 * A username for a person added by company e-mail: the part before the @, with every character the username rule does not
 * allow turned into a dash, starting with a letter or a digit, cut to 32 characters; a name too short gets "-person", and
 * a taken or reserved one "-2", "-3"... (cut again so the suffix fits). Always a name checkUsername accepts.
 */
export function usernameFromEmail(email: string, taken: (username: string) => boolean): string {
  const local = email.slice(0, Math.max(0, email.indexOf('@')));
  let base = local.toLowerCase().replace(/[^a-z0-9._-]/g, '-').replace(/^[^a-z0-9]+/, '').slice(0, MAX_USERNAME_CHARS);
  if (base.length < MIN_USERNAME_CHARS) base = base === '' ? 'person' : `${base}-person`;
  for (let n = 1; n < 10_000; n += 1) {
    const suffix = n === 1 ? '' : `-${n}`;
    const candidate = `${base.slice(0, MAX_USERNAME_CHARS - suffix.length)}${suffix}`;
    if (checkUsername(candidate).ok && !taken(candidate)) return candidate;
  }
  throw new Error('no free username for this e-mail address');
}

/** One company address: a name, one @, a domain with a dot; lower-case letters, digits and . + _ - only. */
const EMAIL = /^[a-z0-9.+_-]+@[a-z0-9-]+(\.[a-z0-9-]+)+$/;
const MAX_EMAIL_CHARS = 254;

/** An e-mail address as typed by the admin or sent by the sign-in provider: trimmed and lower-cased, so the two compare equal. */
export function normalizeEmail(value: string): string {
  return value.trim().toLowerCase();
}

/** The rule for a company e-mail address (the database checks the same, schema version 8), on a normalized address. */
export function checkEmail(email: string): RuleCheck {
  if (email.length > MAX_EMAIL_CHARS || !EMAIL.test(email)) {
    return {
      ok: false,
      message: 'An e-mail address has a name, one @ and a domain with a dot, in lower-case letters, digits and . + _ - only.',
    };
  }
  return { ok: true };
}

export type PasswordRule = 'too_short' | 'too_long' | 'repeated' | 'contains_username' | 'same_as_current';

export type PasswordCheck = { ok: true } | { ok: false; rule: PasswordRule; message: string };

/** Rules for a password a person chooses. Length counts characters, not bytes; nothing else is required. */
export function checkNewPassword(password: string, context: { username: string; current?: string }): PasswordCheck {
  const chars = [...password.normalize('NFC')].length;
  if (chars < MIN_PASSWORD_CHARS) {
    return { ok: false, rule: 'too_short', message: `Choose at least ${MIN_PASSWORD_CHARS} characters. A short sentence works well.` };
  }
  if (chars > MAX_PASSWORD_CHARS) return { ok: false, rule: 'too_long', message: `Choose at most ${MAX_PASSWORD_CHARS} characters.` };
  if (/^(.)\1*$/su.test(password)) return { ok: false, rule: 'repeated', message: 'Choose a password that is not one character repeated.' };
  if (context.username !== '' && password.toLowerCase().includes(context.username.toLowerCase())) {
    return { ok: false, rule: 'contains_username', message: 'Choose a password that does not contain your username.' };
  }
  if (context.current !== undefined && password === context.current) {
    return { ok: false, rule: 'same_as_current', message: 'Choose a password different from the one you have now.' };
  }
  return { ok: true };
}

/** A one-time password as stored and compared: case, dashes and spaces do not matter, since people type it from a message. */
export function canonicalOneTimePassword(value: string): string {
  return value.toLowerCase().replace(/[\s-]/g, '');
}
