import i18n from '@/i18n/config'
import type { AssistantResource, AssistantResourcePlan } from './tauri-bindings'

const moduleKeys: Record<string, string> = {
  qr: 'qr',
  players: 'players',
  'theme-follow': 'themeFollow',
  'locale-follow': 'localeFollow',
  'monitor-state': 'monitorState',
  hub: 'hub',
}

export function resourceName(resource: Pick<AssistantResource, 'kind' | 'id'>) {
  return resource.kind === 'module' && moduleKeys[resource.id]
    ? i18n.t(`creation.modules.name.${moduleKeys[resource.id]}`)
    : resource.id
}

export function pendingResourcePlan(task: {
  resourcePlans?: AssistantResourcePlan[]
}) {
  return task.resourcePlans?.find(plan => plan.decision === 'pending')
}

/** Captured human goals select a narrow networking policy. Project documents
 * cannot assign a task, and older goals cannot turn a cosmetic edit into one. */
export function realtimeResourcePriority(
  input: string,
  previousUserInputs: readonly string[] = []
): { keepExisting: boolean } | null {
  const clean = (text: string) => text.replace(/```[\s\S]*?```/g, '')
  const goal = clean(input)
  const context = [...previousUserInputs.slice(-3).map(clean), goal].join('\n')
  if (
    /(?:有哪些帮助|有帮助吗|是否有必要|为什么|先评估|先讨论|解释|介绍|原理|explain|describe|what are|should we)/i.test(
      goal
    )
  )
    return null
  if (
    /(?:README|交接文档|说明书|文档|documentation)/i.test(goal) &&
    !/(?:实现|接入|连接|implement|integrate|connect)/i.test(goal)
  )
    return null
  const communication =
    /(?:同步|联动|连接|重连|恢复身份|身份恢复|编号选择|选择.{0,12}(?:编号|数字)|广播|消息|多端|多人|实时交互|sync|mirror|connect|reconnect|identity|broadcast|messag|multiplayer|multi.user|number selection)/i
  const touch =
    /(?:触摸|触点|触控|手指|滑动|圆点|点的位置|touch|pointer|dot|marker)/i
  const cosmetic =
    /(?:字体|字号|颜色|背景|样式|排版|尺寸|大小|放大|缩小|font|colou?r|background|styling|resize|bigger|smaller)/i
  if (cosmetic.test(goal) && !communication.test(goal)) return null
  const performers =
    /(?:演奏者|乐手|参与者|客户端|多端|多人|多台|多个设备|performer|player|client|multiplayer|multi.user)/i
  if (
    !performers.test(context) ||
    !(communication.test(goal) || (touch.test(goal) && touch.test(context)))
  )
    return null
  // Interpret scoped transport directives, not unrelated phrases such as
  // "preserve the score" or "no CDN". The latest explicit choice wins.
  const directives =
    /(?<keep>不(?:要|再)?(?:添加|引入|新增|使用|采用|安装).{0,12}(?:依赖|模块|共享包|Socket\.?IO)|不(?:要|再)?(?:改|换|改变|替换|更换).{0,12}(?:通信|通讯|协议|轮询)|保留.{0,12}(?:HTTP|轮询|通信|通讯)|without.{0,12}(?:dependencies|socket)|(?:do not|don't|avoid).{0,12}(?:add|adopt|use|change).{0,12}(?:socket\.?io|dependencies|transport)|no new dependencies|keep.{0,12}(?:HTTP|polling|transport))|(?<prefer>(?:添加|接入|采用|使用|改用|add|adopt|use).{0,12}socket\.?io)/gi
  let keepExisting = false
  for (const text of [...previousUserInputs.slice(-3), input]) {
    for (const match of clean(text).matchAll(directives)) {
      if (
        match.groups?.keep &&
        /(?:CDN|在线|远程|online|remote)/i.test(match[0]) &&
        !/socket\.?io/i.test(match[0])
      )
        continue
      keepExisting = !!match.groups?.keep
    }
  }
  return { keepExisting }
}

/** Only captured human input can pre-authorize a named addition. Reference
 * documents, model arguments and generic implementation goals cannot. */
export function explicitlyRequestedResources(
  input: string,
  plan: AssistantResourcePlan
) {
  const clauses = input
    .replace(/```[\s\S]*?```/g, '')
    .split(/[\n。！!？?；;，,]/)
  return plan.resources.every(resource =>
    clauses.some(clause => {
      if (
        /(?:不要|不需要|不添加|不使用|无需|是否|能否|建议|考虑|don't|do not|without|avoid|\bshould\b|\bcould\b|\bmaybe\b)/i.test(
          clause
        )
      )
        return false
      const names = [resource.id, resourceName(resource)]
      const normalized = clause.toLocaleLowerCase()
      return (
        /^(?:\s*(?:请帮我|请|帮我|现在|接下来|我希望你|我想让你|同时|然后|并且|并))*\s*(?:添加|加入|接入|采用|安装|使用)|^\s*(?:please\s+)?(?:add|adopt|install|use)\b/i.test(
          clause
        ) &&
        names.some(name => {
          const offset = normalized.indexOf(name.toLocaleLowerCase())
          if (offset < 0) return false
          const left = normalized[offset - 1] ?? ''
          const right = normalized[offset + name.length] ?? ''
          return !/[a-z0-9_.-]/i.test(left) && !/[a-z0-9_.-]/i.test(right)
        })
      )
    })
  )
}

export function resourceDecisionEvidence(
  plans: readonly AssistantResourcePlan[]
) {
  return plans
    .filter(plan => plan.decision !== 'pending')
    .map(plan => ({
      resources: plan.resources.map(({ kind, id, version }) => ({
        kind,
        id,
        version,
      })),
      decision: plan.decision,
      ...(plan.decision === 'alternative'
        ? { selectedAlternative: plan.alternative }
        : {}),
    }))
}
