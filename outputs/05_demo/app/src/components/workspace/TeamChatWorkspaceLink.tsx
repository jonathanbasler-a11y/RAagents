'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { WORKSPACE_PATH } from './screens';
import styles from './workspace.module.css';

/** The team chat's small link to the illustrative workspace. The app shell renders it above every page; it shows on /team only. */
export function TeamChatWorkspaceLink() {
  if (usePathname() !== '/team') return null;
  return (
    <p className={styles.crossLink}>
      <Link href={WORKSPACE_PATH}>Open the DD workspace (illustrative)</Link>
    </p>
  );
}
