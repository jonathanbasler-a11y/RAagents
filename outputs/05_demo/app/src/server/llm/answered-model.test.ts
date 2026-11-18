import { describe, expect, it } from 'vitest';
import { isSameModel } from './answered-model';

describe('isSameModel: the reported model against the configured one', () => {
  it.each([
    ['vendor-a.model-2-1', 'model-2-1', 'prefix left out'],
    ['model-8', 'model-8-2027-01-15', 'release date added, dashed'],
    ['vendor-a.model-3-0', 'model-3-0@20270115', 'release date added after @'],
    ['vendor-a.model-3-0', 'model-3-0-20270115', 'release date added, compact'],
    ['alpha-9.4-mini-2027-02-02', 'ALPHA-9.4-mini-2027-02-02', 'only the case differs'],
  ])('%s and %s are the same model (%s)', (configured, reported) => {
    expect(isSameModel(configured, reported)).toBe(true);
  });

  it.each([
    ['vendor-a.model-3-0', 'model-3', 'a shorter version name'],
    ['vendor-a.model-3', 'model-3-0', 'a longer version name'],
    ['model-8', 'model-2-tiny', 'another model'],
    ['model-8', 'model-8-tiny', 'a variant of the same family'],
    ['model-8', 'model-8-2027-01-15-beta', 'a date followed by more'],
  ])('%s and %s are different models (%s)', (configured, reported) => {
    expect(isSameModel(configured, reported)).toBe(false);
  });

  it('does not take a dot inside a version for a vendor prefix', () => {
    expect(isSameModel('alpha-9.4', 'alpha-9.5')).toBe(false);
    expect(isSameModel('alpha-9.4', '4')).toBe(false);
  });
});
