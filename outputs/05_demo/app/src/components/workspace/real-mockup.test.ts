import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { MOCKUP_SCREENS } from './screens';

// The workspace page frames the real mockup file and picks its screen by URL hash. Another
// session maintains that file, so these tests pin what the page relies on: its route ids and
// labels (DATA.routes) and its hash routing. If they fail, update screens.ts to match the file.

const MOCKUP_FILE = path.resolve(process.cwd(), '..', 'ux-mockup', 'index.html');

/** The `{ id: '…', label: '…' }` entries of the `routes: [ … ]` block, in file order. */
function routesIn(html: string): Array<[string, string]> {
  const block = /\broutes:\s*\[([\s\S]*?)\]/.exec(html);
  if (!block) throw new Error('no "routes: [ … ]" block in the mockup');
  return [...block[1].matchAll(/\{\s*id:\s*'([^']+)'[^}]*?\blabel:\s*'([^']+)'[^}]*\}/g)].map((entry) => [entry[1], entry[2]]);
}

describe('the real mockup file (outputs/05_demo/ux-mockup/index.html)', () => {
  const html = readFileSync(MOCKUP_FILE, 'utf8');

  it('has exactly the screens the workspace tabs offer, with the same ids and labels, in order', () => {
    expect(routesIn(html)).toEqual(MOCKUP_SCREENS.map((screen) => [screen.id, screen.label]));
  });

  it('picks its screen from the URL hash and follows hash changes', () => {
    expect(html).toContain('location.hash');
    expect(html).toContain("addEventListener('hashchange'");
  });

  it('is one offline file: no external scripts, styles, fonts or images', () => {
    expect(html).not.toMatch(/\b(?:src|href)\s*=\s*["']?(?:https?:)?\/\//i);
    expect(html).not.toMatch(/@import|@font-face|url\(\s*["']?(?:https?:)?\/\//i);
  });
});

describe('routesIn (the parser above)', () => {
  it('reads ids and labels in order, with or without a step number', () => {
    const sample = "routes: [\n  { id: 'a', n: 1, label: 'First' },\n  { id: 'b', label: 'Second' }\n],";
    expect(routesIn(sample)).toEqual([
      ['a', 'First'],
      ['b', 'Second'],
    ]);
  });

  it('fails loudly when there is no routes block', () => {
    expect(() => routesIn('<html></html>')).toThrow(/no "routes/);
  });
});
