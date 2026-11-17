'use client';

import { createContext, useContext, type ReactNode } from 'react';

// Who is signed in, for the pages that record a person's decisions: the name those decisions are recorded under
// (decisionActor, from the server's session), or null on a copy without sign-in, where they are recorded as the local,
// unauthenticated person.

const SignInContext = createContext<string | null>(null);

export function SignInProvider({ decisionName, children }: { decisionName: string | null; children: ReactNode }) {
  return <SignInContext.Provider value={decisionName}>{children}</SignInContext.Provider>;
}

/** The name the signed-in person's decisions are recorded under; null on a copy without sign-in. */
export function useDecisionName(): string | null {
  return useContext(SignInContext);
}
