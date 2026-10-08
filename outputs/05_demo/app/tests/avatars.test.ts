// @vitest-environment jsdom
// The agent pictures: the committed SVGs in public/avatars and the generator that makes
// them (scripts/make-avatars.mjs). Offline: files are read from disk or rendered locally.
// jsdom is only here for its strict XML DOMParser.
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { LOOKS, buildCandidatesHtml, checkLook } from '../scripts/make-avatars.mjs';

// Not `new URL('..', import.meta.url)`: Vite rewrites that pattern into a dev-server URL.
const APP_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const AVATAR_DIR = path.join(APP_DIR, 'public', 'avatars');
const SCRIPT = path.join(APP_DIR, 'scripts', 'make-avatars.mjs');
const SVG_NS = 'http://www.w3.org/2000/svg';

// The roster (mockup v2, 25 agents), written out by hand: id, first name, capability.
const ROSTER: ReadonlyArray<readonly [id: string, name: string, capability: string]> = [
  ['reglead', 'Rosa', 'Regulatory lead'],
  ['clin', 'Clara', 'Clinical regulatory strategy'],
  ['cmcreg', 'Carlos', 'CMC regulatory'],
  ['regional', 'Ravi', 'Regional regulatory experts'],
  ['label', 'Lena', 'Labelling'],
  ['intel', 'Ines', 'Regulatory intelligence'],
  ['comp', 'Dara', 'Disclosure compliance'],
  ['ops', 'Olu', 'Regulatory operations and submissions'],
  ['mw', 'Mira', 'Medical writing'],
  ['sp-orphan', 'Oona', 'Orphan designation'],
  ['sp-paed', 'Pia', 'Paediatric'],
  ['sp-exp', 'Eitan', 'Expedited programmes'],
  ['sp-combo', 'Chen', 'Combination products'],
  ['sp-cdx', 'Dev', 'Companion diagnostics'],
  ['sp-rm', 'Rhea', 'Risk management'],
  ['sp-promo', 'Paolo', 'Promotional review'],
  ['orc', 'Oskar', 'Orchestrator'],
  ['san', 'Saskia', 'Sanitiser'],
  ['ev', 'Emeka', 'Evidence checker'],
  ['red', 'Ruben', 'Red team'],
  ['syn', 'Sofia', 'Synthesiser'],
  ['o-cmc', 'Cyrus', 'CMC and technical development'],
  ['o-qa', 'Quinn', 'Quality and inspection history'],
  ['o-pv', 'Priya', 'Safety and PV'],
  ['o-ma', 'Malik', 'Medical affairs'],
];
const IDS = ROSTER.map(([id]) => id);

// Mockup tokens: --graphite (agent ink) and --sheet (cards, surfaces).
const GRAPHITE = '#5d6571';
const SHEET = '#fbfcfd';

const readAvatar = (id: string) => readFileSync(path.join(AVATAR_DIR, `${id}.svg`), 'utf8');
const parseSvg = (text: string) => new DOMParser().parseFromString(text, 'image/svg+xml');

/** Every way an SVG could pull something from outside itself. Empty when self-contained. */
function externalReferences(text: string, doc: Document): string[] {
  const found: string[] = [];
  // The namespace declaration is an identifier, never fetched. Nothing else may name a scheme.
  const rest = text.replace(`xmlns="${SVG_NS}"`, '');
  for (const match of rest.matchAll(/(?:[a-z][a-z0-9+.-]*:)?\/\/[^\s"'<>)]*|\b(?:data|javascript):/gi)) {
    found.push(`text: ${match[0]}`);
  }
  for (const el of Array.from(doc.getElementsByTagName('*'))) {
    if (['image', 'script', 'style', 'foreignObject', 'a', 'iframe', 'feImage'].includes(el.localName)) {
      found.push(`element: <${el.localName}>`);
    }
    for (const attr of Array.from(el.attributes)) {
      if (attr.localName === 'href' && !attr.value.startsWith('#')) found.push(`href: ${attr.value}`);
      for (const url of attr.value.matchAll(/url\(\s*([^)]*)\)/g)) {
        if (!url[1].startsWith('#')) found.push(`url(): ${url[0]}`);
      }
    }
  }
  return found;
}

/** Paint values outside the palette (graphite ink, sheet paper). Masks may use black and white. */
function offPalette(root: Document | Element): string[] {
  const found: string[] = [];
  const maskOnly = new Set(['white', '#fff', '#ffffff', 'black', '#000', '#000000']);
  for (const el of Array.from(root.getElementsByTagName('*'))) {
    for (const name of ['fill', 'stroke', 'stop-color', 'flood-color', 'lighting-color', 'color']) {
      const value = el.getAttribute(name)?.trim().toLowerCase();
      if (!value || value === GRAPHITE || value === SHEET || value === 'none' || value.startsWith('url(#')) continue;
      if (maskOnly.has(value) && el.closest('mask')) continue;
      found.push(`<${el.localName} ${name}="${value}">`);
    }
    const style = el.getAttribute('style') ?? '';
    if (/blend-mode|fill|stroke|color/i.test(style)) found.push(`<${el.localName} style="${style}">`);
  }
  return found;
}

/** The drawing without its labels and ids, so two agents with the same look compare equal. */
const drawingOf = (text: string) =>
  text
    .replace(/<title>[\s\S]*?<\/title>/, '')
    .replace(/\saria-label="[^"]*"/, '')
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/\sid="[^"]*"/g, '')
    .replace(/url\(#[^)]*\)/g, 'url(#)')
    .replace(/href="#[^"]*"/g, 'href="#"');

describe('committed avatars (public/avatars)', () => {
  it('has exactly one SVG per roster agent, and no others', () => {
    const files = readdirSync(AVATAR_DIR).filter((file) => file.endsWith('.svg'));
    expect(files.sort()).toEqual(IDS.map((id) => `${id}.svg`).sort());
  });

  it.each(ROSTER)('%s.svg is a well-formed SVG whose first child is the title "<Name>, <capability> (AI agent)"', (id, name, capability) => {
    const doc = parseSvg(readAvatar(id));
    expect(doc.getElementsByTagName('parsererror')).toHaveLength(0);
    const root = doc.documentElement;
    expect(root.localName).toBe('svg');
    expect(root.namespaceURI).toBe(SVG_NS);
    expect(root.firstElementChild?.localName).toBe('title');
    expect(root.firstElementChild?.textContent).toBe(`${name}, ${capability} (AI agent)`);
    expect(root.getAttribute('aria-label')).toBe(`${name}, ${capability} (AI agent)`);
  });

  it.each(IDS)('%s.svg has no external reference (no URL, no image, no outside href)', (id) => {
    const text = readAvatar(id);
    expect(externalReferences(text, parseSvg(text))).toEqual([]);
  });

  it.each(IDS)('%s.svg is drawn in graphite on the sheet colour and nothing else', (id) => {
    const text = readAvatar(id);
    expect(offPalette(parseSvg(text))).toEqual([]);
    expect(text.toLowerCase()).toContain(`fill="${GRAPHITE}"`);
    expect(text.toLowerCase()).toContain(`fill="${SHEET}"`);
  });

  it('gives every agent a different drawing', () => {
    const owners = new Map<string, string[]>();
    for (const id of IDS) {
      const drawing = drawingOf(readAvatar(id));
      owners.set(drawing, [...(owners.get(drawing) ?? []), id]);
    }
    expect([...owners.values()].filter((ids) => ids.length > 1)).toEqual([]);
  });
});

describe('public/avatars/CREDITS.md', () => {
  // Read straight from the installed packages, independently of the generator.
  const require = createRequire(import.meta.url);
  const readJson = (file: string) => JSON.parse(readFileSync(file, 'utf8'));
  const definitionFile = (style: string) => require.resolve(`@dicebear/styles/${style}.json`);
  const packageVersion = (entryFile: string) => readJson(path.join(path.dirname(entryFile), '..', 'package.json')).version;
  const credits = () => readFileSync(path.join(AVATAR_DIR, 'CREDITS.md'), 'utf8');
  const stylesInUse = () => [...new Set(Object.values(LOOKS).map((look) => look.style))];

  it.each(['notionists', 'lorelei', 'open-peeps'])('credits %s with its artist and licence quoted from the definition, if an agent uses it', (style) => {
    const { meta } = readJson(definitionFile(style));
    if (stylesInUse().includes(style)) {
      expect(credits()).toContain(meta.source.name);
      expect(credits()).toContain(meta.creator.name);
      expect(credits()).toContain(`"${meta.license.name}"`);
      expect(credits()).toContain(`"${meta.license.url}"`);
      expect(credits()).toContain(`"${meta.license.text}"`);
    } else {
      // A style nobody uses stays out, so the public repo names no artist it does not need.
      expect(credits()).not.toContain(meta.creator.name);
    }
  });

  it('names the generator packages at their installed versions', () => {
    expect(credits()).toContain(`@dicebear/core@${packageVersion(require.resolve('@dicebear/core'))}`);
    expect(credits()).toContain(`@dicebear/styles@${packageVersion(definitionFile('notionists'))}`);
  });
});

// A complete Notionists look, written out by hand: every component named or switched off.
const PINNED: Record<string, unknown> = {
  beardProbability: 0, clothesVariant: 'variant13', clothesGraphicProbability: 0,
  eyebrowsVariant: 'variant01', eyesVariant: 'variant01', gestureProbability: 0,
  glassesProbability: 0, hairVariant: 'variant36', headVariant: 'variant01',
  mouthVariant: 'variant03', noseVariant: 'variant01',
};
const notionists = (options: Record<string, unknown>) => ({ style: 'notionists', seed: 'Test', options });
const without = (options: Record<string, unknown>, key: string) =>
  Object.fromEntries(Object.entries(options).filter(([name]) => name !== key));

describe('look table (scripts/make-avatars.mjs)', () => {
  it('accepts a look that pins every component (positive control)', () => {
    expect(() => checkLook(notionists(PINNED))).not.toThrow();
  });

  it.each([
    ['a component left to chance', without(PINNED, 'hairVariant'), /hair/],
    ['an option DiceBear would silently ignore', { ...PINNED, bodyVariant: 'variant01' }, /bodyVariant/],
    ['a variant the style does not have', { ...PINNED, hairVariant: 'variant99' }, /variant99/],
    ['an optional part named without probability 100', { ...without(PINNED, 'glassesProbability'), glassesVariant: 'variant03' }, /glasses/],
    ['an optional part named but switched off', { ...PINNED, beardVariant: 'variant01' }, /beard/],
    ['a weighted choice, which the seed would settle', { ...PINNED, hairVariant: ['variant01', 'variant02'] }, /hair/],
    ['a colour, which the generator owns', { ...PINNED, inkColor: '#000000' }, /inkColor/],
  ])('rejects %s', (_case, options, message) => {
    expect(() => checkLook(notionists(options))).toThrow(message);
  });

  it('rejects an unknown style and a missing seed', () => {
    expect(() => checkLook({ ...notionists(PINNED), style: 'pixel-art' })).toThrow(/pixel-art/);
    expect(() => checkLook({ ...notionists(PINNED), seed: '' })).toThrow(/seed/);
  });

  it('has a valid, fully pinned look for exactly the roster agents', () => {
    expect(Object.keys(LOOKS).sort()).toEqual([...IDS].sort());
    for (const [id, look] of Object.entries(LOOKS)) {
      expect(() => checkLook(look), id).not.toThrow();
    }
  });
});

describe('npm run avatars (the CLI)', () => {
  let outDir = '';
  const runGenerator = (args: string[]) =>
    execFileSync(process.execPath, [SCRIPT, ...args], { encoding: 'utf8', stdio: 'pipe' });

  beforeEach(() => {
    outDir = mkdtempSync(path.join(tmpdir(), 'avatars-test-'));
  });
  afterEach(() => {
    rmSync(outDir, { recursive: true, force: true });
  });

  it('regenerates the committed files byte for byte (--out <dir>)', () => {
    runGenerator(['--out', outDir]);
    const committed = readdirSync(AVATAR_DIR).sort();
    expect(readdirSync(outDir).sort()).toEqual(committed);
    for (const file of committed) {
      expect(readFileSync(path.join(outDir, file), 'utf8'), file).toBe(readFileSync(path.join(AVATAR_DIR, file), 'utf8'));
    }
  });

  it('refuses an unknown option and writes nothing', () => {
    expect(() => runGenerator(['--bogus', '--out', outDir])).toThrow();
    expect(readdirSync(outDir)).toEqual([]);
  });

  it('writes only the candidate sheet with --candidates', () => {
    runGenerator(['--candidates', '--out', outDir]);
    expect(readdirSync(outDir)).toEqual(['index.html']);
    expect(readFileSync(path.join(outDir, 'index.html'), 'utf8')).toBe(buildCandidatesHtml());
  });
});

describe('candidate sheet (npm run avatars -- --candidates)', () => {
  const ROWS = ['current', 'notionists', 'lorelei', 'open-peeps'];
  let html = '';
  let doc: Document;
  beforeAll(() => {
    html = buildCandidatesHtml();
    doc = new DOMParser().parseFromString(html, 'text/html');
  });

  const cards = (id: string, row: string) =>
    Array.from(doc.querySelectorAll(`section[data-agent="${id}"] [data-row="${row}"] figure`));
  const entryOf = (card: Element) => JSON.parse(card.querySelector('code')?.textContent ?? 'null');

  it.each(IDS)('%s: shows the current look, 8 Notionists options and a row each of Lorelei and Open Peeps', (id) => {
    expect(cards(id, 'current')).toHaveLength(1);
    expect(cards(id, 'notionists')).toHaveLength(8);
    expect(cards(id, 'lorelei').length).toBeGreaterThanOrEqual(1);
    expect(cards(id, 'open-peeps').length).toBeGreaterThanOrEqual(1);
    for (const row of ROWS) {
      for (const card of cards(id, row)) expect(card.querySelector('svg')).not.toBeNull();
    }
  });

  it.each(IDS)('%s: labels every card with a pinned entry to paste into the table', (id) => {
    expect(entryOf(cards(id, 'current')[0])).toEqual(LOOKS[id as keyof typeof LOOKS]);
    for (const row of ROWS.slice(1)) {
      for (const card of cards(id, row)) {
        const entry = entryOf(card);
        expect(entry.style).toBe(row);
        expect(() => checkLook(entry)).not.toThrow();
        expect(card.textContent).toContain(entry.seed);
      }
    }
  });

  it('offers different options within each row', () => {
    for (const id of IDS) {
      for (const row of ROWS.slice(1)) {
        const looks = cards(id, row).map((card) => JSON.stringify(entryOf(card).options));
        expect(new Set(looks).size, `${id} ${row}`).toBe(looks.length);
      }
    }
  });

  it('opens offline: no script, stylesheet link, image or URL', () => {
    const rest = html.replaceAll(`xmlns="${SVG_NS}"`, '');
    expect(rest.match(/(?:[a-z][a-z0-9+.-]*:)?\/\/[^\s"'<>)]*|\b(?:data|javascript):|@import/gi)).toBeNull();
    expect(doc.querySelectorAll('script, link, img, image, iframe, object, embed, base, foreignObject')).toHaveLength(0);
    for (const el of Array.from(doc.querySelectorAll('*'))) {
      for (const attr of Array.from(el.attributes)) {
        if (attr.localName === 'href') expect(attr.value.startsWith('#'), attr.value).toBe(true);
        for (const url of attr.value.matchAll(/url\(\s*([^)]*)\)/g)) expect(url[1].startsWith('#'), url[0]).toBe(true);
      }
    }
  });

  it('keeps ids unique on the page, and every reference inside its own picture', () => {
    const ids = Array.from(doc.querySelectorAll('[id]')).map((el) => el.id);
    expect(ids.filter((id, index) => ids.indexOf(id) !== index)).toEqual([]);
    for (const svg of Array.from(doc.querySelectorAll('svg'))) {
      const own = new Set(Array.from(svg.querySelectorAll('[id]')).map((el) => el.id));
      for (const el of Array.from(svg.querySelectorAll('*'))) {
        for (const attr of Array.from(el.attributes)) {
          const refs = [...attr.value.matchAll(/url\(#([^)]+)\)/g)].map((m) => m[1]);
          if (attr.localName === 'href') refs.push(attr.value.slice(1));
          for (const ref of refs) expect(own.has(ref), `#${ref}`).toBe(true);
        }
      }
    }
  });

  it('draws every card in graphite on the sheet colour', () => {
    const offenders = Array.from(doc.querySelectorAll('figure svg')).flatMap((svg) => offPalette(svg));
    expect([...new Set(offenders)]).toEqual([]);
  });
});
