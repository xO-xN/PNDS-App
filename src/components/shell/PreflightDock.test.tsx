import { afterEach, expect, it } from 'vitest'
import { act, cleanup, render, screen } from '@/test/test-utils'
import i18n from '@/i18n/config'
import { useProjectStore } from '@/store/project-store'
import { PreflightDock } from './PreflightDock'

afterEach(async () => {
  cleanup()
  await i18n.changeLanguage('en')
  useProjectStore.setState({ preflightStatus: 'idle', preflightError: null })
})

it('localizes native runtime port compatibility failures in the current language', async () => {
  useProjectStore.setState({
    preflightStatus: 'error',
    preflightError: 'participation.errors.runtimePortsVersion',
  })
  render(<PreflightDock />)
  expect(screen.getByRole('alert')).toHaveTextContent(
    'unsupported runtime port protocol'
  )
  await act(async () => {
    await i18n.changeLanguage('zh-CN')
  })
  expect(screen.getByRole('alert')).toHaveTextContent('不支持的运行端口协议')
})
