import { describe, expect, it } from 'vitest';
import { DEFAULT_SCREEN, MOCKUP_SCREENS, mockupSrc, screenFromParam, WORKSPACE_BANNER, workspaceHref } from './screens';

describe('mockup screens', () => {
  it('lists the seven screens of mockup v2 with their ids and labels, in its order', () => {
    expect(MOCKUP_SCREENS.map((screen) => [screen.id, screen.label])).toEqual([
      ['request', 'Request'],
      ['team', 'Regulatory team'],
      ['run', 'Run board'],
      ['findings', 'Findings and risks'],
      ['requests', 'Licensor requests'],
      ['briefing', 'Briefing'],
      ['architecture', 'Architecture'],
    ]);
    expect(DEFAULT_SCREEN).toBe('request');
  });

  it('says plainly that the workspace is illustrative', () => {
    expect(WORKSPACE_BANNER).toBe('Illustrative mockup: example data, not connected to the agents.');
  });

  it('points the frame at the mockup route with the screen as its hash, and the page link at ?screen=', () => {
    expect(mockupSrc('findings')).toBe('/workspace/mockup#findings');
    expect(mockupSrc('request')).toBe('/workspace/mockup#request');
    expect(workspaceHref('run')).toBe('/workspace?screen=run');
  });
});

describe('screenFromParam', () => {
  it.each(MOCKUP_SCREENS.map((screen) => screen.id))('accepts the screen id %s', (id) => {
    expect(screenFromParam(id)).toBe(id);
  });

  it('forgives case and surrounding spaces in a typed link', () => {
    expect(screenFromParam(' Findings ')).toBe('findings');
  });

  it.each([
    ['missing', undefined],
    ['null', null],
    ['empty', ''],
    ['unknown', 'board'],
    ['a label instead of an id', 'Run board'],
    ['an object key', '__proto__'],
    ['an inherited name', 'constructor'],
    ['a hash', '#findings'],
  ])('falls back to the request screen for a %s value', (_case, value) => {
    expect(screenFromParam(value)).toBe('request');
  });
});
