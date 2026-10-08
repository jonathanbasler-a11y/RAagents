import type { RoomId } from '@/shared/contracts';

/**
 * The live demo's prompts (LIVE-DEMO.md, steps 2 to 8), so the presenter clicks them instead
 * of typing them. This file is the app's only copy: demo-prompts.test.ts fails when a text here
 * and its grey box in LIVE-DEMO.md differ, and when a team prompt no longer brings in the
 * teammates the walkthrough names.
 */

/** Stable ids: the walkthrough step in LIVE-DEMO.md ("step4b" is the optional part of step 4). */
export type DemoPromptId = 'step2' | 'step3' | 'step4' | 'step4b' | 'step5' | 'step6' | 'step7' | 'step8';

export interface DemoPrompt {
  id: DemoPromptId;
  /** Where the walkthrough asks it: "team", or the agent id of a 1:1 room. */
  room: RoomId;
  /** The button text: the step and a few words. */
  label: string;
  /** The prompt, exactly as in LIVE-DEMO.md. */
  text: string;
}

export const DEMO_PROMPTS: readonly DemoPrompt[] = [
  {
    id: 'step2',
    room: 'reglead',
    label: 'Step 2 · Rosa: what a buyer would inherit',
    text: 'ABC-123 (illustrative) is an oral small molecule for a rare disease. What commitments would a buyer inherit?',
  },
  {
    id: 'step3',
    room: 'team',
    label: 'Step 3 · @Rosa @Carlos: a new manufacturing site',
    text: '@Rosa @Carlos Suppose the seller of ABC-123 (illustrative) moves manufacturing to a new site before filing. What should our DD check?',
  },
  {
    id: 'step4',
    room: 'team',
    label: 'Step 4 · Designations: rare disease, paediatric',
    text: 'Which designations could matter for a rare disease asset with a paediatric angle?',
  },
  {
    id: 'step4b',
    room: 'team',
    label: 'Step 4b · Optional: adds breakthrough therapy',
    text: 'Which designations could matter for a rare disease asset with a paediatric angle, and could it qualify for breakthrough therapy?',
  },
  {
    id: 'step5',
    room: 'team',
    label: 'Step 5 · @Carlos @Dara: stability gaps',
    text: '@Carlos @Dara Which stability gaps most often delay a filing?',
  },
  {
    id: 'step6',
    room: 'team',
    label: 'Step 6 · Should we buy this asset?',
    text: 'Should we buy this asset?',
  },
  {
    id: 'step7',
    room: 'team',
    label: 'Step 7 · @Emeka: claims that need a source',
    text: '@Emeka Which claims in the replies above need a source, and what kind? List the three that matter most.',
  },
  {
    id: 'step8',
    room: 'team',
    label: 'Step 8 · @Saskia: sanitise a question',
    text: '@Saskia Sanitise this question for a cleared CMC expert: "Does adding a second drug substance site for ABC-123 (illustrative) need new comparability data before the Phase 3 start in 2027?"',
  },
];

/** The prompts the walkthrough asks in this room, in walkthrough order. */
export function demoPromptsFor(roomId: RoomId): DemoPrompt[] {
  return DEMO_PROMPTS.filter((prompt) => prompt.room === roomId);
}
