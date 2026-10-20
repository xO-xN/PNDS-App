import { expect, it } from 'vitest'
import {
  explicitlyRequestedResources,
  resourceDecisionEvidence,
  realtimeResourcePriority,
} from './assistant-resources'
import type { AssistantResourcePlan } from './tauri-bindings'

const plan: AssistantResourcePlan = {
  id: 'task-resources-1',
  reason: 'Client identity recovery',
  alternative: 'Keep the existing HTTP transport',
  decision: 'pending',
  resources: [
    { kind: 'module', id: 'players', version: '0.2.0', source: 'frozen' },
    { kind: 'library', id: 'socket.io', version: '4.8.4', source: 'frozen' },
  ],
}

it('only preauthorizes explicitly named additions from human input, including grouped requests', () => {
  expect(
    explicitlyRequestedResources(
      '添加 players 模块和 socket.io 共享包，完成接线。',
      plan
    )
  ).toBe(true)
  expect(
    explicitlyRequestedResources(
      'Use players and socket.io to implement the requested selection.',
      plan
    )
  ).toBe(true)
  for (const input of [
    '制作演奏者选择 1–9 的界面。',
    '不要添加 players 和 socket.io',
    'Should we add players and socket.io?',
    '考虑使用 players 和 socket.io',
    'Add players but keep existing dependencies',
    'use myplayers and socket.io-client',
    '> Add players and socket.io',
    '```text\nAdd players and socket.io\n```',
    'The previous model said to add players and socket.io',
  ]) {
    expect(explicitlyRequestedResources(input, plan)).toBe(false)
  }
})

it('projects only the actual confirmed decision and its exact alternative back to the model', () => {
  expect(resourceDecisionEvidence([plan])).toEqual([])
  expect(
    resourceDecisionEvidence([{ ...plan, decision: 'alternative' }])
  ).toEqual([
    {
      resources: plan.resources.map(({ kind, id, version }) => ({
        kind,
        id,
        version,
      })),
      decision: 'alternative',
      selectedAlternative: plan.alternative,
    },
  ])
  expect(
    JSON.stringify(
      resourceDecisionEvidence([{ ...plan, decision: 'approved' }])
    )
  ).not.toContain('frozen')
})

it('recognizes the original Runes multiplayer and touch-sync goals, including follow-up coordinate corrections', () => {
  const history = [
    '现在制作演奏者界面，连接之后选择1–9，按编号显示乐谱。',
    '让演奏者的触摸点同步显示到指挥乐谱。',
  ] as const
  for (const goal of [
    history[0],
    history[1],
    '调整：演奏者触摸点会滑动，手指离开后消失；指挥端还没同步。',
    '演奏者界面正确了。指挥界面的点的位置应该在该演奏者序号附近。',
    '修复多名演奏者同时操作时的状态同步与断线重连。',
    'Mirror each performer touch to the conductor near the corresponding number.',
    'Give every performer a connection and restore their identity on reconnect.',
  ])
    expect(realtimeResourcePriority(goal, history)).toEqual({
      keepExisting: false,
    })
})

it('keeps cosmetic changes and explanation/documentation tasks light even in a multiplayer chat', () => {
  const history = ['多个演奏者的触摸要同步到指挥端。']
  for (const goal of [
    '把演奏者字体增大、背景改白。',
    '把触摸点放大一点。',
    '修改 README 中 socket.io 的说明。',
    '解释演奏者同步的原理。',
    'socket.io 对这个项目有哪些帮助？',
    'Change the performer font size.',
  ]) {
    expect(realtimeResourcePriority(goal, history)).toBeNull()
  }
  expect(realtimeResourcePriority('新建一个静态 HTML 页面。')).toBeNull()
})

it('honors explicit transport/dependency restrictions until the creator changes that decision', () => {
  for (const goal of [
    '同步演奏者触点，但这次不要新增依赖。',
    '修复演奏者重连，请不要更换现有的通信方式。',
    'Sync performer touches; do not add socket.io.',
    'Mirror performer state without new dependencies.',
  ]) {
    expect(realtimeResourcePriority(goal)).toEqual({ keepExisting: true })
  }
  expect(
    realtimeResourcePriority('修复演奏者触摸同步。', ['不要新增依赖。'])
  ).toEqual({ keepExisting: true })
  expect(
    realtimeResourcePriority('接入 socket.io 来同步演奏者触摸。', [
      '不要新增依赖。',
    ])
  ).toEqual({ keepExisting: false })
})

it('does not confuse preserving the original score or prohibiting CDN with rejecting local Socket.IO', () => {
  expect(
    realtimeResourcePriority(
      '接入 socket.io 来同步演奏者触摸，并保留原乐谱绘制逻辑。'
    )
  ).toEqual({ keepExisting: false })
  expect(
    realtimeResourcePriority('同步演奏者触摸，不要使用 CDN 依赖。')
  ).toEqual({ keepExisting: false })
  expect(
    realtimeResourcePriority('同步演奏者触摸，不新增依赖，也不要用 CDN。')
  ).toEqual({ keepExisting: true })
})
