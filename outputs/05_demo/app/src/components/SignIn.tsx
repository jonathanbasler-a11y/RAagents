'use client';

import { createContext, useContext, type ReactNode } from 'react';

// Whether the person signed in with their own account (a hosted copy with sign-in on). The pages that record a person's
// decisions say so: the decisions are still stamped as a local, unauthenticated person, not under the person's name.

const SignInContext = createContext(false);

export function SignInProvider({ signedIn, children }: { signedIn: boolean; children: ReactNode }) {
  return <SignInContext.Provider value={signedIn}>{children}</SignInContext.Provider>;
}

/** True when the person signed in with their own account; false on a copy without sign-in. */
export function useSignedIn(): boolean {
  return useContext(SignInContext);
}
