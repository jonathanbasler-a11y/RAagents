import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import { AppShell } from '@/components/AppShell';
import { loadPublicAgents } from '@/components/load-agents';
import { currentAccount, layoutPlan } from '@/server/accounts/current';
import { readDemoMode } from '@/server/demo-mode';
import './globals.css';

// The rail lists the agents read from the spec files on every request.
export const dynamic = 'force-dynamic';

const DESCRIPTION = 'Named agent personas with a team chat and 1:1 rooms. A confidential workspace for due diligence preparation.';
const HOSTED_DESCRIPTION = 'Named agent personas with a team chat and 1:1 rooms. A shared hosted copy for practice material.';

export function generateMetadata(): Metadata {
  const hosted = (process.env.RAAGENTS_HOSTED_NOTICE ?? '').trim() !== '';
  return {
    title: { default: 'Digital Human Hybrid Team', template: '%s · Digital Human Hybrid Team' },
    description: hosted ? HOSTED_DESCRIPTION : DESCRIPTION,
    // No favicon file: an empty icon keeps the browser from logging a 404 on every page.
    icons: { icon: 'data:,' },
  };
}

export default async function RootLayout({ children }: { children: ReactNode }) {
  // A hosted copy with sign-in (deploy notes in the repo's Dockerfile): the shell, and the roster it lists, render only
  // for a valid session. The proxy shows the login page for pages; whatever slips past it renders alone.
  const plan = layoutPlan(await currentAccount());
  if (!plan.shell) {
    return (
      <html lang="en">
        <body>
          <main id="main">{children}</main>
        </body>
      </html>
    );
  }
  const roster = loadPublicAgents();
  // Read on every request (this layout is dynamic), so it matches how this server was started.
  const mode = readDemoMode();
  const notice = (process.env.RAAGENTS_HOSTED_NOTICE ?? '').trim() || undefined;
  return (
    <html lang="en">
      <body>
        <AppShell agentsLoad={roster} mode={mode} notice={notice} account={plan.account}>
          {children}
        </AppShell>
      </body>
    </html>
  );
}
