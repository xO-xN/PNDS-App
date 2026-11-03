import type { AssistantMessage } from './assistant-types'
import { modelProfileKey } from './model-context-settings'
import type { AssistantQuestion, ModelServiceConfig } from './tauri-bindings'

/** Invented scores only: never load a creator project, transcript or credential. */
export const RELIABILITY_EVAL_FIXTURE_VERSION = 1
export const RELIABILITY_EVAL_FILES = {
  'public/controller.js':
    'export const releaseLeadMs = 2000;\nexport const pauseMode = "cut";\nexport function shouldRelease(nowMs, endMs, held) { return !held || nowMs >= endMs - releaseLeadMs; }\n',
  'tests/pad.test.mjs':
    'import { strict as assert } from "node:assert";\nimport { test } from "node:test";\nimport { shouldRelease } from "../public/controller.js";\ntest("release is scheduled before disappearance", () => assert.equal(shouldRelease(8000, 10000, true), true));\n',
  'supercollider/source/voice.scd':
    '// Fixture declarations: attack 0.4 seconds, release 2.0 seconds.\n',
}

export type ReliabilityEvalCaseId =
  | 'creator-correction'
  | 'ending-scope'
  | 'answered-plan'
export interface ReliabilityEvalCase {
  id: ReliabilityEvalCaseId
  input: string
  criteria: string[]
  history: (config: ModelServiceConfig) => AssistantMessage[]
}

function answered(id: string, prompt: string, text: string): AssistantQuestion {
  return {
    id,
    taskId: 'fixture-design',
    scope: { chatId: 'fixture-chat', messageId: 'fixture-reply' },
    prompt,
    options: [],
    recommendedOptionId: null,
    status: 'answered',
    answer: { optionId: null, text },
  }
}

function history(
  config: ModelServiceConfig,
  questions: AssistantQuestion[]
): AssistantMessage[] {
  const common = {
    status: 'completed' as const,
    scope: 'project' as const,
    contextServiceKey: modelProfileKey(config),
    sources: [],
  }
  return [
    {
      ...common,
      id: 'fixture-user',
      role: 'user',
      text: 'Plan the pad voice update. Keep pitch intervals and unrelated transport behavior.',
    },
    {
      ...common,
      id: 'fixture-reply',
      role: 'assistant',
      text: 'The design questions have been answered.',
      questions,
      sources: [
        {
          docId: 'public/controller.js',
          sectionId: 'L1',
          title: 'controller.js',
          locale: 'en',
          project: {
            path: 'public/controller.js',
            version: 'superseded-source',
            text: '// old version',
            offset: 0,
            endOffset: 14,
            totalCharacters: 14,
            nextOffset: null,
            startLine: 1,
            endLine: 1,
          },
        },
      ],
    },
  ]
}

export const RELIABILITY_EVAL_CASES: readonly ReliabilityEvalCase[] = [
  {
    id: 'creator-correction',
    input:
      'Finish the implementation plan for voice.scd and controller.js using my submitted answer. Do not implement yet. All creative choices are settled; provide the full plan and next-step actions.',
    criteria: [
      'Preserves the requested shift of exactly 12 semitones and unchanged intervals.',
      'States the creator-provided route: phones control, the Mac sends audio to the venue PA; does not justify the shift with phone speakers.',
      'Distinguishes creator environment statements from independently verified runtime facts.',
    ],
    history: config =>
      history(config, [
        answered(
          'routing',
          'Raise notes for handset speakers?',
          'Raise notes by exactly 12 semitones, preserving intervals. Phones send control events only. The Mac feeds the venue PA; phone speakers are not the audio output.'
        ),
      ]),
  },
  {
    id: 'ending-scope',
    input:
      'Finalize the public/controller.js sustain fix. The existing tests/pad.test.mjs passes against the saved controller, but the performer reports that holding does not sustain until disappearance. Inspect both source and test and account for the conflict. Do not implement. Preserve the accepted ending boundary; the other transport rules stay as they are.',
    criteria: [
      'Finds that preemptive release conflicts with holding sustain until lift or element disappearance.',
      'Recognizes that the passing old test asserts the old preemptive rule, so passing it does not satisfy the new creator requirement.',
      'Starts release at lift or disappearance and allows the full tail afterward.',
      'Does not extend the element rule to Pause, Stop, seeking, disconnection or whole-score ending.',
    ],
    history: config =>
      history(config, [
        answered(
          'gate',
          'What should happen when an element ends?',
          'While held and visible, sustain continuously. Lift or disappearance begins a 2.0-second release tail. Leave Pause, Stop, seek, disconnection and whole-score ending behavior unchanged.'
        ),
      ]),
  },
  {
    id: 'answered-plan',
    input:
      'Both design questions are answered. Finish the complete plan for voice.scd and controller.js, with the accepted values, scope and event-based acceptance. Offer the next-step actions. Do not start implementation.',
    criteria: [
      'Uses attack 0.4 seconds and release 2.0 seconds for every voice.',
      'Preserves fixed pitches and all pitch intervals.',
      'Publishes the complete public plan through the validated plan protocol without repeating settled questions.',
    ],
    history: config =>
      history(config, [
        answered(
          'texture',
          'Which voices become pads?',
          'Every voice becomes a continuous pad; fixed pitches and pitch intervals stay unchanged.'
        ),
        answered(
          'envelope',
          'Which timing should the pads use?',
          'Attack is 0.4 seconds and release is 2.0 seconds. Sustain while held; lift begins release.'
        ),
      ]),
  },
]
