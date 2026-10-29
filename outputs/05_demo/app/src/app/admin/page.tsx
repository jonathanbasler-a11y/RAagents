import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { PeoplePanel } from '@/components/PeoplePanel';
import { currentAccount } from '@/server/accounts/current';

// Rendered per request, like every page here.
export const dynamic = 'force-dynamic';

export const metadata: Metadata = { title: 'People' };

/**
 * "/admin": the People page of a hosted copy with sign-in, for the admin. Absent without sign-in. The proxy already
 * refuses everyone else; the page checks again where it renders.
 */
export default async function AdminPage() {
  const current = await currentAccount();
  if (current.signIn === 'off') notFound();
  if (current.session === null || current.session.role !== 'admin') return <p className="note">Only the admin can see this page.</p>;
  return <PeoplePanel />;
}
