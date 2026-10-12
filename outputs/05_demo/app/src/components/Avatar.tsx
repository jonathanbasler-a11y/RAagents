'use client';

import { useState } from 'react';

/**
 * An agent's picture (a static SVG under public/avatars/). Decorative: the name is
 * always shown next to it. If the file is missing, the agent's letter stands in.
 */
export function Avatar({ src, letter, size = 36 }: { src?: string | null; letter: string; size?: number }) {
  const [failed, setFailed] = useState(false);
  if (!src || failed) {
    return (
      <span className="avatar avatar-letter" style={{ width: size, height: size }} aria-hidden="true">
        {letter}
      </span>
    );
  }
  return (
    // eslint-disable-next-line @next/next/no-img-element -- small static SVGs from public/; next/image adds nothing here
    <img className="avatar" src={src} alt="" width={size} height={size} onError={() => setFailed(true)} />
  );
}
