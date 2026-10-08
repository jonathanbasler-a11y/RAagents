import Link from 'next/link';
import type { ReactNode } from 'react';
import { AgentRail } from './AgentRail';
import type { AgentsLoad } from './load-agents';
import { SelectionProvider } from './SelectionProvider';

export const PUBLIC_ONLY_BANNER = 'Public information only. Do not paste confidential or company information.';

/** Banner, header, the rail and the page. Rendered by the root layout on every page. */
export function AppShell({ agentsLoad, children }: { agentsLoad: AgentsLoad; children: ReactNode }) {
  return (
    <div className="app">
      <a className="skip" href="#main">
        Skip to content
      </a>
      <div className="banner" role="note">
        {PUBLIC_ONLY_BANNER}
      </div>
      <header className="docbar">
        <Link href="/" className="product">
          <b>Digital Human Hybrid Team</b>
          <span>Agent personas · team chat and 1:1 rooms</span>
        </Link>
        <p className="doc-control">
          In this phase no documents and no tools are connected. Agent replies are model output, not sources.
        </p>
      </header>
      <SelectionProvider>
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
      </SelectionProvider>
    </div>
  );
}
