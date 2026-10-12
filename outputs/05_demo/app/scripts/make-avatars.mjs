#!/usr/bin/env node
// Agent pictures for the hybrid team (Node 24).
//
//   npm run avatars                     writes public/avatars/<id>.svg for the 25 agents
//   npm run avatars -- --candidates     writes .avatar-candidates/index.html, a contact sheet
//                                       of alternative looks to paste into LOOKS (git-ignored)
//   npm run avatars -- --out <dir>      writes either of them somewhere else instead
//
// Rendered offline with DiceBear from the style definitions installed in node_modules.
// No network, no clock, no randomness: the same table always gives the same bytes.
import fs from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { Avatar, Style } from '@dicebear/core';
import loreleiDefinition from '@dicebear/styles/lorelei.json' with { type: 'json' };
import notionistsDefinition from '@dicebear/styles/notionists.json' with { type: 'json' };
import openPeepsDefinition from '@dicebear/styles/open-peeps.json' with { type: 'json' };

const APP_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const AVATAR_DIR = path.join(APP_DIR, 'public', 'avatars');
const CANDIDATES_DIR = path.join(APP_DIR, '.avatar-candidates');

/** Mockup tokens: --graphite is the agent ink, --sheet the paper of cards and surfaces. */
export const PALETTE = { graphite: '#5D6571', sheet: '#FBFCFD' };

/**
 * The 25 agents of mockup v2, in display order. `presentation` is how the drawn look reads
 * (it follows the fictional first name); it only narrows the candidate sheet's choices,
 * for example no beards on the options for a feminine name.
 */
export const ROSTER = [
  { id: 'reglead', name: 'Rosa', capability: 'Regulatory lead', group: 'core', presentation: 'feminine' },
  { id: 'clin', name: 'Clara', capability: 'Clinical regulatory strategy', group: 'core', presentation: 'feminine' },
  { id: 'cmcreg', name: 'Carlos', capability: 'CMC regulatory', group: 'core', presentation: 'masculine' },
  { id: 'regional', name: 'Ravi', capability: 'Regional regulatory experts', group: 'core', presentation: 'masculine' },
  { id: 'label', name: 'Lena', capability: 'Labelling', group: 'core', presentation: 'feminine' },
  { id: 'intel', name: 'Ines', capability: 'Regulatory intelligence', group: 'core', presentation: 'feminine' },
  { id: 'comp', name: 'Dara', capability: 'Disclosure compliance', group: 'core', presentation: 'neutral' },
  { id: 'ops', name: 'Olu', capability: 'Regulatory operations and submissions', group: 'core', presentation: 'neutral' },
  { id: 'mw', name: 'Mira', capability: 'Medical writing', group: 'core', presentation: 'feminine' },
  { id: 'sp-orphan', name: 'Oona', capability: 'Orphan designation', group: 'spec', presentation: 'feminine' },
  { id: 'sp-paed', name: 'Pia', capability: 'Paediatric', group: 'spec', presentation: 'feminine' },
  { id: 'sp-exp', name: 'Eitan', capability: 'Expedited programmes', group: 'spec', presentation: 'masculine' },
  { id: 'sp-combo', name: 'Chen', capability: 'Combination products', group: 'spec', presentation: 'neutral' },
  { id: 'sp-cdx', name: 'Dev', capability: 'Companion diagnostics', group: 'spec', presentation: 'masculine' },
  { id: 'sp-rm', name: 'Rhea', capability: 'Risk management', group: 'spec', presentation: 'feminine' },
  { id: 'sp-promo', name: 'Paolo', capability: 'Promotional review', group: 'spec', presentation: 'masculine' },
  { id: 'orc', name: 'Oskar', capability: 'Orchestrator', group: 'role', presentation: 'masculine' },
  { id: 'san', name: 'Saskia', capability: 'Sanitiser', group: 'role', presentation: 'feminine' },
  { id: 'ev', name: 'Emeka', capability: 'Evidence checker', group: 'role', presentation: 'masculine' },
  { id: 'red', name: 'Ruben', capability: 'Red team', group: 'role', presentation: 'masculine' },
  { id: 'syn', name: 'Sofia', capability: 'Synthesiser', group: 'role', presentation: 'feminine' },
  { id: 'o-cmc', name: 'Cyrus', capability: 'CMC and technical development', group: 'other', presentation: 'masculine' },
  { id: 'o-qa', name: 'Quinn', capability: 'Quality and inspection history', group: 'other', presentation: 'neutral' },
  { id: 'o-pv', name: 'Priya', capability: 'Safety and PV', group: 'other', presentation: 'feminine' },
  { id: 'o-ma', name: 'Malik', capability: 'Medical affairs', group: 'other', presentation: 'masculine' },
];

const GROUP_TITLES = {
  core: 'Regulatory function',
  spec: 'Specialists by asset',
  role: 'Team roles',
  other: 'Other functions',
};

/**
 * One look per agent: DiceBear style, seed and options. Every component is pinned, so the
 * picture never depends on the seed: a variant by name (shown with probability 100), or
 * probability 0 (left out). Clothes graphics stay off: they blend into off-palette colours.
 * To swap a look, paste an entry from the candidate sheet (npm run avatars -- --candidates).
 */
export const LOOKS = {
  // Rosa: voluminous bob, lapelled blazer.
  reglead: {
    style: 'notionists',
    seed: 'Rosa',
    options: {
      beardProbability: 0, clothesVariant: 'variant13', clothesGraphicProbability: 0,
      eyebrowsVariant: 'variant01', eyesVariant: 'variant01', gestureProbability: 0,
      glassesProbability: 0, hairVariant: 'variant36', headVariant: 'variant01',
      mouthVariant: 'variant03', noseVariant: 'variant01',
    },
  },
  // Clara: long straight hair with a fringe, round glasses, dark jacket.
  clin: {
    style: 'notionists',
    seed: 'Clara',
    options: {
      beardProbability: 0, clothesVariant: 'variant04', clothesGraphicProbability: 0,
      eyebrowsVariant: 'variant12', eyesVariant: 'variant05', gestureProbability: 0,
      glassesVariant: 'variant11', glassesProbability: 100, hairVariant: 'variant41',
      headVariant: 'variant01', mouthVariant: 'variant21', noseVariant: 'variant07',
    },
  },
  // Carlos: pompadour, short beard, shirt and dark tie.
  cmcreg: {
    style: 'notionists',
    seed: 'Carlos',
    options: {
      beardVariant: 'variant01', beardProbability: 100, clothesVariant: 'variant20',
      clothesGraphicProbability: 0, eyebrowsVariant: 'variant07', eyesVariant: 'variant04',
      gestureProbability: 0, glassesProbability: 0, hairVariant: 'variant54',
      headVariant: 'variant01', mouthVariant: 'variant22', noseVariant: 'variant18',
    },
  },
  // Ravi: quiff, broad smile, light blazer over a tee.
  regional: {
    style: 'notionists',
    seed: 'Ravi',
    options: {
      beardProbability: 0, clothesVariant: 'variant16', clothesGraphicProbability: 0,
      eyebrowsVariant: 'variant04', eyesVariant: 'variant01', gestureProbability: 0,
      glassesProbability: 0, hairVariant: 'variant27', headVariant: 'variant01',
      mouthVariant: 'variant05', noseVariant: 'variant05',
    },
  },
  // Lena: ponytail, collared top.
  label: {
    style: 'notionists',
    seed: 'Lena',
    options: {
      beardProbability: 0, clothesVariant: 'variant21', clothesGraphicProbability: 0,
      eyebrowsVariant: 'variant09', eyesVariant: 'variant03', gestureProbability: 0,
      glassesProbability: 0, hairVariant: 'variant39', headVariant: 'variant01',
      mouthVariant: 'variant14', noseVariant: 'variant12',
    },
  },
  // Ines: bob with a fringe, rectangular glasses, knit jacket.
  intel: {
    style: 'notionists',
    seed: 'Ines',
    options: {
      beardProbability: 0, clothesVariant: 'variant07', clothesGraphicProbability: 0,
      eyebrowsVariant: 'variant05', eyesVariant: 'variant04', gestureProbability: 0,
      glassesVariant: 'variant08', glassesProbability: 100, hairVariant: 'variant10',
      headVariant: 'variant01', mouthVariant: 'variant17', noseVariant: 'variant03',
    },
  },
  // Dara: medium shaggy hair, open shirt over a tee.
  comp: {
    style: 'notionists',
    seed: 'Dara',
    options: {
      beardProbability: 0, clothesVariant: 'variant05', clothesGraphicProbability: 0,
      eyebrowsVariant: 'variant04', eyesVariant: 'variant02', gestureProbability: 0,
      glassesProbability: 0, hairVariant: 'variant58', headVariant: 'variant01',
      mouthVariant: 'variant03', noseVariant: 'variant09',
    },
  },
  // Olu: buzz cut, hoodie, phone in hand.
  ops: {
    style: 'notionists',
    seed: 'Olu',
    options: {
      beardProbability: 0, clothesVariant: 'variant23', clothesGraphicProbability: 0,
      eyebrowsVariant: 'variant01', eyesVariant: 'variant05', gestureVariant: 'handPhone',
      gestureProbability: 100, glassesProbability: 0, hairVariant: 'variant60',
      headVariant: 'variant01', mouthVariant: 'variant08', noseVariant: 'variant14',
    },
  },
  // Mira: bun with loose strands, rectangular glasses, dark jacket.
  mw: {
    style: 'notionists',
    seed: 'Mira',
    options: {
      beardProbability: 0, clothesVariant: 'variant02', clothesGraphicProbability: 0,
      eyebrowsVariant: 'variant08', eyesVariant: 'variant01', gestureProbability: 0,
      glassesVariant: 'variant03', glassesProbability: 100, hairVariant: 'variant57',
      headVariant: 'variant01', mouthVariant: 'variant23', noseVariant: 'variant11',
    },
  },
  // Oona: wavy side-swept hair, scarf.
  'sp-orphan': {
    style: 'notionists',
    seed: 'Oona',
    options: {
      beardProbability: 0, clothesVariant: 'variant12', clothesGraphicProbability: 0,
      eyebrowsVariant: 'variant12', eyesVariant: 'variant03', gestureProbability: 0,
      glassesProbability: 0, hairVariant: 'variant37', headVariant: 'variant01',
      mouthVariant: 'variant25', noseVariant: 'variant16',
    },
  },
  // Pia: two buns, patterned jumper.
  'sp-paed': {
    style: 'notionists',
    seed: 'Pia',
    options: {
      beardProbability: 0, clothesVariant: 'variant22', clothesGraphicProbability: 0,
      eyebrowsVariant: 'variant01', eyesVariant: 'variant04', gestureProbability: 0,
      glassesProbability: 0, hairVariant: 'variant59', headVariant: 'variant01',
      mouthVariant: 'variant05', noseVariant: 'variant17',
    },
  },
  // Eitan: spiky quiff, lightning-bolt tee under a jacket.
  'sp-exp': {
    style: 'notionists',
    seed: 'Eitan',
    options: {
      beardProbability: 0, clothesVariant: 'variant18', clothesGraphicProbability: 0,
      eyebrowsVariant: 'variant05', eyesVariant: 'variant05', gestureProbability: 0,
      glassesProbability: 0, hairVariant: 'variant53', headVariant: 'variant01',
      mouthVariant: 'variant25', noseVariant: 'variant02',
    },
  },
  // Chen: short hair curling at the nape, patterned jumper.
  'sp-combo': {
    style: 'notionists',
    seed: 'Chen',
    options: {
      beardProbability: 0, clothesVariant: 'variant15', clothesGraphicProbability: 0,
      eyebrowsVariant: 'variant09', eyesVariant: 'variant02', gestureProbability: 0,
      glassesProbability: 0, hairVariant: 'variant24', headVariant: 'variant01',
      mouthVariant: 'variant21', noseVariant: 'variant04',
    },
  },
  // Dev: curly top, open jacket over a dark tee.
  'sp-cdx': {
    style: 'notionists',
    seed: 'Dev',
    options: {
      beardProbability: 0, clothesVariant: 'variant09', clothesGraphicProbability: 0,
      eyebrowsVariant: 'variant07', eyesVariant: 'variant01', gestureProbability: 0,
      glassesProbability: 0, hairVariant: 'variant33', headVariant: 'variant01',
      mouthVariant: 'variant22', noseVariant: 'variant06',
    },
  },
  // Rhea: low bun, dark blazer.
  'sp-rm': {
    style: 'notionists',
    seed: 'Rhea',
    options: {
      beardProbability: 0, clothesVariant: 'variant17', clothesGraphicProbability: 0,
      eyebrowsVariant: 'variant04', eyesVariant: 'variant05', gestureProbability: 0,
      glassesProbability: 0, hairVariant: 'variant30', headVariant: 'variant01',
      mouthVariant: 'variant14', noseVariant: 'variant10',
    },
  },
  // Paolo: wavy quiff, open jacket over a tee.
  'sp-promo': {
    style: 'notionists',
    seed: 'Paolo',
    options: {
      beardProbability: 0, clothesVariant: 'variant01', clothesGraphicProbability: 0,
      eyebrowsVariant: 'variant08', eyesVariant: 'variant04', gestureProbability: 0,
      glassesProbability: 0, hairVariant: 'variant17', headVariant: 'variant01',
      mouthVariant: 'variant14', noseVariant: 'variant13',
    },
  },
  // Oskar: neat side parting, small chin beard, shirt and tie, waving hello.
  orc: {
    style: 'notionists',
    seed: 'Oskar',
    options: {
      beardVariant: 'variant12', beardProbability: 100, clothesVariant: 'variant19',
      clothesGraphicProbability: 0, eyebrowsVariant: 'variant04', eyesVariant: 'variant04',
      gestureVariant: 'waveLongArm', gestureProbability: 100, glassesProbability: 0,
      hairVariant: 'variant06', headVariant: 'variant01', mouthVariant: 'variant25',
      noseVariant: 'variant08',
    },
  },
  // Saskia: high ponytail with a fringe, collared jumper.
  san: {
    style: 'notionists',
    seed: 'Saskia',
    options: {
      beardProbability: 0, clothesVariant: 'variant14', clothesGraphicProbability: 0,
      eyebrowsVariant: 'variant09', eyesVariant: 'variant02', gestureProbability: 0,
      glassesProbability: 0, hairVariant: 'variant47', headVariant: 'variant01',
      mouthVariant: 'variant17', noseVariant: 'variant19',
    },
  },
  // Emeka: short curls, rectangular glasses, pens in the shirt pocket.
  ev: {
    style: 'notionists',
    seed: 'Emeka',
    options: {
      beardProbability: 0, clothesVariant: 'variant25', clothesGraphicProbability: 0,
      eyebrowsVariant: 'variant07', eyesVariant: 'variant01', gestureProbability: 0,
      glassesVariant: 'variant03', glassesProbability: 100, hairVariant: 'variant22',
      headVariant: 'variant01', mouthVariant: 'variant21', noseVariant: 'variant15',
    },
  },
  // Ruben: side-swept undercut, goatee, one raised eyebrow, finger up with a question.
  red: {
    style: 'notionists',
    seed: 'Ruben',
    options: {
      beardVariant: 'variant08', beardProbability: 100, clothesVariant: 'variant08',
      clothesGraphicProbability: 0, eyebrowsVariant: 'variant02', eyesVariant: 'variant05',
      gestureVariant: 'pointLongArm', gestureProbability: 100, glassesProbability: 0,
      hairVariant: 'variant44', headVariant: 'variant01', mouthVariant: 'variant23',
      noseVariant: 'variant20',
    },
  },
  // Sofia: long voluminous waves, tie-neck top.
  syn: {
    style: 'notionists',
    seed: 'Sofia',
    options: {
      beardProbability: 0, clothesVariant: 'variant11', clothesGraphicProbability: 0,
      eyebrowsVariant: 'variant12', eyesVariant: 'variant03', gestureProbability: 0,
      glassesProbability: 0, hairVariant: 'variant28', headVariant: 'variant01',
      mouthVariant: 'variant03', noseVariant: 'variant12',
    },
  },
  // Cyrus: light swept-back hair, full beard, rectangular glasses, jacket.
  'o-cmc': {
    style: 'notionists',
    seed: 'Cyrus',
    options: {
      beardVariant: 'variant02', beardProbability: 100, clothesVariant: 'variant03',
      clothesGraphicProbability: 0, eyebrowsVariant: 'variant07', eyesVariant: 'variant01',
      gestureProbability: 0, glassesVariant: 'variant08', glassesProbability: 100,
      hairVariant: 'variant42', headVariant: 'variant01', mouthVariant: 'variant27',
      noseVariant: 'variant05',
    },
  },
  // Quinn: patterned undercut, round glasses, waistcoat over a tee.
  'o-qa': {
    style: 'notionists',
    seed: 'Quinn',
    options: {
      beardProbability: 0, clothesVariant: 'variant10', clothesGraphicProbability: 0,
      eyebrowsVariant: 'variant05', eyesVariant: 'variant02', gestureProbability: 0,
      glassesVariant: 'variant11', glassesProbability: 100, hairVariant: 'variant26',
      headVariant: 'variant01', mouthVariant: 'variant04', noseVariant: 'variant03',
    },
  },
  // Priya: long straight hair, patterned hoodie.
  'o-pv': {
    style: 'notionists',
    seed: 'Priya',
    options: {
      beardProbability: 0, clothesVariant: 'variant24', clothesGraphicProbability: 0,
      eyebrowsVariant: 'variant08', eyesVariant: 'variant05', gestureProbability: 0,
      glassesProbability: 0, hairVariant: 'variant23', headVariant: 'variant01',
      mouthVariant: 'variant22', noseVariant: 'variant19',
    },
  },
  // Malik: short wavy hair, dark waistcoat over a tee.
  'o-ma': {
    style: 'notionists',
    seed: 'Malik',
    options: {
      beardProbability: 0, clothesVariant: 'variant06', clothesGraphicProbability: 0,
      eyebrowsVariant: 'variant01', eyesVariant: 'variant04', gestureProbability: 0,
      glassesProbability: 0, hairVariant: 'variant01', headVariant: 'variant01',
      mouthVariant: 'variant17', noseVariant: 'variant06',
    },
  },
};

/** The styles on offer (all CC0 1.0 per their definitions), and which colour is ink or paper. */
const STYLES = {
  notionists: {
    title: 'Notionists',
    definition: notionistsDefinition,
    colours: { ink: 'graphite', paper: 'sheet' },
  },
  lorelei: {
    title: 'Lorelei',
    definition: loreleiDefinition,
    colours: {
      earrings: 'graphite', eyebrows: 'graphite', eyes: 'graphite', freckles: 'graphite',
      glasses: 'graphite', hair: 'graphite', hairAccessories: 'graphite', mouth: 'graphite',
      nose: 'graphite', outline: 'graphite', skin: 'sheet',
    },
  },
  'open-peeps': {
    title: 'Open Peeps',
    definition: openPeepsDefinition,
    colours: { clothing: 'sheet', headContrast: 'graphite', ink: 'graphite', skin: 'sheet' },
  },
};

const styleCache = new Map();
function styleOf(name) {
  if (!Object.hasOwn(STYLES, name)) throw new Error(`Unknown avatar style "${name}". Known: ${Object.keys(STYLES).join(', ')}.`);
  if (!styleCache.has(name)) styleCache.set(name, new Style(STYLES[name].definition));
  return styleCache.get(name);
}

/** The components a look must pin: the style's own, not aliases (they follow their source). */
function componentsOf(name) {
  return [...styleOf(name).components().values()].filter((component) => component.extendsName() === undefined);
}

/**
 * Throws unless the look is { style, seed, options } with every component pinned: a single
 * existing variant shown with probability 100, or probability 0. DiceBear itself accepts
 * any `<word>Variant` key and ignores names it does not know, so a typo would silently
 * change a picture; this check turns that into an error. Colours, title and seed are set
 * by the generator, so they are refused in `options`.
 */
export function checkLook(look) {
  if (!look || typeof look !== 'object') throw new Error('A look must be an object: { style, seed, options }.');
  if (!Object.hasOwn(STYLES, look.style)) {
    throw new Error(`Unknown avatar style "${look.style}". Known: ${Object.keys(STYLES).join(', ')}.`);
  }
  const problems = [];
  if (typeof look.seed !== 'string' || look.seed.trim() === '') problems.push('seed must be a non-empty string');
  const options = look.options;
  if (!options || typeof options !== 'object' || Array.isArray(options)) {
    throw new Error(`A look needs an options object (${problems.join('; ') || 'style and seed are fine'}).`);
  }
  const components = new Map(componentsOf(look.style).map((component) => [component.name(), component]));
  for (const key of Object.keys(options)) {
    const part = /^(.+?)(?:Variant|Probability)$/.exec(key)?.[1];
    if (!part || !components.has(part)) {
      problems.push(`"${key}" is not a component option of ${look.style} (colours, title and seed belong to the generator)`);
    }
  }
  for (const [name, component] of components) {
    const variant = options[`${name}Variant`];
    const probability = options[`${name}Probability`];
    if (variant === undefined) {
      if (probability !== 0) problems.push(`${name}: name one variant (${name}Variant) or switch it off (${name}Probability: 0)`);
      continue;
    }
    if (typeof variant !== 'string') {
      problems.push(`${name}Variant must be one variant name; a list or weights leaves the choice to the seed`);
      continue;
    }
    if (!component.variants().has(variant)) {
      problems.push(`${name}Variant "${variant}" does not exist in ${look.style} (${[...component.variants().keys()].join(', ')})`);
    }
    const shown = probability ?? component.probability();
    if (shown !== 100) problems.push(`${name}: a named variant needs ${name}Probability: 100 (now ${shown})`);
  }
  if (problems.length > 0) throw new Error(`Look is not fully pinned:\n  - ${problems.join('\n  - ')}`);
}

/** `${colour}Color` for every colour the style defines, plus the background, in the palette. */
function colourOptions(name) {
  const options = { backgroundColor: PALETTE.sheet };
  for (const colour of styleOf(name).colors().keys()) {
    const role = STYLES[name].colours[colour];
    if (!role) throw new Error(`Style "${name}" has a colour "${colour}" with no palette role.`);
    options[`${colour}Color`] = PALETTE[role];
  }
  return options;
}

/** "Notionists by Zoish (CC0 1.0)", read from the style's own metadata. */
function attribution(name) {
  const meta = styleOf(name).definition().meta ?? {};
  return `${meta.source?.name ?? name} by ${meta.creator?.name ?? 'unknown'} (${meta.license?.name ?? 'licence unknown'})`;
}

/** Gives every id (and every reference to it) a prefix, so pictures can share a page. */
function scopeIds(svg, prefix) {
  return svg.replace(/(\sid="|url\(#|href="#)/g, `$1${prefix}`);
}

/**
 * Some styles hard-code black or white paint (Open Peeps draws the shoulders in black;
 * Lorelei and Open Peeps fill eye whites). Outside masks, where colour is coverage rather
 * than paint, black becomes graphite and white becomes sheet.
 */
function normalisePaint(svg) {
  const ink = PALETTE.graphite.toLowerCase();
  const paper = PALETTE.sheet.toLowerCase();
  return svg
    .split(/(<mask\b[\s\S]*?<\/mask>)/)
    .map((part, i) =>
      i % 2 === 1
        ? part
        : part.replace(/(?<=\s)(fill|stroke|stop-color)="(black|#000|#000000|white|#fff|#ffffff)"/gi, (_, attr, value) =>
            `${attr}="${/^(black|#000|#000000)$/i.test(value) ? ink : paper}"`,
          ),
    )
    .join('');
}

/**
 * A look rendered and made self-contained. DiceBear's comment and RDF metadata carry URLs,
 * so both go (the credits live in CREDITS.md); the title moves to the first child; every
 * id gets a prefix; an optional comment (no URLs) follows the title.
 */
function renderLookSvg(look, { title, idPrefix, comment }) {
  const options = { ...look.options, ...colourOptions(look.style), seed: look.seed, title };
  let svg = new Avatar(styleOf(look.style), options).toString();
  svg = svg.replace(/<!--[\s\S]*?-->/g, '').replace(/<metadata\b[\s\S]*?<\/metadata>/g, '');
  const titleElement = svg.match(/<title>[\s\S]*?<\/title>/)?.[0];
  if (!titleElement) throw new Error('DiceBear returned an SVG without a <title>.');
  svg = svg.replace(titleElement, '');
  const note = comment ? `<!-- ${comment.replaceAll('--', '-')} -->` : '';
  svg = svg.replace(/^<svg\b[^>]*>/, (open) => `${open}${titleElement}${note}`);
  return scopeIds(normalisePaint(svg), idPrefix);
}

/** The committed picture for one agent. */
export function renderAvatarSvg(agent, look) {
  const svg = renderLookSvg(look, {
    title: `${agent.name}, ${agent.capability} (AI agent)`,
    idPrefix: `${agent.id}-`,
    comment:
      `${attribution(look.style)}. Generated by scripts/make-avatars.mjs: ` +
      'change the look table and regenerate instead of editing. Credits: CREDITS.md.',
  });
  return `${svg}\n`;
}

/** The installed package.json of `name`, found by walking up from a file it resolves to. */
function installedPackage(name, specifier = name) {
  let dir = path.dirname(createRequire(import.meta.url).resolve(specifier));
  for (;;) {
    const file = path.join(dir, 'package.json');
    if (fs.existsSync(file)) {
      const manifest = JSON.parse(fs.readFileSync(file, 'utf8'));
      if (manifest.name === name) return manifest;
    }
    const parent = path.dirname(dir);
    if (parent === dir) throw new Error(`Cannot find the package.json of ${name}.`);
    dir = parent;
  }
}

/** CREDITS.md: the styles the agents use, their licences quoted from the definitions, versions. */
function creditsMarkdown() {
  const core = installedPackage('@dicebear/core');
  const styles = installedPackage('@dicebear/styles', '@dicebear/styles/notionists.json');
  const users = new Map();
  for (const agent of ROSTER) {
    const style = LOOKS[agent.id].style;
    users.set(style, [...(users.get(style) ?? []), agent]);
  }
  const quote = (value) => `"${String(value ?? '').replaceAll('"', '\\"')}"`;
  const styleSections = [...users].map(([name, agents]) => {
    const meta = styleOf(name).definition().meta ?? {};
    const usedBy =
      agents.length === ROSTER.length
        ? `all ${ROSTER.length} agents`
        : agents.map((agent) => `${agent.name} (${agent.id})`).join(', ');
    return [
      `### ${meta.source?.name ?? STYLES[name].title}`,
      '',
      `- Artist: ${meta.creator?.name ?? 'not stated'}`,
      `- Source: ${meta.source?.name ?? 'not stated'}${meta.source?.url ? `, ${meta.source.url}` : ''}`,
      '- Licence, quoted from the style definition (`meta.license`):',
      `  - name: ${quote(meta.license?.name)}`,
      `  - url: ${quote(meta.license?.url)}`,
      `  - text: ${quote(meta.license?.text)}`,
      `- Used for: ${usedBy}`,
    ].join('\n');
  });
  const rows = Object.entries(CANDIDATES_PER_ROW).map(([name, count]) => `${count} ${STYLES[name].title} options`);
  const sheetRows = `${rows.slice(0, -1).join(', ')} and ${rows.at(-1)}`;
  const sheetLicences = Object.keys(STYLES)
    .map((name) => `${STYLES[name].title} ${styleOf(name).definition().meta?.license?.name ?? 'not stated'}`)
    .join(', ');
  return `# Avatar credits

The agent pictures in this folder are generated, not drawn by hand: \`scripts/make-avatars.mjs\` renders them offline with DiceBear, and they are committed as plain SVG. Do not edit them by hand; change the look table and regenerate. This file is generated by the same script.

## Styles in use

${styleSections.join('\n\n')}

## Generator

- \`@dicebear/core@${core.version}\` (package licence: ${quote(core.license)}) renders the pictures.
- \`@dicebear/styles@${styles.version}\` (package licence: ${quote(styles.license)}) provides the style definitions; each style carries its own licence, quoted above.
- Colours from the UX mockup tokens: ink \`${PALETTE.graphite}\` (graphite); paper and background \`${PALETTE.sheet}\` (sheet).
- Changes to DiceBear's output: its comment and RDF metadata are removed (they hold the links above, kept here instead so the pictures contain no URL), the title comes first, every id is prefixed with the agent id, and any hard-coded black or white is painted graphite or sheet.

## Regenerate

From \`outputs/05_demo/app\`, with Node 24:

    npm run avatars

The output is deterministic: the same table and package versions give the same bytes. \`tests/avatars.test.ts\` fails when the committed files differ from a fresh run.

## Swap a look

1. Run \`npm run avatars -- --candidates\` and open \`.avatar-candidates/index.html\` in a browser (it works offline and is git-ignored). For each agent it shows the current look, ${sheetRows}. Licences as stated in the style definitions: ${sheetLicences}.
2. Open the entry under the picture you want and copy it into \`LOOKS\` in \`scripts/make-avatars.mjs\`, under the agent's id.
3. Run \`npm run avatars\`, then \`npm test\`.
4. Commit the changed SVG files together with this file. When a look uses another style, its credits appear here on regeneration.

Every look pins every component, so a picture never depends on the seed or on DiceBear's random choices. \`checkLook\` in the script refuses a look that leaves a component to chance or names an option DiceBear would silently ignore.
`;
}

/** File name to contents, for everything `npm run avatars` writes. Validates the table first. */
export function buildAvatarFiles() {
  const rosterIds = new Set(ROSTER.map((agent) => agent.id));
  const strays = Object.keys(LOOKS).filter((id) => !rosterIds.has(id));
  if (strays.length > 0) throw new Error(`LOOKS has entries for agents not in the roster: ${strays.join(', ')}.`);
  const files = new Map();
  for (const agent of ROSTER) {
    const look = LOOKS[agent.id];
    if (!look) throw new Error(`No look for agent "${agent.id}" in LOOKS.`);
    try {
      checkLook(look);
    } catch (error) {
      throw new Error(`LOOKS["${agent.id}"]: ${error.message}`, { cause: error });
    }
    files.set(`${agent.id}.svg`, renderAvatarSvg(agent, look));
  }
  files.set('CREDITS.md', creditsMarkdown());
  return files;
}

// ---------------------------------------------------------------------------
// Candidate sheet
// ---------------------------------------------------------------------------

const variants = (prefix, numbers) => numbers.map((n) => `${prefix}${String(n).padStart(2, '0')}`);
const range = (from, to) => Array.from({ length: to - from + 1 }, (_, i) => from + i);
const byPresentation = (feminine, masculine, neutral) => ({ feminine, masculine, neutral });

// Notionists hair, sorted by eye into longer and shorter cuts. Left out of the candidates:
// caps and hats (hat, 14), head coverings (61 to 63) and the two spiky novelty cuts (50, 51).
const NOTIONISTS_LONGER = variants('variant', [2, 4, 8, 10, 11, 20, 23, 28, 29, 30, 36, 37, 39, 41, 43, 45, 46, 47, 48, 57, 58, 59]);
const NOTIONISTS_SHORTER = variants('variant', [
  1, 3, 5, 6, 7, 9, 12, 13, 15, 16, 17, 18, 19, 21, 22, 24, 25, 26, 27, 31, 32, 33, 34, 35, 38, 40, 42, 44, 49, 52, 53, 54, 55, 56, 60,
]);
// Open Peeps heads. Left out: hats, the bear hood and head coverings.
const PEEPS_LONGER = [
  'afro', 'bangs', 'bangs2', 'bantuKnots', 'bun', 'bun2', 'buns', 'cornrows', 'cornrows2', 'dreads1', 'dreads2', 'grayBun',
  'grayMedium', 'long', 'longAfro', 'longBangs', 'longCurly', 'medium1', 'medium2', 'medium3', 'mediumBangs', 'mediumBangs2',
  'mediumBangs3', 'mediumStraight', 'twists', 'twists2',
];
const PEEPS_SHORTER = [
  'afro', 'cornrows', 'dreads1', 'dreads2', 'flatTop', 'flatTopLong', 'grayShort', 'mohawk', 'noHair1', 'noHair2', 'noHair3',
  'pomp', 'shaved1', 'shaved2', 'shaved3', 'short1', 'short2', 'short3', 'short4', 'short5', 'twists', 'twists2',
];
const either = (a, b) => [...new Set([...a, ...b])];

/**
 * What the sheet draws from, per style: friendly faces, clear lenses, no sunglasses, masks,
 * hats or hand signs that read differently across cultures. A candidate is drawn from
 * these, then pinned, so the entry under each card reproduces exactly that card.
 */
const CANDIDATE_POOLS = {
  notionists: (presentation) => ({
    hairVariant: byPresentation(NOTIONISTS_LONGER, NOTIONISTS_SHORTER, either(NOTIONISTS_LONGER, NOTIONISTS_SHORTER))[presentation],
    beardProbability: byPresentation(0, 35, 10)[presentation],
    glassesVariant: variants('variant', [3, 8, 11]),
    glassesProbability: 30,
    gestureVariant: ['waveLongArm', 'waveLongArms', 'pointLongArm', 'wavePointLongArms', 'handPhone'],
    gestureProbability: 15,
    mouthVariant: variants('variant', [3, 4, 5, 8, 13, 14, 17, 20, 21, 22, 23, 25]),
    eyebrowsVariant: variants('variant', [1, 2, 4, 5, 7, 8, 9, 10, 12]),
    clothesGraphicProbability: 0,
  }),
  lorelei: (presentation) => ({
    hairVariant: variants('variant', range(1, 48).filter((n) => n !== 34)),
    mouthVariant: variants('happy', range(1, 18)),
    beardProbability: byPresentation(0, 15, 0)[presentation],
    glassesProbability: 25,
  }),
  'open-peeps': (presentation) => ({
    headVariant: byPresentation(PEEPS_LONGER, PEEPS_SHORTER, either(PEEPS_LONGER, PEEPS_SHORTER))[presentation],
    expressionVariant: ['calm', 'cute', 'driven', 'serious', 'smile', 'smileBig', 'smileTeethGap'],
    accessoriesVariant: ['glasses', 'glasses2', 'glasses3', 'glasses4', 'glasses5'],
    accessoriesProbability: 25,
    facialHairProbability: byPresentation(0, 35, 10)[presentation],
    maskProbability: 0,
  }),
};
const CANDIDATES_PER_ROW = { notionists: 8, lorelei: 4, 'open-peeps': 4 };

// Plain code-point order (not locale order), so the output is the same on every machine.
const byCodePoint = (left, right) => (left === right ? 0 : left < right ? -1 : 1);

/** Turns what DiceBear picked into a fully pinned options object (see checkLook). */
function pinResolved(styleName, resolved) {
  const options = {};
  for (const component of componentsOf(styleName).sort((a, b) => byCodePoint(a.name(), b.name()))) {
    const name = component.name();
    const variant = resolved[`${name}Variant`];
    if (typeof variant === 'string') {
      options[`${name}Variant`] = variant;
      if (component.probability() < 100) options[`${name}Probability`] = 100;
    } else {
      options[`${name}Probability`] = 0;
    }
  }
  return options;
}

/** `count` different pinned looks for one agent in one style, none equal to a look in `taken`. */
function candidatesFor(agent, styleName, count, taken) {
  if (!['feminine', 'masculine', 'neutral'].includes(agent.presentation)) {
    throw new Error(`ROSTER entry "${agent.id}" has presentation "${agent.presentation}"; use feminine, masculine or neutral.`);
  }
  const looks = [];
  for (let n = 1; looks.length < count; n += 1) {
    if (n > count * 25) throw new Error(`Found only ${looks.length} different ${styleName} looks for ${agent.id}.`);
    const seed = `${agent.name}-${styleName}-${n}`;
    const draft = new Avatar(styleOf(styleName), { seed, ...CANDIDATE_POOLS[styleName](agent.presentation) });
    const options = pinResolved(styleName, draft.toJSON().options);
    const key = `${styleName}:${JSON.stringify(options)}`;
    if (taken.has(key)) continue;
    taken.add(key);
    looks.push({ style: styleName, seed, options });
  }
  return looks;
}

const escapeHtml = (text) =>
  String(text).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

/** A look as one line of JSON with spaces, which is also a valid JavaScript object literal. */
const entryText = (look) => JSON.stringify(look, null, 1).replace(/\n\s*/g, ' ');

const SHEET_CSS = `
:root{--paper:#EEF1F4;--sheet:#FBFCFD;--ink:#172233;--graphite:#5D6571;--sig:#2443C4;--line:rgba(23,34,51,.12)}
*{box-sizing:border-box}
body{margin:0;padding:24px 28px 48px;background:var(--paper);color:var(--ink);font:14px/1.45 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif}
h1,h2{font-family:"Iowan Old Style",Charter,Georgia,serif;font-weight:600}
h1{font-size:24px;margin:0 0 6px}
h2{font-size:19px;margin:28px 0 2px}
h2 small{font:13px/1.4 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;color:var(--graphite)}
h3{font-size:12px;text-transform:uppercase;letter-spacing:.06em;color:var(--graphite);margin:12px 0 4px}
p{max-width:72ch;margin:4px 0}
nav{margin:12px 0;display:flex;flex-wrap:wrap;gap:4px 12px}
nav a{color:var(--sig)}
.group{margin-top:36px;padding-top:8px;border-top:2px solid var(--line);font-size:13px;text-transform:uppercase;letter-spacing:.08em;color:var(--graphite)}
.row{display:grid;grid-template-columns:repeat(auto-fill,minmax(150px,1fr));gap:10px}
figure{margin:0;background:var(--sheet);border:1px solid var(--line);border-radius:4px;padding:6px;display:flex;flex-direction:column;gap:4px}
.current figure{border-color:var(--sig);max-width:220px}
figure svg{display:block;width:100%;height:auto}
figcaption{font-size:12px;color:var(--graphite)}
code{font:12px/1.4 ui-monospace,"SF Mono",Menlo,Consolas,monospace}
figure code{display:block;margin-top:4px;font-size:10.5px;line-height:1.35;white-space:pre-wrap;overflow-wrap:anywhere;user-select:all;background:var(--paper);border-radius:3px;padding:4px;color:var(--ink)}
summary{cursor:pointer;font-size:12px;color:var(--sig)}
footer{margin-top:40px;font-size:13px;color:var(--graphite)}
`;

/**
 * The contact sheet: per agent the current look, 8 Notionists options and a row each of
 * Lorelei and Open Peeps. Inline SVG and inline CSS only, so it opens offline. Each card
 * carries the entry to paste into LOOKS.
 */
export function buildCandidatesHtml() {
  let cardCount = 0;
  const card = (agent, look, label) => {
    cardCount += 1;
    const svg = renderLookSvg(look, { title: `${agent.name}: ${label}`, idPrefix: `c${cardCount}-` });
    return (
      `<figure>${svg}<figcaption>${escapeHtml(label)} · seed ${escapeHtml(look.seed)}</figcaption>` +
      `<details${label === 'current' ? ' open' : ''}><summary>entry</summary>` +
      `<code>${escapeHtml(entryText(look))}</code></details></figure>`
    );
  };
  const sections = [];
  let group = '';
  for (const agent of ROSTER) {
    const current = LOOKS[agent.id];
    checkLook(current);
    if (agent.group !== group) {
      group = agent.group;
      sections.push(`<h2 class="group">${escapeHtml(GROUP_TITLES[group] ?? group)}</h2>`);
    }
    const taken = new Set([`${current.style}:${JSON.stringify(current.options)}`]);
    const rows = [`<h3>Current</h3><div class="row current" data-row="current">${card(agent, current, 'current')}</div>`];
    for (const styleName of Object.keys(CANDIDATES_PER_ROW)) {
      const looks = candidatesFor(agent, styleName, CANDIDATES_PER_ROW[styleName], taken);
      const cards = looks.map((look, i) => card(agent, look, `${STYLES[styleName].title} ${i + 1}`));
      rows.push(`<h3>${escapeHtml(STYLES[styleName].title)}</h3><div class="row" data-row="${styleName}">${cards.join('')}</div>`);
    }
    sections.push(
      `<section id="agent-${agent.id}" data-agent="${agent.id}">` +
        `<h2>${escapeHtml(agent.name)} <small>${escapeHtml(agent.capability)} · ${agent.id}</small></h2>${rows.join('')}</section>`,
    );
  }
  const nav = ROSTER.map((agent) => `<a href="#agent-${agent.id}">${escapeHtml(agent.name)}</a>`).join('');
  const licences = Object.keys(STYLES)
    .map((name) => `<li>${escapeHtml(attribution(name))}</li>`)
    .join('');
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Avatar candidates</title>
<style>${SHEET_CSS}</style>
</head>
<body>
<header>
<h1>Avatar candidates</h1>
<p>Each card shows a look; open its entry to see what draws it. To use one: click the entry to select it, copy it into <code>LOOKS</code> in <code>scripts/make-avatars.mjs</code> under the agent's id, then run <code>npm run avatars</code> and <code>npm test</code>.</p>
<p>Everything is drawn in graphite on the sheet colour. Regenerate this page with <code>npm run avatars -- --candidates</code>; it is git-ignored.</p>
</header>
<nav>${nav}</nav>
${sections.join('\n')}
<footer>
<h2>Styles and licences</h2>
<p>As stated in each style definition (<code>meta</code>):</p>
<ul>${licences}</ul>
<p>The committed pictures credit the styles they use in <code>public/avatars/CREDITS.md</code>.</p>
</footer>
</body>
</html>
`;
}

// ---------------------------------------------------------------------------
// Command line
// ---------------------------------------------------------------------------

const USAGE = `Usage: npm run avatars [-- --candidates] [-- --out <dir>]

  (no option)      write public/avatars/<id>.svg for every agent
  --candidates     write .avatar-candidates/index.html instead: alternative looks to paste into LOOKS
  --out <dir>      write into <dir> instead of the default folder (tests, dry runs)
  --help           show this help`;

function main(argv) {
  let args;
  try {
    args = parseArgs({
      args: argv,
      options: {
        candidates: { type: 'boolean' },
        out: { type: 'string' },
        help: { type: 'boolean', short: 'h' },
      },
      strict: true,
      allowPositionals: false,
    }).values;
  } catch (error) {
    console.error(`${error.message}\n\n${USAGE}`);
    return 1;
  }
  if (args.help) {
    console.log(USAGE);
    return 0;
  }
  const files = args.candidates ? new Map([['index.html', buildCandidatesHtml()]]) : buildAvatarFiles();
  const outDir = args.out ? path.resolve(args.out) : args.candidates ? CANDIDATES_DIR : AVATAR_DIR;
  fs.mkdirSync(outDir, { recursive: true });
  for (const [name, contents] of files) fs.writeFileSync(path.join(outDir, name), contents);
  const what = files.size === 1 ? [...files.keys()][0] : `${files.size} files`;
  console.log(`Wrote ${what} to ${path.relative(process.cwd(), outDir) || '.'}`);
  return 0;
}

const invokedDirectly =
  process.argv[1] !== undefined &&
  fs.realpathSync(path.resolve(process.argv[1])) === fs.realpathSync(fileURLToPath(import.meta.url));
if (invokedDirectly) {
  try {
    process.exitCode = main(process.argv.slice(2));
  } catch (error) {
    console.error(`make-avatars: ${error.message}`);
    process.exitCode = 1;
  }
}
