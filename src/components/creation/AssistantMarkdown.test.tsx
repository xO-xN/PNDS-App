import { beforeEach, expect, it, vi } from 'vitest'
import userEvent from '@testing-library/user-event'
import { writeText } from '@tauri-apps/plugin-clipboard-manager'
import { fireEvent, render, screen, within } from '@/test/test-utils'
import { AssistantMarkdown } from './AssistantMarkdown'

beforeEach(() => {
  vi.clearAllMocks()
})

it('retains all heading levels, including Setext, as document structure', () => {
  render(
    <AssistantMarkdown
      text={[
        '# 一级标题',
        '## 二级标题',
        '### 三级标题',
        '#### 四级标题',
        '##### 五级标题',
        '###### 六级标题',
        '',
        'Setext title',
        '============',
        '',
        'Setext section',
        '--------------',
        '',
        '正文保持独立段落。',
      ].join('\n')}
    />
  )
  for (const [index, name] of [
    '一级标题',
    '二级标题',
    '三级标题',
    '四级标题',
    '五级标题',
    '六级标题',
  ].entries()) {
    expect(
      screen.getByRole('heading', { level: index + 1, name })
    ).toBeVisible()
  }
  expect(
    screen.getByRole('heading', { level: 1, name: 'Setext title' })
  ).toBeVisible()
  expect(
    screen.getByRole('heading', { level: 2, name: 'Setext section' })
  ).toBeVisible()
  expect(screen.getByText('正文保持独立段落。').tagName).toBe('P')
})

it('renders emphasis, quotes, nested lists, aligned tables and read-only task items', async () => {
  const { container } = render(
    <AssistantMarkdown
      text={[
        '**重点**、*说明*和~~旧值~~。',
        '',
        '> 引用说明',
        '>',
        '> - 引用条目',
        '',
        '1. 外层步骤',
        '   - 内层说明',
        '',
        '- [x] 已完成',
        '- [ ] 待处理',
        '',
        '| 名称 | 数值 |',
        '| :--- | ---: |',
        '| 大小 | 32 |',
        '',
        '---',
      ].join('\n')}
    />
  )
  expect(screen.getByText('重点').tagName).toBe('STRONG')
  expect(screen.getByText('说明').tagName).toBe('EM')
  expect(screen.getByText('旧值').tagName).toBe('DEL')
  expect(screen.getByText('引用说明').closest('blockquote')).not.toBeNull()
  expect(screen.getByText('引用条目').closest('blockquote ul')).not.toBeNull()
  expect(screen.getByText('内层说明').closest('ol li ul')).not.toBeNull()
  const table = screen.getByRole('table')
  expect(within(table).getByRole('columnheader', { name: '名称' })).toHaveStyle(
    {
      textAlign: 'left',
    }
  )
  expect(within(table).getByRole('columnheader', { name: '数值' })).toHaveStyle(
    {
      textAlign: 'right',
    }
  )
  expect(within(table).getByRole('cell', { name: '32' })).toHaveStyle({
    textAlign: 'right',
  })
  const [checked, unchecked] = screen.getAllByRole('checkbox')
  if (!checked || !unchecked) throw new Error('Expected two task checkboxes')
  expect(checked).toBeDisabled()
  expect(checked).toBeChecked()
  expect(unchecked).toBeDisabled()
  expect(unchecked).not.toBeChecked()
  await userEvent.click(unchecked)
  expect(unchecked).not.toBeChecked()
  expect(container.querySelector('hr')).not.toBeNull()
})

it('keeps inline code separate and treats Markdown fences as literal copyable source', () => {
  const { container } = render(
    <AssistantMarkdown
      text={
        'Use `size` here.\n\n```markdown\n# README source\n\n**literal**\n```'
      }
    />
  )
  const inline = screen.getByText('size')
  expect(inline.tagName).toBe('CODE')
  expect(inline.closest('pre')).toBeNull()
  const block = container.querySelector('pre')
  expect(block).toHaveAttribute('tabindex', '0')
  expect(block).toHaveAttribute('dir', 'ltr')
  expect(block?.querySelector('code')?.textContent).toBe(
    '# README source\n\n**literal**'
  )
  expect(screen.queryByRole('heading')).not.toBeInTheDocument()
  expect(screen.queryByText('literal')).not.toBeInTheDocument()
  expect(screen.getByText('markdown')).toBeVisible()
  expect(screen.getByRole('button', { name: 'Copy code' })).toBeVisible()
})

it('keeps model links, images and raw HTML inert while retaining readable labels', () => {
  const { container } = render(
    <AssistantMarkdown
      text={[
        '[文档](https://example.com/guide) and [unsafe](javascript:alert(1)).',
        '',
        '![图片说明](https://example.com/tracker.png)',
        '',
        '<script>window.markdownRan = true</script>',
        '',
        '<iframe src="https://example.com/frame"></iframe>',
        '',
        '<img src="https://example.com/raw.png" onerror="alert(1)" />',
      ].join('\n')}
    />
  )
  expect(screen.getByText('文档')).toBeVisible()
  expect(screen.getByText('unsafe')).toBeVisible()
  expect(screen.getByText('图片说明')).toBeVisible()
  expect(container.querySelector('a, img, script, iframe')).toBeNull()
})

it('shows actual Markdown prefixes and settles the same content without duplicate blocks', () => {
  const { container, rerender } = render(
    <AssistantMarkdown text="#" streaming />
  )
  expect(screen.getByRole('heading', { level: 1 })).toBeInTheDocument()
  const prefixes = [
    '## 建议',
    '## 建议\n\n你好',
    '## 建议\n\n你好 👩‍💻，**重',
    '## 建议\n\n你好 👩‍💻，**重点**。',
    '## 建议\n\n你好 👩‍💻，**重点**。\n\n```ts\nconst value =',
    '## 建议\n\n你好 👩‍💻，**重点**。\n\n```ts\nconst value = 1\n',
    '## 建议\n\n你好 👩‍💻，**重点**。\n\n```ts\nconst value = 1\n```',
  ]
  for (const text of prefixes) {
    rerender(<AssistantMarkdown text={text} streaming />)
    expect(screen.getByRole('heading', { name: '建议' })).toBeVisible()
    if (text.includes('你好')) expect(container).toHaveTextContent('你好')
    if (text.includes('👩‍💻')) expect(container).toHaveTextContent('👩‍💻')
    if (text.includes('const value')) {
      expect(container.querySelector('pre code')).toHaveTextContent(
        'const value'
      )
    }
  }
  const settled = prefixes.at(-1)
  if (!settled) throw new Error('Expected final Markdown prefix')
  rerender(<AssistantMarkdown text={settled} />)
  expect(screen.getAllByRole('heading', { name: '建议' })).toHaveLength(1)
  expect(container.querySelectorAll('pre')).toHaveLength(1)
  expect(container.querySelector('pre code')?.textContent).toBe(
    'const value = 1'
  )
})

it.each([
  {
    name: 'a CRLF fence with a content-ending blank line',
    text: '```scd\r\n  Synth(\\tone);\r\n\r\n```\r\n',
    expected: '  Synth(\\tone);\n',
  },
  {
    name: 'indented code with internal blank lines',
    text: '    const value = 1\n    \n    console.log(value)\n',
    expected: 'const value = 1\n\nconsole.log(value)',
  },
  {
    name: 'a tilde fence with unknown language and preserved trailing spaces',
    text: '~~~unknown\n  λ = "你好";  \n~~~',
    expected: '  λ = "你好";  ',
  },
])('copies parsed code content from $name', async ({ text, expected }) => {
  render(<AssistantMarkdown text={text} />)
  await userEvent.click(screen.getByRole('button', { name: 'Copy code' }))
  expect(writeText).toHaveBeenCalledExactlyOnceWith(expected)
})

it('copies each code block independently, including the currently streamed snapshot', async () => {
  const { rerender } = render(
    <AssistantMarkdown
      text={'```ts\nfirst()\n```\n\n```ts\n  second('}
      streaming
    />
  )
  const [firstCopy, secondCopy] = screen.getAllByRole('button', {
    name: 'Copy code',
  })
  if (!firstCopy || !secondCopy)
    throw new Error('Expected two code copy actions')
  fireEvent.click(firstCopy)
  expect(writeText).toHaveBeenLastCalledWith('first()')
  fireEvent.click(secondCopy)
  expect(writeText).toHaveBeenLastCalledWith('  second(')
  rerender(
    <AssistantMarkdown text={'```ts\nfirst()\n```\n\n```ts\n  second()\n```'} />
  )
  const settledCopy = screen.getAllByRole('button', { name: 'Copy code' }).at(1)
  if (!settledCopy) throw new Error('Expected second code copy action')
  fireEvent.click(settledCopy)
  expect(writeText).toHaveBeenLastCalledWith('  second()')
  expect(writeText).toHaveBeenCalledTimes(3)
})
