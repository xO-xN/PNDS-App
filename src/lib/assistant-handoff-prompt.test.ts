import { expect, it } from 'vitest'
import {
  HANDOFF_INSTRUCTIONS,
  handoffLanguage,
  handoffPrompt,
} from './assistant-handoff-prompt'
import i18n from '@/i18n/config'

it('embeds the four English instructions without skill metadata or an installation step', () => {
  const lines = HANDOFF_INSTRUCTIONS.split('\n')
  expect(lines).toHaveLength(4)
  expect(lines[0]).toContain(
    'existing project terminology and design documents'
  )
  expect(lines[1]).toContain('Complete every current task')
  expect(lines[3]).toContain('docs/handoff-history/')
  expect(HANDOFF_INSTRUCTIONS).not.toContain('name: pnds-handoff')
  expect(HANDOFF_INSTRUCTIONS).not.toMatch(/install|npx skills|only.*task/i)
})

it.each(['en', 'zh-CN'])(
  'uses the requested language for the complete prompt independently of the UI in %s',
  async language => {
    const previous = i18n.language
    try {
      await i18n.changeLanguage(language === 'en' ? 'zh-CN' : 'en')
      const root = '/Scores/My "new" project'
      const prompt = handoffPrompt(root, language)
      expect(prompt).toContain(JSON.stringify(root))
      const [location, instructions] = prompt.split('\n\n')
      expect(instructions?.split('\n')).toHaveLength(4)
      if (language === 'en') {
        expect(location).toMatch(/^Work in the PNDS project/)
        expect(instructions).toBe(HANDOFF_INSTRUCTIONS)
      } else {
        expect(location).toMatch(/^在 PNDS 工程/)
        expect(instructions).toContain('完成交接单中的全部当前任务')
        expect(instructions).not.toMatch(
          /Read |Complete every|Run applicable|Save completed/
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
