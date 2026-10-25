import userEvent from '@testing-library/user-event'
import { fireEvent, screen } from '@/test/test-utils'
import i18n from '@/i18n/config'

/** Follow the same menus and file search an operator uses after the r6 relocation. */
export async function creationProjectAction(name: string) {
  const direct =
    screen.queryByRole('button', { name }) ??
    screen.queryByRole('menuitem', { name })
  if (direct) {
    await userEvent.click(direct)
    return
  }
  if (
    name === i18n.t('creation.modules.open') ||
    name === i18n.t('creation.libraries.open')
  ) {
    await userEvent.click(
      screen.getByRole('button', { name: i18n.t('creation.resources.open') })
    )
    if (name === i18n.t('creation.libraries.open'))
      await userEvent.click(
        await screen.findByRole('tab', {
          name: i18n.t('creation.resources.libraries'),
        })
      )
    return
  }
  if (name === i18n.t('creation.newProject.open')) {
    await userEvent.click(
      screen.getByRole('button', { name: i18n.t('creation.switchProject') })
    )
    await userEvent.click(await screen.findByRole('menuitem', { name }))
    return
  }
  await userEvent.click(
    screen.getByRole('button', { name: i18n.t('creation.git.location') })
  )
  await userEvent.click(await screen.findByRole('menuitem', { name }))
}
export function creationFileButton(path: string) {
  const visible = screen.queryByRole('treeitem', { name: path })
  if (visible) return visible
  fireEvent.change(
    screen.getByRole('textbox', { name: i18n.t('creation.searchFiles') }),
    { target: { value: path } }
  )
  return screen.getByRole('treeitem', { name: path })
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
