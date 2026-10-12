import { describe, expect, it } from 'vitest';
import { isNoAddition } from '@/server/chat/team';

// Mutation sweep, guard 4 (BUILD-LEARNINGS Part 9.11): the NO_ADDITION reply filter.
//
// team.test.ts pins the main shapes. This file pins the edges that a one-character change
// would otherwise move without any test noticing: the 12-word limit on a reason, every word
// that turns a reason into a point, and every wrapper the signal may sit in. The rule behind
// all of it: doubt means contribution, because losing a real point is worse than showing a
// redundant reply.

const reasonOf = (wordCount: number) => Array.from({ length: wordCount }, () => 'word').join(' ');

describe('isNoAddition: the length of a reason', () => {
  it('accepts a reason of exactly 12 words and treats 13 words as a contribution', () => {
    expect(isNoAddition(`NO_ADDITION: ${reasonOf(12)}`)).toBe(true);
    expect(isNoAddition(`NO_ADDITION: ${reasonOf(13)}`)).toBe(false);
  });

  it('counts the words of the reason, not its characters', () => {
    expect(isNoAddition('NO_ADDITION: Rosa covered the comparability and stability sections in full detail already')).toBe(true);
  });
});

describe('isNoAddition: a reason that turns on a contrast word is a point', () => {
  const CONTRAST = ['but', 'however', 'although', 'though', 'except', 'yet', 'apart', 'aside', 'besides', 'unless', 'whereas'];

  it('accepts the same reason without the contrast word (positive control)', () => {
    expect(isNoAddition('NO_ADDITION: Rosa covered it and the stability data need a check')).toBe(true);
  });

  it.each(CONTRAST)('treats a reason with "%s" as a contribution', (word) => {
    expect(isNoAddition(`NO_ADDITION: Rosa covered it ${word} the stability data need a check`)).toBe(false);
  });

  it('matches the contrast word in any case', () => {
    expect(isNoAddition('NO_ADDITION: Rosa covered it. HOWEVER the stability data need a check')).toBe(false);
  });
});

describe('isNoAddition: what a model wraps around the signal', () => {
  it.each([
    ['NO_ADDITION', 'bare'],
    ['"NO_ADDITION"', 'straight double quotes'],
    ["'NO_ADDITION'", 'straight single quotes'],
    ['“NO_ADDITION”', 'curly double quotes'],
    ['‘NO_ADDITION’', 'curly single quotes'],
    ['`NO_ADDITION`', 'code ticks'],
    ['**NO_ADDITION**', 'bold'],
    ['_NO_ADDITION_', 'underscore emphasis'],
    ['~NO_ADDITION~', 'tildes'],
    ['NO_ADDITION.', 'a full stop'],
    ['NO_ADDITION!', 'an exclamation mark'],
    ['NO_ADDITION...', 'an ellipsis'],
    ['  \n NO_ADDITION \n ', 'surrounding whitespace'],
    ['No_Addition', 'mixed case'],
    ['no addition', 'a space instead of the underscore'],
    ['no   addition', 'a run of spaces'],
  ])('reads %j (%s) as nothing to add', (text) => {
    expect(isNoAddition(text)).toBe(true);
  });

  it('reads the plain phrase as nothing to add only when it is the whole reply', () => {
    expect(isNoAddition('nothing to add')).toBe(true);
    // The words joined by underscores, built from parts so the joined token is not spelled out in the source.
    expect(isNoAddition(`${['Nothing', 'to', 'add'].join('_')}!`)).toBe(true);
    expect(isNoAddition('Nothing to add: Rosa covered it.')).toBe(false);
  });

  it.each(['NO_ADDITIONAL concerns', 'NO_ADDITIONS', 'Not an addition', 'NO ADD', 'addition'])('does not read %j as the signal', (text) => {
    expect(isNoAddition(text)).toBe(false);
  });
});
