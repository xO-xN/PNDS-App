import { afterEach, expect, it, vi } from 'vitest'
import userEvent from '@testing-library/user-event'
import { cleanup, fireEvent, render, screen, waitFor } from '@/test/test-utils'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from './dropdown-menu'
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuGroup,
  ContextMenuItem,
  ContextMenuLabel,
  ContextMenuTrigger,
} from './context-menu'

afterEach(cleanup)

const menus = [
  {
    kind: 'dropdown',
    Root: DropdownMenu,
    Trigger: DropdownMenuTrigger,
    Content: DropdownMenuContent,
    Group: DropdownMenuGroup,
    Label: DropdownMenuLabel,
    Item: DropdownMenuItem,
  },
  {
    kind: 'context',
    Root: ContextMenu,
    Trigger: ContextMenuTrigger,
    Content: ContextMenuContent,
    Group: ContextMenuGroup,
    Label: ContextMenuLabel,
    Item: ContextMenuItem,
  },
] as const

function Actions({
  menu: { Root, Trigger, Content, Group, Label, Item },
  onSelect,
}: {
  menu: (typeof menus)[number]
  onSelect: (action: string) => void
}) {
  return (
    <>
      <span id="external-description">Saved files only.</span>
      <Root>
        <Trigger asChild>
          <button>Actions</button>
        </Trigger>
        <Content className="pnds-action-menu">
          <Group aria-labelledby="file-actions">
            <Label id="file-actions">File actions</Label>
            <Item
              icon={
                <svg>
                  <title>Document icon</title>
                </svg>
              }
              description="Read the saved file."
              aria-describedby="external-description"
              shortcut="⌘O"
              aria-keyshortcuts="Meta+O"
              onSelect={() => onSelect('open')}
            >
              Open
            </Item>
            <Item
              disabled
              variant="destructive"
              description="Stop the project first."
              onSelect={() => onSelect('remove')}
            >
              Remove
            </Item>
            <Item
              icon={
                <svg>
                  <title>Folder icon</title>
                </svg>
              }
              description="Show the file in Finder."
              onSelect={() => onSelect('reveal')}
            >
              Reveal
            </Item>
          </Group>
        </Content>
      </Root>
    </>
  )
}

it.each(menus)(
  '$kind items expose their title and explanation separately, including disabled reasons',
  async menu => {
    const user = userEvent.setup()
    const onSelect = vi.fn()
    render(<Actions menu={menu} onSelect={onSelect} />)
    const trigger = screen.getByRole('button', { name: 'Actions' })
    if (menu.kind === 'dropdown') await user.click(trigger)
    else fireEvent.contextMenu(trigger)

    expect(
      await screen.findByRole('group', { name: 'File actions' })
    ).toBeVisible()
    const open = screen.getByRole('menuitem', { name: 'Open' })
    expect(open).toHaveAccessibleDescription(
      'Saved files only. Read the saved file.'
    )
    expect(open).toHaveAttribute('aria-keyshortcuts', 'Meta+O')
    expect(screen.getByText('⌘O')).toHaveAttribute('aria-hidden', 'true')
    const remove = screen.getByRole('menuitem', { name: 'Remove' })
    expect(remove).toHaveAttribute('aria-disabled', 'true')
    expect(remove).toHaveAccessibleDescription('Stop the project first.')
    fireEvent.click(remove)
    expect(onSelect).not.toHaveBeenCalled()
    await user.keyboard('{Home}{ArrowDown}')
    expect(screen.getByRole('menuitem', { name: 'Reveal' })).toHaveFocus()
    await user.keyboard('{Escape}')
    expect(screen.queryByRole('menu')).not.toBeInTheDocument()
  }
)

it.each(menus)(
  '$kind typeahead uses the title without the icon text, description or shortcut',
  async menu => {
    const user = userEvent.setup()
    const onSelect = vi.fn()
    render(<Actions menu={menu} onSelect={onSelect} />)
    const trigger = screen.getByRole('button', { name: 'Actions' })
    if (menu.kind === 'dropdown') await user.click(trigger)
    else fireEvent.contextMenu(trigger)
    await screen.findByRole('menu')
    await user.keyboard('{Home}r')
    await waitFor(() =>
      expect(screen.getByRole('menuitem', { name: 'Reveal' })).toHaveFocus()
    )
    await user.keyboard('{Enter}')
    expect(onSelect).toHaveBeenCalledExactlyOnceWith('reveal')
    expect(screen.queryByRole('menu')).not.toBeInTheDocument()
  }
)
