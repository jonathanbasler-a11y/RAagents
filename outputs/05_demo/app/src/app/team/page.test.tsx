// @vitest-environment jsdom
import { render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ROSTER } from '@/client/test-fixtures';

const registry = vi.hoisted(() => ({ listPublicAgents: vi.fn() }));
vi.mock('@/server/agents', () => registry);

import TeamChatPage from './page';

let logged: ReturnType<typeof vi.spyOn>;
beforeEach(() => {
  registry.listPublicAgents.mockReset();
  logged = vi.spyOn(console, 'error').mockImplementation(() => undefined);
});
afterEach(() => logged.mockRestore());

describe('team chat page (/team)', () => {
  it('renders the team chat', () => {
    registry.listPublicAgents.mockReturnValue(ROSTER);

    render(<TeamChatPage />);

    expect(screen.getByRole('heading', { name: 'Team chat' })).toBeInTheDocument();
    expect(screen.getByRole('textbox', { name: 'Message the team' })).toBeInTheDocument();
  });

  it('renders the setup message when the registry fails', () => {
    registry.listPublicAgents.mockImplementation(() => {
      throw new Error('not implemented: listPublicAgents');
    });

    render(<TeamChatPage />);

    expect(screen.getByRole('heading', { name: 'The agent roster could not be loaded' })).toBeInTheDocument();
  });
});
