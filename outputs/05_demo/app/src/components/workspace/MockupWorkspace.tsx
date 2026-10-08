'use client';

import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { useEffect, useRef, useState, type MouseEvent } from 'react';
import { MOCKUP_SCREENS, mockupSrc, screenFromParam, workspaceHref, type MockupScreenId } from './screens';
import styles from './workspace.module.css';

/** Switches the framed mockup to another screen (the same file with another hash). */
export type ShowInFrame = (frame: HTMLIFrameElement, src: string) => void;

/**
 * Replacing the frame's location with the same file and another hash is a same-document hash
 * change: the mockup re-renders without reloading, keeps whatever was clicked in it, and no
 * history entry is added. A parent may replace a sandboxed frame's location even though the
 * frame has its own origin. Before the frame has a window, its src attribute does the job.
 */
export function showScreenInFrame(frame: HTMLIFrameElement, src: string): void {
  const view = frame.contentWindow;
  if (view) {
    try {
      view.location.replace(src);
      return;
    } catch {
      // Fall back to the attribute below.
    }
  }
  frame.src = src;
}

function isPlainLeftClick(event: MouseEvent): boolean {
  return event.button === 0 && !event.metaKey && !event.ctrlKey && !event.shiftKey && !event.altKey;
}

/**
 * The screen tabs and the framed mockup. The address (`?screen=`) names the screen, so a link
 * or a reload lands on it; a tab switches the frame in place and updates the address.
 *
 * The frame is sandboxed with scripts only: the mockup's own script runs, but with an opaque
 * origin, so it cannot reach the app's pages, storage or API (the mockup route's CSP adds the
 * same sandbox and blocks every fetch). The flip side: the app cannot see clicks on the
 * mockup's own tabs, so the highlighted tab is the screen last opened from this row.
 */
export function MockupWorkspace({ showInFrame = showScreenInFrame }: { showInFrame?: ShowInFrame }) {
  const urlScreen = screenFromParam(useSearchParams().get('screen'));
  const [screen, setScreen] = useState(urlScreen);
  const [seenUrlScreen, setSeenUrlScreen] = useState(urlScreen);
  // The frame keeps its first src, so React never reloads the mockup; later switches use showInFrame.
  const [frameSrc] = useState(() => mockupSrc(urlScreen));
  const frame = useRef<HTMLIFrameElement>(null);
  const shown = useRef(urlScreen);

  // The address can also change from outside, for example the rail's link back to /workspace.
  if (urlScreen !== seenUrlScreen) {
    setSeenUrlScreen(urlScreen);
    setScreen(urlScreen);
  }

  useEffect(() => {
    if (screen === shown.current || !frame.current) return;
    shown.current = screen;
    showInFrame(frame.current, mockupSrc(screen));
  }, [screen, showInFrame]);

  function open(event: MouseEvent<HTMLAnchorElement>, id: MockupScreenId) {
    if (!isPlainLeftClick(event)) return; // a new tab or window: the link itself does it
    event.preventDefault();
    shown.current = id;
    setScreen(id);
    window.history.replaceState(null, '', workspaceHref(id));
    // Even for the highlighted tab: the mockup's own tabs may have moved the frame elsewhere.
    if (frame.current) showInFrame(frame.current, mockupSrc(id));
  }

  return (
    <>
      <nav className={styles.tabs} aria-label="Mockup screens">
        <ul className={styles.tabList}>
          {MOCKUP_SCREENS.map((item) => (
            <li key={item.id}>
              <Link
                href={workspaceHref(item.id)}
                prefetch={false}
                className={styles.tab}
                aria-current={item.id === screen ? 'page' : undefined}
                onClick={(event) => open(event, item.id)}
              >
                {item.label}
              </Link>
            </li>
          ))}
        </ul>
      </nav>
      <iframe
        ref={frame}
        className={styles.frame}
        src={frameSrc}
        title="DD workspace mockup v2 (illustrative, example data)"
        sandbox="allow-scripts"
      />
    </>
  );
}
