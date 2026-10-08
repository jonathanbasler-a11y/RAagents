import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import { AppShell } from '@/components/AppShell';
import { loadPublicAgents } from '@/components/load-agents';
import './globals.css';

// The rail lists the agents read from the spec files on every request.
export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: { default: 'Digital Human Hybrid Team', template: '%s · Digital Human Hybrid Team' },
  description: 'Named agent personas with a team chat and 1:1 rooms. A demo on public information only.',
  // No favicon file: an empty icon keeps the browser from logging a 404 on every page.
  icons: { icon: 'data:,' },
};

export default function RootLayout({ children }: { children: ReactNode }) {
  const roster = loadPublicAgents();
  return (
    <html lang="en">
      <body>
        <AppShell agentsLoad={roster}>{children}</AppShell>
      </body>
    </html>
  );
}
