import { describe, expect, it } from 'vitest';
import { isSameModel } from './answered-model';

describe('isSameModel', () => {
  it('accepts the vendor name for a catalogue id, and a dated snapshot of an alias', () => {
    expect(isSameModel('vendor.model-5-5', 'model-5-5')).toBe(true);
    expect(isSameModel('gpt-6.1-sol', 'gpt-6.1-sol-2026-09-29')).toBe(true);
    expect(isSameModel('vendor.model-4-5', 'model-4-5@20250929')).toBe(true);
    expect(isSameModel('vendor.model-4-5', 'model-4-5-20250929')).toBe(true);
    expect(isSameModel('gpt-5.6-sol-2026-07-09', 'GPT-5.6-sol-2026-07-09')).toBe(true);
  });

  it('flags another model, a shorter or longer version name included', () => {
    expect(isSameModel('vendor.model-5-5', 'model-5')).toBe(false);
    expect(isSameModel('vendor.model-5', 'model-5-5')).toBe(false);
    expect(isSameModel('gpt-4o', 'gpt-5-mini')).toBe(false);
    expect(isSameModel('gpt-6.1-sol', 'gpt-6.1-sol-mini')).toBe(false);
    expect(isSameModel('gpt-6.1-sol', 'gpt-6.1-sol-2026-09-29-preview')).toBe(false);
  });
});
