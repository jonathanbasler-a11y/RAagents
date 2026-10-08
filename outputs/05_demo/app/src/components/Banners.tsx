import type { LlmSetupStatus } from '@/shared/contracts';

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

/** The evidence checker's room: no documents are connected in this phase. */
export function EvidenceBanner({ name }: { name: string }) {
  return (
    <p className="banner-room" role="note">
      No documents are connected yet, so {name} cannot verify anything. He can explain what evidence a claim would need.
    </p>
  );
}
