import type { LlmSetupStatus } from '@/shared/contracts';
import { useDocumentsConnected } from './DataRoomProvider';
import { PRACTICE_MODE_BANNER, evidenceBannerText } from './labels';

/**
 * Practice mode: replies come from the stand-in model. Persistent and not dismissible: it is
 * meant to sit under the "Confidential workspace" banner on every page. Live renders nothing.
 */
export function PracticeBanner({ mode }: { mode: 'live' | 'practice' }) {
  if (mode !== 'practice') return null;
  return (
    <div className="banner banner-practice" role="note">
      {PRACTICE_MODE_BANNER}
    </div>
  );
}

/** Shown when GET /api/health says the agents' model route is not set up. Names only, never values. */
export function SetupBanner({ llm }: { llm: LlmSetupStatus }) {
  return (
    <div className="banner-setup" role="alert">
      <p>
        <strong>Setup needed.</strong>
      </p>
      <p>{llm.message ?? 'The model connection is not set up, so the agents cannot answer.'}</p>
      {llm.missing.length > 0 && (
        <p className="banner-missing">
          Missing:{' '}
          {llm.missing.map((name, index) => (
            <span key={name}>
              {index > 0 && ', '}
              <code>{name}</code>
            </span>
          ))}
        </p>
      )}
    </div>
  );
}

/** The evidence checker's room: what he can check, which depends on whether a data room is connected. */
export function EvidenceBanner({ name }: { name: string }) {
  const { documents } = useDocumentsConnected();
  return (
    <p className="banner-room" role="note">
      {evidenceBannerText(documents, name)}
    </p>
  );
}
