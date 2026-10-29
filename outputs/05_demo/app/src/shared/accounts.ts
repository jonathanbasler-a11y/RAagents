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
}

/** The person signed in, as the app's header shows them. */
export interface ShellAccount {
  username: string;
  isAdmin: boolean;
  /** False for the admin from the server settings, whose password is set there. */
  canChangePassword: boolean;
}

/** waiting: has a one-time password that still works; expired: that password no longer works. */
export type PersonStatus = 'active' | 'waiting' | 'expired' | 'disabled';

/** One row of the People page. Never holds a password or a hash. */
export interface PersonSummary {
  username: string;
  role: AccountRole;
  managedBy: AccountManagedBy;
  status: PersonStatus;
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
