import { describe, expect, it } from 'vitest';
import { modelFamily } from './index';

describe('modelFamily', () => {
  it.each([
    ['anthropic.claude-model-a', 'anthropic'],
    ['claude-sonnet-5', 'anthropic'],
    ['us.anthropic.claude-haiku-4', 'anthropic'],
    ['gpt-5.6-sol-test', 'openai'],
    ['proxy/gpt-4.1', 'openai'],
    ['sol-5.6', 'openai'],
    ['o3-mini', 'openai'],
    ['openai.o4-mini', 'openai'],
    ['gemini-2.5-pro', 'google'],
    ['google/gemma-3', 'google'],
    ['meta-llama-4-maverick', 'meta'],
    ['mistral-large-2', 'mistral'],
    ['mixtral-8x22b', 'mistral'],
  ])('reads %s as %s', (model, family) => {
    expect(modelFamily(model)).toBe(family);
  });

  it.each([['house-model-7'], ['console-model'], ['solar-1'], ['photo3-model'], ['']])(
    'does not guess a family for %j',
    (model) => {
      expect(modelFamily(model)).toBe('unknown');
    },
  );
});
