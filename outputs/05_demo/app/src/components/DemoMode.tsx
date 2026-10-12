'use client';

import { createContext, useContext, type ReactNode } from 'react';
import type { DemoMode } from '@/shared/contracts';

const DemoModeContext = createContext<DemoMode>('live');

/**
 * Provided once by the app shell from the server's DEMO_MODE. The practice banner, the label on
 * every agent reply and the status panel all follow it, so a stand-in reply can never pass for
 * model output.
 */
export function DemoModeProvider({ mode, children }: { mode: DemoMode; children: ReactNode }) {
  return <DemoModeContext.Provider value={mode}>{children}</DemoModeContext.Provider>;
}

export function useDemoMode(): DemoMode {
  return useContext(DemoModeContext);
}
