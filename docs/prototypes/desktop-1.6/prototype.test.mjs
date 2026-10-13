import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { setTimeout as delay } from 'node:timers/promises'
import { URL } from 'node:url'
import test from 'node:test'
import { JSDOM, VirtualConsole } from 'jsdom'

const html = await readFile(new URL('./index.html', import.meta.url), 'utf8')
const scripts = await Promise.all(
  ['settings.js', 'prototype.js'].map(name =>
    readFile(new URL(name, import.meta.url), 'utf8')
  )
)

function harness(t, { reducedMotion = true } = {}) {
  const errors = []
  const opened = []
  const virtualConsole = new VirtualConsole()
  virtualConsole.on('jsdomError', error => errors.push(error.message))
  const dom = new JSDOM(html, {
    url: 'https://prototype.test/index.html',
    runScripts: 'outside-only',
    pretendToBeVisual: true,
    virtualConsole,
  })
  const { window } = dom
  const { document } = window
  window.matchMedia = () => ({
    matches: reducedMotion,
    addEventListener() {
      // Motion preference changes are outside this workflow harness.
    },
  })
  window.HTMLDialogElement.prototype.showModal = function () {
    this.open = true
  }
  window.HTMLDialogElement.prototype.close = function () {
    if (!this.open) return
    this.open = false
    this.dispatchEvent(new window.Event('close'))
  }
  window.open = (url, name) => {
    const child = {
      url,
      name,
      closed: false,
      messages: [],
      focus() {
        // Native window focus is verified in browser review.
      },
      close() {
        this.closed = true
      },
      postMessage(message) {
        this.messages.push(message)
      },
    }
    opened.push(child)
    return child
  }
  Object.defineProperty(window.navigator, 'clipboard', {
    value: {
      async writeText() {
        // Keep the real clipboard unchanged during prototype checks.
      },
    },
  })
  scripts.forEach(source => window.eval(source))
  const q = selector => {
    const element = document.querySelector(selector)
    assert.ok(element, `Missing control: ${selector}`)
    return element
  }
  const click = (action, extra = '') => {
    const element = q(`[data-action="${action}"]${extra}`)
    assert.equal(element.disabled, false, `Disabled control: ${action}`)
    element.click()
  }
  const input = (selector, value, event = 'input') => {
    const element = q(selector)
    if (element.type === 'checkbox') element.checked = Boolean(value)
    else element.value = value
    if (element.tagName === 'SELECT') assert.equal(element.value, value)
    element.dispatchEvent(new window.Event(event, { bubbles: true }))
  }
  const escape = () => {
    const event = new window.KeyboardEvent('keydown', {
      key: 'Escape',
      bubbles: true,
      cancelable: true,
    })
    document.body.dispatchEvent(event)
    const dialog = document.querySelector('dialog[open]')
    if (dialog && !event.defaultPrevented) {
      // jsdom has no native dialog Escape action, so reproduce its cancel event.
      const cancel = new window.Event('cancel', { cancelable: true })
      if (dialog.dispatchEvent(cancel)) dialog.close()
    }
  }
  t.after(() => {
    window.close()
    assert.deepEqual(errors, [], 'No browser script exceptions')
  })
  return {
    window,
    document,
    state: window.P.state,
    review: window.P.review,
    q,
    click,
    input,
    escape,
    opened,
  }
}

function addPerformer(h) {
  h.click('add-performer')
  h.click('create-performer', '[data-device="phone"]')
  return h.state.performers.at(-1).id
}

test('Window controls stay in the sidebar and the single mode switch anchors the footer', t => {
  const h = harness(t)
  for (const scene of ['creation', 'performance', 'live', 'empty']) {
    h.review.scenario(scene)
    assert.equal(h.document.querySelector('.titlebar,.topbar'), null)
    assert.equal(
      h.document.querySelector('[data-action="toggle-sidebar"]'),
      null
    )
    assert.equal(h.document.querySelectorAll('.traffic').length, 1)
    assert.equal(
      h.q('.traffic').closest('.sidebar-chrome'),
      h.q('.sidebar > .sidebar-chrome')
    )
    assert.equal(h.document.querySelector('.sidebar-chrome button'), null)
    if (h.state.mode === 'creation')
      assert.ok(h.q('.project-picker[data-action="project-menu"]'))
    assert.equal(
      h.document.querySelectorAll('[data-action="mode-toggle"]').length,
      1
    )
    assert.equal(h.q('.mode-control').parentElement, h.q('.transport'))
    assert.equal(h.q('.transport').lastElementChild, h.q('.mode-control'))
    assert.ok(h.q('[data-action="demo-menu"]').closest('.sidebar'))
  }
})

test('Console remains a creation tool and cannot reopen during performance', t => {
  const h = harness(t)
  const shortcut = () =>
    h.document.body.dispatchEvent(
      new h.window.KeyboardEvent('keydown', {
        key: '`',
        metaKey: true,
        bubbles: true,
        cancelable: true,
      })
    )
  h.click('console')
  assert.equal(h.state.console, true)
  assert.ok(h.q('.console'))
  h.click('mode-toggle')
  h.click('mode-toggle')
  assert.equal(h.state.mode, 'performance')
  assert.equal(h.state.console, false)
  assert.equal(
    h.document.querySelector('[data-action="console"],.console'),
    null
  )
  shortcut()
  assert.equal(h.state.console, false)
  assert.equal(h.document.querySelector('.console'), null)

  h.click('mode-toggle')
  h.click('mode-toggle')
  assert.equal(h.state.mode, 'creation')
  assert.equal(h.state.console, false)
  assert.ok(h.q('[data-action="console"]'))
  shortcut()
  assert.equal(h.state.console, true)
  assert.ok(h.q('.console'))
  shortcut()
  assert.equal(h.state.console, false)
  assert.equal(h.document.querySelector('.console'), null)
})

test('Selecting B preserves running A; replacement cancellation and confirmation differ', t => {
  const h = harness(t)
  h.review.scenario('live')
  const generation = h.state.generation
  assert.equal(h.state.running, 'inarticulate')
  assert.equal(h.state.selected, 'splash')
  h.click('primary')
  h.click('close-dialog')
  assert.equal(h.state.running, 'inarticulate')
  assert.equal(h.state.selected, 'splash')
  assert.equal(h.state.generation, generation)
  h.click('primary')
  h.click('confirm')
  assert.equal(h.state.running, 'splash')
  assert.equal(h.state.applied.audioMode, 'internal')
  assert.ok(h.state.generation > generation)
})

test('Performance handoff uses the running editable project and preserves its generation', t => {
  const h = harness(t)
  h.review.scenario('live')
  const generation = h.state.generation
  const pageRevision = h.state.pageRevision
  h.click('mode-toggle')
  h.escape()
  assert.equal(h.state.mode, 'performance')
  h.click('mode-toggle')
  h.click('mode-toggle')
  assert.equal(h.state.workspace, 'inarticulate')
  assert.equal(h.state.running, 'inarticulate')
  assert.equal(h.state.generation, generation)
  assert.equal(h.state.pageRevision, pageRevision)
})

test('Cancelling mode exit preserves drafts and devices; confirmation returns to unselected idle', t => {
  const h = harness(t)
  const ws = h.state.files.inarticulate
  const draft = ws.disk[h.state.file] + '\n// unsaved'
  h.input('[data-edit="source"]', draft)
  const id = addPerformer(h)
  h.click('mode-toggle')
  h.escape()
  assert.equal(h.state.running, 'inarticulate')
  assert.equal(ws.drafts[h.state.file], draft)
  assert.equal(h.state.performers[0].id, id)
  assert.equal(h.opened[0].closed, false)
  h.click('mode-toggle')
  h.click('mode-toggle')
  assert.equal(h.state.mode, 'performance')
  assert.equal(h.state.running, null)
  assert.equal(h.state.workspace, null)
  assert.equal(h.state.selected, null)
  assert.equal(ws.dirty.size, 0)
  assert.equal(h.state.performers.length, 0)
  assert.equal(h.opened[0].closed, true)
})

test('The single mode button arms without changing drafts; Escape and outside clicks cancel', t => {
  const h = harness(t)
  const ws = h.state.files.inarticulate
  const path = h.state.file
  const draft = ws.disk[path] + '\n// preserve on first click'
  h.input('[data-edit="source"]', draft)
  const generation = h.state.generation

  for (const cancel of ['escape', 'outside', 'blur']) {
    assert.equal(
      h.document.querySelectorAll('[data-action="mode-toggle"]').length,
      1
    )
    h.click('mode-toggle')
    assert.equal(h.state.mode, 'creation')
    assert.equal(h.state.running, 'inarticulate')
    assert.equal(h.state.generation, generation)
    assert.equal(ws.drafts[path], draft)
    assert.equal(ws.dirty.has(path), true)
    assert.equal(
      h.q('[data-action="mode-toggle"]').getAttribute('aria-pressed'),
      'true'
    )
    assert.ok(h.q('.mode-control #mode-switch-note').textContent.trim())
    assert.equal(h.q('#dialog').open, false)

    if (cancel === 'escape') {
      h.escape()
    } else if (cancel === 'blur') {
      h.window.dispatchEvent(new h.window.Event('blur'))
    } else {
      h.document.body.dispatchEvent(
        new h.window.MouseEvent('pointerdown', { bubbles: true })
      )
      h.document.body.click()
    }
    assert.notEqual(
      h.q('[data-action="mode-toggle"]').getAttribute('aria-pressed'),
      'true'
    )
    assert.equal(h.state.mode, 'creation')
    assert.equal(h.state.running, 'inarticulate')
    assert.equal(ws.drafts[path], draft)
  }
})

test('Two clicks on the same single mode control switch in both directions', t => {
  const h = harness(t)
  for (const target of ['performance', 'creation']) {
    const original = h.state.mode
    const button = h.q('[data-action="mode-toggle"]')
    assert.equal(button.dataset.mode, original)
    assert.equal(
      h.document.querySelectorAll('[data-action="mode-toggle"]').length,
      1
    )
    h.click('mode-toggle')
    assert.equal(h.q('[data-action="mode-toggle"]'), button)
    assert.equal(button.classList.contains('armed'), true)
    assert.equal(h.document.querySelector('#mode-switch-note'), null)
    assert.equal(h.state.mode, original)
    assert.equal(
      h.document.querySelectorAll('[data-action="mode-toggle"]').length,
      1
    )
    h.click('mode-toggle')
    assert.equal(h.state.mode, target)
    assert.equal(
      h.document.querySelectorAll('[data-action="mode-toggle"]').length,
      1
    )
    assert.notEqual(
      h.q('[data-action="mode-toggle"]').getAttribute('aria-pressed'),
      'true'
    )
    assert.equal(h.q('#dialog').open, false)
  }
})

test('Animated mode confirmation settles once without replacing the active control', async t => {
  const h = harness(t, { reducedMotion: false })
  const button = h.q('[data-action="mode-toggle"]')
  button.click()
  assert.equal(button.classList.contains('armed'), true)
  assert.equal(h.document.querySelector('#mode-switch-note'), null)
  button.click()
  assert.equal(button.classList.contains('settling'), true)
  assert.equal(h.q('[data-action="mode-toggle"]'), button)
  assert.equal(h.state.mode, 'creation')
  button.click()
  assert.equal(h.state.mode, 'creation')
  await delay(340)
  assert.equal(h.state.mode, 'performance')
  assert.equal(
    h.q('[data-action="mode-toggle"]').classList.contains('settling'),
    false
  )
  assert.equal(
    h.q('[data-action="mode-toggle"]').getAttribute('aria-pressed'),
    'false'
  )
})

test('Brutal mode confirms immediately even when reduced motion is disabled', t => {
  const h = harness(t, { reducedMotion: false })
  h.window.P.setTheme('brutal')
  h.click('mode-toggle')
  h.click('mode-toggle')
  assert.equal(h.state.mode, 'performance')
  assert.equal(
    h.q('[data-action="mode-toggle"]').classList.contains('settling'),
    false
  )
})

test('Only running performances auto-hide the sidebar; left-edge hover reveals it', t => {
  const h = harness(t)
  const autoHide = () => h.q('#app').classList.contains('sidebar-auto-hide')
  const revealed = () => h.q('#app').classList.contains('sidebar-revealed')
  assert.equal(autoHide(), false)
  h.review.scenario('performance')
  assert.equal(autoHide(), false)
  h.review.scenario('live')
  assert.equal(h.state.immersive, false)
  assert.equal(autoHide(), true)
  assert.equal(revealed(), false)

  const enter = new h.window.MouseEvent('pointerenter', { clientX: 4 })
  h.q('.sidebar-reveal-zone').dispatchEvent(enter)
  assert.equal(revealed(), true)
  h.q('.sidebar-reveal-zone').dispatchEvent(
    new h.window.MouseEvent('pointerleave', {
      relatedTarget: h.q('.performance-sidebar'),
    })
  )
  h.q('.performance-sidebar').dispatchEvent(enter)
  assert.equal(revealed(), true)
  h.q('.performance-sidebar').dispatchEvent(
    new h.window.MouseEvent('pointerleave', { relatedTarget: h.document.body })
  )
  assert.equal(revealed(), false)

  h.document.body.dispatchEvent(
    new h.window.MouseEvent('mousemove', {
      clientX: 14,
      clientY: 400,
      bubbles: true,
    })
  )
  assert.equal(revealed(), true)
  h.document.body.dispatchEvent(
    new h.window.MouseEvent('mousemove', {
      clientX: 500,
      clientY: 400,
      bubbles: true,
    })
  )
  assert.equal(revealed(), false)
  h.click('select-project', '[data-id="inarticulate"]')
  h.click('primary')
  h.click('confirm')
  assert.equal(autoHide(), false)
  assert.equal(h.state.mode, 'performance')
})

test('Command peek survives pointer exit and ends when the key is released', t => {
  const h = harness(t)
  h.review.scenario('live')
  const revealed = () => h.q('#app').classList.contains('sidebar-revealed')
  h.document.body.dispatchEvent(
    new h.window.KeyboardEvent('keydown', {
      key: 'Meta',
      metaKey: true,
      bubbles: true,
    })
  )
  assert.equal(revealed(), true)
  h.q('.performance-sidebar').dispatchEvent(
    new h.window.MouseEvent('pointerleave', { relatedTarget: h.document.body })
  )
  assert.equal(revealed(), true)
  h.document.body.dispatchEvent(
    new h.window.KeyboardEvent('keyup', { key: 'Meta', bubbles: true })
  )
  assert.equal(revealed(), false)
})

test('Open menus, dialogs and mode confirmation hold the sidebar until dismissed', t => {
  const h = harness(t)
  h.review.scenario('live')
  const revealed = () => h.q('#app').classList.contains('sidebar-revealed')
  for (const action of ['folder-menu', 'settings', 'mode-toggle']) {
    h.q('.sidebar-reveal-zone').dispatchEvent(
      new h.window.MouseEvent('pointerenter')
    )
    h.click(action)
    h.q('.performance-sidebar').dispatchEvent(
      new h.window.MouseEvent('pointerleave', {
        relatedTarget: h.document.body,
      })
    )
    assert.equal(revealed(), true, `${action} should hold the sidebar`)
    h.escape()
    assert.equal(
      revealed(),
      false,
      `${action} should release the sidebar on Escape`
    )
  }
  assert.equal(h.state.mode, 'performance')
  assert.equal(h.state.running, 'inarticulate')
})

test('Dragging a performance holds its sidebar until the drag ends', t => {
  const h = harness(t)
  h.review.scenario('live')
  const revealed = () => h.q('#app').classList.contains('sidebar-revealed')
  h.q('.sidebar-reveal-zone').dispatchEvent(
    new h.window.MouseEvent('pointerenter')
  )
  const row = h.q('[data-project="splash"]')
  row.dispatchEvent(new h.window.MouseEvent('pointerdown', { bubbles: true }))
  row.dispatchEvent(new h.window.Event('dragstart', { bubbles: true }))
  // Native HTML dragging cancels the pointer stream after dragstart.
  row.dispatchEvent(new h.window.MouseEvent('pointercancel', { bubbles: true }))
  h.q('.performance-sidebar').dispatchEvent(
    new h.window.MouseEvent('pointerleave', { relatedTarget: h.document.body })
  )
  assert.equal(revealed(), true)
  row.dispatchEvent(new h.window.Event('dragend', { bubbles: true }))
  assert.equal(revealed(), false)
  assert.equal(h.state.selected, 'splash')
  assert.equal(h.state.running, 'inarticulate')
})

test('Draft edits, saved-page refresh, compile and restart keep separate state', t => {
  const h = harness(t)
  const ws = h.state.files.inarticulate
  const path = h.state.file
  const before = ws.disk[path]
  const generation = h.state.generation
  const page = h.state.pageRevision
  h.input('[data-edit="source"]', before + '\n// saved later')
  h.click('refresh')
  assert.equal(ws.disk[path], before)
  assert.equal(ws.dirty.has(path), true)
  assert.equal(h.state.generation, generation)
  assert.equal(h.state.pageRevision, page + 1)
  h.click('save')
  assert.equal(ws.dirty.size, 0)
  assert.equal(ws.pending.has('refresh'), true)
  h.click('refresh')
  assert.equal(ws.pending.has('refresh'), false)
  const scd = 'supercollider/source/inarticulate.scd'
  h.review.setFile(scd)
  h.input('[data-edit="source"]', ws.disk[scd] + '\n// new source')
  h.click('compile')
  assert.equal(h.q('#dialog').open, true)
  assert.equal(ws.pending.has('restart'), false)
  h.click('close-dialog')
  h.click('save')
  assert.equal(ws.pending.has('compile'), true)
  h.click('compile')
  assert.equal(ws.pending.has('compile'), false)
  assert.equal(ws.pending.has('restart'), true)
  assert.equal(h.state.generation, generation)
  h.click('primary')
  h.click('close-dialog')
  assert.equal(ws.pending.has('restart'), true)
  h.click('primary')
  h.click('confirm')
  assert.equal(ws.pending.has('restart'), false)
  assert.ok(h.state.generation > generation)
})

test('Device, sample-rate and LAN changes stay pending until confirmed restart', t => {
  const h = harness(t)
  const original = { ...h.state.applied }
  h.click('settings')
  h.click('settings-section', '[data-section="audio"]')
  h.input('[data-setting="device"]', 'BlackHole 16ch', 'change')
  h.input('[data-setting="rate"]', '96000', 'change')
  h.click('settings-section', '[data-section="node"]')
  h.input('[data-setting="lan"]', '192.168.50.2', 'change')
  assert.deepEqual({ ...h.state.applied }, original)
  assert.equal(h.review.hasPending(), true)
  h.click('close-dialog')
  h.click('primary')
  h.click('close-dialog')
  assert.deepEqual({ ...h.state.applied }, original)
  h.click('primary')
  h.click('confirm')
  assert.equal(h.state.applied.device, 'BlackHole 16ch')
  assert.equal(h.state.applied.rate, '96000')
  assert.equal(h.state.applied.lan, '192.168.50.2')
  assert.equal(h.review.hasPending(), false)
})

test('Bundle and utility performances never become editable workspaces', t => {
  const h = harness(t)
  for (const id of ['asbs', 'utility']) {
    h.review.scenario('performance')
    h.state.selected = id
    h.window.P.render()
    h.click('primary')
    assert.equal(h.state.running, id)
    h.click('mode-toggle')
    h.click('mode-toggle')
    assert.equal(h.state.workspace, null)
    assert.equal(h.state.running, null)
    assert.equal(h.document.querySelector('[data-action="save"]'), null)
    assert.equal(h.document.querySelector('[data-action="compile"]'), null)
    h.review.openWorkspace(id)
    assert.equal(h.state.workspace, null)
  }
})

test('Performer hide preserves the client and window; deletion removes only that device', t => {
  const h = harness(t)
  const id = addPerformer(h)
  const child = h.opened[0]
  h.click('show-performer', `.icon-btn[data-id="${id}"]`)
  assert.equal(h.state.performers[0].hidden, true)
  assert.equal(child.closed, false)
  h.click('show-performer', `.icon-btn[data-id="${id}"]`)
  assert.equal(h.state.performers[0].hidden, false)
  assert.equal(h.opened.length, 1)
  assert.equal(h.state.performers[0].id, id)
  h.click('delete-performer', `[data-id="${id}"]`)
  assert.equal(child.closed, true)
  assert.equal(h.state.performers.length, 0)
  assert.equal(h.state.running, 'inarticulate')
  assert.notEqual(addPerformer(h), id)
})

test('Stopping a creation test closes its Performer clients', t => {
  const h = harness(t)
  addPerformer(h)
  h.click('stop')
  assert.equal(h.state.running, null)
  assert.equal(h.state.workspace, 'inarticulate')
  assert.equal(h.state.performers.length, 0)
  assert.equal(h.opened[0].closed, true)
})

test('Mode changes close projection while cancelled changes preserve it', t => {
  const h = harness(t)
  h.review.scenario('live')
  h.click('projection')
  h.click('open-projection')
  const projection = h.opened[0]
  h.click('mode-toggle')
  h.escape()
  assert.equal(h.state.projection, true)
  assert.equal(projection.closed, false)
  h.click('mode-toggle')
  h.click('mode-toggle')
  assert.equal(h.state.projection, false)
  assert.equal(projection.closed, true)
  assert.equal(h.state.running, 'inarticulate')
})

test('All eight settings sections and nested certificate/port/help dialogs work', t => {
  const h = harness(t)
  h.review.scenario('performance')
  h.click('settings')
  const sections = [
    'general',
    'audio',
    'node',
    'https',
    'dns',
    'ports',
    'developer',
    'about',
  ]
  for (const section of sections) {
    h.click('settings-section', `[data-section="${section}"]`)
    assert.equal(
      h.q('.settings-nav [aria-current="page"]').dataset.section,
      section
    )
    assert.ok(h.q('.settings-content').textContent.trim())
  }
  h.click('settings-section', '[data-section="https"]')
  h.click('settings:certificate-import')
  h.click('settings:certificate-confirm')
  h.click('settings:certificate-clear')
  h.click('settings-section', '[data-section="ports"]')
  h.click('settings:port-scenario')
  h.click('settings:port-release')
  assert.match(h.q('#dialog').textContent, /PID 4821/)
  h.click('settings:return')
  h.click('settings:port-release')
  h.click('settings:port-release-confirm')
  h.click('settings-section', '[data-section="about"]')
  h.click('settings:check-update')
  h.click('settings:help')
  h.click('settings:help-creation')
  h.click('settings:return')
  h.click('close-dialog')
})

test('Project, file, runtime, projection and prototype menus render without exceptions', t => {
  const h = harness(t)
  for (const action of [
    'project-menu',
    'file-menu',
    'audio-popover',
    'network-popover',
    'projection',
    'demo-menu',
  ]) {
    h.click(action)
    assert.ok(h.q('#popover-root').textContent.trim())
    h.document.body.click()
  }
  h.review.scenario('performance')
  h.click('folder-menu')
  assert.ok(h.q('#popover-root').textContent.trim())
  assert.ok(h.q('[data-action="rename-project"]'))
  assert.ok(h.q('[data-action="remove-project"]'))
})

test('Disk conflict cancellation preserves the draft and reload adopts disk', t => {
  const h = harness(t)
  h.review.scenario('conflict')
  const ws = h.state.files.inarticulate
  const path = h.state.file
  const draft = ws.drafts[path]
  h.click('save')
  h.click('close-dialog')
  assert.equal(ws.drafts[path], draft)
  assert.equal(ws.conflict, path)
  h.click('save')
  h.click('conflict-reload')
  assert.equal(ws.dirty.has(path), false)
  assert.equal(ws.conflict, null)
  assert.equal(h.q('[data-edit="source"]').value, ws.disk[path])
})

test('Pending test audio modes do not replace applied transport facts', t => {
  const h = harness(t)
  const device = h.q('.device-trigger').textContent
  const volume = h.q('.volume-value').textContent
  for (const mode of ['external', 'none']) {
    h.input('#test-audio-mode', mode, 'change')
    assert.equal(h.state.testMode, mode)
    assert.equal(h.state.applied.audioMode, 'internal')
    assert.equal(h.q('.device-trigger').textContent, device)
    assert.equal(h.q('.volume-value').textContent, volume)
    assert.equal(h.q('#volume').disabled, false)
    assert.match(h.q('.preview-note.warning').textContent, /internal/)
  }
  h.click('primary')
  h.click('confirm')
  assert.equal(h.state.applied.audioMode, 'none')
  assert.equal(h.q('#volume').disabled, true)
  assert.equal(h.q('.volume-value').textContent, '—')
})

test('Test audio choices follow saved supported modes rather than manifest drafts', t => {
  const h = harness(t)
  h.review.setFile('manifest.json')
  h.click('editor-view', '[data-view="source"]')
  const manifest = JSON.parse(h.q('[data-edit="source"]').value)
  manifest.audio.supportedModes = ['none']
  manifest.audio.defaultMode = 'none'
  h.input('[data-edit="source"]', JSON.stringify(manifest, null, 2))
  assert.deepEqual(
    [...h.q('#test-audio-mode').options].map(option => option.value),
    ['internal', 'external', 'none']
  )
  h.click('save')
  assert.deepEqual(
    [...h.q('#test-audio-mode').options].map(option => option.value),
    ['none']
  )
  assert.equal(h.state.testMode, 'none')
  assert.equal(h.state.applied.audioMode, 'internal')
  h.click('primary')
  h.click('confirm')
  assert.equal(h.state.applied.audioMode, 'none')
})

test('Malformed manifest shapes keep their source draft and show a repair fallback', t => {
  const h = harness(t)
  h.review.setFile('manifest.json')
  for (const source of ['null', '[]', '{}', '{ unfinished']) {
    h.click('editor-view', '[data-view="source"]')
    h.input('[data-edit="source"]', source)
    h.click('editor-view', '[data-view="form"]')
    assert.ok(h.q('.editor-body .notice.warning').textContent.trim())
    h.click('editor-view', '[data-view="source"]')
    assert.equal(h.q('[data-edit="source"]').value, source)
    assert.equal(h.state.files.inarticulate.dirty.has('manifest.json'), true)
  }
})

test('Saved output-channel changes retain live gain controls until restart', t => {
  const h = harness(t)
  assert.equal(h.state.applied.channels, 2)
  h.review.setFile('manifest.json')
  h.input('[data-edit="manifest:audio.outputChannels"]', '16')
  h.click('save')
  assert.equal(h.state.applied.channels, 2)
  assert.equal(h.q('#volume').disabled, false)
  assert.equal(h.q('.volume-value').textContent, '80%')
  h.click('primary')
  h.click('confirm')
  assert.equal(h.state.applied.channels, 16)
  assert.equal(h.q('#volume').disabled, true)
  assert.equal(h.q('.volume-value').textContent, '100%')
})
