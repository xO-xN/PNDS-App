import userEvent from '@testing-library/user-event'
import { fireEvent, screen } from '@/test/test-utils'
import i18n from '@/i18n/config'

/** Follow the same menus and file search an operator uses after the r6 relocation. */
export async function creationProjectAction(name: string) {
  const direct = screen.queryByRole('button', { name })
  if (direct) {
    await userEvent.click(direct)
    return
  }
  await userEvent.click(
    screen.getByRole('button', { name: i18n.t('desktop.projectMenu') })
  )
  await userEvent.click(await screen.findByRole('menuitem', { name }))
}
export function creationFileButton(path: string) {
  const visible = screen.queryByRole('button', { name: path })
  if (visible) return visible
  fireEvent.change(
    screen.getByRole('textbox', { name: i18n.t('creation.searchFiles') }),
    { target: { value: path } }
  )
  return screen.getByRole('button', { name: path })
}
export async function openNetworkControls() {
  await userEvent.click(
    screen.getByRole('button', { name: i18n.t('sidebar.localNetwork') })
  )
}
export async function creationFileAction(name: string) {
  const direct = screen.queryByRole('button', { name })
  if (direct) {
    await userEvent.click(direct)
    return
  }
  await userEvent.click(
    screen.getByRole('button', { name: i18n.t('desktop.fileActions') })
  )
  await userEvent.click(await screen.findByRole('menuitem', { name }))
}
export function ensureNetworkControls() {
  if (!screen.queryByTestId('settings-card'))
    fireEvent.click(
      screen.getByRole('button', { name: i18n.t('sidebar.localNetwork') })
    )
}
