// @vitest-environment jsdom
import { render, screen, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

// The real hook follows the address bar; so does this stand-in.
vi.mock('next/navigation', () => ({ useSearchParams: () => new URLSearchParams(window.location.search) }));

import WorkspacePage, { dynamic, metadata } from './page';

const BANNER = 'Illustrative mockup: example data, not connected to the agents.';
const LABELS = ['Request', 'Regulatory team', 'Run board', 'Findings and risks', 'Licensor requests', 'Briefing', 'Architecture'];

beforeEach(() => {
  window.history.replaceState(null, '', '/workspace');
});

describe('workspace page (/workspace)', () => {
  it('says first, in a banner, that it is an illustrative mockup', () => {
    render(<WorkspacePage />);

    const banner = screen.getByText(BANNER);
    expect(banner).toHaveAttribute('role', 'note');
    const heading = screen.getByRole('heading', { level: 1 });
    expect(banner.compareDocumentPosition(heading) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('shows the heading, all seven screen tabs and the framed mockup', () => {
    render(<WorkspacePage />);

    expect(screen.getByRole('heading', { level: 1, name: 'DD workspace (illustrative)' })).toBeInTheDocument();
    const nav = screen.getByRole('navigation', { name: 'Mockup screens' });
    expect(within(nav).getAllByRole('link').map((link) => link.textContent)).toEqual(LABELS);
    expect(screen.getByTitle(/mockup/i)).toHaveAttribute('src', '/workspace/mockup#request');
  });

  it('links back to the live team chat', () => {
    render(<WorkspacePage />);

    expect(screen.getByRole('link', { name: 'Ask the team (live)' })).toHaveAttribute('href', '/team');
  });

  it('opens the screen a deep link names', () => {
    window.history.replaceState(null, '', '/workspace?screen=findings');

    render(<WorkspacePage />);

    expect(screen.getByTitle(/mockup/i)).toHaveAttribute('src', '/workspace/mockup#findings');
    expect(screen.getByRole('link', { name: 'Findings and risks' })).toHaveAttribute('aria-current', 'page');
  });

  it('is rendered per request and titled as illustrative', () => {
    expect(dynamic).toBe('force-dynamic');
    expect(metadata.title).toBe('DD workspace (illustrative)');
  });
});
