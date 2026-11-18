import { describe, expect, it } from 'vitest';
import { isSameModel } from './answered-model';

describe('isSameModel', () => {
  it('accepts the vendor name for a catalogue id, and a dated snapshot of an alias', () => {
    expect(isSameModel('vendor.model-5-5', 'model-5-5')).toBe(true);
    expect(isSameModel('vendor-b.model-7', 'model-7-2026-03-31')).toBe(true);
    expect(isSameModel('vendor.model-4-5', 'model-4-5@20250929')).toBe(true);
    expect(isSameModel('vendor.model-4-5', 'model-4-5-20250929')).toBe(true);
    expect(isSameModel('gpt-5.6-sol-2026-07-09', 'GPT-5.6-sol-2026-07-09')).toBe(true);
  });

  it('flags another model, a shorter or longer version name included', () => {
    expect(isSameModel('vendor.model-5-5', 'model-5')).toBe(false);
    expect(isSameModel('vendor.model-5', 'model-5-5')).toBe(false);
    expect(isSameModel('vendor-b.model-7', 'model-3-small')).toBe(false);
    expect(isSameModel('vendor-b.model-7', 'model-7-small')).toBe(false);
    expect(isSameModel('vendor-b.model-7', 'model-7-2026-03-31-preview')).toBe(false);
  });
});
