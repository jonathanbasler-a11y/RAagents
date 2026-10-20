import Link from 'next/link';

/** A short card on the DD workspace page. The briefing is built when it is opened, so the card says what it is and nothing about its content. */
export function BriefingCard() {
  return (
    <section className="sheet data-room-card" aria-labelledby="briefing-card-title">
      <div>
        <h2 id="briefing-card-title">Briefing</h2>
        <p>Built by code from the accepted, tagged findings and the checklist, with what is missing said plainly. It is not a decision.</p>
      </div>
      <Link className="btn" href="/briefing">
        Open the briefing
      </Link>
    </section>
  );
}
