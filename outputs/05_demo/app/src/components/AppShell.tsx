import Link from 'next/link';
import type { ReactNode } from 'react';
import type { DemoMode } from '@/shared/contracts';
import { AgentRail } from './AgentRail';
import { PracticeBanner } from './Banners';
import { DataRoomProvider } from './DataRoomProvider';
import { DdSetupProvider } from './DdSetupProvider';
import { DemoModeProvider } from './DemoMode';
import { FindingsProvider } from './FindingsProvider';
import { PhaseLine } from './DocumentsNotes';
import type { AgentsLoad } from './load-agents';
import { SelectionProvider } from './SelectionProvider';

export const CONFIDENTIAL_BANNER =
  "Confidential workspace. Chats stay on this computer and go to your company's model gateway; agents cannot promise secrecy or deletion.";

/**
 * Banner, header, the rail and the page. Rendered by the root layout on every page. `mode` comes
 * from the server's DEMO_MODE: in practice mode every page and every reply says it is stand-in text.
 */
export function AppShell({
  agentsLoad,
  mode = 'live',
  children,
}: {
  agentsLoad: AgentsLoad;
  mode?: DemoMode;
  children: ReactNode;
}) {
  return (
    <DemoModeProvider mode={mode}>
      <div className="app">
        <a className="skip" href="#main">
          Skip to content
        </a>
        <div className="banner" role="note">
          {CONFIDENTIAL_BANNER}
        </div>
        <PracticeBanner mode={mode} />
        <DataRoomProvider>
          <header className="docbar">
            <Link href="/" className="product">
              <b>Digital Human Hybrid Team</b>
              <span>Agent personas · team chat and 1:1 rooms</span>
            </Link>
            <PhaseLine mode={mode} />
          </header>
          <FindingsProvider>
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
          </FindingsProvider>
        </DataRoomProvider>
      </div>
    </DemoModeProvider>
  );
}
