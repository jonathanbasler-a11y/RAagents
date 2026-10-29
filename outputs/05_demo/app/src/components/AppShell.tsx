import Link from 'next/link';
import type { ReactNode } from 'react';
import type { ShellAccount } from '@/shared/accounts';
import type { DemoMode } from '@/shared/contracts';
import { AgentRail } from './AgentRail';
import { PracticeBanner } from './Banners';
import { ChecklistProvider } from './ChecklistProvider';
import { GatesProvider } from './GatesProvider';
import { DataRoomProvider } from './DataRoomProvider';
import { DdSetupProvider } from './DdSetupProvider';
import { DemoModeProvider } from './DemoMode';
import { FindingsProvider } from './FindingsProvider';
import { PhaseLine } from './DocumentsNotes';
import type { AgentsLoad } from './load-agents';
import { SelectionProvider } from './SelectionProvider';
import { SignInProvider } from './SignIn';

export const CONFIDENTIAL_BANNER =
  "Confidential workspace. Chats stay on this computer and go to your company's model gateway; agents cannot promise secrecy or deletion.";

/**
 * Banner, header, the rail and the page. Rendered by the root layout on every page. `mode` comes
 * from the server's DEMO_MODE: in practice mode every page and every reply says it is stand-in text.
 * On a hosted copy the root layout passes `notice` (RAAGENTS_HOSTED_NOTICE), which replaces the
 * confidential-workspace banner because chats there do not stay on one computer, and, with sign-in
 * on, the `account` signed in (null: none could be read, so only sign-out is offered).
 */
export function AppShell({
  agentsLoad,
  mode = 'live',
  notice,
  account,
  children,
}: {
  agentsLoad: AgentsLoad;
  mode?: DemoMode;
  notice?: string;
  /** Left out when sign-in is off. */
  account?: ShellAccount | null;
  children: ReactNode;
}) {
  return (
    <DemoModeProvider mode={mode}>
      <div className="app">
        <a className="skip" href="#main">
          Skip to content
        </a>
        <div className="banner" role="note">
          {notice !== undefined && notice.trim() !== '' ? notice : CONFIDENTIAL_BANNER}
        </div>
        <PracticeBanner mode={mode} />
        <DataRoomProvider>
          <header className="docbar">
            <Link href="/" className="product">
              <b>Digital Human Hybrid Team</b>
              <span>Agent personas · team chat and 1:1 rooms</span>
            </Link>
            <PhaseLine mode={mode} />
            {account === undefined ? null : (
              <div className="account">
                {account === null ? null : (
                  <>
                    <span className="account-name">Signed in as {account.username}</span>
                    {account.canChangePassword ? <a href="/account/password">Change password</a> : null}
                    {account.isAdmin ? <Link href="/admin">People</Link> : null}
                  </>
                )}
                <form method="post" action="/api/logout" className="sign-out">
                  <button type="submit">Sign out</button>
                </form>
              </div>
            )}
          </header>
          <SignInProvider signedIn={account !== undefined && account !== null}>
          <FindingsProvider>
            <ChecklistProvider>
            <GatesProvider>
            <SelectionProvider>
              <DdSetupProvider>
                <div className="shell">
                  {agentsLoad.ok ? (
                    <AgentRail agents={agentsLoad.agents} />
                  ) : (
                    <nav className="rail" aria-label="Rooms">
                      <p className="note rail-note">Agents unavailable: see the setup message.</p>
                    </nav>
                  )}
                  <main id="main" className="main" tabIndex={-1}>
                    {children}
                  </main>
                </div>
              </DdSetupProvider>
            </SelectionProvider>
            </GatesProvider>
            </ChecklistProvider>
          </FindingsProvider>
          </SignInProvider>
        </DataRoomProvider>
      </div>
    </DemoModeProvider>
  );
}
