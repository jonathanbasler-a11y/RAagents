import type { Metadata } from 'next';
import Link from 'next/link';
import { MockupWorkspace } from '@/components/workspace/MockupWorkspace';
import { WORKSPACE_BANNER } from '@/components/workspace/screens';
import styles from '@/components/workspace/workspace.module.css';

// Rendered per request, like every page here: the tabs read the address (?screen=).
export const dynamic = 'force-dynamic';

export const metadata: Metadata = { title: 'DD workspace (illustrative)' };

/** "/workspace": UX mockup v2 in a frame, labelled as illustrative, with a way back to the live team chat. */
export default function WorkspacePage() {
  return (
    <section className={styles.workspace} aria-labelledby="workspace-title">
      <p className={styles.banner} role="note">
        {WORKSPACE_BANNER}
      </p>
      <header className={styles.head}>
        <div className={styles.titles}>
          <h1 id="workspace-title" className={styles.title}>
            DD workspace (illustrative)
          </h1>
          <p className="note">
            UX mockup v2: the planned due diligence workspace. Use the tabs or the mockup itself; nothing you do here
            is saved or sent to the agents.
          </p>
        </div>
        <Link href="/team" className="btn btn-primary btn-sm">
          Ask the team (live)
        </Link>
      </header>
      <MockupWorkspace />
    </section>
  );
}
