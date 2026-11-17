import { beforeEach, expect, it, vi } from 'vitest'
import userEvent from '@testing-library/user-event'
import { writeText } from '@tauri-apps/plugin-clipboard-manager'
import { toast } from 'sonner'
import { fireEvent, render, screen, waitFor } from '@/test/test-utils'
import i18n from '@/i18n/config'
import { AssistantCodeBlock } from './AssistantCodeBlock'

vi.mock('sonner', () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}))

beforeEach(async () => {
  vi.clearAllMocks()
  await i18n.changeLanguage('en')
})

it('renders and copies the complete parsed code value without trimming or interpreting it', async () => {
  const code = '\n\tconst label = "池谱 👩‍💻";  \n<script>alert(1)</script>\n\n'
  const { container } = render(
    <AssistantCodeBlock code={code} language="javascript" />
  )
  const region = screen.getByLabelText('Code block')
  expect(region.querySelector('code')?.textContent).toBe(code)
  expect(region).toHaveAttribute('dir', 'ltr')
  expect(screen.getByText('javascript')).toBeVisible()
  expect(container.querySelector('script')).not.toBeInTheDocument()
  fireEvent.click(screen.getByRole('button', { name: 'Copy code' }))
  expect(writeText).toHaveBeenCalledWith(code)
  await waitFor(() => expect(toast.success).toHaveBeenCalledWith('Code copied'))
})

it('keeps copy actions local to each code block, including an empty block', async () => {
  render(
    <>
      <AssistantCodeBlock code={'first\n'} language="js" />
      <AssistantCodeBlock code={'second\n\n'} language="scd" />
      <AssistantCodeBlock code="" />
    </>
  )
  const buttons = screen.getAllByRole('button', { name: 'Copy code' })
  for (const button of buttons) fireEvent.click(button)
  expect(writeText).toHaveBeenNthCalledWith(1, 'first\n')
  expect(writeText).toHaveBeenNthCalledWith(2, 'second\n\n')
  expect(writeText).toHaveBeenNthCalledWith(3, '')
  expect(screen.getByText('Code')).toBeVisible()
  await waitFor(() => expect(toast.success).toHaveBeenCalledTimes(3))
})

it('copies the clicked streaming snapshot while later text continues to grow', async () => {
  let finishCopy: (() => void) | undefined
  vi.mocked(writeText).mockImplementationOnce(
    () =>
      new Promise<void>(resolve => {
        finishCopy = resolve
      })
  )
  const { rerender } = render(
    <AssistantCodeBlock code="const size =" language="js" streaming />
  )
  const button = screen.getByRole('button', { name: 'Copy code' })
  expect(screen.getByText('Reply in progress')).toBeVisible()
  fireEvent.click(button)
  rerender(
    <AssistantCodeBlock code={'const size = 12;\n'} language="js" streaming />
  )
  expect(screen.getByLabelText('Code block').textContent).toBe(
    'const size = 12;\n'
  )
  expect(writeText).toHaveBeenNthCalledWith(1, 'const size =')
  expect(screen.getByRole('button', { name: 'Copy code' })).toBe(button)
  fireEvent.click(button)
  expect(writeText).toHaveBeenNthCalledWith(2, 'const size = 12;\n')
  finishCopy?.()
  await waitFor(() => expect(toast.success).toHaveBeenCalledTimes(2))
  rerender(<AssistantCodeBlock code={'const size = 12;\n'} language="js" />)
  expect(screen.queryByText('Reply in progress')).not.toBeInTheDocument()
  expect(screen.getByLabelText('Code block').textContent).toBe(
    'const size = 12;\n'
  )
})

it('reports clipboard rejection without claiming the code was copied', async () => {
  vi.mocked(writeText).mockRejectedValueOnce(new Error('Clipboard unavailable'))
  render(<AssistantCodeBlock code="unchanged" />)
  fireEvent.click(screen.getByRole('button', { name: 'Copy code' }))
  await waitFor(() =>
    expect(toast.error).toHaveBeenCalledWith('Something went wrong')
  )
  expect(toast.success).not.toHaveBeenCalled()
  expect(screen.getByLabelText('Code block').textContent).toBe('unchanged')
})

it('lets keyboard users copy and focus the code scroll region', async () => {
  const user = userEvent.setup()
  const { container } = render(<AssistantCodeBlock code={'keyboard copy\n'} />)
  await user.tab()
  expect(screen.getByRole('button', { name: 'Copy code' })).toHaveFocus()
  await user.keyboard('{Enter}')
  expect(writeText).toHaveBeenCalledWith('keyboard copy\n')
  await user.tab()
  expect(screen.getByLabelText('Code block')).toHaveFocus()
  expect(container.querySelector('svg')).toHaveAttribute('aria-hidden', 'true')
})

it('localizes code controls and treats the language label as plain text', async () => {
  await i18n.changeLanguage('zh-CN')
  const { container, rerender } = render(
    <AssistantCodeBlock code={'内容\n'} streaming />
  )
  expect(screen.getByText('代码')).toBeVisible()
  expect(screen.getByText('回复生成中')).toBeVisible()
  expect(screen.getByLabelText('代码内容')).toBeVisible()
  expect(screen.getByRole('button', { name: '复制代码' })).toBeVisible()
  rerender(<AssistantCodeBlock code={'内容\n'} language="<img src=x>" />)
  expect(screen.getByText('<img src=x>')).toBeVisible()
  expect(container.querySelector('img')).not.toBeInTheDocument()
  await i18n.changeLanguage('en')
})
