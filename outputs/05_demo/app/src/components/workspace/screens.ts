// The illustrative DD workspace: UX mockup v2 (outputs/05_demo/ux-mockup/index.html) framed
// in the app. The mockup picks its screen from the URL hash; these are its route ids and labels
// (DATA.routes in that file, in its order). real-mockup.test.ts checks them against the file.
// Safe for client and server: no Node modules here.

export type MockupScreenId = 'request' | 'team' | 'run' | 'findings' | 'requests' | 'briefing' | 'architecture';

export interface MockupScreen {
  id: MockupScreenId;
  label: string;
}

export const MOCKUP_SCREENS: readonly MockupScreen[] = [
  { id: 'request', label: 'Request' },
  { id: 'team', label: 'Regulatory team' },
  { id: 'run', label: 'Run board' },
  { id: 'findings', label: 'Findings and risks' },
  { id: 'requests', label: 'Licensor requests' },
  { id: 'briefing', label: 'Briefing' },
  { id: 'architecture', label: 'Architecture' },
];

/** The mockup's own start screen, also used for a missing or unknown `?screen=`. */
export const DEFAULT_SCREEN: MockupScreenId = 'request';

/** Shown at the top of the workspace page. */
export const WORKSPACE_BANNER = 'Illustrative mockup: example data, not connected to the agents.';

export const WORKSPACE_PATH = '/workspace';

/** The route handler that serves the mockup file (src/app/workspace/mockup/route.ts). */
export const MOCKUP_PATH = '/workspace/mockup';

/** The screen named by a `?screen=` value. Case and surrounding spaces are forgiven; anything else falls back to the start screen. */
export function screenFromParam(value: string | null | undefined): MockupScreenId {
  const wanted = (value ?? '').trim().toLowerCase();
  return MOCKUP_SCREENS.find((screen) => screen.id === wanted)?.id ?? DEFAULT_SCREEN;
}

/** The frame's address for a screen: the mockup route, with the screen as its hash. */
export function mockupSrc(screen: MockupScreenId): string {
  return `${MOCKUP_PATH}#${screen}`;
}

/** The workspace page's address for a screen (a deep link). */
export function workspaceHref(screen: MockupScreenId): string {
  return `${WORKSPACE_PATH}?screen=${screen}`;
}
