import { expect, it } from 'vitest'
import {
  HANDOFF_INSTRUCTIONS,
  handoffLanguage,
  handoffPrompt,
} from './assistant-handoff-prompt'
import i18n from '@/i18n/config'

it('assigns the current handoff and its closeout without copying contract references', () => {
  const [task, closeout] = HANDOFF_INSTRUCTIONS.split('\n\n')
  expect(task).toBe(
    'Follow `AGENTS.md`. Complete every current task confirmed in `docs/creator-handoff.md`.'
  )
  expect(closeout).toContain('Before updating the handoff')
  expect(closeout).toContain('docs/handoff-history/')
  expect(closeout).toContain(
    'actual check results and any pending creator reviews'
  )
  expect(closeout).toContain(
    'only unimplemented or blocked items and their reasons'
  )
  expect(HANDOFF_INSTRUCTIONS).not.toContain('name: pnds-handoff')
  expect(HANDOFF_INSTRUCTIONS).not.toMatch(/install|https?:\/\//i)
})

it.each(['en', 'zh-CN'])(
  'uses the requested language for the complete prompt independently of the UI in %s',
  async language => {
    const previous = i18n.language
    try {
      await i18n.changeLanguage(language === 'en' ? 'zh-CN' : 'en')
      const root = '/Scores/My "new" project'
      const prompt = handoffPrompt(root, language)
      if (language === 'en') {
        expect(prompt).toBe(
          `Work in the PNDS project at ${JSON.stringify(root)}. ${HANDOFF_INSTRUCTIONS}`
        )
      } else {
        expect(prompt).toBe(
          `在 PNDS 工程 ${JSON.stringify(root)} 中，遵循 \`AGENTS.md\`，完成 \`docs/creator-handoff.md\` 中已确认的全部当前任务。\n\n运行适用检查。更新交接单前，将完整旧单和实施报告追加归档到 \`docs/handoff-history/\`，报告写明实际检查结果和待创作者复核项。当前交接单只保留未实施或受阻事项及原因。`
        )
      }
      expect(prompt).not.toContain('{{')
    } finally {
      await i18n.changeLanguage(previous)
    }
  }
)

it('keeps a Chinese discussion language through English handoff UI actions and brief acknowledgments', () => {
  expect(
    handoffLanguage([
      { role: 'user', text: '让触摸控制音量，同时保持声音长尾。' },
      { role: 'assistant', text: 'Use the confirmed scope.' },
      { role: 'user', text: 'OK' },
      { role: 'user', text: 'Generate handoff draft' },
      { role: 'user', text: 'Write a handoff file.' },
    ])
  ).toBe('zh-CN')
})

it('uses meaningful English user prose rather than Chinese UI actions or embedded code', () => {
  expect(
    handoffLanguage([
      {
        role: 'user',
        text: 'Keep the sound after release. Use `音色.js`.\n```js\n// 中文注释\n```',
      },
      { role: 'user', text: '生成交接草稿' },
      { role: 'user', text: '开始工作' },
    ])
  ).toBe('en')
})

it.each([
  'Keep the sound after release in "/Scores/符文创作".',
  'Make the 符文 score keep sounding after the finger lifts.',
])(
  'does not treat a Chinese path or work name as the language of English prose: %s',
  text => {
    expect(handoffLanguage([{ role: 'user', text }])).toBe('en')
  }
)

it('respects topic boundaries and keeps the old copy language when a restored topic has no substantive input', async () => {
  const previous = i18n.language
  try {
    await i18n.changeLanguage('zh-CN')
    expect(
      handoffLanguage(
        [
          { role: 'user', text: '修改上一个作品的声音。' },
          {
            role: 'assistant',
            text: 'New topic',
            contextMarker: { type: 'topic' },
          },
          { role: 'user', text: '生成交接草稿' },
        ],
        'Work in the PNDS project at "/Scores/中文工程".\n\nRead AGENTS.md.'
      )
    ).toBe('en')
    await i18n.changeLanguage('en')
    expect(handoffLanguage([], '在 PNDS 工程 "/score" 中完成交接工作。')).toBe(
      'zh-CN'
    )
  } finally {
    await i18n.changeLanguage(previous)
  }
})
