/* global document, window, __NATIVE_FIXTURE_GUEST_URL__, __NATIVE_FIXTURE_LOAD_ONLY__ */
import { createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { SessionActionButton } from '@/components/shell/SessionActionButton'
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

window.addEventListener(
  'keydown',
  event => {
    if (event.key === 'Enter' && event.metaKey && event.altKey)
      void invoke('record_fixture_key', { label })
  },
  true
)
window.addEventListener('message', event => {
  if (event.source === guest.contentWindow && event.data === 'fixture-keydown')
    void invoke('record_fixture_key', { label })
})

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
    const actionHost = document.createElement('div')
    document.body.append(actionHost)
    createRoot(actionHost).render(createElement(SessionActionButton))
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

    if (!__NATIVE_FIXTURE_LOAD_ONLY__) {
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
    }
    async function runLoad(test) {
      await seed('/first')
      useSessionStore.setState({ lanIp: '127.0.0.1', audioMode: 'none' })
      if (test.live) {
        useSessionStore.setState({
          sessionStatus: 'ready',
          sessionProjectPath: '/first',
        })
        if (test.live === 'replace')
          useProjectStore.setState({
            currentProject: { path: '/second', manifest },
          })
        if (test.live === 'change')
          useSessionStore.setState({ pendingChanges: true })
      }
      if (test.gate === 'preflight')
        useProjectStore.setState({
          preflightStatus: 'checking',
          pendingPreflightPath: '/second',
        })
      if (test.gate === 'command')
        useSessionStore.setState({ commandPending: true })
      if (test.gate === 'lan') useSessionStore.setState({ lanIp: null })
      if (test.gate === 'creation') await useCreationStore.getState().enter()
      if (test.realReturn) {
        await useCreationStore.getState().enter()
        await useCreationStore.getState().leave()
        useProjectStore.setState({
          currentProject: { path: '/first', manifest },
          preflightStatus: 'ready',
        })
        useSessionStore.setState({ lanIp: '127.0.0.1' })
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
      await buildAppMenu()
      // Force stale enabled state for business/mode/window cases, as in real
      // focus rebuild races; the production callback must still gate them.
      await invoke('set_fixture_menu_enabled', {
        enabled: !test.disabled,
        matching: !test.noMatch,
        parentDisabled: false,
      })
      const before = await invoke('fixture_counts')
      if (test.sequence) {
        await invoke('probe_native_route', {
          label: target,
          direct: false,
          keyCode: 125,
          flags: 0x180000,
        })
        await wait(250)
      }
      await invoke('probe_native_route', {
        label: target,
        direct: Boolean(test.direct),
        keyCode: 36,
        flags: test.flags ?? 0x180000,
      })
      await wait(250)
      let dialog = document.querySelector('[data-slot="alert-dialog-content"]')
      if (test.live === 'replace') {
        const awaiting = await invoke('fixture_counts')
        if (
          !dialog ||
          awaiting.starts.length !== before.starts.length ||
          awaiting.stop !== before.stop ||
          useSessionStore.getState().sessionProjectPath !== '/first'
        )
          throw new Error(
            'Replacement did not preserve the show behind its actual UI confirmation'
          )
        const confirm = [...dialog.querySelectorAll('button')].find(
          button => button.textContent === 'Start'
        )
        if (!confirm)
          throw new Error('Existing replacement confirmation action missing')
        confirm.click()
        await wait(250)
        dialog = document.querySelector('[data-slot="alert-dialog-content"]')
      }
      const after = await invoke('fixture_counts')
      const starts = after.starts.slice(before.starts.length)
      const actions = after.menu - before.menu
      const originalRoutes = after.original - before.original
      const stops = after.stop - before.stop
      const keys = (after.keys[target] ?? 0) - (before.keys[target] ?? 0)
      const expectedStarts =
        test.starts === false
          ? []
          : [test.sequence || test.live === 'replace' ? '/second' : '/first']
      const result = {
        ...test,
        starts,
        expectedStarts,
        actions,
        originalRoutes,
        stops,
        keys,
      }
      results.push(result)
      if (
        JSON.stringify(starts) !== JSON.stringify(expectedStarts) ||
        actions !== (test.actions ?? (test.sequence ? 2 : 1)) ||
        (test.originalRoutes !== undefined &&
          originalRoutes !== test.originalRoutes) ||
        stops !== (test.live === 'replace' || test.live === 'change' ? 1 : 0)
      )
        throw new Error(
          `Native Load routing mismatch: ${JSON.stringify(result)}`
        )
      if (test.keys !== undefined && keys !== test.keys)
        throw new Error(
          `Original Return key did not reach its document: ${JSON.stringify(result)}`
        )
      if (dialog) throw new Error('Load left a replacement dialog open')
      if (test.followExact) {
        // No rebuild/re-enable between the variant and this exact chord: verify
        // that temporary native disablement restores the same installed item.
        await invoke('probe_native_route', {
          label: target,
          direct: false,
          keyCode: 36,
          flags: 0x180000,
        })
        await wait(250)
        const restored = await invoke('fixture_counts')
        const followedExactStarts = restored.starts.slice(after.starts.length)
        result.followedExactStarts = followedExactStarts
        if (
          JSON.stringify(followedExactStarts) !== JSON.stringify(['/first']) ||
          restored.menu - after.menu !== 1 ||
          restored.stop !== after.stop
        )
          throw new Error(
            `Load menu did not restore after modifier delegation: ${JSON.stringify(result)}`
          )
      }
      document.getElementById('state').textContent =
        `${results.length} cases passed`
    }
    await runLoad({ name: 'native-load-menu-control', direct: true })
    for (const surface of ['body', 'input', 'guest'])
      await runLoad({ name: 'native-window-load', focus: surface })
    await runLoad({
      name: 'native-selection-then-load',
      sequence: true,
      focus: 'guest',
    })
    await runLoad({
      name: 'native-load-replacement-confirmation',
      live: 'replace',
      focus: 'guest',
    })
    await runLoad({
      name: 'native-load-running-unchanged',
      live: 'same',
      starts: false,
    })
    await runLoad({ name: 'native-load-running-change', live: 'change' })
    for (const gate of ['preflight', 'command', 'lan', 'overlay'])
      await runLoad({
        name: 'native-load-stale-enabled-business-gate',
        gate,
        starts: false,
      })
    for (const surface of ['body', 'input', 'guest'])
      await runLoad({
        name: 'native-load-real-creation-transition',
        keys: 1,
        gate: 'creation',
        focus: surface,
        starts: false,
      })
    await runLoad({
      name: 'native-load-real-performance-return',
      realReturn: true,
    })
    for (const label of [
      'help',
      'projection',
      'performer-00000000-0000-4000-8000-000000000001',
    ])
      await runLoad({
        name: 'native-load-stale-enabled-secondary',
        keys: 1,
        label,
        starts: false,
      })
    await runLoad({
      name: 'native-load-keeps-existing-cmd-enter',
      flags: 0x100000,
      actions: 0,
    })
    for (const flags of [0x1a0000, 0x1c0000])
      for (const surface of ['body', 'input', 'guest'])
        await runLoad({
          name: 'native-load-other-modifiers',
          flags,
          followExact: flags === 0x1a0000 && surface === 'body',
          focus: surface,
          starts: false,
          actions: 0,
          keys: 1,
        })
    await runLoad({
      name: 'native-load-disabled',
      keys: 1,
      disabled: true,
      starts: false,
      actions: 0,
    })
    await runLoad({
      name: 'native-load-no-matching-menu',
      keys: 1,
      noMatch: true,
      starts: false,
      actions: 0,
    })
    await runLoad({
      name: 'native-load-modified-disabled',
      flags: 0x1a0000,
      disabled: true,
      starts: false,
      actions: 0,
      keys: 1,
    })
    await runLoad({
      name: 'native-load-modified-no-match',
      flags: 0x1a0000,
      noMatch: true,
      starts: false,
      actions: 0,
      keys: 1,
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
