/* global document, window, __NATIVE_FIXTURE_GUEST_URL__ */
import { invoke } from '@tauri-apps/api/core'
import { getCurrentWindow } from '@tauri-apps/api/window'
import { buildAppMenu } from '@/lib/menu'
import { useProjectStore } from '@/store/project-store'
import { useSessionStore } from '@/store/session-store'
import { useCreationStore } from '@/store/creation-store'
import { commands } from '@/lib/tauri-bindings'

const label = getCurrentWindow().label
const wait = ms => new Promise(resolve => setTimeout(resolve, ms))
const results = []
const field = document.getElementById('field')
const guest = document.getElementById('guest')
const guestLoaded = new Promise(resolve =>
  guest.addEventListener('load', resolve, { once: true })
)
guest.src = __NATIVE_FIXTURE_GUEST_URL__

async function focus(surface) {
  if (surface === 'body') document.body.focus()
  else if (surface === 'input') field.focus()
  else {
    await new Promise((resolve, reject) => {
      const timer = setTimeout(
        () => reject(new Error('Guest did not focus')),
        3000
      )
      const listener = event => {
        if (
          event.source !== guest.contentWindow ||
          event.data !== 'fixture-focused'
        )
          return
        clearTimeout(timer)
        window.removeEventListener('message', listener)
        resolve()
      }
      window.addEventListener('message', listener)
      guest.contentWindow.postMessage('fixture-focus', '*')
    })
  }
}
window.fixtureFocus = focus

if (label === 'main') {
  try {
    const manifest = (await commands.preflightProject('/first')).data
    const seed = async path => {
      useCreationStore.setState({
        opening: false,
        modePhase: 'idle',
      })
      useSessionStore.getState().resetSession()
      useSessionStore.setState({ commandPending: false })
      if (useCreationStore.getState().active) {
        await useCreationStore.getState().leave()
        if (useCreationStore.getState().active)
          throw new Error(
            `Real performance return failed: ${JSON.stringify(useCreationStore.getState().modeError)}`
          )
      }
      useProjectStore.setState({
        currentProject: { path, manifest },
        recentProjectPaths: ['/first', '/second'],
        projectFolders: [],
        activeFolderId: null,
        preflightStatus: 'ready',
        pendingPreflightPath: null,
        failedPreflightPath: null,
      })
      document.querySelector('[data-fixture-overlay]')?.remove()
    }
    await seed('/first')
    await buildAppMenu()
    await guestLoaded

    async function run(test) {
      const down = test.keyCode !== 126
      const initial = down ? '/first' : '/second'
      await seed(test.initial ?? initial)
      if (test.gate === 'command')
        useSessionStore.setState({ commandPending: true })
      if (test.gate === 'starting' || test.gate === 'stopping')
        useSessionStore.setState({ sessionStatus: test.gate })
      if (test.gate === 'creation') {
        await useCreationStore.getState().enter()
        if (!useCreationStore.getState().active)
          throw new Error(
            `Real creation transition failed: ${JSON.stringify(useCreationStore.getState().modeError)}`
          )
      }
      if (test.realReturn) {
        await useCreationStore.getState().enter()
        await useCreationStore.getState().leave()
        if (
          useCreationStore.getState().active ||
          useCreationStore.getState().modePhase !== 'idle'
        )
          throw new Error('Real performance return did not complete')
        useProjectStore.setState({
          currentProject: { path: initial, manifest },
          preflightStatus: 'ready',
        })
      }
      if (test.staleOwner !== undefined) {
        const stale = await commands.setMainPerformanceKeyOwner(
          useCreationStore.getState().epoch - 1,
          test.staleOwner
        )
        if (stale.status !== 'error' || !stale.error.includes('Stale'))
          throw new Error(
            `Stale ownership request was accepted: ${JSON.stringify(stale)}`
          )
      }
      if (test.gate === 'overlay') {
        const overlay = document.createElement('div')
        overlay.dataset.fixtureOverlay = ''
        overlay.setAttribute('role', 'alertdialog')
        document.body.append(overlay)
      }
      const target = test.label ?? 'main'
      await invoke('prepare_fixture_window', { label: target })
      await wait(250)
      if (target === 'main') await focus(test.focus ?? 'body')
      await wait(80)
      await invoke('set_fixture_menu_enabled', {
        enabled: !test.disabled,
        matching: !test.noMatch,
        parentDisabled: Boolean(test.parentDisabled),
      })
      const selectedBefore =
        useProjectStore.getState().currentProject?.path ?? null
      const before = await invoke('fixture_counts')
      const guestPage = guest
      const guestUrl = guest.src
      for (let attempt = 0; ; attempt++) {
        try {
          await invoke('probe_native_route', {
            label: target,
            direct: Boolean(test.direct),
            keyCode: test.keyCode ?? 125,
            flags: test.flags ?? 0x180000,
          })
          break
        } catch (error) {
          if (error !== 'Invalid active/key/event window' || attempt === 2)
            throw error
          await invoke('prepare_fixture_window', { label: target })
          await wait(250)
          if (target === 'main') await focus(test.focus ?? 'body')
          await wait(80)
        }
      }
      await wait(250)
      const after = await invoke('fixture_counts')
      const selected = useProjectStore.getState().currentProject?.path ?? null
      const expected =
        test.moves === false ? selectedBefore : down ? '/second' : '/first'
      const actions = after.menu - before.menu
      const preflights = after.preflight - before.preflight
      const originalRoutes = after.original - before.original
      const result = {
        ...test,
        selected,
        expected,
        actions,
        preflights,
        originalRoutes,
      }
      results.push(result)
      if (
        selected !== expected ||
        actions !== (test.actions ?? 1) ||
        preflights !== (test.moves === false ? 0 : 1)
      )
        throw new Error(`Native routing mismatch: ${JSON.stringify(result)}`)
      if (originalRoutes !== (test.originalRoutes ?? 0))
        throw new Error(
          `Original WK routing mismatch: ${JSON.stringify(result)}`
        )
      if (
        document.getElementById('guest') !== guestPage ||
        guest.src !== guestUrl
      )
        throw new Error('Selection replaced or navigated the guest fixture')
      document.getElementById('state').textContent =
        `${results.length} cases passed`
    }

    await run({ name: 'native-menu-control', direct: true, focus: 'body' })
    for (const keyCode of [125, 126]) {
      for (const surface of ['body', 'input', 'guest']) {
        for (const flags of [0x180000, 0xb80000])
          await run({
            name: 'native-window-selection',
            keyCode,
            focus: surface,
            flags,
          })
      }
    }
    for (const keyCode of [125, 126]) {
      await run({
        name: 'no-matching-menu',
        keyCode,
        noMatch: true,
        moves: false,
        actions: 0,
        originalRoutes: 1,
      })
      await run({
        name: 'disabled-menu',
        keyCode,
        disabled: true,
        moves: false,
        actions: 0,
        originalRoutes: 1,
      })
    }
    for (const keyCode of [125, 126])
      await run({
        name: 'disabled-submenu-parent',
        keyCode,
        parentDisabled: true,
        moves: false,
        actions: 0,
        originalRoutes: 1,
      })
    for (const flags of [0x100000, 0x1a0000, 0x1c0000])
      await run({
        name: 'other-modifiers',
        flags,
        moves: false,
        actions: 0,
        originalRoutes: 1,
      })
    for (const keyCode of [123, 124])
      await run({
        name: 'no-left-right-selection',
        keyCode,
        moves: false,
        actions: 0,
        originalRoutes: 1,
      })
    for (const gate of ['command', 'starting', 'stopping', 'overlay'])
      await run({ name: 'stale-enabled-business-gate', gate, moves: false })
    for (const keyCode of [125, 126]) {
      for (const surface of ['body', 'input', 'guest'])
        await run({
          name: 'stale-enabled-real-creation-transition',
          gate: 'creation',
          staleOwner: true,
          keyCode,
          focus: surface,
          moves: false,
          actions: 0,
          originalRoutes: 1,
        })
    }
    for (const keyCode of [125, 126])
      await run({
        name: 'native-performance-return-after-late-revocation',
        keyCode,
        realReturn: true,
        staleOwner: false,
      })
    for (const secondary of [
      'help',
      'projection',
      'performer-00000000-0000-4000-8000-000000000001',
    ]) {
      for (const keyCode of [125, 126])
        await run({
          name: 'stale-enabled-secondary-window',
          label: secondary,
          keyCode,
          moves: false,
          actions: 0,
          originalRoutes: 1,
        })
    }
    await invoke('prepare_fixture_window', { label: 'main' })
    await wait(250)
    await run({
      name: 'lower-boundary',
      keyCode: 125,
      initial: '/second',
      moves: false,
    })
    await run({
      name: 'upper-boundary',
      keyCode: 126,
      initial: '/first',
      moves: false,
    })
    await invoke('finish_probe', {
      success: true,
      evidence: { passed: true, results },
    })
  } catch (error) {
    await invoke('finish_probe', {
      success: false,
      evidence: { passed: false, failure: String(error), results },
    })
  }
}
