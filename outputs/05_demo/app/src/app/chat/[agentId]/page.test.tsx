// @vitest-environment jsdom
import { render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ROSTER } from '@/client/test-fixtures';

const registry = vi.hoisted(() => ({ listPublicAgents: vi.fn() }));
vi.mock('@/server/agents', () => registry);

import AgentRoomPage from './page';

const paramsFor = (agentId: string) => ({ params: Promise.resolve({ agentId }) });

let logged: ReturnType<typeof vi.spyOn>;
beforeEach(() => {
  registry.listPublicAgents.mockReset();
  logged = vi.spyOn(console, 'error').mockImplementation(() => undefined);
});
afterEach(() => logged.mockRestore());

describe('1:1 room page (/chat/[agentId])', () => {
  it('renders the agent’s room', async () => {
    registry.listPublicAgents.mockReturnValue(ROSTER);

    render(await AgentRoomPage(paramsFor('reglead')));

    expect(screen.getByRole('heading', { name: 'Rosa' })).toBeInTheDocument();
    expect(screen.getByRole('textbox', { name: 'Message Rosa' })).toBeInTheDocument();
  });

  it('is a 404 for an id that is not an active agent, including "team"', async () => {
    registry.listPublicAgents.mockReturnValue(ROSTER);

    await expect(AgentRoomPage(paramsFor('nobody'))).rejects.toMatchObject({ digest: 'NEXT_HTTP_ERROR_FALLBACK;404' });
    await expect(AgentRoomPage(paramsFor('team'))).rejects.toMatchObject({ digest: 'NEXT_HTTP_ERROR_FALLBACK;404' });
  });

  it('renders the setup message when the registry fails', async () => {
    registry.listPublicAgents.mockImplementation(() => {
      throw new Error('not implemented: listPublicAgents');
    });

    render(await AgentRoomPage(paramsFor('reglead')));

    expect(screen.getByRole('heading', { name: 'The agent roster could not be loaded' })).toBeInTheDocument();
  });
});
