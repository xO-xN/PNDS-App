import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { URL } from 'node:url'
import test from 'node:test'
import { JSDOM, VirtualConsole } from 'jsdom'

const html = await readFile(new URL('./index.html', import.meta.url), 'utf8')
const scripts = await Promise.all(
  ['catalogs.js', 'workflows.js', 'prototype.js'].map(name =>
    readFile(new URL(name, import.meta.url), 'utf8')
  )
)
const codePath = 'web/monitor/sketch.js'

function harness(t, language = 'zh-CN') {
  const errors = []
  const opened = []
  const virtualConsole = new VirtualConsole()
  virtualConsole.on('jsdomError', error => errors.push(error.message))
  const dom = new JSDOM(html, {
    url: `https://prototype.test/index.html?lang=${language}`,
    runScripts: 'outside-only',
    pretendToBeVisual: true,
    virtualConsole,
  })
  const { window } = dom
  const { document } = window
  window.HTMLDialogElement.prototype.showModal = function () {
    this.open = true
  }
  window.HTMLDialogElement.prototype.close = function () {
    this.open = false
    this.dispatchEvent(new window.Event('close'))
  }
  window.HTMLElement.prototype.setPointerCapture = () => {
    // Native pointer capture and geometry are covered by browser review.
  }
  window.open = (url, name) => {
    const child = {
      url,
      name,
      closed: false,
      focus() {
        // This test double does not create a native window.
      },
      close() {
        this.closed = true
      },
    }
    opened.push(child)
    return child
  }
  for (const script of scripts) window.eval(script)
  t.after(() => {
    window.close()
    assert.deepEqual(errors, [], 'Prototype should not raise browser errors')
  })
  const q = selector => {
    const element = document.querySelector(selector)
    assert.ok(element, `Expected visible control: ${selector}`)
    return element
  }
  const click = (action, extra = '') => {
    const element = q(`[data-action="${action}"]${extra}`)
    assert.equal(
      element.disabled,
      false,
      `Control should be enabled: ${action}`
    )
    element.click()
    return element
  }
  const input = (selector, value) => {
    const element = q(selector)
    element.value = value
    element.dispatchEvent(new window.Event('input', { bubbles: true }))
    return element
  }
  const check = (selector, value) => {
    const element = q(selector)
    element.checked = value
    element.dispatchEvent(new window.Event('change', { bubbles: true }))
    return element
  }
  const file = path => click('open-file', `[data-path="${path}"]`)
  return {
    window,
    document,
    q,
    click,
    input,
    check,
    file,
    opened,
    state: window.P.state,
  }
}

test('monitor, discussion input, and per-file drafts survive workspace navigation', t => {
  const h = harness(t)
  const monitor = h.q('#live-monitor')
  monitor.click()
  const touches = h.q('#touch-count').textContent
  h.input('#chat-input', '保留这句尚未发送的想法')
  h.file(codePath)
  const draft = h
    .q('#code-editor')
    .value.replace('density: 0.32', 'density: 0.41')
  h.input('#code-editor', draft)
  for (const view of ['handoff', 'changes', 'history', 'chat']) {
    h.click('nav', `[data-view="${view}"]`)
    assert.equal(h.q('#live-monitor'), monitor)
    assert.equal(h.q('#touch-count').textContent, touches)
  }
  assert.equal(h.q('#chat-input').value, '保留这句尚未发送的想法')
  h.file(codePath)
  assert.equal(h.q('#code-editor').value, draft)
  h.click('console-toggle')
  assert.ok(h.q('.console-dock'))
  h.click('expand-monitor')
  assert.equal(h.q('#app').classList.contains('full-monitor'), true)
  h.click('expand-monitor')
  assert.equal(h.q('#app').classList.contains('full-monitor'), false)
  assert.equal(h.q('#live-monitor'), monitor)
  assert.equal(h.q('#code-editor').value, draft)
})

test('explicit AI execution, manual saving, version recording, and monitor refresh remain separate', t => {
  const h = harness(t)
  const initial = h.state.files[codePath]
  const initialHistory = h.state.history.length
  const runtimeLabel = h.q('#density-label').textContent
  h.file(codePath)
  assert.equal(h.q('#code-editor').value, initial)
  h.click('back-chat')
  h.click('execute-edit')
  assert.match(h.state.files[codePath], /density: 0\.56/)
  assert.match(h.q('.diff').textContent, /0\.56/)
  assert.equal(h.q('#density-label').textContent, runtimeLabel)
  assert.equal(h.state.history.length, initialHistory)
  h.file(codePath)
  h.input(
    '#code-editor',
    h.q('#code-editor').value.replace('density: 0.56', 'density: 0.72')
  )
  assert.match(h.state.files[codePath], /density: 0\.56/)
  h.click('save-file')
  assert.match(h.state.files[codePath], /density: 0\.72/)
  assert.equal(h.q('#density-label').textContent, runtimeLabel)
  assert.equal(h.state.history.length, initialHistory)
  h.click('back-chat')
  assert.match(h.q('.diff').textContent, /0\.56/)
  assert.doesNotMatch(h.q('.diff').textContent, /0\.72/)
  assert.equal(h.q('[data-action="undo-ai"]').disabled, true)
  h.click('refresh-monitor')
  assert.match(h.q('#density-label').textContent, /0\.72/)
})

test('unsaved selection snapshots are retained when project reading blocks a send', t => {
  const h = harness(t)
  h.file(codePath)
  const editor = h.input(
    '#code-editor',
    h.q('#code-editor').value.replace('density: 0.32', 'density: 0.41')
  )
  const start = editor.value.indexOf('density:')
  editor.setSelectionRange(start, start + 'density: 0.41'.length)
  h.click('attach-selection')
  h.click('view-attachment')
  assert.match(h.q('#dialog').textContent, /density: 0\.41/)
  h.click('close-dialog')
  h.input('#chat-input', '解释这个参数')
  h.check('#read-project', false)
  h.click('send-message')
  assert.equal(h.state.messages.length, 0)
  assert.equal(h.q('#chat-input').value, '解释这个参数')
  assert.ok(h.q('.attachment-block'))
  assert.equal(h.state.attachment.unsaved, true)
  h.file(codePath)
  h.input(
    '#code-editor',
    h.q('#code-editor').value.replace('density: 0.41', 'density: 0.65')
  )
  h.click('back-chat')
  h.check('#read-project', true)
  h.click('send-message')
  assert.equal(
    h.state.messages.length,
    0,
    'A first project send needs confirmation'
  )
  h.click('authorize-send')
  assert.equal(h.state.messages[0].attachment.text, 'density: 0.41')
  assert.equal(h.state.messages[0].attachment.unsaved, true)
  assert.equal(h.q('#chat-input').value, '')
  assert.equal(h.state.attachment, null)
  assert.match(h.state.files[codePath], /density: 0\.32/)
})

test('shared packages block manifest drafts, then save only a reference and project version', t => {
  const h = harness(t)
  const originalFiles = { ...h.state.files }
  const monitor = h.q('#live-monitor')
  h.file('manifest.json')
  h.input('#code-editor', `${h.q('#code-editor').value}\n`)
  h.click('catalog-packages')
  assert.equal(
    h.document.querySelectorAll('[data-action="catalog-package"]').length,
    7
  )
  h.click('catalog-package', '[data-id="ml5"]')
  assert.equal(h.q('[data-action="catalog-adopt"]').disabled, true)
  h.click('catalog-close')
  h.click('save-file')
  h.click('catalog-packages')
  h.click('catalog-package', '[data-id="ml5"]')
  h.input('#catalog-project-version', '0.5.0')
  h.click('catalog-adopt')
  const manifest = JSON.parse(h.state.files['manifest.json'])
  assert.equal(manifest.version, '0.5.0')
  assert.ok(
    manifest.sharedLibraries.some(
      item => item.id === 'ml5' && item.version === '1.4.0'
    )
  )
  assert.deepEqual(Object.keys(h.state.files), Object.keys(originalFiles))
  for (const path of Object.keys(originalFiles).filter(
    path => path !== 'manifest.json'
  )) {
    assert.equal(h.state.files[path], originalFiles[path])
  }
  assert.equal(h.q('#live-monitor'), monitor)
  assert.equal(h.document.querySelector('[data-action="catalog-adopt"]'), null)
  assert.match(h.q('#dialog').textContent, /接入|wiring/i)
})

test('module addition creates source and a wiring task without modifying entry code or restarting', t => {
  const h = harness(t)
  const before = { ...h.state.files }
  const monitor = h.q('#live-monitor')
  const label = h.q('#density-label').textContent
  h.click('catalog-modules')
  assert.equal(
    h.document.querySelectorAll('[data-action="catalog-module"]').length,
    6
  )
  h.click('catalog-module', '[data-id="qr"]')
  h.click('catalog-add-module', '[data-id="qr"]')
  assert.ok(
    Object.keys(h.state.files).some(path => path.startsWith('modules/pnds-qr/'))
  )
  for (const path of Object.keys(before))
    assert.equal(h.state.files[path], before[path])
  assert.equal(h.state.handoffTasks.length, 1)
  assert.match(h.state.files['docs/creator-handoff.md'], /扫码|Scan/)
  assert.equal(h.q('#live-monitor'), monitor)
  assert.equal(h.q('#density-label').textContent, label)
  h.click('catalog-handoff')
  h.click('wf-preview-handoff')
  assert.match(h.q('#dialog').textContent, /扫码|Scan/)
  h.click('wf-cancel')
  h.click('catalog-modules')
  h.click('catalog-module', '[data-id="qr"]')
  assert.equal(
    h.document.querySelector('[data-action="catalog-add-module"]'),
    null
  )
  assert.equal(h.state.handoffTasks.length, 1)
})

test('saved-only handoff captures a baseline and keeps comparison after an external Git commit', t => {
  const h = harness(t)
  const monitor = h.q('#live-monitor')
  const original = h.state.files[codePath]
  h.file(codePath)
  h.input('#code-editor', original.replace('density: 0.32', 'density: 0.44'))
  h.click('nav', '[data-view="handoff"]')
  h.click('wf-preview-handoff')
  h.check('[name="wf-drafts"][value="saved"]', true)
  h.click('wf-confirm-handoff')
  assert.equal(h.state.baseline.files[codePath], original)
  assert.match(h.state.drafts[codePath], /density: 0\.44/)
  const baseline = h.state.baseline
  h.click('wf-show-changes')
  assert.equal(h.document.querySelectorAll('.change-card').length, 0)
  h.click('wf-simulate-external')
  assert.equal(h.state.baseline, baseline)
  assert.ok(h.document.querySelectorAll('.change-card').length >= 3)
  assert.match(h.q('#main-content').textContent, /资源摘要|Resource summary/)
  h.click('wf-git-tab')
  assert.equal(h.document.querySelectorAll('.change-card').length, 0)
  h.click('wf-compare-tab')
  assert.ok(h.document.querySelectorAll('.change-card').length >= 3)
  assert.equal(h.q('#live-monitor'), monitor)
  assert.match(h.q('#density-label').textContent, /0\.32/)
})

test('manual version recording selects whole files; historical text loads only into a draft', t => {
  const h = harness(t)
  const before = h.state.files[codePath]
  h.file(codePath)
  h.input('#code-editor', before.replace('density: 0.32', 'density: 0.68'))
  h.click('save-file')
  h.file('README.md')
  h.input('#code-editor', `${h.q('#code-editor').value}\n未纳入这次版本。\n`)
  h.click('save-file')
  h.click('nav', '[data-view="history"]')
  h.click('wf-record')
  h.check('input[name="wf-file"][value="README.md"]', false)
  assert.equal(
    h.q('input[name="wf-file"][value="audio/room-tone.wav"]').checked,
    false
  )
  h.input('#wf-commit-message', '调整圆环密度')
  h.click('wf-confirm-record')
  assert.equal(h.state.history[0].message, '调整圆环密度')
  assert.deepEqual(Array.from(h.state.history[0].files), [codePath])
  const saved = h.state.files[codePath]
  const historyCount = h.state.history.length
  h.click('wf-select-history', '[data-id="7c4e2a1"]')
  h.click('wf-select-history-file', `[data-path="${codePath}"]`)
  h.click('wf-load-history', `[data-path="${codePath}"]`)
  assert.equal(h.q('#code-editor').value, before)
  assert.equal(h.state.files[codePath], saved)
  assert.equal(h.state.history.length, historyCount)
  assert.match(h.q('#density-label').textContent, /0\.32/)
  h.click('nav', '[data-view="history"]')
  h.click('wf-load-history', `[data-path="${codePath}"]`)
  assert.match(h.q('#dialog').textContent, /未保存草稿|unsaved draft/)
  assert.equal(h.state.drafts[codePath], before)
})

test('an existing project can enable local history explicitly and large resources default to excluded', t => {
  const h = harness(t)
  const files = JSON.stringify(h.state.files)
  h.click('demo-state')
  h.click('demo-no-git')
  assert.equal(h.state.hasGit, false)
  assert.equal(h.state.history.length, 0)
  assert.equal(JSON.stringify(h.state.files), files)
  h.click('wf-enable-git')
  assert.equal(
    h.q('input[name="wf-file"][value="audio/room-tone.wav"]').checked,
    false
  )
  h.input('#wf-author', '新创作者')
  h.click('wf-confirm-git')
  assert.equal(h.state.hasGit, true)
  assert.equal(h.state.history.length, 1)
  assert.equal(h.state.history[0].author, '新创作者')
  assert.equal(h.state.gitEmail, 'creator@local.invalid')
  assert.equal(h.state.history[0].files.includes('audio/room-tone.wav'), false)
  assert.equal(JSON.stringify(h.state.files), files)
})

test('static checks stay available during a run and copy checks require a manual stop', t => {
  const h = harness(t)
  const monitor = h.q('#live-monitor')
  const files = JSON.stringify(h.state.files)
  h.click('checks')
  assert.equal(h.q('[data-action="run-copy-check"]').disabled, true)
  h.click('run-static')
  assert.equal(h.state.running, true)
  assert.equal(h.q('#live-monitor'), monitor)
  h.click('close-dialog')
  h.click('runtime-toggle')
  h.click('checks')
  h.click('run-copy-check')
  assert.match(h.q('#dialog').textContent, /None|none/)
  assert.equal(h.state.running, false)
  assert.equal(JSON.stringify(h.state.files), files)
  assert.equal(h.q('#live-monitor'), monitor)
})

test('English catalog and independent performer messaging use the same working prototype', t => {
  const h = harness(t, 'en')
  assert.equal(h.document.documentElement.lang, 'en')
  h.click('catalog-packages')
  assert.match(h.q('#dialog').textContent, /App shared packages/)
  h.click('catalog-close')
  h.click('add-performer')
  assert.match(h.opened[0].url, /performer\.html\?lang=en/)
  const monitor = h.q('#live-monitor')
  const previousTouches = h.q('#touch-count').textContent
  h.window.dispatchEvent(
    new h.window.MessageEvent('message', {
      data: { type: 'pnds-170-touch', x: 0.3, y: 0.6 },
      source: {},
    })
  )
  assert.equal(h.q('#touch-count').textContent, previousTouches)
  h.window.dispatchEvent(
    new h.window.MessageEvent('message', {
      data: { type: 'pnds-170-touch', x: 0.3, y: 0.6 },
      source: h.opened[0],
    })
  )
  assert.notEqual(h.q('#touch-count').textContent, previousTouches)
  h.window.dispatchEvent(
    new h.window.MessageEvent('message', {
      data: { type: 'pnds-170-performer-closed' },
      source: h.opened[0],
    })
  )
  assert.equal(h.state.performers.length, 0)
  assert.equal(h.q('#live-monitor'), monitor)
})

test('new-project preview preserves the current project until confirmation and uses the new authorship', t => {
  const h = harness(t)
  const currentFiles = JSON.stringify(h.state.files)
  const currentHistory = JSON.stringify(h.state.history)
  h.click('project-menu')
  h.click('new-project')
  h.input('#new-name', '夜航')
  h.input('#new-author', '李青')
  h.input('#new-email', 'li@example.test')
  h.click('create-project')
  assert.equal(JSON.stringify(h.state.files), currentFiles)
  assert.equal(JSON.stringify(h.state.history), currentHistory)
  assert.equal(h.q('#wf-author').value, '李青')
  assert.equal(h.q('#wf-email').value, 'li@example.test')
  h.click('wf-cancel')
  assert.equal(JSON.stringify(h.state.files), currentFiles)
  assert.equal(JSON.stringify(h.state.history), currentHistory)
  h.click('project-menu')
  h.click('new-project')
  h.input('#new-name', '夜航')
  h.input('#new-author', '李青')
  h.input('#new-email', 'li@example.test')
  h.click('create-project')
  h.click('wf-confirm-git')
  assert.equal(h.state.projectName, '夜航')
  assert.equal(h.state.history.length, 1)
  assert.equal(h.state.history[0].author, '李青')
  assert.equal(h.state.gitEmail, 'li@example.test')
  assert.equal(h.state.running, false)
  assert.match(h.state.files['README.md'], /夜航/)
  assert.notEqual(JSON.stringify(h.state.files), currentFiles)
})

test('saved-only handoff marks its open draft conflicted and blocks accidental overwrite', t => {
  const h = harness(t)
  h.click('nav', '[data-view="handoff"]')
  h.click('wf-preview-handoff')
  h.click('wf-confirm-handoff')
  h.file('docs/creator-handoff.md')
  const draft = `${h.q('#code-editor').value}\n尚未确认的任务补充。\n`
  h.input('#code-editor', draft)
  h.click('nav', '[data-view="handoff"]')
  h.click('wf-preview-handoff')
  h.check('[name="wf-drafts"][value="saved"]', true)
  h.click('wf-confirm-handoff')
  const saved = h.state.files['docs/creator-handoff.md']
  h.file('docs/creator-handoff.md')
  assert.equal(h.q('#code-editor').value, draft)
  h.click('save-file')
  assert.equal(h.state.files['docs/creator-handoff.md'], saved)
  assert.equal(h.state.drafts['docs/creator-handoff.md'], draft)
  h.click('nav', '[data-view="handoff"]')
  const baselineCount = h.state.handoffBaselines.length
  h.click('wf-preview-handoff')
  h.click('wf-confirm-handoff')
  assert.equal(h.state.handoffBaselines.length, baselineCount)
  assert.equal(h.q('#dialog').open, true)
})

test('handoff save-first rejects an invalid JSON draft without recording a baseline', t => {
  const h = harness(t)
  h.file('manifest.json')
  const saved = h.state.files['manifest.json']
  h.input('#code-editor', '{invalid draft')
  h.click('nav', '[data-view="handoff"]')
  h.click('wf-preview-handoff')
  h.click('wf-confirm-handoff')
  assert.equal(h.state.baseline, null)
  assert.equal(h.state.files['manifest.json'], saved)
  assert.equal(h.state.drafts['manifest.json'], '{invalid draft')
  assert.equal(h.q('#dialog').open, true)
})

test('an externally staged selected file blocks recording without clearing the existing staging', t => {
  const h = harness(t)
  const historyCount = h.state.history.length
  h.click('demo-state')
  h.click('demo-external-staged')
  h.click('wf-record')
  h.input('#wf-commit-message', '应当阻止此记录')
  h.click('wf-confirm-record')
  assert.equal(h.state.history.length, historyCount)
  assert.equal(h.state.externalStaged.has(codePath), true)
  assert.equal(h.q('#dialog').open, true)
})

test('refreshing the monitor does not clear a shared-package restart requirement', t => {
  const h = harness(t)
  h.click('catalog-packages')
  h.click('catalog-package', '[data-id="ml5"]')
  h.input('#catalog-project-version', '0.5.0')
  h.click('catalog-adopt')
  h.click('catalog-close')
  h.click('refresh-monitor')
  assert.match(
    h.q('#monitor-notice.visible').textContent,
    /重启|重新启动|restart/i
  )
  h.click('runtime-toggle')
  h.click('runtime-toggle')
  assert.equal(h.document.querySelector('#monitor-notice.visible'), null)
})

test('saving new content invalidates a previous static pass without stopping the project', t => {
  const h = harness(t)
  h.click('checks')
  h.click('run-static')
  assert.ok(h.q('#dialog .callout.success'))
  h.click('close-dialog')
  h.file(codePath)
  h.input(
    '#code-editor',
    `${h.q('#code-editor').value}\n// A newer saved version.\n`
  )
  h.click('save-file')
  h.click('checks')
  assert.equal(h.document.querySelector('#dialog .callout.success'), null)
  assert.equal(h.state.running, true)
})

test('new projects do not inherit the old project restart reminder or static result', t => {
  const h = harness(t)
  h.click('catalog-packages')
  h.click('catalog-package', '[data-id="ml5"]')
  h.input('#catalog-project-version', '0.5.0')
  h.click('catalog-adopt')
  h.click('catalog-close')
  h.click('checks')
  h.click('run-static')
  h.click('close-dialog')
  h.click('project-menu')
  h.click('new-project')
  h.input('#new-name', '新的空白工程')
  h.click('create-project')
  h.click('wf-confirm-git')
  assert.equal(h.document.querySelector('#monitor-notice.visible'), null)
  h.click('checks')
  assert.equal(h.document.querySelector('#dialog .callout.success'), null)
})

function durableState(state) {
  return JSON.stringify({
    files: state.files,
    drafts: state.drafts,
    changes: [...state.changed],
    history: state.history,
    runtime: state.runtimeParameters,
    pendingRuntime: state.pendingRuntime,
    pendingRestart: state.pendingRestart,
  })
}

test('parameter controls preview visually without changing saved files, drafts, Git, or actual runtime', t => {
  const h = harness(t)
  const monitor = h.q('#live-monitor')
  const initialRadius = h
    .q('#score-orbits ellipse:last-child')
    .getAttribute('rx')
  const initialDuration = h.q('#score-orbits').style.animationDuration
  const before = durableState(h.state)
  h.input('[data-parameter="density"][type="number"]', '0.73')
  h.input('[data-parameter="easing"][type="number"]', '0.055')
  assert.equal(h.state.parameters.active, true)
  assert.equal(
    h.q('#live-monitor').classList.contains('parameter-preview'),
    true
  )
  assert.notEqual(
    h.q('#score-orbits ellipse:last-child').getAttribute('rx'),
    initialRadius
  )
  assert.notEqual(h.q('#score-orbits').style.animationDuration, initialDuration)
  assert.match(h.q('#monitor-preview').textContent, /预演|preview/i)
  assert.equal(durableState(h.state), before)
  for (const view of ['handoff', 'changes', 'history', 'chat']) {
    h.click('nav', `[data-view="${view}"]`)
    assert.equal(h.q('#live-monitor'), monitor)
    assert.equal(h.state.parameters.active, true)
  }
  h.click('parameter-stop')
  assert.equal(h.state.parameters.active, false)
  assert.equal(
    h.q('#live-monitor').classList.contains('parameter-preview'),
    false
  )
  assert.equal(
    h.q('#score-orbits ellipse:last-child').getAttribute('rx'),
    initialRadius
  )
  assert.equal(h.q('#score-orbits').style.animationDuration, initialDuration)
  assert.equal(durableState(h.state), before)
})

test('applying selected preview values writes only after a click and preserves earlier actual diffs', t => {
  const h = harness(t)
  const original = h.state.files[codePath]
  const runtime = JSON.stringify(h.state.runtimeParameters)
  const history = JSON.stringify(h.state.history)
  h.input('[data-parameter="density"][type="range"]', '0.73')
  h.input('[data-parameter="easing"][type="number"]', '0.055')
  assert.equal(h.state.files[codePath], original)
  h.click('execute-edit')
  assert.match(h.state.files[codePath], /density: 0\.73/)
  assert.match(h.state.files[codePath], /easing: 0\.055/)
  assert.equal(h.state.parameters.active, true)
  assert.equal(JSON.stringify(h.state.runtimeParameters), runtime)
  assert.equal(JSON.stringify(h.state.history), history)
  assert.match(
    h.q('#parameter-status').textContent,
    /已保存|已应用|saved|applied/i
  )
  assert.ok(h.q('#monitor-notice.visible'))
  const firstEdit = h.state.parameterEdits[0]
  const firstSnapshot = JSON.stringify(firstEdit)
  assert.equal(firstEdit.before, original)
  assert.match(firstEdit.after, /density: 0\.73/)
  h.input('[data-parameter="density"][type="number"]', '0.84')
  h.click('execute-edit')
  assert.equal(h.state.parameterEdits.length, 2)
  assert.equal(JSON.stringify(firstEdit), firstSnapshot)
  assert.match(h.state.files[codePath], /density: 0\.84/)
  const visibleDiffs = [...h.document.querySelectorAll('.diff')]
    .map(element => element.textContent)
    .join('\n')
  assert.match(visibleDiffs, /0\.73/)
  assert.match(visibleDiffs, /0\.84/)
  h.click('parameter-stop')
  assert.equal(JSON.stringify(h.state.runtimeParameters), runtime)
  h.click('refresh-monitor')
  assert.equal(h.state.runtimeParameters.density, 0.84)
  assert.equal(h.state.runtimeParameters.easing, 0.055)
})

test('an unsaved file draft blocks applying a preview and keeps both saved content and the draft', t => {
  const h = harness(t)
  const saved = h.state.files[codePath]
  h.input('[data-parameter="density"][type="number"]', '0.73')
  h.file(codePath)
  const draft = `${h.q('#code-editor').value}\n// Keep this unsaved work.\n`
  h.input('#code-editor', draft)
  h.click('back-chat')
  const radius = h.q('#score-orbits ellipse:last-child').getAttribute('rx')
  h.input('[data-parameter="density"][type="number"]', '0.84')
  assert.equal(
    h.q('#score-orbits ellipse:last-child').getAttribute('rx'),
    radius
  )
  h.q('[data-action="execute-edit"]').click()
  assert.equal(h.state.files[codePath], saved)
  assert.equal(h.state.drafts[codePath], draft)
  assert.equal(h.state.parameterEdits.length, 0)
  assert.match(h.document.body.textContent, /草稿|draft/i)
})

test('external file changes invalidate the parameter proposal until explicitly reloaded', t => {
  const h = harness(t)
  h.input('[data-parameter="density"][type="number"]', '0.73')
  h.click('nav', '[data-view="handoff"]')
  h.click('wf-preview-handoff')
  h.click('wf-confirm-handoff')
  h.click('wf-simulate-external')
  const external = h.state.files[codePath]
  h.click('nav', '[data-view="chat"]')
  const radius = h.q('#score-orbits ellipse:last-child').getAttribute('rx')
  h.input('[data-parameter="density"][type="number"]', '0.84')
  assert.equal(
    h.q('#score-orbits ellipse:last-child').getAttribute('rx'),
    radius
  )
  h.q('[data-action="execute-edit"]').click()
  assert.equal(h.state.files[codePath], external)
  assert.equal(h.state.parameterEdits.length, 0)
  h.click('parameter-reload')
  assert.equal(h.state.parameters.base, external)
  h.input('[data-parameter="density"][type="number"]', '0.83')
  h.click('execute-edit')
  assert.match(h.state.files[codePath], /density: 0\.83/)
  assert.match(h.state.files[codePath], /Collective touch density/)
})

test('invalid parameter input never reaches the preview or a saved file', t => {
  const h = harness(t)
  h.input('[data-parameter="density"][type="number"]', '0.73')
  const radius = h.q('#score-orbits ellipse:last-child').getAttribute('rx')
  const before = durableState(h.state)
  for (const value of ['', 'NaN', '-1', '2']) {
    h.input('[data-parameter="density"][type="number"]', value)
    assert.equal(
      h.q('#score-orbits ellipse:last-child').getAttribute('rx'),
      radius
    )
    h.q('[data-action="execute-edit"]').click()
    assert.equal(durableState(h.state), before)
  }
  h.input('[data-parameter="density"][type="number"]', '0.73')
  const duration = h.q('#score-orbits').style.animationDuration
  h.input('[data-parameter="easing"][type="number"]', '0.005')
  assert.equal(h.q('#score-orbits').style.animationDuration, duration)
  assert.equal(durableState(h.state), before)
})

test('creating a different project clears temporary parameter previews and their execution history', t => {
  const h = harness(t)
  h.input('[data-parameter="density"][type="number"]', '0.73')
  h.click('execute-edit')
  h.click('project-menu')
  h.click('new-project')
  h.input('#new-name', '另一个创作工程')
  h.click('create-project')
  h.click('wf-confirm-git')
  assert.equal(h.state.parameters, null)
  assert.equal(h.state.parameterEdits.length, 0)
  assert.equal(
    h.q('#live-monitor').classList.contains('parameter-preview'),
    false
  )
  assert.notEqual(h.state.runtimeParameters?.density, 0.73)
})

test('stopping a test ends its parameter preview and restarting uses the saved values', t => {
  const h = harness(t)
  const monitor = h.q('#live-monitor')
  const runtime = JSON.stringify(h.state.runtimeParameters)
  const files = JSON.stringify(h.state.files)
  h.input('[data-parameter="density"][type="number"]', '0.73')
  h.input('[data-parameter="easing"][type="number"]', '0.055')
  h.click('runtime-toggle')
  assert.equal(h.state.running, false)
  assert.equal(h.state.parameters.active, false)
  assert.equal(h.q('#monitor-preview').hidden, true)
  assert.equal(
    h.q('#live-monitor').classList.contains('parameter-preview'),
    false
  )
  assert.equal(JSON.stringify(h.state.runtimeParameters), runtime)
  assert.equal(JSON.stringify(h.state.files), files)
  h.click('runtime-toggle')
  assert.equal(h.state.running, true)
  assert.equal(h.state.parameters.active, false)
  assert.equal(JSON.stringify(h.state.runtimeParameters), runtime)
  assert.equal(h.q('#live-monitor'), monitor)
})

test('manual refresh leaves parameter preview and adopts only the saved parameter values', t => {
  const h = harness(t)
  const monitor = h.q('#live-monitor')
  h.input('[data-parameter="density"][type="number"]', '0.73')
  h.click('refresh-monitor')
  assert.equal(h.state.parameters.active, false)
  assert.equal(h.state.runtimeParameters.density, 0.32)
  assert.equal(h.q('#monitor-preview').hidden, true)
  h.input('[data-parameter="easing"][type="number"]', '0.055')
  h.click('execute-edit')
  assert.equal(h.state.parameters.active, true)
  assert.equal(h.state.runtimeParameters.density, 0.32)
  h.click('refresh-monitor')
  assert.equal(h.state.parameters.active, false)
  assert.equal(h.state.runtimeParameters.density, 0.73)
  assert.equal(h.state.runtimeParameters.easing, 0.055)
  assert.equal(h.q('#monitor-preview').hidden, true)
  assert.equal(h.q('#live-monitor'), monitor)
})

test('discussion code edits keep one suggestion across views and preview text only on an explicit action', t => {
  const h = harness(t)
  const monitor = h.q('#live-monitor')
  const before = durableState(h.state)
  h.click('proposal-view', '[data-view="code"]')
  const code = h
    .q('#proposal-code')
    .value.replace("title: '潮汐'", "title: '共同呼吸'")
  h.input('#proposal-code', code)
  assert.equal(h.q('#score-title').textContent, '潮汐')
  assert.equal(h.state.parameters.active, false)
  assert.equal(durableState(h.state), before)
  for (const view of ['handoff', 'history', 'chat'])
    h.click('nav', `[data-view="${view}"]`)
  assert.equal(h.q('#proposal-code').value, code)
  assert.equal(h.q('#live-monitor'), monitor)
  h.click('parameter-preview')
  assert.equal(h.q('#score-title').textContent, '共同呼吸')
  assert.equal(durableState(h.state), before)
  h.input('#proposal-code', code.replace("title: '共同呼吸'", "title: ''"))
  assert.equal(h.state.parameters.active, false)
  assert.equal(
    h.q('#score-title').textContent,
    '潮汐',
    'Editing ends the old preview'
  )
  h.click('parameter-preview')
  assert.equal(
    h.q('#score-title').textContent,
    '',
    'An empty title stays empty'
  )
  h.click('refresh-monitor')
  assert.equal(h.q('#score-title').textContent, '潮汐')
  assert.equal(h.state.files[codePath], JSON.parse(before).files[codePath])
})

test('applying edited code saves the complete file and freezes nonnumeric execution differences', t => {
  const h = harness(t)
  const history = JSON.stringify(h.state.history)
  h.click('proposal-view', '[data-view="code"]')
  const code = h
    .q('#proposal-code')
    .value.replace("title: '潮汐'", "title: '<b>共同呼吸</b>'")
  h.input('#proposal-code', code)
  h.click('parameter-preview')
  assert.equal(h.q('#score-title').textContent, '<b>共同呼吸</b>')
  assert.equal(h.q('#score-title').childElementCount, 0)
  h.click('execute-edit')
  assert.equal(h.state.files[codePath], code)
  assert.equal(h.state.runtimeParameters.title, '潮汐')
  assert.equal(JSON.stringify(h.state.history), history)
  const firstDiff = h.q('[data-edit-index="0"] .diff').textContent
  assert.match(firstDiff, /title: '潮汐'/)
  assert.match(firstDiff, /title: '<b>共同呼吸<\/b>'/)
  const firstRecord = JSON.stringify(h.state.parameterEdits[0])
  const next = code.replace('<b>共同呼吸</b>', '潮间带')
  h.input('#proposal-code', next)
  h.click('execute-edit')
  assert.equal(h.state.files[codePath], next)
  assert.equal(h.state.parameterEdits.length, 2)
  assert.equal(JSON.stringify(h.state.parameterEdits[0]), firstRecord)
  assert.equal(h.q('[data-edit-index="0"] .diff').textContent, firstDiff)
  h.click('refresh-monitor')
  assert.equal(h.q('#score-title').textContent, '潮间带')
  assert.equal(JSON.stringify(h.state.history), history)
})

test('unmapped expressions and duplicate fields disable only their own parameter without overwriting code', t => {
  const h = harness(t)
  h.click('proposal-view', '[data-view="code"]')
  let code = h
    .q('#proposal-code')
    .value.replace('density: 0.56', 'density: calculateDensity()')
  h.input('#proposal-code', code)
  h.click('proposal-view', '[data-view="parameters"]')
  assert.equal(h.q('[data-parameter="density"][type="number"]').disabled, true)
  assert.equal(h.q('[data-parameter="easing"][type="number"]').disabled, false)
  assert.equal(h.q('[data-action="parameter-preview"]').disabled, true)
  h.input('[data-parameter="density"][type="number"]', '0.4')
  assert.equal(h.state.parameters.code, code)
  h.input('[data-parameter="easing"][type="number"]', '0.055')
  code = code.replace('easing: 0.035', 'easing: 0.055')
  h.click('proposal-view', '[data-view="code"]')
  assert.equal(h.q('#proposal-code').value, code)
  const previousRuntime = JSON.stringify(h.state.runtimeParameters)
  h.click('execute-edit')
  h.click('refresh-monitor')
  assert.equal(JSON.stringify(h.state.runtimeParameters), previousRuntime)
  assert.match(
    h.q('#monitor-preview').textContent,
    /其他代码未执行|not executed/
  )
  code = code.replace(
    'density: calculateDensity()',
    'density: 0.56,\n  density: 0.42'
  )
  h.input('#proposal-code', code)
  h.click('proposal-view', '[data-view="parameters"]')
  assert.equal(h.q('[data-parameter="density"][type="number"]').disabled, true)
  assert.equal(h.q('[data-parameter="easing"][type="number"]').disabled, false)
  h.click('execute-edit')
  assert.equal(h.state.files[codePath], code)
  assert.equal(h.q('[data-action="parameter-preview"]').disabled, true)
  h.click('refresh-monitor')
  assert.match(
    h.q('#monitor-preview').textContent,
    /其他代码未执行|not executed/
  )
})

test('restoring AI numeric parameters preserves handwritten text and other code and never fakes execution', t => {
  const h = harness(t, 'en')
  h.click('proposal-view', '[data-view="code"]')
  const code =
    h
      .q('#proposal-code')
      .value.replace("title: '潮汐'", "title: 'A shared breath'")
      .replace('density: 0.56', 'density: 0.8') +
    '\nwindow.demoCodeExecuted = true;\n'
  h.input('#proposal-code', code)
  assert.equal(h.q('[data-action="parameter-preview"]').disabled, true)
  h.click('parameter-reset')
  const reset = code.replace('density: 0.8', 'density: 0.56')
  assert.equal(h.q('#proposal-code').value, reset)
  h.click('proposal-view', '[data-view="parameters"]')
  h.click('proposal-view', '[data-view="code"]')
  assert.equal(h.q('#proposal-code').value, reset)
  assert.equal(h.state.parameters.active, false)
  assert.equal(h.window.demoCodeExecuted, undefined)
  h.click('execute-edit')
  h.click('refresh-monitor')
  assert.equal(h.window.demoCodeExecuted, undefined)
  assert.equal(h.q('[data-action="parameter-preview"]').disabled, true)
  assert.match(h.q('#monitor-preview').textContent, /not executed/)
})

test('a conflicting file draft blocks a handwritten suggestion without discarding either edit', t => {
  const h = harness(t)
  h.click('proposal-view', '[data-view="code"]')
  const code = h
    .q('#proposal-code')
    .value.replace("title: '潮汐'", "title: '待确认的名字'")
  h.input('#proposal-code', code)
  h.file(codePath)
  const draft = h.q('#code-editor').value + '\n// existing draft\n'
  h.input('#code-editor', draft)
  h.click('back-chat')
  assert.equal(h.q('#proposal-code').value, code)
  assert.equal(h.q('[data-action="execute-edit"]').disabled, true)
  h.q('[data-action="execute-edit"]').click()
  assert.equal(h.state.drafts[codePath], draft)
  assert.notEqual(h.state.files[codePath], code)
  assert.equal(h.state.parameters.code, code)
  assert.equal(h.state.parameterEdits.length, 0)
})
