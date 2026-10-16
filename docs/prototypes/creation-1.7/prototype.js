/* global window, document, location, URLSearchParams, setTimeout, clearTimeout, innerWidth, innerHeight */
/* 1.7 creation study. All files, model replies, Git and runtime actions are in memory. */
;(() => {
  const params = new URLSearchParams(location.search)
  const source = `// 潮汐 · Monitor score\n// A shared breath, shaped by every participant.\nconst score = {\n  density: 0.32,\n  easing: 0.08,\n  title: '潮汐',\n  radius: 140,\n  palette: ['#a4c9b8', '#d0ae78'],\n};\n\nfunction setup() {\n  createCanvas(windowWidth, windowHeight);\n  frameRate(60);\n}\n\nfunction draw() {\n  background(23, 33, 37);\n  translate(width / 2, height / 2);\n  const breath = sin(frameCount * 0.012);\n  const spread = score.radius + breath * 24;\n\n  noFill();\n  stroke(score.palette[0]);\n  for (let i = 0; i < 18; i++) {\n    const r = spread + i * 12 / (1 + score.density * 8);\n    ellipse(0, 0, r * 2, r * 1.5);\n  }\n}\n`
  const manifest = JSON.stringify(
    {
      schemaVersion: 2,
      name: '潮汐',
      version: '0.4.0',
      author: '林声',
      monitor: { entry: 'web/monitor/index.html' },
      performer: { entry: 'web/performer/index.html' },
      audio: { supportedModes: ['none', 'internal', 'external'] },
      sharedLibraries: [{ id: 'p5', version: '2.3.4' }],
    },
    null,
    2
  )
  const P = (window.P = Object.assign(window.P || {}, {
    state: {
      language: params.get('lang') === 'en' ? 'en' : 'zh-CN',
      theme: params.get('theme') || 'pond',
      activeView: 'chat',
      activeFile: 'web/monitor/sketch.js',
      projectName: '潮汐',
      projectVersion: '0.4.0',
      author: '林声',
      files: {
        'manifest.json': manifest,
        'README.md':
          '# 潮汐\n\n一部关于共同呼吸的互动乐谱。\n\n## 演出方式\n观众通过手机触摸参与，声场随触摸密度缓慢变化。\n\n## 技术说明\nMonitor 呈现共享声场；Performer 提供触摸界面。\n',
        'web/monitor/sketch.js': source,
        'web/monitor/index.html':
          '<!doctype html>\n<html>\n  <head><title>潮汐</title></head>\n  <body><script src="sketch.js"></script></body>\n</html>\n',
        'web/performer/index.html':
          '<!doctype html>\n<html lang="zh-CN">\n  <body><main id="touch-surface"></main></body>\n</html>\n',
        'server/index.js':
          "import express from 'express';\nconst app = express();\napp.use(express.static('web'));\n",
        'supercollider/source/tide.scd':
          'SynthDef(\\tide, { |out = 0, freq = 220, amp = 0.1|\n    var sound = SinOsc.ar(freq) * amp;\n    Out.ar(out, sound ! 2);\n}).add;\n',
      },
      drafts: {},
      changed: new Set(),
      catalogRefs: { p5: '2.3.4' },
      modulesAdded: {},
      handoffTasks: [],
      baseline: null,
      hasGit: true,
      history: [],
      running: true,
      audio: 'none',
      appliedAudio: 'none',
      pendingRuntime: false,
      pendingRestart: false,
      showFiles: true,
      console: false,
      input: '',
      readProject: true,
      authorized: false,
      attachment: null,
      messages: [],
      proposal: true,
      parameters: {
        base: source,
        code: source
          .replace('density: 0.32', 'density: 0.56')
          .replace('easing: 0.08', 'easing: 0.035'),
        view: 'parameters',
        values: { density: 0.56, easing: 0.035 },
        recommended: { density: 0.56, easing: 0.035 },
        active: false,
        errors: {},
      },
      runtimeCode: source,
      runtimeParameters: { density: 0.32, easing: 0.08, title: '潮汐' },
      parameterEdits: [],
      executed: null,
      showDiff: false,
      fullMonitor: false,
      find: false,
      editorMode: 'code',
      touches: 3,
      performers: [],
      modeArmed: false,
      logs: ['Monitor ready · None', 'Performer server ready · 4210'],
      undo: {},
      redo: {},
      settingsTab: 'general',
    },
    t: (zh, en) => (P.state.language === 'en' ? en : zh),
    esc: value =>
      String(value ?? '').replace(
        /[&<>"']/g,
        c =>
          ({
            '&': '&amp;',
            '<': '&lt;',
            '>': '&gt;',
            '"': '&quot;',
            "'": '&#39;',
          })[c]
      ),
  }))
  const S = P.state
  const paths = {
    chat: 'M4 4h16v12H9l-5 4V4',
    file: 'M6 3h8l4 4v14H6z M14 3v5h4',
    handoff: 'M4 5h10M4 12h8M4 19h10M16 9l4 3-4 3M12 12h8',
    changes: 'M7 3v18M4 6l3-3 3 3M17 21V3M14 18l3 3 3-3',
    history: 'M4 4v5h5M4 9a8 8 0 1 1 0 6M12 7v5l3 2',
    plus: 'M12 5v14M5 12h14',
    package: 'M3 7l9-4 9 4v10l-9 4-9-4V7M3 7l9 4 9-4M12 11v10M7 5l9 4',
    module: 'M4 4h6v6H4zM14 4h6v6h-6zM4 14h6v6H4zM17 14v6M14 17h6',
    chevron: 'M8 10l4 4 4-4',
    arrow: 'M14 6l-6 6 6 6',
    send: 'M12 20V4M6 10l6-6 6 6',
    settings:
      'M9 3h6l1 3 3 1 2 5-2 5-3 1-1 3H9l-1-3-3-1-2-5 2-5 3-1 1-3M15 12a3 3 0 1 1-6 0 3 3 0 0 1 6 0',
    more: 'M5 12h.01M12 12h.01M19 12h.01',
    play: 'M8 4l12 8-12 8V4',
    stop: 'M6 6h12v12H6z',
    refresh: 'M20 4v5h-5M4 20v-5h5M4 9a8 8 0 0 1 14-4M20 15a8 8 0 0 1-14 4',
    expand: 'M8 3H3v5M16 3h5v5M21 16v5h-5M3 16v5h5',
    code: 'M8 5l-6 7 6 7M16 5l6 7-6 7M14 3l-4 18',
    check: 'M5 12l4 4L19 6',
    search: 'M21 21l-6-6M17 10a7 7 0 1 1-14 0 7 7 0 0 1 14 0',
    close: 'M6 6l12 12M18 6L6 18',
    console: 'M4 6l6 6-6 6M12 18h8',
    folder: 'M3 6h6l2 2h10v12H3V6',
    audio: 'M4 10h4l5-5v14l-5-5H4v-4M17 8a6 6 0 0 1 0 8M20 5a10 10 0 0 1 0 14',
    link: 'M9 15l6-6M8 16l-2 2a4 4 0 0 1-6-6l4-4M16 8l2-2a4 4 0 0 1 6 6l-4 4',
    shield: 'M12 3l8 3v6c0 5-8 9-8 9s-8-4-8-9V6l8-3',
    undo: 'M4 4v6h6M4 10c5-8 16-5 16 3 0 5-6 7-10 5',
    device: 'M6 2h12v20H6zM10 18h4',
    network: 'M12 3v6M4 15V9h16v6M2 15h4v5H2zM10 15h4v5h-4zM18 15h4v5h-4z',
    book: 'M3 3h7l2 2 2-2h7v17h-7l-2 2-2-2H3V3M12 5v17',
  }
  P.icon = name =>
    `<svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="${paths[name] || paths.file}"/></svg>`
  const b = (action, label, icon = '', cls = '', extra = '') =>
    `<button type="button" data-action="${action}" class="${cls}" ${extra}>${icon ? P.icon(icon) : ''}${label}</button>`
  P.button = b
  let toastTimer, dialogTrigger, modeTimer
  P.toast = msg => {
    const el = document.querySelector('#toast')
    el.textContent = msg
    el.classList.add('show')
    clearTimeout(toastTimer)
    toastTimer = setTimeout(() => el.classList.remove('show'), 4200)
  }
  P.openDialog = (title, body, footer = '') => {
    const d = document.querySelector('#dialog')
    if (!d.open) dialogTrigger = document.activeElement
    d.innerHTML = `<header class="dialog-header"><h2 id="dialog-title" tabindex="-1">${title}</h2>${b('close-dialog', P.icon('close'), '', 'icon-button', `aria-label="${P.t('关闭', 'Close')}"`)}</header><div class="dialog-body">${body}</div><footer class="dialog-actions">${footer}</footer>`
    if (!d.open) d.showModal()
    d.querySelector('#dialog-title').focus()
  }
  P.closeDialog = () => {
    document.querySelector('#dialog').close()
    if (dialogTrigger?.isConnected) dialogTrigger.focus()
  }
  P.markChanged = (path, text) => {
    S.files[path] = text
    S.changed.add(path)
    S.checked = false
    if (!path.endsWith('.md') && !path.startsWith('docs/'))
      S.pendingRuntime = true
    if (
      path === 'manifest.json' ||
      path.startsWith('server/') ||
      path.startsWith('supercollider/')
    )
      S.pendingRestart = true
  }
  P.openFile = path => {
    if (!(path in S.files)) {
      P.toast(
        P.t(
          '此资源只显示变化摘要。',
          'This resource has a change summary only.'
        )
      )
      return
    }
    S.activeFile = path
    S.activeView = 'file'
    S.editorMode = 'code'
    P.render()
  }
  S.history = [
    {
      id: '7c4e2a1',
      message: '建立潮汐的初始声场',
      author: S.author,
      time: '2026-10-15 10:24',
      files: Object.keys(S.files),
      snapshot: { ...S.files },
    },
  ]
  window.initWorkflows?.(P)
  P.initCatalogs?.()
  const nav = (id, zh, en, ic, count = '') =>
    b(
      'nav',
      `${P.t(zh, en)}${count ? `<span class="count">${count}</span>` : ''}`,
      ic,
      `nav-button ${S.activeView === id ? 'active' : ''}`,
      `data-view="${id}"`
    )
  function sidebar() {
    return `<div class="traffic" aria-label="macOS window controls"><span></span><span></span><span></span></div>${b('project-menu', `${P.esc(S.projectName)}${P.icon('chevron')}`, '', 'project-title')}<div class="project-sub">${P.t('互动数字乐谱', 'Interactive score')} <span>v${P.esc(S.projectVersion)}</span></div><nav class="nav-group" aria-label="${P.t('工作区', 'Workspace')}">${nav('chat', '创作讨论', 'Discussion', 'chat')}${nav('handoff', '创作交接', 'Handoff', 'handoff', S.handoffTasks.length || '')}${nav('changes', '查看变化', 'Changes', 'changes', S.changed.size || '')}${nav('history', '版本记录', 'Versions', 'history')}</nav><div class="section-label"><span>${P.t('工程文件', 'Project files')}</span>${b('quick-open', '', 'search', 'icon-button small', `aria-label="${P.t('快速打开文件', 'Quick open')}" title="⌘ P"`)}</div><div class="file-tree">${Object.keys(
      S.files
    )
      .map(
        (path, i) =>
          `${i === 2 || (path.startsWith('modules/') && !Object.keys(S.files)[i - 1]?.startsWith('modules/')) ? `<div class="tree-folder">${path.startsWith('modules/') ? 'modules' : P.t('源码与资源', 'Source & assets')}</div>` : ''}<button class="tree-file ${S.activeView === 'file' && S.activeFile === path ? 'active' : ''}" data-action="open-file" data-path="${P.esc(path)}" title="${P.esc(path)}"><span class="file-type">${path.endsWith('.js') ? 'JS' : path.endsWith('.md') ? 'M' : path.endsWith('.json') ? '{}' : path.endsWith('.scd') ? 'SC' : '◇'}</span><span>${P.esc(path.split('/').pop())}</span>${S.drafts[path] !== undefined ? '<span class="count warning">●</span>' : S.changed.has(path) ? '<span class="count">M</span>' : ''}</button>`
      )
      .join(
        ''
      )}</div><div class="sidebar-foot"><div class="section-label" style="margin-top:3px">${P.t('添加到工程', 'Add to project')}</div>${b('catalog-packages', P.t('App 共享包', 'App shared packages'), 'package', 'nav-button')}${b('catalog-modules', P.t('标准技术模块', 'Standard modules'), 'module', 'nav-button')}</div>`
  }
  const parameterPath = 'web/monitor/sketch.js'
  const parameterMeta = {
    density: {
      min: 0.1,
      max: 1,
      step: 0.01,
      label: ['圆环密度', 'Ring density'],
    },
    easing: {
      min: 0.01,
      max: 0.15,
      step: 0.005,
      label: ['缓动速度', 'Easing speed'],
    },
  }
  function mappedField(text, key) {
    const matches = [
      ...String(text || '').matchAll(
        new RegExp(`^(  ${key}:\\s*)([^\\n]*?)(,\\s*)$`, 'gm')
      ),
    ]
    return matches.length === 1 ? matches[0] : null
  }
  function mappedNumber(text, key) {
    const match = mappedField(text, key)
    if (!match || !/^\d+(?:\.\d+)?$/.test(match[2])) return null
    const value = Number(match[2]),
      limits = parameterMeta[key]
    return value >= limits.min && value <= limits.max ? value : null
  }
  function readParameters(text) {
    const result = {}
    for (const key of Object.keys(parameterMeta)) {
      const value = mappedNumber(text, key)
      if (value === null) return null
      result[key] = value
    }
    return result
  }
  function readTitle(text) {
    const match = mappedField(text, 'title')
    if (!match) return null
    if (/^'[^'\\\n]*'$/.test(match[2])) return match[2].slice(1, -1)
    try {
      const value = JSON.parse(match[2])
      return typeof value === 'string' ? value : null
    } catch {
      return null
    }
  }
  function previewValues(text) {
    const values = readParameters(text),
      title = readTitle(text)
    return values && title !== null ? { ...values, title } : null
  }
  function replaceParameter(text, key, value) {
    const match = mappedField(text, key)
    if (!match) return text
    return (
      text.slice(0, match.index) +
      match[1] +
      value +
      match[3] +
      text.slice(match.index + match[0].length)
    )
  }
  function normalizedPreviewCode(text) {
    return ['density', 'easing', 'title'].reduce(
      (result, key) => replaceParameter(result, key, '<preview-value>'),
      text
    )
  }
  function canPreviewProposal() {
    return Boolean(
      S.parameters &&
      previewValues(S.parameters.code) &&
      normalizedPreviewCode(S.parameters.code) === normalizedPreviewCode(source)
    )
  }
  function parameterProblem() {
    if (!S.parameters)
      return P.t('当前没有可编辑建议。', 'No editable suggestion here.')
    if (
      S.drafts[parameterPath] !== undefined ||
      S.diskConflicts?.[parameterPath]
    )
      return P.t(
        '文件有草稿，请先处理后再应用修改。',
        'Resolve the file draft before applying changes.'
      )
    if (S.files[parameterPath] !== S.parameters.base)
      return P.t(
        '文件已变化，请按当前文件重新载入建议。',
        'The file changed. Reload the suggestion from the current file.'
      )
    if (Object.keys(S.parameters.errors).length)
      return P.t(
        '请修正超出范围或留空的参数。',
        'Fix empty or out-of-range parameters.'
      )
    if (!S.parameters.code.trim())
      return P.t(
        '建议为空，请填写代码后再应用。',
        'Enter code before applying this suggestion.'
      )
    return ''
  }
  function parameterApplied() {
    return S.parameters?.code === S.files[parameterPath]
  }
  function parameterStatus() {
    const problem = parameterProblem()
    if (problem) return problem
    if (!canPreviewProposal())
      return P.t(
        '代码已保留；有未适配的改动，应用后请手动测试。',
        'Code kept. These changes are not mapped for preview; apply and test manually.'
      )
    if (!S.running)
      return P.t(
        '建议已保留；手动启动测试后可预演。',
        'Suggestion kept. Start testing manually to preview.'
      )
    if (S.parameters.active)
      return parameterApplied()
        ? P.t('正在预演 · 已应用到文件', 'Previewing · applied to file')
        : P.t(
            '正在预演 · 尚未应用到工程',
            'Previewing · not applied to the project'
          )
    return parameterApplied()
      ? P.t('已应用到文件 · 可继续修改', 'Applied to file · keep refining')
      : S.parameters.view === 'code'
        ? P.t(
            '待应用 · 编辑不会运行代码；点击“预演修改”查看效果。',
            'Not applied · editing does not execute code. Choose “Preview changes” to inspect the result.'
          )
        : P.t(
            '拖动或输入数值，立即在右侧预演',
            'Drag or enter a value to preview on the right'
          )
  }
  function actualEditDiff(before, after) {
    const left = before.split('\n'),
      right = after.split('\n')
    let start = 0,
      endLeft = left.length,
      endRight = right.length
    while (start < endLeft && start < endRight && left[start] === right[start])
      start++
    while (
      endLeft > start &&
      endRight > start &&
      left[endLeft - 1] === right[endRight - 1]
    ) {
      endLeft--
      endRight--
    }
    return (
      left
        .slice(start, endLeft)
        .map(line => `<div class="remove-line">− ${P.esc(line)}</div>`)
        .join('') +
      right
        .slice(start, endRight)
        .map(line => `<div class="add-line">+ ${P.esc(line)}</div>`)
        .join('')
    )
  }
  function parameterCard() {
    const params = S.parameters
    if (!params) return ''
    const fields = Object.entries(parameterMeta)
      .map(([key, meta]) => {
        const mapped = mappedNumber(params.code, key) !== null
        return `<div class="parameter-row"><div class="row between"><label for="parameter-${key}">${P.t(...meta.label)}</label><span class="muted">${P.t('AI 建议', 'AI suggestion')} ${params.recommended[key]}</span></div><div class="parameter-controls"><input type="range" data-parameter="${key}" min="${meta.min}" max="${meta.max}" step="${meta.step}" value="${params.values[key]}" aria-label="${P.t(...meta.label)} ${P.t('滑块', 'slider')}" ${mapped ? '' : 'disabled'}><input id="parameter-${key}" type="number" data-parameter="${key}" min="${meta.min}" max="${meta.max}" step="${meta.step}" value="${params.values[key]}" aria-describedby="parameter-status" ${mapped ? '' : 'disabled'}></div><div class="parameter-range"><span>${meta.min}</span><span>${meta.max}</span></div>${mapped ? '' : `<p class="parameter-unmapped">${P.t('代码不再是可直接调节的数值；请在代码中继续编辑。', 'This code is no longer a mapped numeric value. Continue editing in Code.')}</p>`}</div>`
      })
      .join('')
    const records = S.parameterEdits
      .map(
        (edit, i) =>
          `<section class="parameter-diff-record" data-edit-index="${i}"><div class="proposal-head"><span>${P.t('已应用', 'Applied')} ${i + 1}</span><span class="muted">${P.t('执行时的只读差异', 'Read-only execution diff')}</span></div><div class="diff" aria-label="${P.t('实际保存差异', 'Actual saved difference')}">${actualEditDiff(edit.before, edit.after)}</div></section>`
      )
      .join('')
    const codeView = params.view === 'code'
    const controls = `<div class="proposal-mode row" role="group" aria-label="${P.t('修改方式', 'Edit mode')}">${b('proposal-view', P.t('参数', 'Parameters'), '', 'small', `data-view="parameters" aria-pressed="${!codeView}"`)}${b('proposal-view', P.t('代码', 'Code'), 'code', 'small', `data-view="code" aria-pressed="${codeView}"`)}</div>`
    const content = codeView
      ? `<label class="proposal-code-label" for="proposal-code">${P.t('直接修改建议代码', 'Edit the suggested code')} <span class="muted">${P.t('完整单文件 · 修改建议', 'Full single file · suggested changes')}</span></label><textarea id="proposal-code" class="proposal-code" spellcheck="false" aria-describedby="parameter-status proposal-code-scope">${P.esc(params.code)}</textarea><p id="proposal-code-scope" class="muted proposal-code-scope">${P.t('试试修改 title 中的文字。此演示仅映射 density、easing、title；其他代码应用后需手动测试。', 'Try changing the text in title. This demo maps only density, easing and title; other code requires manual testing after applying.')}</p>`
      : `<div class="parameter-fields">${fields}</div><p class="muted proposal-code-scope">${P.t('文字、条件或其他代码也可以直接修改。', 'Edit text, conditions or other code directly.')}${b('proposal-view', P.t('编辑代码', 'Edit code'), 'code', 'small', 'data-view="code"')}</p>`
    return `<div class="proposal parameter-proposal"><div class="proposal-head"><span class="row">${P.icon('code')}<code>${parameterPath}</code></span><span class="badge accent" id="proposal-state">${parameterApplied() ? P.t('已应用', 'Applied') : P.t('待应用建议', 'Editable suggestion')}</span></div><div class="proposal-body"><p>${P.t('调参数，或直接改代码。先试用，再应用到工程。', 'Adjust parameters or edit code. Try the result, then apply to the project.')}</p>${controls}${content}<p class="parameter-status" id="parameter-status" role="status">${parameterStatus()}</p></div><div class="proposal-footer"><div class="row">${b('parameter-reset', P.t('恢复 AI 参数', 'Reset AI parameters'), '', 'small', readParameters(params.code) ? '' : 'disabled')}${b('parameter-preview', P.t(codeView ? '预演修改' : '预演建议', codeView ? 'Preview changes' : 'Preview suggestion'), 'play', 'small', S.running && canPreviewProposal() ? '' : 'disabled')}${b('parameter-stop', P.t('结束预演', 'End preview'), '', 'small', params.active ? '' : 'disabled')}</div>${b('execute-edit', P.t('应用到工程', 'Apply to project'), 'check', 'primary small', parameterProblem() || parameterApplied() ? 'disabled' : '')}</div>${S.parameterEdits.length ? `<div class="proposal-footer">${b('toggle-diff', P.t(S.showDiff ? '收起实际差异' : '查看实际差异', S.showDiff ? 'Hide actual diff' : 'View actual diff'), 'changes', 'small')}<div class="row">${b('undo-ai', P.t('撤销最近修改', 'Undo latest edit'), 'undo', 'small', S.files[parameterPath] !== S.executed?.after ? 'disabled' : '')}${b('open-file', P.t('当前文件', 'Current file'), 'code', 'secondary small', `data-path="${parameterPath}"`)}</div></div>${S.showDiff ? records : ''}` : ''}${S.files[parameterPath] !== params.base ? `<div class="proposal-footer">${b('parameter-reload', P.t('放弃待应用修改并重载', 'Discard suggestion and reload'), 'refresh', 'secondary small')}</div>` : ''}</div>`
  }
  function syncParameterControls() {
    if (!S.parameters) {
      updateMonitorArt()
      return
    }
    const problem = parameterProblem()
    const status = document.querySelector('#parameter-status')
    if (status) status.textContent = parameterStatus()
    const badge = document.querySelector('#proposal-state')
    if (badge)
      badge.textContent = parameterApplied()
        ? P.t('已应用', 'Applied')
        : P.t('待应用建议', 'Editable suggestion')
    const apply = document.querySelector('[data-action="execute-edit"]')
    if (apply) apply.disabled = Boolean(problem || parameterApplied())
    const stop = document.querySelector('[data-action="parameter-stop"]')
    if (stop) stop.disabled = !S.parameters.active
    const preview = document.querySelector('[data-action="parameter-preview"]')
    if (preview)
      preview.disabled = Boolean(problem || !S.running || !canPreviewProposal())
    const reset = document.querySelector('[data-action="parameter-reset"]')
    if (reset) reset.disabled = !readParameters(S.parameters.code)
    document.querySelectorAll('[data-parameter]').forEach(input => {
      input.setAttribute(
        'aria-invalid',
        String(Boolean(S.parameters.errors[input.dataset.parameter]))
      )
      input.disabled =
        mappedNumber(S.parameters.code, input.dataset.parameter) === null
    })
    updateMonitorArt()
  }
  function inputParameter(input) {
    const key = input.dataset.parameter,
      meta = parameterMeta[key]
    if (!meta || !S.parameters || mappedNumber(S.parameters.code, key) === null)
      return
    const value = Number(input.value)
    if (
      input.value.trim() === '' ||
      !Number.isFinite(value) ||
      value < meta.min ||
      value > meta.max
    ) {
      S.parameters.errors[key] = true
      syncParameterControls()
      return
    }
    Reflect.deleteProperty(S.parameters.errors, key)
    S.parameters.values[key] = value
    S.parameters.code = replaceParameter(S.parameters.code, key, value)
    document.querySelectorAll(`[data-parameter="${key}"]`).forEach(other => {
      if (other !== input) other.value = String(value)
    })
    if (!parameterProblem() && S.running && canPreviewProposal()) {
      S.parameters.active = true
      S.parameters.previewValues = previewValues(S.parameters.code)
    }
    syncParameterControls()
  }
  function inputProposalCode(input) {
    S.parameters.code = input.value
    S.parameters.errors = {}
    S.parameters.active = false
    for (const key of Object.keys(parameterMeta)) {
      const value = mappedNumber(input.value, key)
      if (value !== null) S.parameters.values[key] = value
    }
    syncParameterControls()
  }
  function applyParameters() {
    const problem = parameterProblem()
    if (problem) {
      P.toast(problem)
      return
    }
    if (parameterApplied()) return
    const before = S.files[parameterPath],
      after = S.parameters.code
    S.parameters.base = after
    P.markChanged(parameterPath, after)
    S.executed = { before, after }
    S.parameterEdits.push({ ...S.executed })
    S.showDiff = true
    P.render()
    P.toast(
      P.t(
        '建议已应用到文件；请手动刷新或测试，版本尚未记录。',
        'Suggestion applied to the file. Refresh or test manually; no version recorded.'
      )
    )
  }

  function initialChat() {
    if (S.newProjectCreated)
      return `<h1 class="conversation-title">${P.t('从一个想法开始', 'Start with an idea')}</h1><p class="conversation-meta">${P.esc(S.projectName)} · ${S.projectTemplate === 'classic' ? 'Classic' : 'Blank'}</p><article class="message"><div class="speaker"><span class="assistant-mark">✦</span>${P.t('创作助手', 'Creation assistant')}</div><p>${P.t('工程和初始版本已经建立。你希望观众听见什么、看见什么，又以什么方式参与？我们可以先把想法聊清楚，再决定哪些地方直接调整，哪些任务交给外部编程智能体。', 'Your project and its initial version are ready. What should the audience hear, see, and do? Let’s shape the idea, then decide which changes belong here and which need an external coding agent.')}</p></article>`
    return `<h1 class="conversation-title">${P.t('让声场跟随观众的呼吸', 'Let the sound follow the audience')}</h1><p class="conversation-meta">${P.t('潮汐的创作讨论', 'A discussion about 潮汐')} · ${P.t('今天', 'Today')}</p><article class="message user"><p>${P.t('想让观众触摸时，圆环更密一些，但变化不要太突然。先保留安静、缓慢的感觉。', 'I want denser rings when the audience touches, with a gentle transition. Keep the quiet, unhurried feeling.')}</p></article><article class="message"><div class="speaker"><span class="assistant-mark">✦</span>${P.t('创作助手', 'Creation assistant')}</div><p>${P.t('可以先调整视觉的密度与缓动，保留现在的声部和演出结构。这样你能一边看右侧画面，一边比较呼吸感。', 'We can adjust the visual density and easing while keeping the current voices and performance structure. Compare the feeling in the live monitor.')}</p>${parameterCard()}<div class="source-row">${P.t('依据', 'Sources')}${b('open-file', 'sketch.js', '', '', 'data-path="web/monitor/sketch.js"')}${b('open-file', 'README.md', '', '', 'data-path="README.md"')}<span>${P.t('工程保存版', 'Saved project')}</span></div></article>`
  }
  function chat() {
    return `<div class="chat">${initialChat()}${S.messages.map(m => `<article class="message ${m.role === 'user' ? 'user' : ''}">${m.role !== 'user' ? `<div class="speaker"><span class="assistant-mark">✦</span>${P.t('创作助手', 'Creation assistant')}</div>` : ''}<p>${P.esc(m.text).replace(/\n/g, '<br>')}</p>${m.attachment ? `<div class="source-row">${P.icon('code')}${P.esc(m.attachment.path)}:${m.attachment.start}–${m.attachment.end} ${m.attachment.unsaved ? P.t('未保存快照', 'Draft snapshot') : P.t('保存版快照', 'Saved snapshot')}</div>` : ''}${m.handoff ? `<div class="suggestions">${b('wf-preview-handoff', P.t('预览交接任务', 'Preview handoff'), 'handoff', 'secondary')}</div>` : ''}</article>`).join('')}<div class="suggestions">${b('discuss-multi', P.t('加入手机触摸的互动', 'Add phone interaction'), '')}${b('catalog-modules', P.t('有哪些可用的技术模块？', 'Explore standard modules'), '')}${b('checks', P.t('检查现在的工程', 'Check this project'), '')}</div></div>`
  }
  function composer() {
    return `${S.attachment ? `<div class="attachment">${P.icon('code')}<span class="grow"><b>${P.esc(S.attachment.path.split('/').pop())}</b> : ${S.attachment.start}–${S.attachment.end} <span>${S.attachment.unsaved ? P.t('未保存', 'Unsaved') : P.t('保存版', 'Saved')}</span></span>${b('view-attachment', P.t('查看', 'View'), '', 'small')}${b('remove-attachment', '', 'close', 'icon-button small', `aria-label="${P.t('移除附件', 'Remove attachment')}"`)}</div>` : ''}${S.attachment && !S.readProject ? `<div class="attachment-block">${P.t('启用“读取当前工程”或移除片段后才能发送。', 'Enable project reading or remove the snippet before sending.')}</div>` : ''}<textarea id="chat-input" aria-label="${P.t('向创作助手提问', 'Message creation assistant')}" placeholder="${P.t('描述你的想法，或选一段代码来讨论…', 'Describe an idea, or select code to discuss…')}">${P.esc(S.input)}</textarea><div class="composer-foot"><div class="row"><label class="toggle"><input id="read-project" type="checkbox" ${S.readProject ? 'checked' : ''}>${P.t('读取当前工程', 'Read project')}</label>${b('context-scope', P.t('范围', 'Scope'), 'shield', 'small')}</div><div class="row">${b('model-settings', 'Creative model', '', 'small')}${b('send-message', '', 'send', 'primary send', `aria-label="${P.t('发送', 'Send')}"`)}</div></div>`
  }
  function highlight(text) {
    return (
      text
        .split('\n')
        .map(line => {
          if (line.trim().startsWith('//'))
            return `<span class="tok-comment">${P.esc(line)}</span>`
          return line
            .split(
              /(\b(?:const|function|let|import|from|return|for|var)\b|\b\d+(?:\.\d+)?\b)/g
            )
            .map(part => {
              const cls =
                /^(const|function|let|import|from|return|for|var)$/.test(part)
                  ? 'tok-key'
                  : /^\d+(?:\.\d+)?$/.test(part)
                    ? 'tok-num'
                    : ''
              return cls
                ? `<span class="${cls}">${P.esc(part)}</span>`
                : P.esc(part)
            })
            .join('')
        })
        .join('\n') + '\n'
    )
  }
  function fileView() {
    const path = S.activeFile
    const text = S.drafts[path] ?? S.files[path] ?? ''
    const draft = S.drafts[path] !== undefined
    return `<div class="editor-wrap"><div class="editor-tools"><div class="editor-path">${P.esc(path)} ${draft ? `<span class="badge warn">${P.t('未保存', 'Unsaved')}</span>` : ''}</div><div class="row">${b('editor-more', '', 'more', 'icon-button', `aria-label="${P.t('文件操作', 'File actions')}"`)}${path.endsWith('.md') ? b('toggle-readme', S.editorMode === 'preview' ? P.t('编辑', 'Edit') : P.t('预览', 'Preview'), 'book', 'small') : ''}${path === 'manifest.json' ? b('manifest-form', P.t('表单', 'Form'), '', 'small') : ''}${path.endsWith('.scd') ? b('compile', P.t('编译 SynthDef', 'Compile SynthDef'), '', 'secondary small') : ''}${b('save-file', P.t('保存', 'Save'), '', 'primary small', draft ? '' : 'disabled')}</div></div>${S.find ? `<div class="find-bar"><input id="find-value" aria-label="Find" placeholder="${P.t('查找', 'Find')}"><input id="replace-value" aria-label="Replace" placeholder="${P.t('替换', 'Replace')}">${b('find-next', P.t('下一个', 'Next'), '', 'small')}${b('replace-one', P.t('替换', 'Replace'), '', 'small')}${b('find-close', '', 'close', 'icon-button small', `aria-label="${P.t('关闭查找', 'Close find')}"`)}</div>` : ''}${
      S.editorMode === 'preview'
        ? `<div class="markdown-preview"><h1>${P.esc(S.projectName)}</h1><p>${P.t('一部关于共同呼吸的互动乐谱。', 'An interactive score about breathing together.')}</p><h2>${P.t('演出方式', 'Performance')}</h2><p>${P.t('观众通过手机触摸参与，声场随触摸密度缓慢变化。', 'The audience participates through touch; the sound changes gradually with touch density.')}</p><hr><p class="muted">${P.t('README 保存内容', 'Saved README')}</p><pre style="white-space:pre-wrap;font-size:12px">${P.esc(text)}</pre></div>`
        : `<div class="editor-content"><div class="line-numbers" aria-hidden="true">${text
            .split('\n')
            .map((_, i) => i + 1)
            .join(
              '\n'
            )}</div><div class="code-scroll"><pre class="code-highlight" aria-hidden="true">${highlight(text)}</pre><textarea id="code-editor" aria-label="${P.esc(path)}" spellcheck="false" wrap="off">${P.esc(text)}</textarea></div></div>`
    }<div class="editor-tools"><div class="row">${b('editor-undo', '', 'undo', 'icon-button', `aria-label="${P.t('撤销编辑', 'Undo draft edit')}"`)}${b('find-open', P.t('查找', 'Find'), 'search', 'small')}${b('go-line', P.t('跳转行', 'Go to line'), '', 'small')}</div>${b('attach-selection', P.t('选中代码问助手', 'Ask about selection'), 'chat', 'secondary small')}</div><div class="editor-status"><span id="cursor-status">Ln 1, Col 1</span><span>${path.split('.').pop().toUpperCase()} · UTF-8 · ${P.t('缩进 2 空格', '2 spaces')}</span></div></div>`
  }
  function header() {
    let title = {
      chat: P.t('创作讨论', 'Discussion'),
      file: S.activeFile.split('/').pop(),
      handoff: P.t('创作交接', 'Handoff'),
      changes: P.t('查看变化', 'Changes'),
      history: P.t('版本记录', 'Versions'),
    }[S.activeView]
    return `${S.activeView !== 'chat' ? b('back-chat', '', 'arrow', 'icon-button', `aria-label="${P.t('返回讨论', 'Back to discussion')}"`) : P.icon('chat')}<span class="title">${P.esc(title)}</span><span class="grow"></span>${S.activeView === 'chat' ? b('overview', `<span class="dot"></span>${P.t('工程概况', 'Project overview')}`, '', 'small') : ''}${b('checks', '', 'shield', 'icon-button', `title="${P.t('检查工程', 'Project checks')}" aria-label="${P.t('检查工程', 'Project checks')}"`)}`
  }
  function art() {
    return `<div class="score" id="live-monitor" tabindex="0" role="button" aria-label="${P.t('互动 Monitor，点击模拟观众触摸', 'Interactive monitor, click to simulate touch')}"><div class="score-head"><span>林声 / 2026</span><span id="score-scene">${P.t('第一乐章 · 潮起', 'Movement I · Rising tide')}</span></div><h2><span id="score-title">潮汐</span><span>TIDELINES</span></h2><svg class="score-art" viewBox="0 0 420 330" role="img" aria-label="${P.t('由环形线条组成的数字乐谱', 'A circular digital score')}"><path class="axis" d="M30 165h360M210 30v270"/><g id="score-orbits">${Array.from({ length: 20 }, (_, i) => `<ellipse class="orbit" cx="${210 + Math.sin(i * 0.4) * 6}" cy="165" rx="${63 + i * 5.1}" ry="${42 + i * 4.7}" transform="rotate(${i * 2.4 - 25} 210 165)"/>`).join('')}</g><path d="M40 165 Q90 105 140 165 T240 165 T340 165 L380 165" fill="none" stroke="#c7ad7e" stroke-width="1.2"/><circle class="pulse" id="touch-dot" cx="269" cy="109" r="4"/><circle cx="210" cy="165" r="2" fill="#dbebe2"/></svg><div class="score-caption"><span>Ⅰ — breathe slowly</span><span id="touch-count">03 touches</span></div><div class="score-timeline"></div><div class="score-foot"><span>01:24 / open duration</span><span id="density-label">density 0.32</span></div></div>`
  }
  function monitorShell() {
    return `<header class="pane-header"><span class="title">${P.t('实时画面', 'Live monitor')}</span><span class="badge">Monitor</span><span class="grow"></span>${b('refresh-monitor', '', 'refresh', 'icon-button', `title="${P.t('刷新画面', 'Refresh monitor')}" aria-label="${P.t('刷新画面', 'Refresh monitor')}"`)}${b('expand-monitor', '', 'expand', 'icon-button', `title="${P.t('展开／还原', 'Expand / restore')}" aria-label="${P.t('展开／还原', 'Expand / restore')}"`)}</header><div class="monitor-preview" id="monitor-preview" hidden></div><div class="monitor-notice" id="monitor-notice"></div><div class="monitor-body">${art()}</div><div class="monitor-controls" id="monitor-controls"></div><div class="performers" id="performers"></div><div class="monitor-status"><span class="muted">${P.t('画面由工程提供', 'Rendered by the project')}</span>${b('monitor-more', P.t('显示选项', 'View options'), 'chevron', 'small')}</div>`
  }
  function monitorUpdate() {
    const heading = document.querySelector('#live-monitor h2')
    heading.querySelector('span:last-child').textContent = S.newProjectCreated
      ? P.t('等待启动测试', 'READY FOR TEST')
      : 'TIDELINES'
    document.querySelector('#monitor-notice').className =
      `monitor-notice ${S.pendingRuntime ? 'visible' : ''}`
    document.querySelector('#monitor-notice').textContent = S.pendingRestart
      ? P.t(
          '运行配置已变化 · 手动停止并重新启动后应用',
          'Runtime configuration changed · stop and start manually to apply'
        )
      : P.t(
          '保存版已变化 · 画面仍在运行之前的内容',
          'Saved files changed · monitor is showing the previous run'
        )
    document.querySelector('#monitor-controls').innerHTML =
      `${b('runtime-toggle', S.running ? P.t('停止', 'Stop') : P.t('启动测试', 'Start test'), S.running ? 'stop' : 'play', 'secondary small')}<span class="badge ${S.running ? 'good' : ''}">${S.running ? P.t('运行中', 'Running') : P.t('已停止', 'Stopped')}</span><span class="grow"></span>${b('audio-mode', `${P.t('音频', 'Audio')}: ${S.audio === 'none' ? 'None' : S.audio === 'internal' ? 'Internal' : 'External'}`, 'audio', 'small')}<span class="small-text muted">${S.running && S.audio !== S.appliedAudio ? P.t('下次启动生效', 'Next start') : ''}</span>`
    document.querySelector('#performers').innerHTML =
      `<div class="row between"><span class="small-text muted">${P.t('Performer 测试窗口', 'Performer test windows')}</span>${b('add-performer', P.t('添加', 'Add'), 'plus', 'small')}</div>${S.performers.length ? S.performers.map((_, i) => `<div class="performer-row"><span class="device"></span><span>${P.t('测试窗口', 'Test window')} ${i + 1}</span><span class="badge good">${P.t('已打开', 'Open')}</span><span class="grow"></span>${b('focus-performer', P.t('显示', 'Show'), '', 'small', `data-index="${i}"`)}</div>`).join('') : `<div class="performer-row muted">${P.t('添加一个手机或平板，体验互动。', 'Add a phone or tablet to try the interaction.')}</div>`}`
    document.querySelector('#live-monitor').style.opacity = S.running
      ? '1'
      : '.45'
    document
      .querySelector('#app')
      .classList.toggle('full-monitor', S.fullMonitor)
  }
  function bottom() {
    return `${b('audio-settings', P.t('主输出', 'Master output'), 'audio')}<input class="volume-range" type="range" aria-label="${P.t('主音量', 'Master volume')}" min="0" max="100" value="75"><span class="bottom-separator"></span>${b('device-settings', 'MacBook Pro · 48 kHz', '', 'device-summary')}${b('network-settings', P.t('本机节点', 'Local node'), 'network')}<span class="grow"></span>${b('console-toggle', P.t('控制台', 'Console'), 'console', S.console ? 'selected' : '')}${b('settings', P.t('设置', 'Settings'), 'settings')}<span class="bottom-separator"></span><button class="mode-button ${S.modeArmed ? 'armed' : ''}" data-action="mode-switch"><span>${S.modeArmed ? P.t('再次点击 → 演出', 'Click again → Perform') : P.t('创作模式', 'Creation mode')}</span></button>`
  }
  function guide() {
    return `<strong>${P.t('1.7.0 交互原型', '1.7.0 prototype')}</strong><span class="hint">${P.t('内存演示', 'In-memory demo')}</span>${b('guide-chat', P.t('① 对话改码', '① Discuss & edit'), '', 'small')}${b('guide-add', P.t('② 添加能力', '② Add capabilities'), '', 'small')}${b('guide-handoff', P.t('③ 交接与记录', '③ Handoff & versions'), '', 'small')}<span class="spacer"></span>${b('demo-state', P.t('演示状态', 'Demo state'), '', 'small')}${b('theme-menu', S.theme[0].toUpperCase() + S.theme.slice(1), '', 'small')}${b('language', S.language === 'en' ? '中文' : 'EN', '', 'small')}`
  }
  function mount() {
    document.documentElement.dataset.theme = S.theme
    document.querySelector('#app').innerHTML =
      `<div class="workspace"><aside class="sidebar" id="sidebar"></aside><div class="stage"><section class="main-pane"><header class="pane-header" id="main-header"></header><main class="main-content" id="main-content"></main><div class="composer" id="composer"></div><div id="console-root"></div></section><div class="splitter" role="separator" aria-label="${P.t('调整工作区与画面宽度；左右箭头调整，双击复位', 'Resize workspace and monitor; arrows adjust, double-click resets')}" aria-orientation="vertical" aria-valuemin="30" aria-valuemax="48" aria-valuenow="40" tabindex="0"></div><aside class="monitor-pane" id="monitor-pane">${monitorShell()}</aside></div></div><footer class="bottom-bar" id="bottom-bar"></footer><div class="prototype-bar" id="prototype-bar"></div>`
    bindSplitter()
    document
      .querySelector('#live-monitor')
      .addEventListener('click', () => touch())
    document.querySelector('#live-monitor').addEventListener('keydown', e => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault()
        touch()
      }
    })
    P.render()
  }
  P.render = () => {
    if (
      S.parameters &&
      (S.parameters.base !== S.files[parameterPath] ||
        S.drafts[parameterPath] !== undefined ||
        S.diskConflicts?.[parameterPath] ||
        !S.running)
    )
      S.parameters.active = false
    document.documentElement.dataset.theme = S.theme
    document.documentElement.lang = S.language
    document.querySelector('#sidebar').innerHTML = sidebar()
    document.querySelector('#main-header').innerHTML = header()
    document.querySelector('#main-content').innerHTML =
      S.activeView === 'chat'
        ? chat()
        : S.activeView === 'file'
          ? fileView()
          : `<div class="content-pad">${P.workflowView?.(S.activeView) || ''}</div>`
    const c = document.querySelector('#composer')
    c.hidden = S.activeView !== 'chat'
    c.innerHTML = composer()
    document.querySelector('#console-root').innerHTML = S.console
      ? `<section class="console-dock"><header class="console-head"><span>${P.t('运行控制台', 'Runtime console')}</span>${b('console-toggle', '', 'close', 'icon-button small', `aria-label="${P.t('关闭控制台', 'Close console')}"`)}</header><div class="console-lines">${S.logs.map(l => `<div><span>[info]</span> ${P.esc(l)}</div>`).join('')}</div></section>`
      : ''
    document.querySelector('#bottom-bar').innerHTML = bottom()
    document.querySelector('#prototype-bar').innerHTML = guide()
    monitorUpdate()
    syncParameterControls()
    bindEditor()
  }
  function touch() {
    if (!S.running) return
    S.touches++
    document.querySelector('#touch-count').textContent =
      String(S.touches).padStart(2, '0') + ' touches'
    document
      .querySelector('#touch-dot')
      .setAttribute('cx', 180 + ((S.touches * 17) % 110))
    document
      .querySelector('#touch-dot')
      .setAttribute('cy', 105 + ((S.touches * 11) % 100))
  }
  function updateMonitorArt() {
    const preview = Boolean(S.parameters?.active && S.running)
    const values = preview ? S.parameters.previewValues : S.runtimeParameters
    const density = values?.density || 0.32,
      easing = values?.easing || 0.08
    document.querySelectorAll('#live-monitor .orbit').forEach((orbit, i) => {
      orbit.setAttribute('rx', 63 + (i * 9) / (1 + density * 2.4))
      orbit.setAttribute('ry', 42 + (i * 8.3) / (1 + density * 2.4))
    })
    document
      .querySelector('#live-monitor')
      .classList.toggle('parameter-preview', preview)
    document.querySelector('#score-orbits').style.animationDuration =
      `${0.16 / easing}s`
    document.querySelector('#density-label').textContent =
      `density ${density} · easing ${easing}`
    document.querySelector('#score-title').textContent =
      values?.title ?? S.projectName
    const status = document.querySelector('#monitor-preview')
    const limitedRuntime =
      !preview &&
      S.running &&
      S.runtimeCode &&
      (!previewValues(S.runtimeCode) ||
        normalizedPreviewCode(S.runtimeCode) !== normalizedPreviewCode(source))
    status.hidden = !preview && !limitedRuntime
    status.innerHTML = preview
      ? `<span><strong>${P.t('修改预演', 'Change preview')}</strong> · ${parameterApplied() ? P.t('已应用到文件', 'Applied to file') : P.t('未应用到工程', 'Not applied to project')}</span>${b('parameter-stop', P.t('回到运行画面', 'Return to runtime'), '', 'small')}`
      : limitedRuntime
        ? P.t(
            '原型仅显示可识别字段；其他代码未执行。',
            'Prototype shows recognized fields only; other code was not executed.'
          )
        : ''
  }
  function bindSplitter() {
    const el = document.querySelector('.splitter')
    let active = false
    const set = value => {
      const max = Math.min(
        48,
        ((document.querySelector('.stage').clientWidth - 370) /
          document.querySelector('.stage').clientWidth) *
          100
      )
      const v = Math.max(30, Math.min(max, value))
      document.documentElement.style.setProperty('--monitor', v + '%')
      el.setAttribute('aria-valuenow', String(Math.round(v)))
    }
    el.addEventListener('pointerdown', e => {
      active = true
      el.setPointerCapture(e.pointerId)
    })
    el.addEventListener('pointermove', e => {
      if (active) {
        const r = document.querySelector('.stage').getBoundingClientRect()
        set(((r.right - e.clientX) / r.width) * 100)
      }
    })
    el.addEventListener('pointerup', () => (active = false))
    el.addEventListener('dblclick', () => set(40))
    el.addEventListener('keydown', e => {
      if (['ArrowLeft', 'ArrowRight', 'Home'].includes(e.key)) {
        e.preventDefault()
        set(
          e.key === 'Home'
            ? 40
            : Number(el.getAttribute('aria-valuenow')) +
                (e.key === 'ArrowLeft' ? 2 : -2)
        )
      }
    })
  }
  function updateDraft(value) {
    const path = S.activeFile
    const prev = S.drafts[path] ?? S.files[path]
    if (prev !== value) {
      ;(S.undo[path] ??= []).push(prev)
      S.redo[path] = []
    }
    if (value === S.files[path]) Reflect.deleteProperty(S.drafts, path)
    else S.drafts[path] = value
    const pre = document.querySelector('.code-highlight')
    if (pre) pre.innerHTML = highlight(value)
    const nums = document.querySelector('.line-numbers')
    if (nums)
      nums.textContent = value
        .split('\n')
        .map((_, i) => i + 1)
        .join('\n')
    const save = document.querySelector('[data-action="save-file"]')
    if (save) save.disabled = S.drafts[path] === undefined
    document.querySelector('#sidebar').innerHTML = sidebar()
  }
  function bindEditor() {
    const el = document.querySelector('#code-editor')
    if (!el) return
    el.addEventListener('input', () => updateDraft(el.value))
    el.addEventListener('scroll', () => {
      document.querySelector('.code-highlight').scrollTop = el.scrollTop
      document.querySelector('.code-highlight').scrollLeft = el.scrollLeft
      document.querySelector('.line-numbers').scrollTop = el.scrollTop
    })
    const status = () => {
      const before = el.value.slice(0, el.selectionStart).split('\n')
      document.querySelector('#cursor-status').textContent =
        `Ln ${before.length}, Col ${before.at(-1).length + 1}${el.selectionStart !== el.selectionEnd ? ' · ' + P.t('已选中', 'Selected') : ''}`
    }
    el.addEventListener('keyup', status)
    el.addEventListener('click', status)
    el.addEventListener('select', status)
    el.addEventListener('keydown', e => {
      if (e.isComposing) return
      if (e.key === 'Tab') {
        e.preventDefault()
        const start = el.selectionStart,
          end = el.selectionEnd
        if (start === end) {
          el.setRangeText('  ', start, end, 'end')
        } else {
          const lineStart = el.value.lastIndexOf('\n', start - 1) + 1
          const block = el.value
            .slice(lineStart, end)
            .split('\n')
            .map(l => (e.shiftKey ? l.replace(/^ {1,2}/, '') : '  ' + l))
            .join('\n')
          el.setRangeText(block, lineStart, end, 'select')
        }
        updateDraft(el.value)
      }
      if (e.key === 'Enter') {
        e.preventDefault()
        const before = el.value.slice(0, el.selectionStart).split('\n').at(-1)
        const indent =
          before.match(/^\s*/)[0] + (before.trimEnd().endsWith('{') ? '  ' : '')
        el.setRangeText(
          '\n' + indent,
          el.selectionStart,
          el.selectionEnd,
          'end'
        )
        updateDraft(el.value)
      }
      if ((e.metaKey || e.ctrlKey) && e.key === 'z') {
        e.preventDefault()
        draftUndo(e.shiftKey)
      }
    })
  }
  function draftUndo(redo = false) {
    const path = S.activeFile
    const from = (redo ? S.redo : S.undo)[path] || []
    if (!from.length) return
    ;((redo ? S.undo : S.redo)[path] ??= []).push(
      S.drafts[path] ?? S.files[path]
    )
    const value = from.pop()
    if (value === S.files[path]) Reflect.deleteProperty(S.drafts, path)
    else S.drafts[path] = value
    P.render()
    document.querySelector('#code-editor')?.focus()
  }
  function saveFile() {
    const path = S.activeFile
    if (S.drafts[path] === undefined) return
    if (S.diskConflicts?.[path]) {
      P.toast(
        P.t(
          '保存版已变化。请先比较并处理草稿，或丢弃草稿重读。',
          'Saved file changed. Resolve your draft or discard it to reload.'
        )
      )
      return
    }
    if (path.endsWith('.json')) {
      try {
        JSON.parse(S.drafts[path])
      } catch {
        P.toast(
          P.t(
            'JSON 格式无效，请先修正。',
            'Invalid JSON. Fix it before saving.'
          )
        )
        return
      }
    }
    P.markChanged(path, S.drafts[path])
    Reflect.deleteProperty(S.drafts, path)
    P.render()
    P.toast(
      P.t(
        '文件已保存；画面保持原样，版本尚未记录。',
        'File saved. Monitor unchanged; version not recorded.'
      )
    )
  }
  function popup(items, anchor) {
    const root = document.querySelector('#popover-root')
    root.innerHTML = `<div class="popover">${items}</div>`
    const box = root.firstElementChild
    const r = anchor.getBoundingClientRect()
    box.style.left = Math.min(r.left, innerWidth - box.offsetWidth - 10) + 'px'
    box.style.top =
      Math.max(8, Math.min(r.bottom + 5, innerHeight - box.offsetHeight - 42)) +
      'px'
    box.querySelector('button')?.focus()
  }
  function contextDialog() {
    P.openDialog(
      P.t('发送给模型的工程范围', 'Project context sent to the model'),
      `<div class="stack"><p>${P.t('服务：Creative model（原型演示）', 'Service: Creative model (prototype)')}</p><div class="callout">${P.t('按问题读取相关的保存版文本。显式附件可以包含你选中的未保存内容。', 'Reads relevant saved text for your question. Explicit attachments may include selected unsaved text.')}</div><ul class="file-list"><li>manifest.json · README.md</li><li>web/monitor/sketch.js</li>${S.attachment ? `<li>${P.t('附件', 'Attachment')}: ${P.esc(S.attachment.path)} : ${S.attachment.start}–${S.attachment.end}</li>` : ''}<li class="muted">${P.t('不读取密钥、音频、模型、依赖和其他未保存草稿。', 'Excludes secrets, audio, models, dependencies and other unsaved drafts.')}</li></ul></div>`,
      b(
        'authorize-send',
        P.t('允许本次工程会话并发送', 'Allow for this project session & send'),
        '',
        'primary'
      )
    )
  }
  function sendMessage() {
    if (!S.input.trim()) return
    if (!S.readProject && S.attachment) {
      P.toast(
        P.t(
          '请启用读取当前工程，或移除片段。输入和附件已保留。',
          'Enable project reading or remove the snippet. Your message and attachment are kept.'
        )
      )
      return
    }
    if (S.readProject && !S.authorized) {
      contextDialog()
      return
    }
    const text = S.input
    S.messages.push({
      role: 'user',
      text,
      attachment: S.attachment ? { ...S.attachment } : null,
    })
    const complex = /触摸|手机|模块|跨|touch|phone|module|multi/i.test(text)
    S.messages.push({
      role: 'assistant',
      text: complex
        ? P.t(
            '这会涉及 Performer、服务端事件与 Monitor 的配合。我们可以先确定交互规则，再整理一份交接文档。建议从“按住时增加密度，松开后缓慢恢复”开始；涉及多个文件，由外部编程智能体实现。',
            'This affects Performer, server events and Monitor. Let’s agree on the interaction, then prepare a handoff. Start with “hold to increase density; release to recover slowly”. The external coding agent will implement the changes across files.'
          )
        : P.t(
            '可以继续围绕当前声场细化。你选中的参数决定圆环间距；增大 density 会更紧密，easing 决定变化速度。先在当前文件微调，再手动刷新对比。这里的回复是用于讨论界面的示例。',
            'We can refine the sound field. The selected parameters control ring spacing and transition speed. Edit the current file, then refresh to compare. This reply is a prototype example.'
          ),
      handoff: complex,
    })
    S.input = ''
    S.attachment = null
    S.activeView = 'chat'
    P.render()
    document.querySelector('#main-content').scrollTop = 99999
  }
  function attachSelection() {
    const el = document.querySelector('#code-editor')
    if (!el || el.selectionStart === el.selectionEnd) {
      P.toast(P.t('先在代码中选中一段文本。', 'Select some code first.'))
      return
    }
    S.attachment = {
      path: S.activeFile,
      start: el.value.slice(0, el.selectionStart).split('\n').length,
      end: el.value.slice(0, el.selectionEnd).split('\n').length,
      text: el.value.slice(el.selectionStart, el.selectionEnd),
      unsaved: S.drafts[S.activeFile] !== undefined,
      version: 'snapshot-' + Date.now(),
    }
    S.activeView = 'chat'
    P.render()
    document.querySelector('#chat-input').focus()
  }
  function overview() {
    P.openDialog(
      P.t('工程概况', 'Project overview'),
      `<div class="stack"><div class="row"><h2>${P.esc(S.projectName)}</h2><span class="badge">v${S.projectVersion}</span></div><ul class="file-list"><li class="row between"><span>${P.t('工程内容', 'Project content')}</span><b>${P.t('已有 Monitor 与 Performer 源码', 'Monitor & Performer source present')}</b></li><li class="row between"><span>${P.t('静态契约', 'Static contract')}</span><span>${S.checked ? P.t('最近检查通过', 'Last check passed') : P.t('尚未检查当前保存版', 'Current saved files not checked')}</span></li><li class="row between"><span>${P.t('实际测试', 'Runtime test')}</span><span>${S.running ? P.t('None 模式运行中', 'Running with None') : P.t('已停止', 'Stopped')}</span></li><li class="row between"><span>${P.t('未保存文件', 'Drafts')}</span>${Object.keys(S.drafts).length}</li></ul><p class="muted">${P.t('这些是工程事实；画面、互动与声音效果需要创作者亲自体验。', 'These are project facts. The creator still needs to evaluate visuals, interaction and sound.')}</p></div>`,
      b('close-dialog', P.t('返回创作', 'Back to creation'), '', 'secondary')
    )
  }
  function checks() {
    P.openDialog(
      P.t('检查工程', 'Project checks'),
      `<div class="stack"><p class="muted">${P.t('检查保存版工程；未保存内容不参与。', 'Checks saved files, excluding unsaved drafts.')}</p><div class="card"><h3>${P.t('静态检查', 'Static check')}</h3><p>${P.t('检查 manifest、入口与资源引用，不启动工程。', 'Checks manifest, entries and resource references without starting a project.')}</p>${b('run-static', P.t('运行静态检查', 'Run static check'), 'shield', 'secondary')}</div><div class="card"><h3>${P.t('独立副本运行检查', 'Run check in a temporary copy')}</h3><p>${P.t('默认使用 None 音频；报告保留输入版本与未覆盖项。', 'Uses None audio by default; the report records input versions and coverage limits.')}</p>${S.running ? `<p class="warning">${P.t('当前工程正在运行。先手动停止，再进行副本运行检查。', 'A project is running. Stop it manually before running this check.')}</p>` : ''}<div class="row">${b('run-copy-check', 'None', '', 'secondary', S.running ? 'disabled' : '')}${b('run-copy-check', 'Internal', '', 'secondary', `${S.running ? 'disabled' : ''} data-audio="internal"`)}</div></div>${S.checked ? `<div class="callout success">${P.t('静态检查通过 · 演示报告。互动和声音尚未验收。', 'Static check passed · demo report. Interaction and sound remain unverified.')}</div>` : ''}</div>`,
      b('close-dialog', P.t('关闭', 'Close'), '', 'secondary')
    )
  }
  function settings(tab = 'general') {
    S.settingsTab = tab
    const tabs = [
      ['general', '通用', 'General'],
      ['audio', '音频', 'Audio'],
      ['network', '网络与节点', 'Network'],
      ['ports', 'Ports 调试', 'Ports'],
      ['model', '创作助手', 'Assistant'],
    ]
    let body = ''
    if (tab === 'general')
      body = `<h3>${P.t('外观与语言', 'Appearance & language')}</h3><div class="field"><span>${P.t('主题', 'Theme')}</span><div class="row">${['pond', 'sand', 'stage', 'brutal'].map(x => b('set-theme', x[0].toUpperCase() + x.slice(1), '', S.theme === x ? 'primary' : 'secondary', `data-theme="${x}"`)).join('')}</div></div><div class="field"><span>${P.t('界面语言', 'Interface language')}</span>${b('language', S.language === 'en' ? '简体中文' : 'English', '', 'secondary')}</div>`
    if (tab === 'audio')
      body = `<h3>${P.t('主输出', 'Master output')}</h3><label class="field">${P.t('音频设备', 'Audio device')}<select><option>MacBook Pro Speakers</option><option>External audio device (demo)</option></select></label><label class="field">${P.t('采样率', 'Sample rate')}<select><option>48,000 Hz</option><option>44,100 Hz</option></select></label><p class="muted">${P.t('配置将在下次启动测试时应用。', 'Configuration applies when the next test starts.')}</p>`
    if (tab === 'network')
      body = `<h3>${P.t('网络与节点', 'Network & nodes')}</h3><label class="field">${P.t('节点名称', 'Node name')}<input value="PNDS Studio"></label><label class="field">Hub URL<input placeholder="https://hub.example.org"></label><label class="field">Token<input type="password" placeholder="••••••••"></label><div class="callout">${P.t('本机地址', 'Local address')}: 192.168.1.24<br>HTTPS · ${P.t('本机证书已就绪（演示）', 'Local certificate ready (demo)')}</div>`
    if (tab === 'ports')
      body = `<h3>Ports</h3><ul class="file-list"><li class="row between">Performer · 4210 <span class="badge">${S.running ? P.t('当前工程使用', 'Current project') : P.t('可用', 'Available')}</span></li><li class="row between">Monitor · 4211 <span class="badge">${S.running ? P.t('当前工程使用', 'Current project') : P.t('可用', 'Available')}</span></li></ul><p class="muted">${P.t('释放当前工程端口前，请先停止测试。', 'Stop the project before releasing its ports.')}</p>${b('ports-refresh', P.t('刷新端口状态', 'Refresh port status'), 'refresh', 'secondary')}`
    if (tab === 'model')
      body = `<h3>${P.t('模型服务', 'Model service')}</h3><label class="field">${P.t('服务名称', 'Service name')}<input value="Creative model"></label><label class="field">Base URL<input value="https://your-provider.example/v1"></label><label class="field">Model<input value="your-model-id"></label><div class="callout">${P.t('此原型不接收 API Key，不发起模型请求。正式 App 在系统钥匙串保存凭据。', 'This prototype does not accept API keys or call a model. The app will store credentials in the system keychain.')}</div>`
    P.openDialog(
      P.t('设置', 'Settings'),
      `<div class="settings-grid"><nav class="settings-nav">${tabs.map(([id, zh, en]) => b('settings-tab', P.t(zh, en), '', tab === id ? 'active' : '', `data-tab="${id}"`)).join('')}</nav><div class="stack">${body}</div></div>`,
      b('close-dialog', P.t('完成', 'Done'), '', 'primary')
    )
  }
  function projectMenu(el) {
    popup(
      `${b('new-project', P.t('新建工程…', 'New project…'), 'plus')}${b('open-project', P.t('打开工程…', 'Open project…'), 'folder')}${b('finder', P.t('在 Finder 中显示', 'Reveal in Finder'), 'folder')}<hr>${b('rename-project', P.t('编辑作品信息', 'Edit project details'), 'file')}${b('package-project', P.t('生成 .pnds 工程包', 'Build .pnds bundle'), 'package')}<hr>${b('close-project', P.t('关闭工程', 'Close project'), 'close')}`,
      el
    )
  }
  function newProject() {
    P.openDialog(
      P.t('新建工程', 'New project'),
      `<div class="stack"><label class="field">${P.t('作品名称', 'Project name')}<input id="new-name" value="潮汐实验"></label><div class="field"><span>${P.t('起点', 'Starting point')}</span><label><input name="template" type="radio" value="blank" checked> Blank — ${P.t('空白骨架', 'Blank structure')}</label><label><input name="template" type="radio" value="classic"> Classic — ${P.t('经典互动模板', 'Classic interactive template')}</label></div><label class="field">${P.t('创作者 / 初始版本署名', 'Creator / initial version author')}<input id="new-author" value="${P.esc(S.author)}"></label><label class="field">${P.t('邮箱（选填）', 'Email (optional)')}<input id="new-email" placeholder="${P.t('留空将使用 creator@local.invalid', 'Uses creator@local.invalid when empty')}"></label><div class="callout">${P.t('创建时自动启用本地版本记录，并记录初始版本。之后由你手动记录。', 'Creates local version history and an initial version. Later versions are recorded manually.')}</div><p class="muted">${P.t('演示位置', 'Demo location')}: ~/Music/PNDS Projects/</p></div>`,
      b(
        'create-project',
        P.t('预览文件范围', 'Preview file scope'),
        '',
        'primary'
      )
    )
  }
  function demoState() {
    P.openDialog(
      P.t('原型演示状态', 'Prototype demo states'),
      `<div class="stack"><p>${P.t('这些按钮只改变原型内存，帮助检查边界。', 'These controls change prototype memory to exercise edge cases.')}</p>${b('demo-no-git', P.t('已有工程 · 尚未启用版本记录', 'Existing project · no version history'), 'history', 'secondary')}${b('demo-manifest-draft', P.t('manifest 有未保存草稿', 'Unsaved manifest draft'), 'file', 'secondary')}${b('demo-external-staged', P.t('文件已由外部工具暂存', 'A file is staged externally'), 'changes', 'secondary')}${b('demo-reset', P.t('重新载入原型', 'Reload prototype'), 'refresh', 'secondary')}<div class="callout"><div>${P.t('保存版变更', 'Saved changes')}: ${S.changed.size}</div><div>${P.t('未保存文件', 'Unsaved files')}: ${Object.keys(S.drafts).length}</div><div>${P.t('画面', 'Monitor')}: ${S.running ? 'running' : 'stopped'} / ${S.pendingRuntime ? 'pending refresh' : 'current'}</div><div>Git: ${S.hasGit ? 'enabled' : 'not enabled'}</div><div>${P.t('交接基线', 'Handoff baseline')}: ${S.baseline ? 'captured' : 'none'}</div></div></div>`
    )
  }
  function audioMode() {
    P.openDialog(
      P.t('手动测试音频', 'Manual test audio'),
      `<div class="stack"><div class="row">${['none', 'internal', 'external'].map(a => b('set-audio', a[0].toUpperCase() + a.slice(1), '', S.audio === a ? 'primary' : 'secondary', `data-audio="${a}"`)).join('')}</div>${S.audio === 'external' ? `<label class="field">${P.t('App 测试 OSC 目标', 'App test OSC target')}<input value="127.0.0.1:57120"></label>` : ''}<p class="muted">${P.t('此选择不改工程默认音频模式；运行中修改后，手动停止并启动才应用。', 'Does not change the project default. Stop and start manually to apply while running.')}</p></div>`,
      b('close-dialog', P.t('完成', 'Done'), '', 'primary')
    )
  }
  async function action(a, el) {
    if (P.catalogAction?.(a, el)) return
    if (P.workflowAction?.(a, el)) return
    switch (a) {
      case 'close-dialog':
        P.closeDialog()
        break
      case 'nav':
        S.activeView = el.dataset.view
        P.render()
        break
      case 'back-chat':
      case 'guide-chat':
        S.activeView = 'chat'
        P.render()
        break
      case 'open-file':
        P.openFile(el.dataset.path)
        break
      case 'project-menu':
        projectMenu(el)
        break
      case 'proposal-view':
        S.parameters.view = el.dataset.view
        P.render()
        break
      case 'execute-edit':
        applyParameters()
        break
      case 'parameter-preview':
        if (parameterProblem()) P.toast(parameterProblem())
        else if (!S.running)
          P.toast(P.t('请先手动启动测试。', 'Start testing manually first.'))
        else if (canPreviewProposal()) {
          S.parameters.active = true
          S.parameters.previewValues = previewValues(S.parameters.code)
          syncParameterControls()
        }
        break
      case 'parameter-stop':
        if (S.parameters) S.parameters.active = false
        syncParameterControls()
        break
      case 'parameter-reset':
        if (S.parameters && readParameters(S.parameters.code)) {
          S.parameters.values = { ...S.parameters.recommended }
          for (const [key, value] of Object.entries(S.parameters.recommended))
            S.parameters.code = replaceParameter(S.parameters.code, key, value)
          S.parameters.errors = {}
          S.parameters.active = Boolean(
            S.running && !parameterProblem() && canPreviewProposal()
          )
          S.parameters.previewValues = previewValues(S.parameters.code)
          P.render()
        }
        break
      case 'parameter-reload': {
        const values = readParameters(S.files[parameterPath])
        if (
          S.drafts[parameterPath] !== undefined ||
          S.diskConflicts?.[parameterPath] ||
          !S.files[parameterPath]
        ) {
          P.toast(
            P.t(
              '请先在当前文件中处理草稿或无效参数。',
              'Resolve the draft or invalid parameters in the current file.'
            )
          )
          break
        }
        S.parameters.base = S.files[parameterPath]
        S.parameters.code = S.files[parameterPath]
        if (values) S.parameters.values = values
        S.parameters.errors = {}
        S.parameters.active = false
        P.render()
        break
      }
      case 'toggle-diff':
        S.showDiff = !S.showDiff
        P.render()
        break
      case 'undo-ai':
        if (
          S.executed &&
          S.files['web/monitor/sketch.js'] === S.executed.after &&
          !S.drafts['web/monitor/sketch.js']
        ) {
          P.markChanged('web/monitor/sketch.js', S.executed.before)
          P.toast(P.t('已撤销本次保存的修改。', 'Reverted this saved edit.'))
          P.render()
        } else
          P.toast(
            P.t(
              '文件已有后续变化，无法直接撤销。',
              'The file has later changes; direct undo is unavailable.'
            )
          )
        break
      case 'save-file':
        saveFile()
        break
      case 'editor-undo':
        draftUndo()
        break
      case 'find-open':
        S.find = true
        P.render()
        document.querySelector('#find-value')?.focus()
        break
      case 'find-close':
        S.find = false
        P.render()
        break
      case 'find-next': {
        const editor = document.querySelector('#code-editor'),
          term = document.querySelector('#find-value').value
        if (!term || !editor) break
        let i = editor.value.indexOf(term, editor.selectionEnd)
        if (i < 0) i = editor.value.indexOf(term)
        if (i < 0) P.toast(P.t('没有找到', 'No matches'))
        else {
          editor.focus()
          editor.setSelectionRange(i, i + term.length)
          editor.scrollTop = Math.max(
            0,
            (editor.value.slice(0, i).split('\n').length - 4) * 22
          )
        }
        break
      }
      case 'replace-one': {
        const editor = document.querySelector('#code-editor'),
          term = document.querySelector('#find-value').value
        if (
          editor &&
          term &&
          editor.value.slice(editor.selectionStart, editor.selectionEnd) ===
            term
        ) {
          editor.setRangeText(
            document.querySelector('#replace-value').value,
            editor.selectionStart,
            editor.selectionEnd,
            'select'
          )
          updateDraft(editor.value)
        } else action('find-next', el)
        break
      }
      case 'go-line':
        P.openDialog(
          P.t('跳转到行', 'Go to line'),
          `<label class="field">${P.t('行号', 'Line number')}<input id="line-number" type="number" min="1" value="4"></label>`,
          b('go-line-confirm', P.t('跳转', 'Go'), '', 'primary')
        )
        break
      case 'go-line-confirm': {
        const line = Number(document.querySelector('#line-number').value)
        P.closeDialog()
        const e = document.querySelector('#code-editor')
        if (e) {
          const i =
            e.value
              .split('\n')
              .slice(0, Math.max(0, line - 1))
              .join('\n').length + (line > 1 ? 1 : 0)
          e.focus()
          e.setSelectionRange(i, i)
          e.scrollTop = Math.max(0, (line - 5) * 22)
        }
        break
      }
      case 'attach-selection':
        attachSelection()
        break
      case 'view-attachment':
        P.openDialog(
          P.t('代码片段快照', 'Code snippet snapshot'),
          `<p><code>${P.esc(S.attachment.path)}:${S.attachment.start}–${S.attachment.end}</code></p><pre class="diff">${P.esc(S.attachment.text)}</pre><p class="muted">${P.t('保留选取时内容，后续编辑不会静默更新附件。', 'Keeps the content from selection time; later edits do not update this attachment.')}</p>`
        )
        break
      case 'remove-attachment':
        S.attachment = null
        P.render()
        break
      case 'send-message':
        sendMessage()
        break
      case 'authorize-send':
        S.authorized = true
        P.closeDialog()
        sendMessage()
        break
      case 'context-scope':
        contextDialog()
        break
      case 'discuss-multi':
        S.input = P.t(
          '想加入手机触摸的互动，按住增加密度，松开后慢慢恢复。',
          'Add phone interaction: hold to increase density, release to recover slowly.'
        )
        sendMessage()
        break
      case 'overview':
        overview()
        break
      case 'checks':
        checks()
        break
      case 'run-static':
        S.checked = true
        S.logs.push('Static check passed · current saved version')
        checks()
        break
      case 'run-copy-check':
        if (S.running) break
        S.logs.push(
          `Copy check passed · ${el.dataset.audio || 'none'} · visuals / sound not verified`
        )
        P.openDialog(
          P.t('副本检查报告', 'Copy check report'),
          `<div class="stack"><div class="callout success">${P.t('启动与关停检查通过（演示）', 'Startup and shutdown check passed (demo)')}</div><p>${P.t('音频模式', 'Audio mode')}: ${el.dataset.audio || 'None'}</p><p>${P.t('尚未验收：画面表现、观众互动、音色与现场设备。原工程和实时画面均未改变。', 'Not verified: visuals, audience interaction, timbre and venue devices. Original files and live monitor are unchanged.')}</p></div>`,
          b('close-dialog', P.t('返回', 'Back'), '', 'primary')
        )
        break
      case 'runtime-toggle':
        S.running = !S.running
        if (S.running) {
          S.pendingRuntime = false
          S.pendingRestart = false
          S.appliedAudio = S.audio
          document.querySelector('#density-label').textContent =
            'density ' +
            (S.files['web/monitor/sketch.js']?.match(
              /density: ([\d.]+)/
            )?.[1] || '0.32')
        }
        if (S.running) S.runtimeCode = S.files[parameterPath]
        if (S.running)
          S.runtimeParameters = previewValues(S.files[parameterPath]) ||
            S.runtimeParameters || {
              density: 0.32,
              easing: 0.08,
            }
        if (S.parameters) S.parameters.active = false
        updateMonitorArt()
        S.logs.push(S.running ? 'Manual test started' : 'Manual test stopped')
        P.render()
        break
      case 'refresh-monitor':
        if (!S.running) {
          P.toast(P.t('请先启动测试。', 'Start the test first.'))
          break
        }
        S.pendingRuntime = Boolean(S.pendingRestart)
        document.querySelector('#density-label').textContent =
          'density ' +
          (S.files['web/monitor/sketch.js']?.match(/density: ([\d.]+)/)?.[1] ||
            '0.32')
        S.runtimeCode = S.files[parameterPath]
        S.runtimeParameters = previewValues(S.files[parameterPath]) ||
          S.runtimeParameters || {
            density: 0.32,
            easing: 0.08,
          }
        if (S.parameters) S.parameters.active = false
        updateMonitorArt()
        S.logs.push('Monitor manually refreshed')
        monitorUpdate()
        P.toast(
          P.t(
            '已手动刷新画面。运行配置变化仍需重启。',
            'Monitor refreshed. Runtime configuration changes still require a restart.'
          )
        )
        break
      case 'expand-monitor':
        S.fullMonitor = !S.fullMonitor
        monitorUpdate()
        break
      case 'monitor-more':
        popup(
          `${b('expand-monitor', P.t('展开／还原 Monitor', 'Expand / restore Monitor'), 'expand')}${b('projection', P.t('打开投影窗口', 'Open projection window'), 'device')}${b('reset-split', P.t('复位工作区宽度', 'Reset workspace width'), '')}`,
          el
        )
        break
      case 'reset-split':
        document.documentElement.style.removeProperty('--monitor')
        break
      case 'add-performer': {
        const w = window.open(
          `performer.html?lang=${S.language}`,
          `pnds-170-performer-${Date.now()}`,
          'width=470,height=800'
        )
        if (w) {
          S.performers.push(w)
          monitorUpdate()
        } else
          P.toast(
            P.t(
              '请允许原型打开测试窗口。',
              'Allow the prototype to open a test window.'
            )
          )
        break
      }
      case 'focus-performer':
        S.performers[Number(el.dataset.index)]?.focus()
        break
      case 'projection':
        P.openDialog(
          P.t('独立投影窗口', 'Independent projection window'),
          `<p>${P.t('投影窗口入口保留在实时画面的“显示选项”。正式 App 会打开工程的独立 Monitor；该窗口布局沿用 1.6 定稿，此原型不额外展开。', 'Projection remains in the monitor view options. The app opens an independent project Monitor using the approved 1.6 design; this prototype does not expand it.')}</p>`,
          b('close-dialog', P.t('返回', 'Back'), '', 'secondary')
        )
        break
      case 'audio-mode':
        audioMode()
        break
      case 'set-audio':
        S.audio = el.dataset.audio
        audioMode()
        monitorUpdate()
        break
      case 'console-toggle':
        S.console = !S.console
        P.render()
        break
      case 'settings':
        settings()
        break
      case 'settings-tab':
        settings(el.dataset.tab)
        break
      case 'audio-settings':
      case 'device-settings':
        settings('audio')
        break
      case 'network-settings':
        settings('network')
        break
      case 'model-settings':
        settings('model')
        break
      case 'ports-refresh':
        P.toast(P.t('端口状态已刷新（演示）。', 'Port state refreshed (demo).'))
        break
      case 'language':
        S.language = S.language === 'en' ? 'zh-CN' : 'en'
        P.render()
        if (document.querySelector('#dialog').open) settings(S.settingsTab)
        break
      case 'theme-menu':
        popup(
          ['pond', 'sand', 'stage', 'brutal']
            .map(x =>
              b(
                'set-theme',
                x[0].toUpperCase() + x.slice(1),
                '',
                '',
                `data-theme="${x}"`
              )
            )
            .join(''),
          el
        )
        break
      case 'set-theme':
        S.theme = el.dataset.theme
        P.render()
        if (document.querySelector('#dialog').open) settings(S.settingsTab)
        break
      case 'quick-open':
        P.openDialog(
          P.t('快速打开', 'Quick open'),
          `<label class="field"><input id="quick-filter" placeholder="${P.t('输入文件名…', 'Search files…')}"></label><div class="file-list" id="quick-results">${Object.keys(
            S.files
          )
            .map(p =>
              b('quick-file', P.esc(p), 'file', '', `data-path="${P.esc(p)}"`)
            )
            .join('')}</div>`
        )
        document.querySelector('#quick-filter').focus()
        break
      case 'quick-file':
        P.closeDialog()
        P.openFile(el.dataset.path)
        break
      case 'toggle-readme':
        S.editorMode = S.editorMode === 'preview' ? 'code' : 'preview'
        P.render()
        break
      case 'editor-more':
        popup(
          `${b('find-open', P.t('查找与替换', 'Find & replace'), 'search')}${b('editor-undo', P.t('撤销草稿编辑', 'Undo draft edit'), 'undo')}${b('discard-draft', P.t('丢弃当前草稿', 'Discard current draft'), 'refresh')}${b('rename-file', P.t('重命名文件（交接）', 'Rename file (handoff)'), 'handoff')}`,
          el
        )
        break
      case 'discard-draft':
        P.openDialog(
          P.t('丢弃当前草稿？', 'Discard current draft?'),
          `<p>${P.esc(S.activeFile)}</p>`,
          b('close-dialog', P.t('保留草稿', 'Keep draft'), '', 'secondary') +
            b(
              'confirm-discard',
              P.t('丢弃并重读保存版', 'Discard & reload saved file'),
              '',
              'primary'
            )
        )
        break
      case 'confirm-discard':
        Reflect.deleteProperty(S.drafts, S.activeFile)
        if (S.diskConflicts)
          Reflect.deleteProperty(S.diskConflicts, S.activeFile)
        P.closeDialog()
        P.render()
        break
      case 'rename-file':
        S.handoffTasks.push({
          id: 'rename-' + Date.now(),
          title: P.t(
            '重命名文件并更新引用',
            'Rename file and update references'
          ),
          files: [S.activeFile],
          detail: S.activeFile,
          status: '待确认',
        })
        S.activeView = 'handoff'
        P.render()
        break
      case 'manifest-form':
        P.openDialog(
          P.t('工程配置', 'Project configuration'),
          `<div class="stack"><label class="field">${P.t('作品名称', 'Name')}<input id="manifest-name" value="${P.esc(S.projectName)}"></label><label class="field">${P.t('工程版本', 'Version')}<input id="manifest-version" value="${S.projectVersion}"></label><div class="callout">Monitor: web/monitor/index.html<br>Performer: web/performer/index.html<br>${P.t('音频支持', 'Audio modes')}: None / Internal / External</div><p class="muted">${P.t('应用表单先进入 manifest 草稿，再由你保存。', 'Applying the form updates the manifest draft; save it yourself.')}</p></div>`,
          b(
            'manifest-apply',
            P.t('应用到草稿', 'Apply to draft'),
            '',
            'primary'
          )
        )
        break
      case 'manifest-apply': {
        let data
        try {
          data = JSON.parse(
            S.drafts['manifest.json'] ?? S.files['manifest.json']
          )
        } catch {
          P.toast(
            P.t('请先修正 manifest 草稿格式。', 'Fix the manifest draft first.')
          )
          break
        }
        data.name = document.querySelector('#manifest-name').value
        data.version = document.querySelector('#manifest-version').value
        S.drafts['manifest.json'] = JSON.stringify(data, null, 2)
        P.closeDialog()
        P.openFile('manifest.json')
        break
      }
      case 'compile':
        if (
          S.drafts[S.activeFile] !== undefined ||
          S.drafts['manifest.json'] !== undefined
        ) {
          P.toast(
            P.t(
              '先保存 SCD 和 manifest，再编译。',
              'Save SCD and manifest before compiling.'
            )
          )
          break
        }
        S.logs.push(
          'SynthDef compiled · supercollider/synthdefs/tide.scsyndef (demo)'
        )
        S.pendingRuntime = true
        S.pendingRestart = true
        S.console = true
        P.render()
        P.toast(
          P.t(
            '编译完成（演示）；手动重启测试后采用。',
            'Compiled (demo); restart manually to apply.'
          )
        )
        break
      case 'new-project':
        newProject()
        break
      case 'create-project': {
        const name = document.querySelector('#new-name').value.trim()
        if (!name) {
          P.toast(P.t('请填写作品名称。', 'Enter a project name.'))
          break
        }
        S.pendingNewProject = {
          name,
          author:
            document.querySelector('#new-author').value.trim() || 'Creator',
          email: document.querySelector('#new-email').value,
          template: document.querySelector('[name="template"]:checked').value,
        }
        P.gitSetup?.({ newProject: true })
        break
      }
      case 'open-project':
        P.openDialog(
          P.t('打开已有工程', 'Open existing project'),
          `<p>${P.t('原型使用“潮汐”演示工程。可体验打开无 Git 的已有工程；不会自动启用版本记录。', 'The prototype uses the 潮汐 demo project. Try the existing project without Git; history will not be enabled automatically.')}</p>`,
          b(
            'demo-no-git',
            P.t('打开演示工程（无 Git）', 'Open demo project (no Git)'),
            'folder',
            'primary'
          )
        )
        break
      case 'finder':
        P.toast(
          P.t(
            '演示路径：~/Music/PNDS Projects/潮汐',
            'Demo path: ~/Music/PNDS Projects/潮汐'
          )
        )
        break
      case 'rename-project':
        P.openFile('README.md')
        break
      case 'package-project':
        P.openDialog(
          P.t('生成 .pnds 工程包', 'Build .pnds bundle'),
          `<div class="stack"><h3>${P.esc(S.projectName)} · v${S.projectVersion}</h3><p>${P.t('仅使用工程保存版。版本记录、聊天和交接比较基线不包含在工程包中。', 'Uses saved files. Git history, chats and handoff baselines are excluded.')}</p>${Object.keys(S.drafts).length ? `<div class="callout warning">${P.t('存在未保存草稿；可以取消并先保存。', 'There are unsaved drafts; you can cancel and save first.')}</div>` : ''}</div>`,
          b('close-dialog', P.t('取消', 'Cancel'), '', 'secondary') +
            b(
              'package-confirm',
              P.t('生成演示包', 'Build demo bundle'),
              '',
              'primary'
            )
        )
        break
      case 'package-confirm':
        P.closeDialog()
        P.toast(
          P.t(
            '工程包生成流程已演示；没有写入真实文件。',
            'Bundle flow demonstrated; no files were written.'
          )
        )
        break
      case 'close-project':
        P.openDialog(
          P.t('关闭工程', 'Close project'),
          `<p>${P.t('关闭会停止测试并离开当前工程。此原型保留工作台方便继续评审。', 'Closing stops the test and leaves the project. This prototype keeps the workspace for review.')}</p>`,
          b('close-dialog', P.t('继续创作', 'Continue creating'), '', 'primary')
        )
        break
      case 'mode-switch':
        if (!S.modeArmed) {
          S.modeArmed = true
          P.render()
          clearTimeout(modeTimer)
          modeTimer = setTimeout(() => {
            S.modeArmed = false
            document.querySelector('#bottom-bar').innerHTML = bottom()
          }, 5000)
        } else {
          S.modeArmed = false
          P.openDialog(
            P.t('进入演出模式', 'Enter performance mode'),
            `<p>${P.t('正式 App 会停止测试、关闭测试窗口并回到演出首页。此原型聚焦创作模式；1.6 演出布局沿用既有定稿。', 'The app stops testing, closes test windows and returns to the performance home. This prototype focuses on creation; the approved 1.6 performance design is retained.')}</p>`,
            b(
              'close-dialog',
              P.t('留在创作原型', 'Stay in creation prototype'),
              '',
              'primary'
            )
          )
          document.querySelector('#bottom-bar').innerHTML = bottom()
        }
        break
      case 'guide-add':
        P.openDialog(
          P.t('给工程添加能力', 'Add capabilities to the project'),
          `<div class="catalog-grid"><button class="catalog-card" data-action="catalog-packages">${P.icon('package')}<h3>${P.t('App 共享包', 'App shared packages')}</h3><p>${P.t('引用随 App 提供的 p5、ml5、Socket.IO 等固定版本。', 'Reference bundled versions of p5, ml5, Socket.IO and more.')}</p></button><button class="catalog-card" data-action="catalog-modules">${P.icon('module')}<h3>${P.t('标准技术模块', 'Standard modules')}</h3><p>${P.t('加入 QR、主题、语言等模块文件，再通过交接接入作品。', 'Add QR, theme, language and other source modules; wire them through a handoff.')}</p></button></div><p class="muted">${P.t('两个入口也常驻左侧“添加到工程”。', 'Both entries remain available in the left sidebar.')}</p>`
        )
        break
      case 'guide-handoff':
        S.activeView = 'handoff'
        P.render()
        break
      case 'demo-state':
        demoState()
        break
      case 'demo-no-git':
        S.hasGit = false
        S.history = []
        P.closeDialog()
        S.activeView = 'history'
        P.render()
        break
      case 'demo-manifest-draft':
        S.drafts['manifest.json'] = S.files['manifest.json'] + '\n'
        P.closeDialog()
        P.openFile('manifest.json')
        break
      case 'demo-external-staged':
        S.externalStaged = new Set(['web/monitor/sketch.js'])
        S.changed.add('web/monitor/sketch.js')
        P.closeDialog()
        S.activeView = 'changes'
        P.render()
        P.toast(
          P.t(
            'sketch.js 已模拟外部暂存。',
            'sketch.js is now staged externally (demo).'
          )
        )
        break
      case 'demo-reset':
        location.reload()
        break
    }
  }
  P.action = action
  document.addEventListener('click', e => {
    const el = e.target.closest('[data-action]')
    if (!el) {
      if (!e.target.closest('.popover'))
        document.querySelector('#popover-root').innerHTML = ''
      return
    }
    const a = el.dataset.action
    document.querySelector('#popover-root').innerHTML = ''
    action(a, el)
  })
  document.addEventListener('input', e => {
    if (e.target.id === 'proposal-code') {
      inputProposalCode(e.target)
      return
    }
    if (e.target.dataset.parameter) {
      inputParameter(e.target)
      return
    }
    if (e.target.id === 'chat-input') S.input = e.target.value
    if (e.target.id === 'quick-filter') {
      const v = e.target.value.toLowerCase()
      document
        .querySelectorAll('#quick-results button')
        .forEach(b => (b.hidden = !b.dataset.path.toLowerCase().includes(v)))
    }
  })
  document.addEventListener('change', e => {
    if (e.target.id === 'read-project') {
      S.readProject = e.target.checked
      P.render()
    }
  })
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape') {
      document.querySelector('#popover-root').innerHTML = ''
      if (S.fullMonitor) {
        S.fullMonitor = false
        monitorUpdate()
      }
      S.modeArmed = false
      document.querySelector('#bottom-bar').innerHTML = bottom()
    }
    if ((e.metaKey || e.ctrlKey) && e.key === 'p') {
      e.preventDefault()
      action('quick-open')
    }
    if ((e.metaKey || e.ctrlKey) && e.key === 's' && S.activeView === 'file') {
      e.preventDefault()
      saveFile()
    }
    if ((e.metaKey || e.ctrlKey) && e.key === 'f' && S.activeView === 'file') {
      e.preventDefault()
      action('find-open')
    }
    if (
      (e.metaKey || e.ctrlKey) &&
      e.key === 'Enter' &&
      S.activeView === 'chat' &&
      e.target.id === 'chat-input'
    ) {
      e.preventDefault()
      sendMessage()
    }
  })
  window.addEventListener('message', e => {
    if (!S.performers.includes(e.source)) return
    if (e.data?.type === 'pnds-170-touch') touch()
    if (e.data?.type === 'pnds-170-performer-closed') {
      S.performers = S.performers.filter(w => w !== e.source)
      monitorUpdate()
    }
  })
  mount()
  if (params.get('view')) {
    S.activeView = ['file', 'handoff', 'changes', 'history'].includes(
      params.get('view')
    )
      ? params.get('view')
      : 'chat'
    P.render()
  }
})()
