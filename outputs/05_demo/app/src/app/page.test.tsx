// @vitest-environment jsdom
import { render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ROSTER } from '@/client/test-fixtures';

const registry = vi.hoisted(() => ({ listPublicAgents: vi.fn() }));
vi.mock('@/server/agents', () => registry);

import TeamPage from './page';

let logged: ReturnType<typeof vi.spyOn>;
beforeEach(() => {
  registry.listPublicAgents.mockReset();
  logged = vi.spyOn(console, 'error').mockImplementation(() => undefined);
});
afterEach(() => logged.mockRestore());

describe('team page (/)', () => {
  it('renders the team overview from the registry', () => {
    registry.listPublicAgents.mockReturnValue(ROSTER);

    render(<TeamPage />);

    expect(screen.getByRole('heading', { name: 'Your hybrid team' })).toBeInTheDocument();
    expect(screen.getByRole('article', { name: 'Rosa' })).toBeInTheDocument();
  });

  it('renders a clear setup message when the registry fails', () => {
    registry.listPublicAgents.mockImplementation(() => {
      throw new Error('not implemented: listPublicAgents');
    });

    render(<TeamPage />);

    expect(screen.getByRole('heading', { name: 'The agent roster could not be loaded' })).toBeInTheDocument();
    expect(screen.queryByRole('article')).not.toBeInTheDocument();
  });
});
