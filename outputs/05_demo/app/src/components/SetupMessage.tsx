/** Replaces a page when the agent roster cannot be loaded. */
export function SetupMessage({ title, detail, issues }: { title: string; detail: string; issues: string[] }) {
  return (
    <section className="sheet setup-message" aria-labelledby="setup-title">
      <h1 id="setup-title">{title}</h1>
      <p>{detail}</p>
      {issues.length > 0 && (
        <ul className="setup-issues">
          {issues.map((issue) => (
            <li key={issue}>
              <code>{issue}</code>
            </li>
          ))}
        </ul>
      )}
      <p className="note">
        The specs live in <code>outputs/04_agents/</code>; the authoring guide is <code>outputs/04_agents/README.md</code>.
      </p>
    </section>
  );
}
