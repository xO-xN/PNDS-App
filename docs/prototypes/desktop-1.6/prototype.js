/* global window, document, navigator, location, innerWidth, innerHeight, URLSearchParams, setTimeout, clearTimeout */
/* PNDS 1.6 desktop proposal. All files, sessions and configuration live in memory. */
;(function () {
  const icons = {
    sidebar:
      '<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M9 4v16"/>',
    chevron: '<path d="m9 5 7 7-7 7"/>',
    down: '<path d="m6 9 6 6 6-6"/>',
    file: '<path d="M14 3H5v18h14V8zM14 3v5h5M8 12h8M8 16h6"/>',
    code: '<path d="m8 8-4 4 4 4m8-8 4 4-4 4m-3-11-2 14"/>',
    settings:
      '<path d="M12 3v3m0 12v3M3 12h3m12 0h3M5.6 5.6l2.1 2.1m8.6 8.6 2.1 2.1m0-12.8-2.1 2.1m-8.6 8.6-2.1 2.1"/><circle cx="12" cy="12" r="6"/><circle cx="12" cy="12" r="2"/>',
    folder: '<path d="M3 6h7l2 2h9v12H3zM3 6V4h7l2 2"/>',
    music:
      '<path d="M9 18V5l11-2v13M9 9l11-2"/><ellipse cx="6" cy="18" rx="3" ry="2"/><ellipse cx="17" cy="16" rx="3" ry="2"/>',
    monitor:
      '<rect x="3" y="4" width="18" height="13" rx="2"/><path d="M12 17v4m-4 0h8"/>',
    play: '<path d="m8 4 12 8-12 8z"/>',
    stop: '<rect x="5" y="5" width="14" height="14" rx="1"/>',
    refresh:
      '<path d="M20 4v6h-6M4 20v-6h6M5.5 8a7 7 0 0 1 11.8-3L20 10M4 14l2.7 5A7 7 0 0 0 18.5 16"/>',
    search: '<circle cx="10" cy="10" r="6"/><path d="m15 15 5 5"/>',
    more: '<circle cx="5" cy="12" r="1"/><circle cx="12" cy="12" r="1"/><circle cx="19" cy="12" r="1"/>',
    plus: '<path d="M12 5v14M5 12h14"/>',
    close: '<path d="m6 6 12 12M18 6 6 18"/>',
    volume:
      '<path d="M11 5 6 9H3v6h3l5 4zM15 8a6 6 0 0 1 0 8m3-11a10 10 0 0 1 0 14"/>',
    mute: '<path d="M11 5 6 9H3v6h3l5 4zM16 9l5 6m0-6-5 6"/>',
    audio:
      '<path d="M4 14v-2a8 8 0 0 1 16 0v2"/><rect x="3" y="12" width="4" height="8" rx="2"/><rect x="17" y="12" width="4" height="8" rx="2"/>',
    network:
      '<path d="M5 12a10 10 0 0 1 14 0M2 8a15 15 0 0 1 20 0M8 16a5 5 0 0 1 8 0"/><circle cx="12" cy="20" r="1"/>',
    terminal:
      '<rect x="3" y="4" width="18" height="16" rx="2"/><path d="m7 9 3 3-3 3m6 0h4"/>',
    projection:
      '<path d="M3 4h18M4 4v12h16V4M12 16v5m-4 0 4-3 4 3"/><path d="m10 8 5 2-5 2z"/>',
    expand: '<path d="M8 3H3v5m13-5h5v5M3 16v5h5m13-5v5h-5"/>',
    shrink: '<path d="M3 8h5V3m13 5h-5V3M3 16h5v5m13-5h-5v5"/>',
    phone:
      '<rect x="6" y="2" width="12" height="20" rx="2"/><path d="M10 18h4"/>',
    tablet:
      '<rect x="3" y="2" width="18" height="20" rx="2"/><path d="M10 18h4"/>',
    eye: '<path d="M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/>',
    hidden:
      '<path d="m3 3 18 18M9 5a12 12 0 0 1 13 7 18 18 0 0 1-4 4M6 6a18 18 0 0 0-4 6s4 7 10 7a12 12 0 0 0 4-1"/>',
    check: '<path d="m5 12 4 4L19 6"/>',
    alert: '<path d="m12 3 10 18H2zM12 9v5m0 3v.1"/>',
    book: '<path d="M3 4h7l2 2 2-2h7v16h-7l-2 1-2-1H3zM12 6v15"/>',
    package:
      '<path d="m12 2 10 5v10l-10 5-10-5V7zM2 7l10 5 10-5M12 12v10M7 4.5l10 5"/>',
    handoff: '<path d="M5 4h11v5M5 4v16h14v-7M10 12h11m-4-4 4 4-4 4"/>',
    image:
      '<rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8" cy="8" r="1"/><path d="m3 17 6-6 4 4 3-3 5 5"/>',
    tools:
      '<path d="M14 6a5 5 0 0 0-6 6L3 17l4 4 5-5a5 5 0 0 0 6-6l-3 3-4-4z"/>',
    link: '<path d="m9 15 6-6M8 16l-2 2a4 4 0 0 1-6-6l4-4m12 0 2-2a4 4 0 0 1 6 6l-4 4" transform="translate(2 0) scale(.85 1)"/>',
    arrow: '<path d="m10 5-7 7 7 7M3 12h18"/>',
    copy: '<rect x="8" y="8" width="13" height="13" rx="2"/><path d="M16 8V3H3v13h5"/>',
    clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
  }
  const icon = name =>
    `<svg class="icon" viewBox="0 0 24 24" aria-hidden="true">${icons[name] || icons.file}</svg>`
  const esc = value =>
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
    )
  const projects = [
    {
      id: 'inarticulate',
      name: 'Inarticulate III',
      subtitle: '失语 III',
      author: '@肖翔',
      version: '1.0.1',
      source: 'folder',
      group: 'Home',
      channels: 2,
      defaultMode: 'internal',
      performerPort: 6868,
      monitorPort: 6869,
    },
    {
      id: 'splash',
      name: 'Splash Ink',
      subtitle: '泼墨',
      author: 'PNDS Collective',
      version: '1.2.0',
      source: 'folder',
      group: 'Evening set',
      channels: 2,
      defaultMode: 'internal',
      performerPort: 6868,
      monitorPort: 6869,
    },
    {
      id: 'asbs',
      name: 'All Sentient Being Sounds',
      subtitle: '众生之声',
      author: 'PNDS Collective',
      version: '1.0.0',
      source: 'bundle',
      group: 'Evening set',
      channels: 2,
      defaultMode: 'internal',
      performerPort: 6868,
      monitorPort: 6869,
    },
    {
      id: 'external',
      name: 'Remote Ensemble',
      subtitle: '远程合奏',
      author: 'PNDS Collective',
      version: '0.9.0',
      source: 'folder',
      group: 'Home',
      channels: 2,
      defaultMode: 'external',
      telematic: true,
      performerPort: 6868,
      monitorPort: 6869,
    },
    {
      id: 'utility',
      name: 'Multichannel Gen',
      subtitle: '多通道信号发生器',
      author: 'PNDS',
      version: '1.0.0',
      source: 'utility',
      group: 'Utilities',
      channels: 16,
      defaultMode: 'internal',
      performerPort: 6868,
      monitorPort: 6869,
    },
    {
      id: 'diagnostics',
      name: 'Local Diagnostics',
      subtitle: '本地网络诊断',
      author: 'PNDS',
      version: '1.0.0',
      source: 'utility',
      group: 'Utilities',
      channels: 2,
      defaultMode: 'none',
      performerPort: 6868,
      monitorPort: 6869,
    },
  ]
  const monitorCode = [
    '// Inarticulate III · conductor monitor',
    "import { createScore } from './score.js';",
    "import { connectPlayers } from './players.js';",
    '',
    'const score = createScore({',
    '  duration: 480,',
    "  palette: ['#d7dcb7', '#8b9876', '#253329'],",
    '  radius: 180,',
    '});',
    '',
    'const players = connectPlayers({',
    '  onJoin(player) {',
    '    score.addVoice(player.id);',
    '  },',
    '',
    '  onGesture({ id, intensity, position }) {',
    '    score.updateVoice(id, {',
    '      intensity,',
    '      position,',
    '    });',
    '  },',
    '});',
    '',
    'function draw(time) {',
    '  score.clear();',
    '  score.drawOrbit(time);',
    '  score.drawVoices(players.active);',
    '  requestAnimationFrame(draw);',
    '}',
    '',
    'requestAnimationFrame(draw);',
  ].join('\n')
  const initialFiles = project => ({
    'manifest.json': JSON.stringify(
      {
        schemaVersion: 1,
        id: project.id,
        name: project.name,
        version: project.version,
        description: 'A networked digital score for three performers.',
        scoreServer: {
          entry: 'server.js',
          workingDirectory: '.',
          performerPort: 6868,
          monitorPort: 6869,
        },
        audio: {
          defaultMode: project.defaultMode,
          supportedModes: ['internal', 'external', 'none'],
          outputChannels: project.channels,
          synthdefs: ['supercollider/synthdefs/inarticulate.scsyndef'],
          scsynth: { blockSize: 64, audioBusChannels: 128 },
        },
      },
      null,
      2
    ),
    'README.zh-CN.md':
      '# 失语 III\n\n**作者**：@肖翔\n\n## 简介\n\n一首关于距离、呼吸与回应的网络化数字乐谱。三位演奏者通过触摸与倾斜，让微小的动作在共同的声音空间中相遇。\n\n## 演奏方式\n\n连接同一局域网，扫描 Monitor 上的二维码进入演奏页面。先倾听，再加入。\n',
    'README.md':
      '# Inarticulate III\n\n**Composer**: @肖翔\n\n## About\n\nA networked digital score for three performers. Touch, tilt and listen. Small gestures meet in a shared sonic space.\n',
    'server.js':
      "import http from 'node:http';\nimport { createProjectServer } from './modules/server.js';\n\nconst project = createProjectServer({\n  host: process.env.PNDS_HOST_IP,\n  monitorPort: Number(process.env.PNDS_MONITOR_PORT),\n  performerPort: Number(process.env.PNDS_PERFORMER_PORT),\n});\n\nawait project.start();\n",
    'package.json': JSON.stringify(
      {
        name: project.id,
        private: true,
        engines: { node: '>=24 <25' },
        dependencies: { 'socket.io': '^4.8.0' },
      },
      null,
      2
    ),
    'public/monitor.js': monitorCode,
    'public/performer.js':
      "// Performer gestures belong to the project.\nconst pad = document.querySelector('#touch-pad');\n\npad.addEventListener('pointermove', event => {\n  sendGesture({ x: event.offsetX, y: event.offsetY });\n});\n",
    'public/index.html':
      '<!doctype html>\n<html lang="zh-CN">\n  <head><title>Inarticulate III</title></head>\n  <body>\n    <main id="score"></main>\n    <script type="module" src="monitor.js"></script>\n  </body>\n</html>',
    'supercollider/source/inarticulate.scd':
      '// Compile all standard project sources.\n(\nSynthDef(\\inarticulate, { |out = 0, freq = 220, amp = 0.1|\n  var env = EnvGen.kr(Env.perc(0.02, 3), doneAction: 2);\n  var sound = SinOsc.ar(freq) * env * amp;\n  Out.ar(out, sound);\n}).writeDefFile;\n)\n',
    'supercollider/synthdefs/inarticulate.scsyndef': '[binary: 1428 bytes]',
    'modules/players.js':
      '// Project-owned player registry.\nexport const players = new Map();\n',
    'modules/theme-follow.js':
      '// Optional theme bridge.\nexport function applyTheme(theme) {\n  document.documentElement.dataset.theme = theme;\n}\n',
    'assets/cover.svg': '[image: cover illustration]',
    'docs/creator-handoff.md':
      '# Creator handoff\n\nNo pending handoff notes.\n',
    'package-lock.json': '{\n  "lockfileVersion": 3,\n  "requires": true\n}',
    '.github/workflows/package.yml': 'name: Package\non: workflow_dispatch\n',
    'test/audio.test.js': '// Audio contract checks live with the project.\n',
  })
  const workspaces = Object.fromEntries(
    projects.map(p => [
      p.id,
      {
        disk: initialFiles(p),
        drafts: {},
        dirty: new Set(),
        pending: new Set(),
        conflict: null,
        tested: p.id === 'inarticulate',
        savedRevision: 1,
      },
    ])
  )
  const S = {
    theme: 'pond',
    language: 'zh-CN',
    mode: 'creation',
    selected: 'inarticulate',
    workspace: 'inarticulate',
    running: 'inarticulate',
    status: 'ready',
    applied: {
      device: 'MacBook Pro Speakers',
      rate: '48000',
      lan: '192.168.31.13',
      audioMode: 'internal',
      channels: 2,
      oscTarget: '127.0.0.1:57110',
      https: false,
      room: '1',
      nodeName: 'Studio Mac',
      hub: '',
    },
    device: 'MacBook Pro Speakers',
    rate: '48000',
    lan: '192.168.31.13',
    nodeName: 'Studio Mac',
    hub: '',
    https: false,
    dns: false,
    room: '1',
    volume: 80,
    muted: false,
    projects,
    files: workspaces,
    file: 'public/monitor.js',
    editorView: 'form',
    readmeLanguage: 'zh-CN',
    testMode: 'internal',
    oscTarget: '127.0.0.1:57110',
    folder: 'Home',
    folders: ['Home', 'Evening set'],
    fileSearch: '',
    collapsed: new Set(['modules', 'assets', 'support', 'artifacts']),
    console: false,
    sidebar: true,
    sidebarPeek: false,
    preview: true,
    expanded: false,
    immersive: false,
    chrome: true,
    pinnedChrome: false,
    performers: [],
    nextPerformer: 1,
    generation: 1,
    pageRevision: 1,
    gesture: 0,
    projection: false,
    projectionLive: false,
    settingsSection: 'general',
    searchOpen: false,
    simFailure: false,
    logs: [],
  }
  const t = (zh, en) => (S.language === 'en' ? en : zh)
  const project = id => projects.find(p => p.id === id)
  const ws = () => (S.workspace ? workspaces[S.workspace] : null)
  const current = () =>
    project(S.mode === 'creation' ? S.workspace : S.selected)
  const runningProject = () => project(S.running)
  const text = path => ws()?.drafts[path] ?? ws()?.disk[path] ?? ''
  const formField = (label, name, value, extra = '') =>
    `<label class="field-stack"><span>${label}</span><input data-edit="${name}" value="${esc(value)}" ${extra}></label>`
  const button = (action, label, ico = '', extra = '', cls = '') =>
    `<button class="btn ${cls}" data-action="${action}" ${extra}>${ico ? icon(ico) : ''}${label}</button>`
  const ib = (action, name, label, extra = '') =>
    `<button class="icon-btn" data-action="${action}" title="${esc(label)}" aria-label="${esc(label)}" ${extra}>${icon(name)}</button>`
  const menu = (action, label, name = '', extra = '', shortcut = '') =>
    `<button class="menu-item" data-action="${action}" ${extra}>${name ? icon(name) : ''}<span>${label}</span>${shortcut ? `<kbd>${shortcut}</kbd>` : ''}</button>`
  let modeIntent = null,
    modeSettling = false,
    modeHoverPaused = false,
    modeSwitchTimer,
    sidebarPointer = false,
    sidebarPointerActive = false,
    sidebarDragging = false,
    sidebarKeyboard = false
  let popover = null,
    modalKind = null,
    confirmAction = null,
    toastTimer,
    revealTimer,
    lastFocus
  const childWindows = new Map()
  function log(message, source = 'host', level = 'info') {
    S.logs.push({
      time: new Date().toLocaleTimeString('en-GB', { hour12: false }),
      source,
      message,
      level,
    })
    if (S.logs.length > 150) S.logs.shift()
  }
  log('Demo session ready · Inarticulate III', 'host')
  log('Performer :6868 · Monitor :6869', 'node')
  log('Internal · 2ch · 48 kHz · master 80%', 'audio')

  function toast(message) {
    const el = document.getElementById('toast')
    el.textContent = message
    el.classList.add('visible')
    clearTimeout(toastTimer)
    toastTimer = setTimeout(() => el.classList.remove('visible'), 2800)
  }
  function closePopover() {
    popover = null
    document.getElementById('popover-root').innerHTML = ''
    updateSidebarVisibility()
  }
  function dialog(title, html, footer = '') {
    closePopover()
    const d = document.getElementById('dialog')
    modalKind = html.includes('settings-layout') ? 'settings' : 'generic'
    d.className = modalKind === 'settings' ? 'settings-dialog' : ''
    d.innerHTML = `<div class="dialog-head"><h2 id="dialog-title">${title}</h2>${ib('close-dialog', 'close', t('关闭', 'Close'))}</div><div class="dialog-body">${html}</div>${footer ? `<div class="dialog-footer">${footer}</div>` : ''}`
    if (!d.open) {
      lastFocus = document.activeElement
      d.showModal()
    }
    updateSidebarVisibility()
  }
  function closeDialog() {
    document.getElementById('dialog').close()
    modalKind = null
    confirmAction = null
    lastFocus?.focus?.()
    updateSidebarVisibility()
  }
  function confirm(title, body, action, label = t('确认', 'Confirm')) {
    confirmAction = action
    dialog(
      title,
      body,
      button('close-dialog', t('取消', 'Cancel')) +
        button('confirm', label, '', '', 'primary')
    )
  }
  function setTheme(theme) {
    S.theme = theme
    document.documentElement.dataset.theme = theme
    broadcast({ action: 'theme', theme })
    render()
  }
  const hasPending = () =>
    !!S.running &&
    [
      'device',
      'rate',
      'lan',
      'oscTarget',
      'https',
      'room',
      'nodeName',
      'hub',
    ].some(k => String(S[k]) !== String(S.applied[k]))
  const adjustable = () =>
    !!S.running && S.applied.audioMode === 'internal' && S.applied.channels <= 2
  function broadcast(message) {
    for (const w of childWindows.values()) {
      try {
        if (!w.closed)
          w.postMessage({ type: 'pnds-prototype', ...message }, '*')
      } catch {
        /* A child window may already be closed. */
      }
    }
  }
  window.P = {
    state: S,
    icon,
    escape: esc,
    t,
    render,
    toast,
    dialog,
    closeDialog,
    log,
    setTheme,
  }

  function scoreArt(large = false) {
    const pulse = S.gesture
    return `<svg class="monitor-art" viewBox="0 0 700 450" role="img" aria-label="${t('失语 III 乐谱监视画面，演示数据', 'Inarticulate III score monitor, demo data')}">
      <rect width="700" height="450" fill="#141717"/>
      <g fill="#bfc5b1" font-family="ui-monospace,monospace" font-size="8">
        <text x="28" y="33" letter-spacing="2">INARTICULATE III</text><text x="28" y="48" opacity=".45">NETWORKED DIGITAL SCORE</text>
        <text x="570" y="33">${S.running ? 'LIVE SCORE' : 'SCORE PREVIEW'}</text><text x="570" y="48" opacity=".45">${S.performers.length} TEST CLIENTS</text>
        <text x="28" y="422" opacity=".6">TOUCH · TILT · LISTEN</text><text x="560" y="422" opacity=".6">${String(S.pageRevision).padStart(2, '0')} / 08:00</text>
      </g>
      <g fill="none" stroke="#88927d" opacity=".26">
        <circle cx="350" cy="222" r="158"/><circle cx="350" cy="222" r="124"/><circle cx="350" cy="222" r="90"/><circle cx="350" cy="222" r="56"/>
        <path d="M192 222h316M350 64v316" stroke-dasharray="2 6"/>
      </g>
      <g stroke="#cbd4b7" fill="none" stroke-width="1.2" opacity=".72">
        <path d="M218 305C270 187 295 161 350 221S431 260 487 157"/>
        <path d="M242 119C376 84 416 256 350 222S260 277 412 363" opacity=".5"/>
        <path d="M212 160C272 273 358 121 466 288" opacity=".3"/>
      </g>
      <g fill="#d5dfb9">
        <circle cx="254" cy="242" r="${5 + pulse * 7}" opacity=".85"/><circle cx="420" cy="188" r="4"/><circle cx="407" cy="314" r="3"/>
        <circle cx="254" cy="242" r="${12 + pulse * 20}" fill="none" stroke="#d5dfb9" opacity=".25"/>
      </g>
      <g fill="#d5dfb9" font-family="-apple-system,sans-serif" font-size="9"><text x="267" y="239">01</text><text x="434" y="189">02</text><text x="419" y="315">03</text></g>
      <text x="350" y="225" fill="#d5dfb9" font-family="-apple-system,sans-serif" font-size="11" text-anchor="middle" letter-spacing="5">失语</text>
      <g stroke="#87907f" opacity=".45"><path d="M28 90h55M28 94h32M28 98h44M590 360h82M590 364h55M590 368h70"/></g>
      ${large ? '<text x="350" y="400" fill="#89957d" font-family="-apple-system,sans-serif" font-size="8" text-anchor="middle">演出画面示意 · 不连接实际工程</text>' : ''}
    </svg>`
  }
  function coverArt() {
    return '<svg viewBox="0 0 680 180" fill="none" aria-hidden="true"><g stroke="currentColor" opacity=".45"><ellipse cx="330" cy="90" rx="280" ry="65"/><ellipse cx="330" cy="90" rx="205" ry="65"/><ellipse cx="330" cy="90" rx="120" ry="65"/><ellipse cx="330" cy="90" rx="42" ry="65"/><path d="M25 90h620M330 18v144"/></g><g fill="currentColor"><circle cx="154" cy="42" r="4"/><circle cx="477" cy="139" r="4"/><circle cx="343" cy="27" r="3"/></g></svg>'
  }
  function renderSidebarChrome() {
    return '<div class="sidebar-chrome"><div class="traffic" aria-hidden="true"><span></span><span></span><span></span></div></div>'
  }
  function renderPrototypeMenu() {
    return `<button class="prototype-tag" data-action="demo-menu" title="${t('原型场景与主题', 'Prototype scenarios and themes')}"><span>${t('原型', 'Prototype')}</span>${icon('down')}</button>`
  }
  function renderModeSwitch() {
    const control = document.querySelector('.mode-control')
    if (!control) return
    const button = control.querySelector('.mode-switch')
    const currentLabel =
      S.mode === 'creation'
        ? t('创作模式', 'Creation mode')
        : t('演出模式', 'Performance mode')
    const nextLabel =
      S.mode === 'creation'
        ? t('演出模式', 'Performance')
        : t('创作模式', 'Creation')
    button.dataset.mode = S.mode
    button.classList.toggle('armed', !!modeIntent && !modeSettling)
    button.classList.toggle('settling', modeSettling)
    button.classList.toggle('hover-paused', modeHoverPaused)
    button.disabled = modeSettling || S.status === 'starting'
    button.setAttribute('aria-pressed', String(!!modeIntent && !modeSettling))
    button.setAttribute(
      'aria-label',
      modeSettling
        ? t('正在切换到', 'Switching to ') + nextLabel
        : modeIntent
          ? t('再次点击切换到', 'Click again to switch to ') + nextLabel
          : currentLabel + t('，切换到', '; switch to ') + nextLabel
    )
    const labels = modeSettling
      ? `<span class="mode-label mode-settled">${nextLabel}</span>`
      : modeIntent
        ? `<span class="mode-label mode-confirm">${t('再次点击切换', 'Confirm switch')}</span>`
        : `<span class="mode-label mode-current">${currentLabel}</span><span class="mode-label mode-next" aria-hidden="true">${t('切换到', 'Switch to ')}${nextLabel}</span>`
    if (button.innerHTML !== labels) button.innerHTML = labels
    const warning = modeIntent && !modeSettling ? modeIntent.warning : ''
    const existingNote = control.querySelector('#mode-switch-note')
    if (warning) {
      const note = existingNote || document.createElement('p')
      note.id = 'mode-switch-note'
      note.className = 'mode-switch-note'
      note.setAttribute('role', 'status')
      note.textContent = warning
      if (!existingNote) control.append(note)
      button.setAttribute('aria-describedby', note.id)
    } else {
      existingNote?.remove()
      button.removeAttribute('aria-describedby')
    }
  }
  function autoSidebar() {
    return S.mode === 'performance' && !!S.running && S.status === 'ready'
  }
  function updateSidebarVisibility() {
    const app = document.getElementById('app')
    const sidebar = app?.querySelector('.performance-sidebar')
    if (!sidebar) return
    const automatic = autoSidebar()
    const visible =
      !automatic ||
      sidebarPointer ||
      sidebarPointerActive ||
      sidebarDragging ||
      S.sidebarPeek ||
      S.pinnedChrome ||
      !!popover ||
      !!document.getElementById('dialog')?.open ||
      !!modeIntent ||
      modeSettling ||
      (sidebarKeyboard &&
        !!document.activeElement?.closest('.performance-sidebar'))
    app.classList.toggle('sidebar-auto-hide', automatic)
    app.classList.toggle('sidebar-revealed', visible)
    sidebar.inert = !visible || (!automatic && !S.sidebar)
    sidebar.setAttribute('aria-hidden', String(sidebar.inert))
    const zone = app.querySelector('.sidebar-reveal-zone')
    if (zone) zone.hidden = !automatic
  }
  function bindSidebarHover() {
    for (const surface of document.querySelectorAll(
      '.performance-sidebar,.sidebar-reveal-zone'
    )) {
      surface.addEventListener('pointerenter', () => {
        sidebarPointer = true
        updateSidebarVisibility()
      })
      surface.addEventListener('pointerleave', e => {
        if (
          e.relatedTarget?.closest?.(
            '.performance-sidebar,.sidebar-reveal-zone'
          )
        )
          return
        sidebarPointer = false
        S.sidebarPeek = false
        updateSidebarVisibility()
      })
    }
  }
  const groups = [
    [
      'runtime',
      '运行与依赖',
      'Runtime & dependencies',
      ['server.js', 'package.json'],
    ],
    [
      'pages',
      '页面',
      'Pages',
      ['public/index.html', 'public/monitor.js', 'public/performer.js'],
    ],
    ['audio', '声音', 'Audio', ['supercollider/source/inarticulate.scd']],
    [
      'artifacts',
      '编译产物',
      'Compiled artifacts',
      ['supercollider/synthdefs/inarticulate.scsyndef'],
    ],
    [
      'modules',
      '模块',
      'Modules',
      ['modules/players.js', 'modules/theme-follow.js'],
    ],
    ['assets', '资源', 'Assets', ['assets/cover.svg']],
    [
      'support',
      '工程支持',
      'Project support',
      [
        'docs/creator-handoff.md',
        'package-lock.json',
        '.github/workflows/package.yml',
        'test/audio.test.js',
      ],
    ],
  ]
  function renderCreationSidebar() {
    const p = project(S.workspace)
    if (!p)
      return `<aside class="sidebar">${renderSidebarChrome()}<div class="sidebar-head"><button class="project-picker" data-action="project-menu">${icon('folder')}${t('创作工程', 'Projects')}<span class="chevron">${icon('down')}</span></button></div><div class="file-tree"><p class="subtle" style="padding:12px">${t('打开一个文件夹工程，开始创作。', 'Open a folder project to begin.')}</p></div><div class="side-bottom">${renderPrototypeMenu()}<span class="spacer"></span>${ib('help', 'book', t('帮助', 'Help'))}</div></aside>`
    const w = ws(),
      readme = S.readmeLanguage === 'en' ? 'README.md' : 'README.zh-CN.md'
    const pinned = [
      [
        'manifest.json',
        'settings',
        t('工程声明', 'Project settings'),
        'manifest.json',
      ],
      [readme, 'book', t('作品说明', 'Project README'), 'README'],
    ]
    return `<aside class="sidebar">${renderSidebarChrome()}<div class="sidebar-head"><button class="project-picker" data-action="project-menu">${icon('folder')}<strong>${esc(p.name)}</strong><span class="chevron">${icon('down')}</span></button><div class="sidebar-subline">${t('本地文件夹工程', 'Local folder project')}</div></div>
      <div class="pinned-files">${pinned.map(([path, name, label, sub]) => `<button class="pin ${S.file === path ? 'active' : ''}" data-action="file" data-path="${path}">${icon(name)}<span>${label}<small>${sub}</small></span>${w.dirty.has(path) ? '<i class="dot dirty dirty-dot"></i>' : ''}</button>`).join('')}</div>
      <label class="file-filter">${icon('search')}<input id="file-search" aria-label="${t('搜索文件', 'Search files')}" placeholder="${t('搜索文件…', 'Find a file…')}" value="${esc(S.fileSearch)}"></label>
      <nav class="file-tree" aria-label="${t('工程文件', 'Project files')}">${groups
        .map(([id, zh, en, paths]) => {
          const shown = paths.filter(
            path =>
              w.disk[path] !== undefined &&
              path.toLowerCase().includes(S.fileSearch.toLowerCase())
          )
          if (!shown.length) return ''
          const collapsed = S.collapsed.has(id) && !S.fileSearch
          return `<section class="file-group"><button class="group-label" data-action="group" data-group="${id}" aria-expanded="${!collapsed}">${icon(collapsed ? 'chevron' : 'down')}${t(zh, en)}<span>${shown.length}</span></button>${collapsed ? '' : shown.map(path => `<button class="file-row ${S.file === path ? 'active' : ''}" data-action="file" data-path="${path}" title="${path}">${icon(path.endsWith('.scd') ? 'music' : path.endsWith('.svg') ? 'image' : path.endsWith('.js') || path.endsWith('.html') ? 'code' : 'file')}<span class="file-name">${esc(path.split('/').at(-1))}</span>${w.dirty.has(path) ? '<i class="dot dirty dirty-dot"></i>' : path === 'server.js' ? `<span class="file-role">${t('入口', 'Entry')}</span>` : ''}</button>`).join('')}</section>`
        })
        .join('')}</nav>
      <div class="side-bottom">${renderPrototypeMenu()}<span class="spacer"></span><span>${Object.keys(w.disk).length} ${t('个文件', 'files')}</span>${ib('finder', 'folder', t('在 Finder 中显示', 'Reveal in Finder'))}</div>
    </aside>`
  }
  function renderPerformanceSidebar() {
    const listed = projects.filter(p =>
      S.folder === 'Home' ? p.source !== 'utility' : p.group === S.folder
    )
    return `<aside class="sidebar performance-sidebar">${renderSidebarChrome()}<div class="sidebar-head"><div class="project-picker">${icon('music')}<strong>${t('演出作品', 'Performances')}</strong>${ib('folder-menu', 'more', t('管理演出文件夹', 'Manage folders'))}</div></div>
      <div class="sidebar-nav"><select id="folder-select" aria-label="${t('演出文件夹', 'Performance folder')}">${S.folders.map(f => `<option value="${esc(f)}" ${S.folder === f ? 'selected' : ''}>${f === 'Home' ? t('所有作品', 'All projects') : esc(f)}</option>`).join('')}<option value="Utilities" ${S.folder === 'Utilities' ? 'selected' : ''}>${t('内置工具', 'Utilities')}</option></select>${ib('utilities', 'tools', t('内置工具', 'Utilities'))}</div>
      <div class="project-list">${listed.map((p, i) => `<button class="project-row ${S.selected === p.id ? 'active' : ''} ${S.running === p.id ? 'running' : ''}" data-action="select-project" data-id="${p.id}" draggable="${p.source !== 'utility'}" data-project="${p.id}" aria-pressed="${S.selected === p.id}"><span class="project-icon">${icon(p.source === 'utility' ? 'tools' : p.source === 'bundle' ? 'package' : 'music')}</span><span><strong>${esc(p.name)}</strong><small>${p.source === 'bundle' ? '.pnds' : p.source === 'utility' ? t('内置工具', 'Built-in utility') : t('文件夹工程', 'Folder project')}</small></span>${S.running === p.id ? icon('play') : `<kbd>⌘${i + 1}</kbd>`}</button>`).join('')}
      <button class="import-button" data-action="import">${icon('plus')}${t('导入工程', 'Import project')}</button></div>
      <div class="side-bottom">${renderPrototypeMenu()}<span class="spacer"></span><span>${listed.length} ${t('个作品', 'projects')}</span>${ib('help', 'book', t('帮助', 'Help'))}</div></aside>`
  }
  function savedModes(id = S.workspace) {
    try {
      return JSON.parse(
        workspaces[id].disk['manifest.json']
      ).audio.supportedModes.filter(v =>
        ['internal', 'external', 'none'].includes(v)
      )
    } catch {
      return []
    }
  }
  function manifestForm() {
    let m
    try {
      m = JSON.parse(text('manifest.json'))
      if (
        !m?.audio?.scsynth ||
        !m?.scoreServer ||
        !Array.isArray(m.audio.supportedModes) ||
        !Array.isArray(m.audio.synthdefs)
      )
        throw Error('Invalid declaration')
    } catch {
      return `<div class="form-page"><div class="notice warning">${t('JSON 无法解析，请切换源码视图修正。', 'Invalid JSON. Open Source to repair it.')}</div></div>`
    }
    return `<div class="form-page"><div class="page-title"><h1>${t('工程声明', 'Project settings')}</h1><span class="chip">manifest.json</span></div>
      <section class="form-section"><h3>${t('作品身份', 'Identity')}</h3><div class="form-grid">
        ${formField(t('名称', 'Name'), 'manifest:name', m.name)}${formField(t('版本', 'Version'), 'manifest:version', m.version)}
        <div class="span-2">${formField(t('工程 ID', 'Project ID'), 'manifest:id', m.id)}</div>
        <label class="field-stack span-2"><span>${t('描述', 'Description')}</span><textarea rows="2" data-edit="manifest:description">${esc(m.description)}</textarea></label>
      </div></section>
      <section class="form-section"><h3>${t('音频声明', 'Audio declaration')}</h3>
        <label class="field"><span>${t('工程默认模式', 'Default mode')}</span><select data-edit="manifest:audio.defaultMode">${m.audio.supportedModes.map(v => `<option ${m.audio.defaultMode === v ? 'selected' : ''}>${v}</option>`).join('')}</select></label>
        <div class="field"><span>${t('支持的测试模式', 'Supported test modes')}</span><span class="subtle">${m.audio.supportedModes.map(esc).join(' / ')}</span></div>
        <div class="form-grid" style="margin-top:12px">${formField(t('输出通道', 'Output channels'), 'manifest:audio.outputChannels', m.audio.outputChannels, 'type="number" min="1" max="64"')}${formField(t('音频总线', 'Audio buses'), 'manifest:audio.scsynth.audioBusChannels', m.audio.scsynth.audioBusChannels, 'type="number"')}</div>
        <p class="subtle" style="margin-top:12px">${t('输出设备与采样率由窗口底部的音频输出设置管理。', 'Output device and sample rate are available in the bottom audio controls.')}</p>
      </section>
      <section class="form-section"><h3>${t('服务与端口', 'Server & ports')}</h3><div class="form-grid">
        <div class="span-2">${formField(t('服务器入口', 'Server entry'), 'manifest:scoreServer.entry', m.scoreServer.entry)}</div>
        ${formField('Performer', 'manifest:scoreServer.performerPort', m.scoreServer.performerPort, 'type="number"')}${formField('Monitor', 'manifest:scoreServer.monitorPort', m.scoreServer.monitorPort, 'type="number"')}
      </div></section>
      <section class="form-section"><details><summary class="subtle">${t('其他声明与 SynthDef 引用', 'Other declarations & SynthDef references')}</summary><p class="mono" style="margin-top:12px">${esc(m.audio.synthdefs.join('\n'))}</p><p class="subtle">${t('可在源码视图中编辑完整声明。', 'Edit the full declaration in Source view.')}</p></details></section>
    </div>`
  }
  function readmeView() {
    if (S.editorView === 'form') {
      const raw = text(S.file),
        title = raw.match(/^# (.+)/)?.[1] || '',
        desc =
          raw
            .split(/\n## (?:简介|About)\n\n/)[1]
            ?.split('\n## ')[0]
            ?.trim() || ''
      return `<div class="form-page"><div class="page-title"><h1>${t('作品说明', 'Project README')}</h1></div><div class="form-grid">
        <div class="span-2">${formField(t('作品标题', 'Title'), 'readme:title', title)}</div>
        <div class="span-2">${formField(t('作者', 'Composer'), 'readme:author', '@肖翔')}</div>
        <label class="field-stack span-2"><span>${t('简介', 'About the piece')}</span><textarea data-edit="readme:description" rows="6">${esc(desc)}</textarea></label>
      </div><div class="divider"></div><div class="row"><span class="subtle">${t('此说明用于演出准备与投影简介。', 'Shown during preparation and on the projection cover.')}</span></div><div style="margin-top:20px">${button('readme-sync', t('记录翻译交接', 'Record translation handoff'), 'handoff', '', 'ghost')}</div></div>`
    }
    const raw = text(S.file)
    return `<article class="readme-preview"><div class="cover-art" style="height:110px;margin:15px 0 25px">${coverArt()}</div><h1>${esc(raw.match(/^# (.+)/)?.[1] || current().name)}</h1><p class="subtle">@肖翔 · 2026</p><p class="abstract">${esc(
      raw
        .split(/\n## (?:简介|About)\n\n/)[1]
        ?.split('\n## ')[0]
        ?.trim() || raw
    )}</p><h3>${esc(raw.match(/\n## (演奏方式|Performance notes)/)?.[1] || '')}</h3><p class="subtle">${esc(
      raw
        .split(/\n## (?:演奏方式|Performance notes)\n\n/)[1]
        ?.split('\n## ')[0]
        ?.trim() || ''
    )}</p></article>`
  }
  function editorBody() {
    const path = S.file
    if (path === 'manifest.json' && S.editorView !== 'source')
      return manifestForm()
    if (path.startsWith('README') && S.editorView !== 'source')
      return readmeView()
    if (path.endsWith('.scsyndef'))
      return `<div class="form-page"><h2>${t('SynthDef 编译产物', 'Compiled SynthDef')}</h2><div class="divider"></div><div class="artifact-box stack">${icon('music')}<strong>inarticulate.scsyndef</strong><p class="subtle">1.4 KB · ${t('已由 manifest 引用', 'Referenced in manifest')}</p><p class="subtle">${t('编译产物供运行使用。修改声音请打开对应的 SCD 源码。', 'This artifact is used at runtime. Open SCD source to edit sound.')}</p>${button('open-scd', t('打开声音源码', 'Open sound source'), 'code')}</div></div>`
    if (path.endsWith('.svg'))
      return `<div class="form-page"><h2>cover.svg</h2><div class="cover-art">${coverArt()}</div><p class="subtle">${t('工程封面 · 图像预览', 'Project cover · image preview')}</p>${button('finder', t('在 Finder 中显示', 'Reveal in Finder'), 'folder')}</div>`
    const value = text(path),
      count = Math.max(value.split('\n').length, 25)
    return `<div class="code-wrap"><div class="line-numbers" aria-hidden="true">${Array.from({ length: count }, (_, i) => i + 1).join('\n')}</div><textarea id="code-input" class="code-input" spellcheck="false" aria-label="${esc(path)}" data-edit="source">${esc(value)}</textarea></div>`
  }
  function renderEditor() {
    const w = ws(),
      isManifest = S.file === 'manifest.json',
      readme = S.file.startsWith('README'),
      binary = S.file.endsWith('.scsyndef') || S.file.endsWith('.svg')
    return `<section class="editor-pane" aria-label="${t('编辑区', 'Editor')}">
      <div class="editor-tabs">${icon(isManifest ? 'settings' : readme ? 'book' : 'code')}<span class="filename">${esc(S.file.split('/').at(-1))}</span><span id="active-dirty">${w.dirty.has(S.file) ? '<i class="dot dirty"></i>' : ''}</span>
        <div class="editor-tools">${S.file.endsWith('.scd') ? button('compile', t('编译', 'Compile'), 'play') : ''}${!binary ? button('save', t('保存', 'Save'), '', 'id="save-button" ' + (w.dirty.has(S.file) ? '' : 'disabled')) : ''}${ib('file-menu', 'more', t('文件操作', 'File actions'))}</div>
      </div>
      <div class="editor-context"><span class="mono">${esc(S.file.includes('/') ? S.file.split('/').slice(0, -1).join('/') : '/' + current().id)}</span>
        ${readme ? `<select id="readme-language" aria-label="README language" style="font-size:10px;padding:2px 5px;border:0"><option value="zh-CN" ${S.readmeLanguage === 'zh-CN' ? 'selected' : ''}>简体中文</option><option value="en" ${S.readmeLanguage === 'en' ? 'selected' : ''}>English</option></select>` : ''}
        ${isManifest || readme ? `<div class="segmented" aria-label="${t('编辑视图', 'Editor view')}">${(readme ? ['preview', 'form', 'source'] : ['form', 'source']).map(v => `<button data-action="editor-view" data-view="${v}" class="${S.editorView === v ? 'active' : ''}">${v === 'source' ? t('源码', 'Source') : v === 'preview' ? t('预览', 'Preview') : t('编辑', 'Edit')}</button>`).join('')}</div>` : `<span class="spacer"></span>${ib('search-in-file', 'search', t('文件内查找', 'Find in file'))}`}
      </div>
      ${w.conflict ? `<div class="change-strip">${icon('alert')}<span>${t('磁盘版本已改变，你的草稿已保留。', 'Disk changed. Your draft is preserved.')}</span><button data-action="resolve-conflict">${t('处理冲突', 'Resolve')}</button></div>` : ''}
      ${w.pending.size ? `<div class="change-strip"><span>${[...w.pending].map(v => (v === 'refresh' ? t('页面待刷新', 'Pages need refresh') : v === 'compile' ? t('声音待编译', 'Audio needs compilation') : t('运行待重启', 'Restart needed'))).join(' · ')}</span><span class="spacer"></span>${w.pending.has('compile') ? `<button data-action="open-scd">${t('查看源码', 'Open source')}</button>` : w.pending.has('restart') ? `<button data-action="restart">${t('重启', 'Restart')}</button>` : `<button data-action="refresh">${t('刷新页面', 'Refresh pages')}</button>`}</div>` : ''}
      ${S.searchOpen ? `<div class="search-strip"><input id="find-text" placeholder="${t('查找当前文件…', 'Find in this file…')}">${button('find-next', t('查找', 'Find'))}${ib('close-search', 'close', t('关闭查找', 'Close find'))}</div>` : ''}
      <div class="editor-body">${editorBody()}</div>
      <div class="editor-status"><span id="save-status">${w.dirty.has(S.file) ? t('未保存', 'Unsaved') : t('已保存', 'Saved')}</span><span>UTF-8</span><span class="spacer"></span><span>${t('测试使用保存版', 'Tests use saved files')}</span></div>
    </section>`
  }
  function renderPreview() {
    const live = S.running === S.workspace
    return `<aside class="preview-pane" aria-label="${t('测试与预览', 'Test & preview')}">
      <div class="preview-head"><strong>Monitor</strong><span class="chip">${live ? '<i class="dot"></i>' : ''}${live ? t('运行中', 'Running') : t('未启动', 'Stopped')}</span><span class="spacer"></span>${ib('toggle-preview', 'sidebar', t('收起预览', 'Hide preview'))}${ib('expand', 'expand', t('展开 Monitor', 'Expand Monitor'))}</div>
      <div class="preview-body"><div class="monitor-wrap">${live ? scoreArt() : `<div class="empty-preview">${icon('monitor')}<span>${t('启动测试后显示乐谱', 'Start a test to see the score')}</span></div>`}</div>
      <div class="monitor-caption"><span class="mono">${live ? `${esc(S.applied.lan)}:6869` : '—'}</span><button data-action="copy-address">${icon('copy')}${t('复制地址', 'Copy address')}</button></div>
      <div class="preview-config"><span>${t('测试音频', 'Test audio')}</span><select id="test-audio-mode" aria-label="${t('测试音频模式', 'Test audio mode')}">${savedModes()
        .map(
          v =>
            `<option value="${v}" ${S.testMode === v ? 'selected' : ''}>${v[0].toUpperCase() + v.slice(1)}</option>`
        )
        .join('')}</select></div>
      ${live && S.testMode !== S.applied.audioMode ? `<p class="preview-note warning">${t('配置待应用；当前运行', 'Pending; currently running')} ${S.applied.audioMode}</p>` : ''}
      <div class="performer-head"><strong>${t('测试设备', 'Test devices')} <span class="subtle">${S.performers.length}</span></strong>${ib('add-performer', 'plus', t('添加 Performer 窗口', 'Add Performer window'))}</div>
      ${S.performers.length ? S.performers.map(p => `<div class="performer-row">${icon(p.device === 'tablet' ? 'tablet' : 'phone')}<div class="performer-info"><button data-action="show-performer" data-id="${p.id}" style="padding:0;text-align:start"><strong>Performer ${String(p.id).padStart(2, '0')}</strong></button><small>${t(p.device === 'tablet' ? '平板' : '手机', p.device === 'tablet' ? 'Tablet' : 'Phone')} · ${p.hidden ? t('已隐藏', 'Hidden') : t('独立窗口', 'Separate window')}</small></div>${ib('show-performer', p.hidden ? 'hidden' : 'eye', t('显示／隐藏窗口', 'Show / hide window'), `data-id="${p.id}"`)}${ib('delete-performer', 'close', t('删除设备', 'Remove device'), `data-id="${p.id}"`)}</div>`).join('') : `<div class="preview-empty">${t('添加独立窗口，检查手机与平板上的交互。', 'Add a window to try phone and tablet interactions.')}</div>`}
      <p class="preview-note">${t('测试窗口直接模拟工程页面。页面已打开不代表服务器确认连接。', 'Test windows simulate project pages. An open page does not confirm a server connection.')}</p>
      </div></aside>`
  }
  function renderCover(p) {
    return `<article class="work-cover"><div class="cover-topline"><span>${t('作品简介', 'Project introduction')}</span><span>${p.source === 'bundle' ? '.pnds' : p.source === 'utility' ? t('内置工具', 'Built-in utility') : t('本地工程', 'Local project')} / ${p.version}</span></div><div class="cover-art">${coverArt()}</div><h1>${esc(S.language === 'en' ? p.name : p.subtitle)}</h1><p class="cover-subtitle">${esc(p.name)} · ${esc(p.author)}</p><p class="cover-description">${p.source === 'utility' ? t('检查演出前的音频与网络环境。此原型仅展示操作界面，不会发声或启动服务。', 'Check the audio and network setup before a performance. This prototype does not produce sound or start services.') : t('一首关于距离、呼吸与回应的网络化数字乐谱。演奏者通过触摸与倾斜，让微小的动作在共同的声音空间中相遇。', 'A networked digital score about distance, breath and response. Small gestures meet in a shared sonic space.')}</p><dl class="cover-facts"><div><dt>${t('音频', 'Audio')}</dt><dd>${p.defaultMode} · ${p.channels}ch</dd></div><div><dt>${t('版本', 'Version')}</dt><dd>${p.version}</dd></div><div><dt>${t('启动检查', 'Preflight')}</dt><dd class="success">${t('可以加载', 'Ready to load')}</dd></div></dl></article>`
  }
  function renderPerformance() {
    if (S.status === 'error')
      return `<main class="performance-main" style="display:flex"><div class="error-screen"><span class="chip">${t('启动失败', 'Start failed')}</span><h2 style="margin-top:17px">${t('无法启动工程服务器', 'Could not start the project server')}</h2><p class="subtle">${t('端口 6868 被其他进程占用。检查占用后重试。', 'Port 6868 is occupied. Inspect the process and retry.')}</p><div class="row" style="margin-top:20px">${button('retry', t('重试', 'Retry'), 'refresh', '', 'primary')}${button('settings-ports', t('检查端口', 'Inspect ports'), 'network')}${button('stop', t('返回作品', 'Back to project'))}</div><details style="margin-top:25px"><summary class="subtle">${t('技术详情', 'Technical details')}</summary><pre>Stage: server bind\nPort: 6868\nEADDRINUSE · 127.0.0.1:6868\nPrototype scenario — no actual process was started.</pre></details></div></main>`
    return `<main class="performance-main">${S.running ? `<div class="performance-running">${scoreArt(true)}<div class="performance-live-label"><i class="dot"></i>${esc(runningProject().name)}</div>${S.selected !== S.running ? `<div class="running-selection"><span>${t('准备加载', 'Preparing')} <strong>${esc(project(S.selected).name)}</strong></span>${button('selected-info', t('查看简介', 'View intro'), 'book')}</div>` : ''}</div>` : current() ? renderCover(current()) : '<div class="home-screen">PNDS</div>'}</main>`
  }
  function renderHome() {
    return `<main class="editor-pane" style="justify-content:center"><div class="home-screen"><span class="subtle">PNDS / ${t('创作', 'Create')}</span><h1 style="margin-top:15px">${t('从一个工程开始。', 'Begin with a project.')}</h1><p class="subtle">${t('编辑、测试，然后带到演出现场。', 'Edit, test, and take it to the stage.')}</p><div class="row" style="margin-bottom:30px">${button('new-project', t('新建空白工程', 'New blank project'), 'plus', '', 'primary')}${button('choose-project', t('打开工程', 'Open project'), 'folder')}</div><div class="subtle">${t('最近创作', 'Recent projects')}</div>${projects
      .filter(p => p.source === 'folder')
      .slice(0, 3)
      .map(
        p =>
          `<button class="recent-project" data-action="open-workspace" data-id="${p.id}">${icon('folder')}${esc(p.name)}<span class="spacer"></span>${icon('chevron')}</button>`
      )
      .join('')}</div></main>`
  }
  function renderTransport() {
    const p = current(),
      live = !!S.running,
      mode = S.running
        ? S.applied.audioMode
        : S.mode === 'creation'
          ? S.testMode
          : p?.defaultMode
    const same = S.running === S.selected
    let runLabel =
      S.mode === 'creation'
        ? S.status === 'error'
          ? t('重试测试', 'Retry test')
          : live
            ? t('重启测试', 'Restart test')
            : t('启动测试', 'Start test')
        : same
          ? hasPending()
            ? t('应用并重启', 'Apply & restart')
            : t('关闭工程', 'Close project')
          : live
            ? t('加载', 'Load') + ' ' + (p?.name || '')
            : t('加载工程', 'Load project')
    const stopStyle = S.mode === 'performance' && same && !hasPending()
    const actual = S.running ? S.applied : S
    return `<footer class="transport">
      ${button('primary', '<span class="run-label">' + esc(runLabel) + '</span>', stopStyle ? 'stop' : 'play', !p || S.status === 'starting' ? 'disabled' : '', `run-btn ${stopStyle ? 'stop' : 'primary'}`)}
      ${S.mode === 'creation' && live ? ib('stop', 'stop', t('停止测试', 'Stop test')) : ''}
      ${live ? ib('refresh', 'refresh', t('刷新保存版页面 · ⌘⇧R', 'Refresh saved pages · ⌘⇧R')) : ''}
      <span class="separator"></span>
      <div class="volume-control">${ib('mute', S.muted ? 'mute' : 'volume', t('静音 · ⌘M', 'Mute · ⌘M'), adjustable() ? '' : 'disabled')}
      <input type="range" id="volume" aria-label="${t('当前运行作品音量', 'Running project volume')}" min="0" max="100" value="${S.muted ? 0 : S.volume}" ${adjustable() ? '' : 'disabled'}><span class="volume-value">${mode === 'internal' ? (S.applied.channels > 2 ? '100%' : (S.muted ? '0' : S.volume) + '%') : '—'}</span></div>
      <span class="separator"></span>
      <button class="device-trigger" data-action="audio-popover" title="${t('音频输出设置', 'Audio output settings')}">${icon('audio')}<span class="device-name">${mode === 'external' ? esc(S.applied.oscTarget || S.oscTarget) : mode === 'none' ? t('无音频输出', 'No audio output') : esc(actual.device.replace(' Speakers', t(' 扬声器', ' Speakers')))}</span>${mode === 'internal' ? `<small>${Number(actual.rate) / 1000} kHz</small>` : ''}${hasPending() ? '<i class="pending-indicator"></i>' : ''}${icon('down')}</button>
      <button class="network-trigger" data-action="network-popover" title="${t('网络与节点', 'Network & node')}">${icon('network')}<span>${esc(actual.lan || t('选择网络', 'Select network'))}</span>${icon('down')}</button>
      <span class="spacer"></span>
      ${S.mode === 'creation' && !S.preview ? ib('toggle-preview', 'monitor', t('显示测试预览', 'Show test preview')) : ''}
      ${S.mode === 'creation' ? `<button class="bottom-tool ${S.console ? 'active' : ''}" data-action="console" aria-label="${t('控制台', 'Console')}" title="${t('控制台', 'Console')}" aria-pressed="${S.console}">${icon('terminal')}<span>${t('控制台', 'Console')}</span></button>` : ''}
      <button class="bottom-tool ${S.projection ? 'active' : ''}" data-action="projection" aria-label="${t('投影', 'Projection')}" title="${t('投影', 'Projection')}">${icon('projection')}<span>${t('投影', 'Projection')}</span></button>
      ${S.mode === 'performance' ? ib('immersive', 'expand', t(S.immersive ? '退出沉浸演出' : '沉浸演出', S.immersive ? 'Exit immersive view' : 'Immersive performance')) : ''}
      ${ib('settings', 'settings', t('设置 · ⌘,', 'Settings · ⌘,'))}
      <div class="mode-control"><button class="mode-switch" data-action="mode-toggle"></button></div>
    </footer>`
  }
  function renderConsole() {
    return `<section class="console" aria-label="${t('控制台', 'Console')}"><div class="console-head">${icon('terminal')}<strong>${t('控制台', 'Console')}</strong><span class="chip">${t('演示日志', 'Demo logs')}</span><span class="spacer"></span>${ib('copy-logs', 'copy', t('复制日志', 'Copy logs'))}${ib('console', 'close', t('关闭控制台', 'Close console'))}</div><div class="console-body">${S.logs.map(l => `<div class="log-line ${l.level === 'error' ? 'danger' : ''}"><time>${l.time}</time><span class="log-source">${l.source}</span><span>${esc(l.message)}</span></div>`).join('')}</div></section>`
  }
  function render() {
    document.documentElement.dataset.theme = S.theme
    document.documentElement.lang = S.language
    const app = document.getElementById('app')
    const modeControl = app.querySelector('.mode-control')
    const modeFocused = modeControl?.contains(document.activeElement)
    app.className = [
      S.mode === 'performance' ? 'performance-mode' : 'creation-mode',
      !S.sidebar && !autoSidebar() ? 'no-sidebar' : '',
      S.immersive && S.mode === 'performance' && S.running ? 'immersive' : '',
      !S.chrome ? 'chrome-hidden' : '',
      !S.preview ? 'full-preview' : '',
    ].join(' ')
    app.innerHTML =
      `<div class="workspace">${S.mode === 'performance' ? '<div class="sidebar-reveal-zone" aria-hidden="true" hidden></div>' : ''}${S.mode === 'creation' ? renderCreationSidebar() : renderPerformanceSidebar()}<div class="splitter side-split" role="separator" aria-label="${t('调整侧栏宽度', 'Resize sidebar')}" aria-orientation="vertical" tabindex="0" data-resize="side"></div>${S.mode === 'creation' ? (S.workspace ? renderEditor() + `<div class="splitter preview-split" role="separator" aria-label="${t('调整测试区宽度', 'Resize test pane')}" aria-orientation="vertical" tabindex="0" data-resize="preview"></div>` + renderPreview() : renderHome()) : renderPerformance()}</div>` +
      renderTransport() +
      (S.mode === 'creation' && S.console ? renderConsole() : '') +
      (S.expanded
        ? `<div class="expanded-preview">${scoreArt(true)}${button('expand', t('还原工作区 · Esc', 'Restore workspace · Esc'), 'shrink', '', 'restore')}</div>`
        : '') +
      (S.immersive && S.running
        ? `<span class="immersive-hint">${t('移到边缘显示控制 · 按住 ⌘', 'Move to an edge for controls · Hold ⌘')}</span>`
        : '')
    if (modeControl) app.querySelector('.mode-control').replaceWith(modeControl)
    renderModeSwitch()
    if (modeFocused && !document.getElementById('dialog').open)
      modeControl.querySelector('button').focus({ preventScroll: true })
    bindSidebarHover()
    updateSidebarVisibility()
    if (modalKind === 'settings' && document.getElementById('dialog').open) {
      const body = document.querySelector('#dialog .dialog-body')
      body.innerHTML = window.PNDSSettings.render(S.settingsSection)
      document.getElementById('dialog-title').textContent = t(
        '设置',
        'Settings'
      )
    }
  }

  function openPopover(kind, anchor) {
    if (popover?.kind === kind) {
      closePopover()
      return
    }
    popover = { kind, anchor }
    let html = '',
      wide = false
    if (kind === 'project') {
      html =
        menu(
          'choose-project',
          t('打开其他工程…', 'Open another project…'),
          'folder',
          '',
          '⌘O'
        ) +
        menu('new-project', t('新建空白工程…', 'New blank project…'), 'plus') +
        '<div class="divider" style="margin:5px"></div>'
      if (S.mode === 'creation' && S.workspace)
        html +=
          menu('bundle', t('生成 .pnds…', 'Generate .pnds…'), 'package') +
          menu('handoff', t('记录创作交接…', 'Record handoff…'), 'handoff') +
          menu(
            'view-handoff',
            t('查看交接文档', 'View handoff document'),
            'file'
          )
      else if (S.mode === 'performance')
        html +=
          menu(
            'selected-info',
            t('所选作品简介', 'Selected project info'),
            'book'
          ) +
          menu(
            'rename-project',
            t('重命名列表条目…', 'Rename list entry…'),
            'file',
            !current() || current().source === 'utility' ? 'disabled' : ''
          ) +
          menu(
            'remove-project',
            t('从列表移除…', 'Remove from list…'),
            'close',
            !current() || current().source === 'utility' ? 'disabled' : ''
          )
      html +=
        '<div class="divider" style="margin:5px"></div>' +
        menu('finder', t('在 Finder 中显示', 'Reveal in Finder'), 'folder') +
        menu('help', t('帮助与快捷键', 'Help & shortcuts'), 'book')
    } else if (kind === 'file') {
      html =
        menu(
          'search-in-file',
          t('在文件中查找', 'Find in file'),
          'search',
          '',
          '⌘F'
        ) +
        menu(
          'reload-file',
          t('从磁盘重新读取', 'Reload from disk'),
          'refresh'
        ) +
        menu('finder', t('在 Finder 中显示', 'Reveal in Finder'), 'folder')
      if (S.file !== 'manifest.json')
        html += menu('rename-file', t('重命名文件…', 'Rename file…'), 'file')
    } else if (kind === 'demo') {
      wide = true
      html =
        `<div class="row"><h3>${t('原型演示', 'Prototype review')}</h3><span class="spacer"></span><span class="chip">1.6 / Final</span></div><p class="subtle" style="margin-bottom:14px">${t('所有工程、文件与运行状态仅在内存中模拟。', 'Projects, files and runtime are simulated in memory.')}</p><div class="theme-choices">${['pond', 'sand', 'stage', 'brutal'].map(v => `<button class="theme-choice ${S.theme === v ? 'active' : ''}" data-action="theme" data-theme="${v}"><span class="theme-swatch" style="background:${{ pond: '#eeeef7', sand: '#efe7d9', stage: '#22272e', brutal: '#eeeeda' }[v]};color:${{ pond: '#6251d4', sand: '#9c692f', stage: '#a5c8b6', brutal: '#c34423' }[v]}"></span>${v[0].toUpperCase() + v.slice(1)}</button>`).join('')}</div><div class="divider"></div>` +
        menu(
          'scenario-creation',
          t('创作工作台', 'Creation workspace'),
          'code'
        ) +
        menu(
          'scenario-performance',
          t('演出准备', 'Performance preparation'),
          'music'
        ) +
        menu(
          'scenario-live',
          t('运行 A · 选择 B', 'Running A · selected B'),
          'play'
        ) +
        menu(
          'scenario-conflict',
          t('外部修改与保存冲突', 'External edit & save conflict'),
          'alert'
        ) +
        menu(
          'scenario-error',
          t('启动失败与重试', 'Startup failure & retry'),
          'alert'
        ) +
        menu('scenario-empty', t('创作首页', 'Creation home'), 'plus') +
        '<div class="divider" style="margin:6px"></div>' +
        menu('inspect-state', t('查看演示状态', 'Inspect demo state'), 'code') +
        menu(
          'language',
          S.language === 'en' ? '切换到中文' : 'Switch to English',
          'book'
        ) +
        menu('reset', t('重置原型', 'Reset prototype'), 'refresh')
    } else if (kind === 'audio') {
      wide = true
      const mode = S.running
        ? S.applied.audioMode
        : S.mode === 'creation'
          ? S.testMode
          : current()?.defaultMode
      html = `<h3>${t('音频输出', 'Audio output')}</h3>`
      if (mode === 'external') {
        html += `<label class="field-stack"><span>OSC ${t('目标', 'target')}</span><input data-setting="oscTarget" value="${esc(S.oscTarget)}" placeholder="127.0.0.1:57110"></label><p class="subtle" style="margin-top:10px">${t('External 使用本机配置的 OSC 目标。', 'External uses the OSC target configured on this Mac.')}</p>`
      } else if (mode === 'none')
        html += `<p class="subtle">${t('此工程以 None 模式运行，不使用音频输出。', 'This project uses None mode, with no audio output.')}</p>`
      else
        html += `<label class="field"><span>${t('输出设备', 'Device')}</span><select data-setting="device">${['MacBook Pro Speakers', 'BlackHole 2ch', 'BlackHole 16ch', 'USB Audio Interface'].map(d => `<option ${S.device === d ? 'selected' : ''}>${d}</option>`).join('')}</select></label><label class="field"><span>${t('采样率', 'Sample rate')}</span><select data-setting="rate">${['44100', '48000', '96000'].map(r => `<option value="${r}" ${String(S.rate) === r ? 'selected' : ''}>${Number(r) / 1000} kHz</option>`).join('')}</select></label>`
      html += `<div class="divider"></div><p class="subtle">${S.running ? t('当前运行：', 'Running: ') + esc(S.applied.device) + ' · ' + Number(S.applied.rate) / 1000 + ' kHz' : t('下次启动时应用。', 'Applies on the next start.')}</p><p id="audio-pending" class="subtle warning" style="margin-top:6px">${hasPending() ? t('有待应用的设置。重启后生效。', 'Settings pending. Restart to apply.') : t('设备与采样率在下次启动时生效。', 'Device and sample rate apply on the next start.')}</p><div class="row" style="margin-top:14px">${button('settings-audio', t('音频设置', 'Audio settings'), 'settings', '', 'ghost')}<span class="spacer"></span>${S.running ? button('restart', t('重启以应用', 'Restart to apply'), 'refresh') : ''}</div>`
    } else if (kind === 'network') {
      wide = true
      html = `<h3>${t('网络与节点', 'Network & node')}</h3><label class="field"><span>Local network</span><select data-setting="lan">${['192.168.31.13', '10.0.0.8', ''].map(v => `<option value="${v}" ${S.lan === v ? 'selected' : ''}>${v || t('未连接', 'Disconnected')}</option>`).join('')}</select></label>${current()?.telematic || runningProject()?.telematic ? `<label class="field"><span>Room</span><select data-setting="room">${['1', '2', '3'].map(v => `<option ${S.room === v ? 'selected' : ''}>${v}</option>`).join('')}</select></label>` : ''}<div class="field"><span class="subtle">${t('当前运行地址', 'Running address')}</span><span class="mono">${esc(S.running ? S.applied.lan : '—')}</span></div><div class="field"><span class="subtle">${t('演奏者入口', 'Performer entry')}</span><span class="chip">${(S.running ? S.applied.https : S.https) ? 'HTTPS' : 'HTTP'}</span></div><p class="subtle">${t('网络修改在下次启动时生效。', 'Network changes apply on the next start.')}</p><div class="divider"></div>${button('copy-performer', t('复制演奏者地址', 'Copy Performer URL'), 'copy')}<div class="row" style="margin-top:12px">${button('settings-node', t('网络设置', 'Network settings'), 'settings', '', 'ghost')}<span class="spacer"></span>${button('settings-ports', t('检查端口', 'Inspect ports'), 'network', '', 'ghost')}</div>`
    } else if (kind === 'projection') {
      html =
        `<div class="menu-label">${t('场地屏', 'Audience display')}</div>` +
        menu(
          'open-projection',
          S.projection
            ? t('显示投影窗口', 'Show projection window')
            : t('打开投影窗口', 'Open projection window'),
          'projection'
        ) +
        menu(
          'projection-live',
          S.projectionLive
            ? t('撤回到作品简介', 'Return to project cover')
            : t('投影开演', 'Show performance'),
          'play',
          S.running ? '' : 'disabled'
        ) +
        menu(
          'close-projection',
          t('关闭投影窗口', 'Close projection window'),
          'close',
          S.projection ? '' : 'disabled'
        )
    } else if (kind === 'folder') {
      html =
        menu(
          'new-folder',
          t('新建演出文件夹…', 'New performance folder…'),
          'plus'
        ) +
        menu(
          'export-folder',
          t('导出演出文件夹…', 'Export performance folder…'),
          'package'
        ) +
        menu(
          'import-setlist',
          t('导入演出文件夹…', 'Import performance folder…'),
          'folder'
        ) +
        menu(
          'rename-folder',
          t('重命名文件夹…', 'Rename folder…'),
          'file',
          S.folder === 'Home' || S.folder === 'Utilities' ? 'disabled' : ''
        ) +
        menu(
          'delete-folder',
          t('删除文件夹…', 'Delete folder…'),
          'close',
          S.folder === 'Home' || S.folder === 'Utilities' ? 'disabled' : ''
        ) +
        '<div class="divider" style="margin:5px"></div>' +
        menu(
          'selected-info',
          t('所选作品简介', 'Selected project info'),
          'book',
          current() ? '' : 'disabled'
        ) +
        menu(
          'rename-project',
          t('重命名列表条目…', 'Rename list entry…'),
          'file',
          !current() || current().source === 'utility' ? 'disabled' : ''
        ) +
        menu(
          'remove-project',
          t('从列表移除…', 'Remove from list…'),
          'close',
          !current() || current().source === 'utility' ? 'disabled' : ''
        )
    }
    document.getElementById('popover-root').innerHTML =
      `<div class="popover ${wide ? 'wide' : ''}" role="dialog" aria-label="${t('选项', 'Options')}">${html}</div>`
    const p = document.querySelector('.popover'),
      r = anchor.getBoundingClientRect()
    updateSidebarVisibility()
    p.style.left =
      Math.min(Math.max(8, r.left), innerWidth - p.offsetWidth - 8) + 'px'
    p.style.top =
      (r.top > innerHeight / 2
        ? Math.max(8, r.top - p.offsetHeight - 9)
        : Math.min(r.bottom + 9, innerHeight - p.offsetHeight - 8)) + 'px'
  }
  function openSettings(section = 'general') {
    S.settingsSection = section
    dialog(t('设置', 'Settings'), window.PNDSSettings.render(section))
  }
  function markDraft(value, path = S.file) {
    const w = ws()
    if (!w) return
    w.drafts[path] = value
    if (value === w.disk[path]) w.dirty.delete(path)
    else w.dirty.add(path)
    const dirty = w.dirty.has(S.file)
    const save = document.getElementById('save-button')
    if (save) save.disabled = !dirty
    const active = document.getElementById('active-dirty')
    if (active) active.innerHTML = dirty ? '<i class="dot dirty"></i>' : ''
    const status = document.getElementById('save-status')
    if (status)
      status.textContent = dirty ? t('未保存', 'Unsaved') : t('已保存', 'Saved')
    document.querySelectorAll('[data-action="file"]').forEach(el => {
      if (el.dataset.path !== path) return
      let dot = el.querySelector('.dirty-dot')
      if (w.dirty.has(path) && !dot) {
        dot = document.createElement('i')
        dot.className = 'dot dirty dirty-dot'
        el.append(dot)
      }
      if (!w.dirty.has(path)) dot?.remove()
    })
  }
  function saveFile(override = false) {
    const w = ws()
    if (!w || !w.dirty.has(S.file)) return
    if (w.conflict === S.file && !override) {
      resolveConflict()
      return
    }
    if (S.file === 'manifest.json') {
      try {
        const m = JSON.parse(text(S.file))
        if (
          !m.id ||
          !m.name ||
          !m.audio.supportedModes.includes(m.audio.defaultMode) ||
          Number(m.audio.outputChannels) < 1 ||
          Number(m.audio.outputChannels) > 64
        )
          throw Error('Required fields / audio declaration')
      } catch {
        dialog(
          t('声明需要修正', 'Declaration needs attention'),
          `<p>${t('请检查 JSON、必填字段及默认音频模式。当前草稿保留。', 'Check JSON, required fields and the default audio mode. Your draft is preserved.')}</p>`
        )
        return
      }
    }
    w.disk[S.file] = text(S.file)
    Reflect.deleteProperty(w.drafts, S.file)
    w.dirty.delete(S.file)
    w.savedRevision++
    w.conflict = null
    if (S.file.startsWith('public/')) w.pending.add('refresh')
    else if (S.file.endsWith('.scd')) w.pending.add('compile')
    else if (
      S.file === 'manifest.json' ||
      S.file === 'server.js' ||
      S.file === 'package.json'
    )
      w.pending.add('restart')
    if (S.file === 'manifest.json') {
      const m = JSON.parse(w.disk[S.file])
      const p = current()
      p.name = m.name
      p.version = m.version
      p.defaultMode = m.audio.defaultMode
      p.channels = Number(m.audio.outputChannels)
      p.performerPort = Number(m.scoreServer.performerPort)
      p.monitorPort = Number(m.scoreServer.monitorPort)
      if (!m.audio.supportedModes.includes(S.testMode))
        S.testMode = m.audio.defaultMode
    }
    log('Saved ' + S.file + ' · disk revision ' + w.savedRevision, 'editor')
    render()
    toast(
      t(
        '已保存演示文件；运行保持不变。',
        'Demo file saved. Runtime is unchanged.'
      )
    )
  }
  function resolveConflict() {
    dialog(
      t('磁盘版本已改变', 'File changed on disk'),
      `<p>${t('外部编辑器修改了同一文件。你的未保存草稿仍保留。', 'An external editor changed this file. Your unsaved draft is preserved.')}</p><div class="artifact-box mono" style="margin-top:15px">${esc(S.file)}<br>${t('当前草稿与模拟磁盘版本不同。', 'Current draft differs from the simulated disk version.')}</div>`,
      button('close-dialog', t('继续编辑', 'Keep editing')) +
        button(
          'conflict-reload',
          t('放弃草稿并重读', 'Discard draft & reload')
        ) +
        button(
          'conflict-overwrite',
          t('覆盖磁盘版', 'Overwrite disk'),
          '',
          '',
          'primary'
        )
    )
  }
  function setFile(path) {
    S.file = path
    S.editorView =
      path === 'manifest.json'
        ? 'form'
        : path.startsWith('README')
          ? 'preview'
          : 'source'
    S.searchOpen = false
    render()
  }
  function closeClients() {
    for (const w of childWindows.values()) {
      try {
        w.close()
      } catch {
        /* A child window may already be closed. */
      }
    }
    childWindows.clear()
    S.performers = []
  }
  function stopRuntime() {
    if (S.mode === 'creation') closeClients()
    S.running = null
    S.status = 'idle'
    S.projectionLive = false
    S.immersive = false
    S.chrome = true
    log('Session stopped; workspace and saved files retained.', 'host')
    broadcast({ action: 'runtime', running: false })
    updateProjection()
    render()
  }
  function run(id, restart = false) {
    closePopover()
    const p = project(id)
    if (!p) return
    const mode = S.mode === 'creation' ? S.testMode : p.defaultMode
    if (!savedModes(id).includes(mode)) {
      dialog(
        t('不支持此测试模式', 'Unsupported test mode'),
        `<p>${t('保存版工程声明不支持此音频模式，请检查 manifest。原运行保持不变。', 'The saved manifest does not support this audio mode. The current session is preserved.')}</p>`
      )
      return
    }
    if (!S.lan) {
      dialog(
        t('选择本地网络', 'Choose a local network'),
        `<p>${t('尚未选择可用的本地地址。打开底部网络入口完成选择。', 'No local address is selected. Choose one in the bottom network controls.')}</p>`
      )
      return
    }
    if (mode === 'external' && !/^[a-zA-Z0-9.-]+:\d+$/.test(S.oscTarget)) {
      toast(
        t(
          '请填写有效的 OSC 目标，例如 127.0.0.1:57110。',
          'Enter a valid OSC target, such as 127.0.0.1:57110.'
        )
      )
      return
    }
    if (S.simFailure) {
      S.running = null
      S.status = 'error'
      S.mode = 'performance'
      S.selected = id
      log('EADDRINUSE: performer port 6868', 'node', 'error')
      render()
      return
    }
    S.running = id
    S.status = 'ready'
    S.generation++
    S.pageRevision++
    S.applied = {
      device: S.device,
      rate: String(S.rate),
      lan: S.lan,
      audioMode: mode,
      channels: p.channels,
      oscTarget: S.oscTarget,
      https: S.https,
      room: S.room,
      nodeName: S.nodeName,
      hub: S.hub,
    }
    workspaces[id].tested = true
    workspaces[id].pending.delete('refresh')
    workspaces[id].pending.delete('restart')
    log(
      (restart ? 'Restarted' : 'Started') +
        ' ' +
        p.name +
        ' · generation ' +
        S.generation,
      'host'
    )
    log(
      mode + ' · ' + S.device + ' · ' + Number(S.rate) / 1000 + ' kHz',
      'audio'
    )
    broadcast({ action: 'runtime', running: true })
    updateProjection()
    render()
    if (S.mode === 'performance') {
      S.immersive = true
      render()
      scheduleHide()
    }
  }
  function requestRun() {
    const id = S.mode === 'creation' ? S.workspace : S.selected
    if (!id) return
    if (S.mode === 'performance' && S.running === id && !hasPending()) {
      confirm(
        t('关闭当前工程？', 'Close the running project?'),
        `<p>${esc(project(id).name)} ${t('的声音与服务将停止。', 'will stop its audio and services.')}</p>`,
        () => stopRuntime(),
        t('关闭工程', 'Close project')
      )
      return
    }
    if (S.running) {
      confirm(
        S.running === id
          ? t('重新启动工程？', 'Restart this project?')
          : t('更换演出作品？', 'Load another performance?'),
        `<p>${S.running === id ? t('将短暂停止当前运行，并应用保存版文件与待应用配置。', 'The current session will briefly stop, then use saved files and pending settings.') : t('将关闭 ', 'This will stop ') + esc(runningProject().name) + t('，并加载 ', ' and load ') + esc(project(id).name) + '.'}</p>`,
        () => run(id, true),
        S.running === id ? t('重启', 'Restart') : t('加载作品', 'Load project')
      )
    } else run(id)
  }
  function cancelModeSwitch() {
    if (!modeIntent || modeSettling) return
    modeIntent = null
    renderModeSwitch()
    updateSidebarVisibility()
    scheduleHide()
  }
  function requestMode(next) {
    closePopover()
    if (S.mode === next || S.status === 'starting' || modeSettling) return
    if (modeIntent?.next === next) {
      const commit = modeIntent.commit
      const restoreFocus =
        document.activeElement === document.querySelector('.mode-switch')
      modeSettling = true
      renderModeSwitch()
      updateSidebarVisibility()
      const finish = () => {
        modeIntent = null
        modeSettling = false
        modeHoverPaused = true
        sidebarPointer = false
        S.sidebarPeek = false
        commit()
        if (restoreFocus)
          document.querySelector('.mode-switch')?.focus({ preventScroll: true })
      }
      if (
        S.theme === 'brutal' ||
        window.matchMedia('(prefers-reduced-motion: reduce)').matches
      )
        finish()
      else modeSwitchTimer = setTimeout(finish, 300)
      return
    }
    const dirty = ws()?.dirty.size || 0,
      canContinue = next === 'creation' && runningProject()?.source === 'folder'
    const warning =
      next === 'performance' && dirty
        ? t('将放弃 ', 'Discard ') +
          dirty +
          t(' 个未保存文件', ' unsaved files')
        : ''
    modeHoverPaused = false
    modeIntent = {
      next,
      warning,
      commit: () => {
        closeProjection()
        if (next === 'creation') {
          const target = canContinue
            ? S.running
            : !S.running && project(S.selected)?.source === 'folder'
              ? S.selected
              : null
          if (S.running && !canContinue) stopRuntime()
          S.workspace = target
          S.selected = target || S.selected
          S.mode = 'creation'
          S.testMode = canContinue
            ? S.applied.audioMode
            : project(target)?.defaultMode || 'internal'
          S.immersive = false
          S.chrome = true
          S.file = 'public/monitor.js'
          S.editorView = 'source'
        } else {
          if (ws()) {
            ws().drafts = {}
            ws().dirty.clear()
            ws().conflict = null
          }
          stopRuntime()
          closeClients()
          S.workspace = null
          S.mode = 'performance'
          S.console = false
          S.folder = 'Home'
          S.selected = null
        }
        render()
      },
    }
    revealChrome()
    renderModeSwitch()
    updateSidebarVisibility()
    document
      .querySelector('[data-action="mode-toggle"]')
      ?.focus({ preventScroll: true })
  }
  function refreshPages() {
    if (!S.running) {
      toast(t('先启动工程。', 'Start a project first.'))
      return
    }
    S.pageRevision++
    workspaces[S.running].pending.delete('refresh')
    log('Refreshed saved pages · navigation ' + S.pageRevision, 'host')
    broadcast({ action: 'refresh', running: true })
    updateProjection()
    render()
    toast(
      t(
        '已刷新保存版页面；进程未重启。',
        'Saved pages refreshed. Processes were not restarted.'
      )
    )
  }
  function compile() {
    const w = ws()
    if (!w) return
    if (
      [...w.dirty].some(p => p === 'manifest.json' || p.endsWith('.scd')) ||
      w.conflict
    ) {
      dialog(
        t('编译前需要保存', 'Save before compiling'),
        `<p>${t('SCD 或 manifest 仍有未保存修改／冲突。保存后再编译。', 'SCD or manifest has unsaved changes or a conflict. Save before compiling.')}</p>`
      )
      return
    }
    w.pending.delete('compile')
    w.pending.add('restart')
    log('sclang: compiling supercollider/source/*.scd', 'compile')
    log('Written 1 SynthDef · verified all manifest references', 'compile')
    render()
    toast(
      t(
        '编译成功。重启后使用新声音。',
        'Compilation complete. Restart to use the new sound.'
      )
    )
  }
  function openWorkspace(id) {
    const p = project(id)
    if (p?.source !== 'folder') {
      toast(t('该来源只可演出，无法编辑。', 'This source is performance-only.'))
      return
    }
    const change = () => {
      if (S.running && S.running !== id) stopRuntime()
      if (S.workspace !== id) closeClients()
      S.mode = 'creation'
      S.workspace = id
      S.selected = id
      S.file = 'manifest.json'
      S.editorView = 'form'
      S.immersive = false
      S.chrome = true
      S.testMode = S.running === id ? S.applied.audioMode : p.defaultMode
      closeDialog()
      render()
    }
    if (ws()?.dirty.size && S.workspace !== id)
      confirm(
        t('切换工程？', 'Switch projects?'),
        `<p>${t('旧工程的未保存草稿将被放弃。取消会保留当前编辑与测试。', 'Unsaved drafts will be discarded. Cancel to retain the current edit and test.')}</p>`,
        () => {
          ws().drafts = {}
          ws().dirty.clear()
          change()
        },
        t('切换工程', 'Switch project')
      )
    else change()
  }

  function projectPicker() {
    dialog(
      t('打开创作工程', 'Open a creation project'),
      `<div class="stack"><p class="subtle">${t('原型提供示例文件夹，不读取你的磁盘。', 'Choose a demo folder. Your disk is not accessed.')}</p>${projects
        .filter(p => p.source === 'folder')
        .map(
          p =>
            `<button class="row btn ghost" data-action="open-workspace" data-id="${p.id}" style="justify-content:flex-start;padding:12px">${icon('folder')}${esc(p.name)}<span class="spacer"></span>${icon('chevron')}</button>`
        )
        .join('')}</div>`,
      button('new-project', t('新建空白工程', 'New blank project'), 'plus')
    )
  }
  function newProject() {
    dialog(
      t('新建空白工程', 'New blank project'),
      `<div class="stack"><label class="field-stack"><span>${t('作品名称', 'Project name')}</span><input id="new-project-name" value="Untitled Score" autofocus></label><label class="field-stack"><span>${t('作品 ID', 'Project ID')}</span><input id="new-project-id" value="untitled-score"></label><label class="field-stack"><span>${t('保存位置（演示）', 'Location (demo)')}</span><input value="~/Music/PNDS/" readonly></label><p class="subtle">${t('创建可测试的空白文件夹工程，不自动启动。', 'Create a testable blank folder project. It will not start automatically.')}</p></div>`,
      button('close-dialog', t('取消', 'Cancel')) +
        button(
          'create-project',
          t('创建工程', 'Create project'),
          '',
          '',
          'primary'
        )
    )
  }
  function bundle() {
    const w = ws()
    if (!w) return
    dialog(
      t('生成 .pnds', 'Generate .pnds'),
      `<div class="stack"><p>${t('将工程的已保存文件打包，供演出使用。', 'Package saved project files for performance.')}</p>${w.dirty.size ? `<div class="notice warning">${w.dirty.size} ${t('个文件未保存，这些草稿不会进入工程包。', 'unsaved drafts will not be included.')}</div>` : ''}${!w.tested ? `<div class="notice warning">${t('此工程尚未完成一次成功测试。你仍可以继续生成。', 'This project has not completed a successful test. You can still continue.')}</div>` : ''}<label class="field-stack"><span>${t('文件名', 'Filename')}</span><input id="bundle-name" value="${esc(current().id)}-${esc(current().version)}.pnds"></label><label class="field-stack"><span>${t('保存位置（演示）', 'Location (demo)')}</span><select id="bundle-location"><option>Desktop</option><option>Music/PNDS/Exports</option><option>Documents</option></select></label><small class="subtle">${t('本次仅模拟打包，不写入真实文件。', 'This demo simulates packaging and writes no real files.')}</small></div>`,
      button('close-dialog', t('取消', 'Cancel')) +
        button(
          'generate-bundle',
          t('生成工程包', 'Generate bundle'),
          'package',
          '',
          'primary'
        )
    )
  }
  function handoff(translation = false) {
    dialog(
      t('记录创作交接', 'Record creator handoff'),
      `<div class="stack"><label class="field-stack"><span>${t('需要完成的工作', 'Intent')}</span><textarea id="handoff-intent" rows="3" placeholder="${t('描述给外部创作者或 agent 的任务…', 'Describe work for an external creator or agent…')}">${translation ? t('同步 README 的英文版本，保留作品标题与元数据。', 'Synchronize the English README, preserving title and metadata.') : ''}</textarea></label><label class="field-stack"><span>${t('涉及文件', 'Files')}</span><input id="handoff-files" value="${esc(S.file)}"></label><label class="field-stack"><span>${t('验收要求', 'Acceptance')}</span><input id="handoff-acceptance" placeholder="${t('怎样判断任务已完成', 'How to verify completion')}"></label><p class="subtle">${t('记录到 docs/creator-handoff.md。不会自动修改其他文件或执行任务。', 'Recorded in docs/creator-handoff.md. No other files are changed and no task is executed.')}</p></div>`,
      button('close-dialog', t('取消', 'Cancel')) +
        button(
          'record-handoff',
          t('记录交接', 'Record handoff'),
          '',
          '',
          'primary'
        )
    )
  }
  function addPerformer() {
    dialog(
      t('添加测试设备', 'Add test device'),
      `<p class="subtle">${t('每个设备打开独立浏览器窗口，使用演示页面。', 'Each device opens a separate browser window with a demo page.')}</p><div class="row" style="margin-top:20px">${button('create-performer', t('手机', 'Phone'), 'phone', 'data-device="phone"')}${button('create-performer', t('平板', 'Tablet'), 'tablet', 'data-device="tablet"')}</div>`
    )
  }
  function showPerformer(id, toggle = false) {
    const p = S.performers.find(p => p.id === id)
    if (!p) return
    let win = childWindows.get(id)
    if (toggle && !p.hidden && win && !win.closed) {
      win.postMessage({ type: 'pnds-prototype', action: 'hide' }, '*')
      p.hidden = true
      render()
      return
    }
    p.hidden = false
    if (!win || win.closed) {
      win = window.open(
        `performer.html?id=${id}&theme=${S.theme}&lang=${S.language}&device=${p.device}`,
        'pnds-prototype-performer-' + id,
        `width=${p.device === 'tablet' ? 820 : 460},height=820`
      )
      if (win) childWindows.set(id, win)
      else {
        p.hidden = true
        toast(
          t(
            '浏览器拦截了弹窗，请允许后点击设备再次打开。',
            'Popup blocked. Allow popups and select the device again.'
          )
        )
      }
    } else {
      win.postMessage({ type: 'pnds-prototype', action: 'show' }, '*')
      win.focus()
    }
    render()
  }
  let projectionWindow = null
  function closeProjection() {
    projectionWindow?.close()
    projectionWindow = null
    S.projection = false
    S.projectionLive = false
  }
  function updateProjection() {
    if (projectionWindow && !projectionWindow.closed) {
      const p = runningProject() || current() || projects[0]
      projectionWindow.postMessage(
        {
          type: 'pnds-projection',
          theme: S.theme,
          html: S.projectionLive && S.running ? scoreArt(true) : renderCover(p),
        },
        '*'
      )
    }
  }
  function openProjection() {
    if (!projectionWindow || projectionWindow.closed)
      projectionWindow = window.open(
        'index.html?projection=1',
        'pnds-prototype-projection',
        'width=1100,height=750'
      )
    if (!projectionWindow) {
      toast(
        t(
          '浏览器拦截了投影窗口，请允许弹窗后重试。',
          'Projection popup blocked. Allow popups and try again.'
        )
      )
      return
    }
    S.projection = true
    projectionWindow.focus()
    render()
    updateProjection()
  }
  function scenario(name) {
    closePopover()
    closeDialog()
    closeClients()
    clearTimeout(modeSwitchTimer)
    modeIntent = null
    modeSettling = false
    modeHoverPaused = false
    sidebarPointer = false
    sidebarPointerActive = false
    sidebarDragging = false
    S.sidebarPeek = false
    S.immersive = false
    S.chrome = true
    S.console = false
    S.status = 'ready'
    S.simFailure = false
    S.selected = 'inarticulate'
    S.workspace = 'inarticulate'
    S.file = 'public/monitor.js'
    S.editorView = 'source'
    S.mode = 'creation'
    S.running = 'inarticulate'
    S.expanded = false
    S.applied = {
      device: S.device,
      rate: String(S.rate),
      lan: S.lan,
      audioMode: 'internal',
      channels: 2,
      oscTarget: S.oscTarget,
      https: S.https,
      room: S.room,
      nodeName: S.nodeName,
      hub: S.hub,
    }
    S.testMode = 'internal'
    if (name === 'performance') {
      S.mode = 'performance'
      S.workspace = null
      S.running = null
      S.status = 'idle'
    }
    if (name === 'live') {
      S.mode = 'performance'
      S.workspace = null
      S.selected = 'splash'
    }
    if (name === 'conflict') {
      const w = ws()
      w.drafts[S.file] = w.disk[S.file] + '\n// My local change'
      w.dirty.add(S.file)
      w.conflict = S.file
      w.disk[S.file] += '\n// External edit'
    }
    if (name === 'error') {
      S.mode = 'performance'
      S.running = null
      S.status = 'error'
      S.simFailure = true
      log('EADDRINUSE · port 6868 is occupied', 'node', 'error')
    }
    if (name === 'empty') {
      S.workspace = null
      S.running = null
      S.status = 'idle'
    }
    render()
  }
  function scheduleHide() {
    clearTimeout(revealTimer)
    if (!S.immersive || !S.running || S.mode !== 'performance') return
    revealTimer = setTimeout(() => {
      if (
        popover ||
        document.getElementById('dialog').open ||
        S.console ||
        S.pinnedChrome ||
        modeIntent ||
        (sidebarKeyboard &&
          document.activeElement?.closest('.sidebar,.mode-control'))
      )
        return
      S.chrome = false
      document.getElementById('app').classList.add('chrome-hidden')
    }, 2200)
  }
  function revealChrome() {
    if (S.chrome) return
    S.chrome = true
    document.getElementById('app').classList.remove('chrome-hidden')
  }
  async function copyValue(value) {
    try {
      await navigator.clipboard.writeText(value)
      toast(t('已复制', 'Copied'))
    } catch {
      dialog(
        t('复制内容', 'Copy content'),
        `<textarea readonly style="width:100%;min-height:120px">${esc(value)}</textarea>`
      )
    }
  }
  function action(name, el) {
    if (name.startsWith('settings:')) {
      window.PNDSSettings.handle(name, el)
      return
    }
    if (name.startsWith('settings-') && name !== 'settings-section') {
      closePopover()
      openSettings(name.slice(9))
      return
    }
    if (name.startsWith('scenario-')) {
      scenario(name.slice(9))
      return
    }
    switch (name) {
      case 'confirm': {
        const cb = confirmAction
        closeDialog()
        cb?.()
        break
      }
      case 'close-dialog':
        closeDialog()
        break
      case 'project-menu':
        openPopover('project', el)
        break
      case 'file-menu':
        openPopover('file', el)
        break
      case 'demo-menu':
        openPopover('demo', el)
        break
      case 'audio-popover':
        openPopover('audio', el)
        break
      case 'network-popover':
        openPopover('network', el)
        break
      case 'folder-menu':
        openPopover('folder', el)
        break
      case 'projection':
        openPopover('projection', el)
        break
      case 'mode-toggle':
        requestMode(S.mode === 'creation' ? 'performance' : 'creation')
        break
      case 'cancel-mode':
        cancelModeSwitch()
        break
      case 'mode-performance':
        requestMode('performance')
        break
      case 'mode-creation':
        requestMode('creation')
        break
      case 'primary':
        requestRun()
        break
      case 'restart':
        if (S.running)
          confirm(
            t('重启当前工程？', 'Restart current project?'),
            `<p>${t('短暂停止运行，应用已保存文件与待应用设置。未保存草稿不会参与运行。', 'Briefly stop the session and apply saved files and pending settings. Unsaved drafts are excluded.')}</p>`,
            () => run(S.running, true),
            t('重启', 'Restart')
          )
        else requestRun()
        break
      case 'stop':
        stopRuntime()
        break
      case 'retry':
        S.simFailure = false
        run(S.selected)
        break
      case 'refresh':
        refreshPages()
        break
      case 'save':
        saveFile()
        break
      case 'compile':
        compile()
        break
      case 'open-scd':
        setFile('supercollider/source/inarticulate.scd')
        break
      case 'file':
        setFile(el.dataset.path)
        break
      case 'group':
        if (S.collapsed.has(el.dataset.group))
          S.collapsed.delete(el.dataset.group)
        else S.collapsed.add(el.dataset.group)
        render()
        break
      case 'editor-view':
        S.editorView = el.dataset.view
        render()
        break
      case 'search-in-file':
        closePopover()
        S.searchOpen = true
        S.editorView = 'source'
        render()
        document.getElementById('find-text')?.focus()
        break
      case 'close-search':
        S.searchOpen = false
        render()
        break
      case 'find-next': {
        const term = document.getElementById('find-text').value,
          area = document.getElementById('code-input'),
          value = text(S.file),
          pos = value
            .toLowerCase()
            .indexOf(term.toLowerCase(), area?.selectionEnd || 0),
          found =
            pos < 0 ? value.toLowerCase().indexOf(term.toLowerCase()) : pos
        if (area && term && found >= 0) {
          area.focus()
          area.setSelectionRange(found, found + term.length)
        } else toast(t('没有找到匹配项。', 'No match found.'))
        break
      }
      case 'select-project':
        S.selected = el.dataset.id
        render()
        break
      case 'utilities':
        S.folder = S.folder === 'Utilities' ? 'Home' : 'Utilities'
        render()
        break
      case 'selected-info':
        closePopover()
        dialog(
          t('所选作品', 'Selected project'),
          renderCover(project(S.selected))
        )
        break
      case 'toggle-preview':
        S.preview = !S.preview
        render()
        break
      case 'expand':
        S.expanded = !S.expanded
        render()
        break
      case 'console':
        if (S.mode !== 'creation') break
        closePopover()
        S.console = !S.console
        render()
        break
      case 'copy-logs':
        copyValue(
          S.logs.map(l => `[${l.time}] [${l.source}] ${l.message}`).join('\n')
        )
        break
      case 'copy-address':
        copyValue(`http://${S.running ? S.applied.lan : S.lan}:6869`)
        break
      case 'copy-performer':
        copyValue(`http://${S.running ? S.applied.lan : S.lan}:6868`)
        break
      case 'mute':
        if (adjustable()) {
          S.muted = !S.muted
          render()
        }
        break
      case 'settings':
        openSettings()
        break
      case 'settings-section':
        S.settingsSection = el.dataset.section
        openSettings(S.settingsSection)
        break
      case 'theme':
        closePopover()
        setTheme(el.dataset.theme)
        break
      case 'language':
        S.language = S.language === 'en' ? 'zh-CN' : 'en'
        broadcast({ action: 'language', language: S.language })
        closePopover()
        render()
        break
      case 'choose-project':
        projectPicker()
        break
      case 'open-workspace':
        openWorkspace(el.dataset.id)
        break
      case 'new-project':
        newProject()
        break
      case 'create-project': {
        const name = document.getElementById('new-project-name').value.trim(),
          id = document.getElementById('new-project-id').value.trim()
        if (!name || !/^[a-z0-9-]+$/.test(id) || project(id)) {
          toast(
            t(
              '请填写名称及唯一的小写工程 ID。',
              'Enter a name and unique lowercase project ID.'
            )
          )
          break
        }
        const create = () => {
          const p = {
            ...projects[0],
            id,
            name,
            subtitle: name,
            version: '0.1.0',
            group: 'Home',
            source: 'folder',
          }
          projects.push(p)
          workspaces[id] = {
            disk: initialFiles(p),
            drafts: {},
            dirty: new Set(),
            pending: new Set(),
            conflict: null,
            tested: false,
            savedRevision: 1,
          }
          if (S.running) stopRuntime()
          closeClients()
          S.workspace = null
          openWorkspace(id)
          toast(
            t(
              '已创建演示工程，尚未启动。',
              'Demo project created. It has not started.'
            )
          )
        }
        if (ws()?.dirty.size)
          confirm(
            t('放弃旧工程草稿？', 'Discard existing drafts?'),
            t(
              '创建新工程将切换工作区。',
              'Creating the project will switch the workspace.'
            ),
            () => {
              ws().dirty.clear()
              ws().drafts = {}
              create()
            }
          )
        else create()
        break
      }
      case 'bundle':
        closePopover()
        bundle()
        break
      case 'generate-bundle': {
        const name = document.getElementById('bundle-name').value,
          loc = document.getElementById('bundle-location').value
        dialog(
          t('工程包已生成（演示）', 'Bundle generated (demo)'),
          `<div class="stack"><span class="chip accent">${icon('check')}${t('静态检查通过', 'Static checks passed')}</span><strong>${esc(name)}</strong><p class="mono">~/${esc(loc)}/${esc(name)}</p><p class="subtle">${t('仅包含已保存文件。没有创建真实 .pnds 文件。', 'Contains saved files only. No real .pnds file was created.')}</p></div>`,
          button('close-dialog', t('完成', 'Done'), '', '', 'primary')
        )
        log(
          'Demo bundle generated from saved revision ' + ws().savedRevision,
          'bundle'
        )
        break
      }
      case 'handoff':
        closePopover()
        handoff()
        break
      case 'readme-sync':
        handoff(true)
        break
      case 'view-handoff':
        closePopover()
        setFile('docs/creator-handoff.md')
        break
      case 'record-handoff': {
        const intent = document.getElementById('handoff-intent').value.trim(),
          files = document.getElementById('handoff-files').value,
          accept = document.getElementById('handoff-acceptance').value
        if (!intent) {
          toast(t('请填写任务内容。', 'Describe the task.'))
          break
        }
        ws().disk['docs/creator-handoff.md'] +=
          '\n## Task\n\n' +
          intent +
          '\n\nFiles: ' +
          files +
          '\nAcceptance: ' +
          accept +
          '\n'
        closeDialog()
        toast(
          t('交接已记录到演示文档。', 'Handoff recorded in the demo document.')
        )
        break
      }
      case 'resolve-conflict':
        resolveConflict()
        break
      case 'conflict-reload':
        Reflect.deleteProperty(ws().drafts, S.file)
        ws().dirty.delete(S.file)
        ws().conflict = null
        closeDialog()
        render()
        break
      case 'conflict-overwrite':
        closeDialog()
        saveFile(true)
        break
      case 'reload-file':
        closePopover()
        confirm(
          t('重新读取文件？', 'Reload the file?'),
          t(
            '将舍弃当前文件的未保存草稿。',
            'The current file draft will be discarded.'
          ),
          () => {
            Reflect.deleteProperty(ws().drafts, S.file)
            ws().dirty.delete(S.file)
            ws().conflict = null
            render()
          },
          t('重新读取', 'Reload')
        )
        break
      case 'rename-file':
        closePopover()
        dialog(
          t('重命名文件', 'Rename file'),
          `<label class="field-stack"><span>${t('文件名', 'Filename')}</span><input id="rename-file-name" value="${esc(S.file.split('/').at(-1))}"></label><p class="subtle" style="margin-top:12px">${t('重命名不会修正源码中的引用。', 'Renaming does not update references in source code.')}</p>`,
          button('close-dialog', t('取消', 'Cancel')) +
            button(
              'apply-rename-file',
              t('重命名', 'Rename'),
              '',
              '',
              'primary'
            )
        )
        break
      case 'apply-rename-file': {
        const name = document.getElementById('rename-file-name').value.trim()
        if (!name || /[\\/]/.test(name)) {
          toast(t('请输入有效的文件名。', 'Enter a valid filename.'))
          break
        }
        const old = S.file,
          path = old.split('/').slice(0, -1).concat(name).join('/')
        if (ws().disk[path] !== undefined) {
          toast(t('目标文件已存在。', 'The destination exists.'))
          break
        }
        ws().disk[path] = ws().disk[old]
        Reflect.deleteProperty(ws().disk, old)
        if (ws().drafts[old] !== undefined) {
          ws().drafts[path] = ws().drafts[old]
          Reflect.deleteProperty(ws().drafts, old)
        }
        if (ws().dirty.delete(old)) ws().dirty.add(path)
        const g = groups.find(g => g[3].includes(old))
        if (g) g[3].push(path)
        closeDialog()
        setFile(path)
        toast(
          t('已重命名；请检查源码引用。', 'Renamed. Check source references.')
        )
        break
      }
      case 'add-performer':
        addPerformer()
        break
      case 'create-performer': {
        const p = {
          id: String(S.nextPerformer++),
          device: el.dataset.device,
          hidden: false,
        }
        S.performers.push(p)
        closeDialog()
        showPerformer(p.id)
        break
      }
      case 'show-performer':
        showPerformer(el.dataset.id, el.classList.contains('icon-btn'))
        break
      case 'delete-performer': {
        const id = el.dataset.id
        childWindows.get(id)?.close()
        childWindows.delete(id)
        S.performers = S.performers.filter(p => p.id !== id)
        render()
        break
      }
      case 'open-projection':
        closePopover()
        openProjection()
        break
      case 'projection-live':
        closePopover()
        if (S.running) {
          S.projectionLive = !S.projectionLive
          if (!S.projection) openProjection()
          updateProjection()
          render()
        }
        break
      case 'close-projection':
        closePopover()
        closeProjection()
        render()
        break
      case 'immersive':
        S.immersive = !S.immersive
        S.chrome = true
        render()
        scheduleHide()
        break
      case 'finder':
        closePopover()
        toast(
          t(
            '原型示意：正式 App 会在 Finder 中定位此文件。',
            'Prototype: the App would reveal this file in Finder.'
          )
        )
        break
      case 'help':
        closePopover()
        window.PNDSSettings.handle('settings:help', el)
        break
      case 'import':
      case 'import-setlist':
        closePopover()
        dialog(
          t('导入工程（演示）', 'Import project (demo)'),
          `<p class="subtle">${t('选择演示来源，体验导入后的列表与只读行为。', 'Choose a demo source to explore import and read-only behavior.')}</p><div class="stack" style="margin-top:18px">${button('import-demo', t('文件夹工程', 'Folder project'), 'folder', 'data-source="folder"')}${button('import-demo', t('.pnds 工程包', '.pnds bundle'), 'package', 'data-source="bundle"')}</div>`
        )
        break
      case 'import-demo': {
        const id = 'imported-' + (projects.length + 1),
          p = {
            ...projects[0],
            id,
            name:
              el.dataset.source === 'bundle'
                ? 'Imported Performance'
                : 'Imported Score',
            subtitle: t('导入的作品', 'Imported score'),
            source: el.dataset.source,
            group: S.folder === 'Utilities' ? 'Home' : S.folder,
          }
        projects.push(p)
        workspaces[id] = {
          disk: initialFiles(p),
          drafts: {},
          dirty: new Set(),
          pending: new Set(),
          tested: false,
          savedRevision: 1,
        }
        S.selected = id
        S.folder = p.group
        closeDialog()
        render()
        break
      }
      case 'new-folder':
      case 'rename-folder':
      case 'rename-project':
        closePopover()
        dialog(
          t('名称', 'Name'),
          `<input id="name-input" style="width:100%" value="${name === 'rename-project' ? esc(current().name) : name === 'rename-folder' ? esc(S.folder) : t('新的演出', 'New performance')}">`,
          button('close-dialog', t('取消', 'Cancel')) +
            button(
              'apply-name',
              t('保存', 'Save'),
              '',
              'data-kind="' + name + '"',
              'primary'
            )
        )
        break
      case 'apply-name': {
        const value = document.getElementById('name-input').value.trim()
        if (!value) return
        if (el.dataset.kind === 'rename-project') current().name = value
        else if (el.dataset.kind === 'rename-folder') {
          const old = S.folder
          S.folders = S.folders.map(f => (f === old ? value : f))
          projects.forEach(p => {
            if (p.group === old) p.group = value
          })
          S.folder = value
        } else {
          if (!S.folders.includes(value)) S.folders.push(value)
          S.folder = value
        }
        closeDialog()
        render()
        break
      }
      case 'delete-folder':
        closePopover()
        confirm(
          t('删除演出文件夹？', 'Delete performance folder?'),
          t(
            '其中的作品仍保留在所有作品中。',
            'Projects remain in All projects.'
          ),
          () => {
            const old = S.folder
            S.folders = S.folders.filter(f => f !== old)
            projects.forEach(p => {
              if (p.group === old) p.group = 'Home'
            })
            S.folder = 'Home'
            render()
          },
          t('删除文件夹', 'Delete folder')
        )
        break
      case 'remove-project':
        closePopover()
        if (current()?.source === 'utility') {
          toast(
            t('内置工具不能移除。', 'Built-in utilities cannot be removed.')
          )
          break
        }
        confirm(
          t('从列表移除？', 'Remove from the list?'),
          t(
            '不会删除原始工程文件。',
            'Original project files will not be deleted.'
          ),
          () => {
            if (S.selected === S.running) stopRuntime()
            const i = projects.findIndex(p => p.id === S.selected)
            projects.splice(i, 1)
            S.selected = projects.find(p => p.source !== 'utility')?.id || null
            render()
          },
          t('移除', 'Remove')
        )
        break
      case 'export-folder':
        closePopover()
        dialog(
          t('导出演出文件夹', 'Export performance folder'),
          `<div class="stack"><strong>${esc(S.folder)}</strong><p>${t('包含作品清单、简介与工程包。', 'Includes the setlist, introduction and project bundles.')}</p><p class="subtle">${t('当前为交互演示，不生成实际导出目录。', 'This interaction demo does not create an export directory.')}</p></div>`,
          button('close-dialog', t('取消', 'Cancel')) +
            button('export-complete', t('导出', 'Export'), '', '', 'primary')
        )
        break
      case 'export-complete':
        closeDialog()
        toast(t('演出文件夹导出演示完成。', 'Setlist export demo complete。'))
        break
      case 'inspect-state': {
        const {
          theme,
          language,
          mode,
          selected,
          running,
          status,
          applied,
          device,
          rate,
          lan,
          generation,
          pageRevision,
          performers,
        } = S
        dialog(
          t('原型状态', 'Prototype state'),
          `<pre class="mono" style="white-space:pre-wrap">${esc(JSON.stringify({ theme, language, mode, selected, running, status, applied, nextStart: { device, rate, lan }, generation, pageRevision, dirty: ws() ? [...ws().dirty] : [], pending: ws() ? [...ws().pending] : [], performers }, null, 2))}</pre>`
        )
        break
      }
      case 'reset':
        closePopover()
        location.reload()
        break
    }
  }

  document.addEventListener('click', e => {
    if (modeIntent && !e.target.closest('.mode-control')) cancelModeSwitch()
    const el = e.target.closest('[data-action]')
    if (el) {
      e.preventDefault()
      action(el.dataset.action, el)
    } else if (popover && !e.target.closest('.popover')) closePopover()
  })
  document.addEventListener('input', e => {
    const el = e.target
    if (el.id === 'volume') {
      S.volume = Number(el.value)
      S.muted = false
      document.querySelector('.volume-value').textContent = S.volume + '%'
      document.querySelector('[data-action="mute"]').innerHTML = icon('volume')
      return
    }
    if (el.id === 'file-search') {
      const start = el.selectionStart
      S.fileSearch = el.value
      render()
      const input = document.getElementById('file-search')
      input.focus()
      input.setSelectionRange(start, start)
      return
    }
    const kind = el.dataset.edit
    if (!kind) return
    if (kind === 'source') {
      markDraft(el.value)
      return
    }
    if (kind.startsWith('manifest:')) {
      try {
        const m = JSON.parse(text('manifest.json')),
          keys = kind.slice(9).split('.')
        let target = m
        for (const k of keys.slice(0, -1)) target = target[k]
        target[keys.at(-1)] = el.type === 'number' ? Number(el.value) : el.value
        markDraft(JSON.stringify(m, null, 2), 'manifest.json')
      } catch {
        /* A child window may already be closed. */
      }
    }
    if (kind.startsWith('readme:')) {
      let raw = text(S.file)
      if (kind === 'readme:title') raw = raw.replace(/^# .+/, '# ' + el.value)
      if (kind === 'readme:author')
        raw = raw.replace(
          /\*\*(?:作者|Composer)\*\*[:：].*/,
          S.readmeLanguage === 'en'
            ? '**Composer**: ' + el.value
            : '**作者**：' + el.value
        )
      if (kind === 'readme:description') {
        const heading = S.readmeLanguage === 'en' ? 'About' : '简介'
        const re = new RegExp(
          '(## ' + heading + '\\n\\n)[\\s\\S]*?(?=\\n## |$)'
        )
        raw = raw.replace(re, (_, prefix) => prefix + el.value + '\n')
      }
      markDraft(raw)
    }
  })
  document.addEventListener('change', e => {
    const el = e.target
    if (el.dataset.setting) {
      const key = el.dataset.setting,
        value = el.type === 'checkbox' ? el.checked : el.value
      if (['device', 'rate', 'lan', 'room', 'oscTarget'].includes(key)) {
        S[key] = value
        render()
        const note = document.getElementById('audio-pending')
        if (note)
          note.textContent = t(
            '有待应用的设置。重启后生效。',
            'Settings pending. Restart to apply.'
          )
      } else window.PNDSSettings.change(key, value)
      if (key === 'language')
        broadcast({ action: 'language', language: S.language })
      return
    }
    if (el.id === 'folder-select') {
      S.folder = el.value
      render()
    }
    if (el.id === 'test-audio-mode') {
      S.testMode = el.value
      render()
    }
    if (el.id === 'readme-language') {
      S.readmeLanguage = el.value
      setFile(el.value === 'en' ? 'README.md' : 'README.zh-CN.md')
    }
  })
  document.addEventListener('keydown', e => {
    if (!document.getElementById('dialog')) return
    const editable = e.target.matches(
        'input,textarea,select,[contenteditable]'
      ),
      dialogOpen = document.getElementById('dialog').open
    if (e.key === 'Tab') sidebarKeyboard = true
    if (e.key === 'Meta') {
      S.pinnedChrome = true
      updateSidebarVisibility()
      revealChrome()
    }
    if (e.key === 'Escape') {
      if (modeIntent) {
        cancelModeSwitch()
        return
      }
      closePopover()
      if (dialogOpen) return
      if (S.expanded) {
        S.expanded = false
        render()
      } else if (S.console) {
        S.console = false
        render()
      } else if (S.immersive) {
        S.immersive = false
        S.chrome = true
        render()
      }
      return
    }
    if ((e.metaKey || e.ctrlKey) && e.key === ',') {
      e.preventDefault()
      openSettings()
      return
    }
    if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'm') {
      e.preventDefault()
      if (adjustable()) {
        S.muted = !S.muted
        render()
      }
      return
    }
    if (dialogOpen) return
    if (
      !editable &&
      (e.metaKey || e.ctrlKey) &&
      /^[1-9]$/.test(e.key) &&
      S.mode === 'performance'
    ) {
      const listed = projects.filter(p =>
        S.folder === 'Home' ? p.source !== 'utility' : p.group === S.folder
      )
      const target = listed[Number(e.key) - 1]
      if (target) {
        e.preventDefault()
        S.selected = target.id
        render()
      }
      return
    }
    if (
      (e.metaKey || e.ctrlKey) &&
      e.key.toLowerCase() === 's' &&
      S.mode === 'creation'
    ) {
      e.preventDefault()
      saveFile()
      return
    }
    if ((e.metaKey || e.ctrlKey) && e.shiftKey && e.key.toLowerCase() === 'r') {
      e.preventDefault()
      refreshPages()
      return
    }
    if (
      (e.metaKey || e.ctrlKey) &&
      e.key.toLowerCase() === 'f' &&
      S.mode === 'creation' &&
      S.workspace
    ) {
      e.preventDefault()
      S.searchOpen = true
      S.editorView = 'source'
      render()
      document.getElementById('find-text').focus()
      return
    }
    if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'o') {
      e.preventDefault()
      projectPicker()
      return
    }
    if (
      !editable &&
      e.key === 'Enter' &&
      !e.target.closest('button') &&
      S.mode === 'performance'
    ) {
      e.preventDefault()
      requestRun()
    }
    if (
      !editable &&
      e.key === String.fromCharCode(96) &&
      (e.metaKey || e.ctrlKey) &&
      S.mode === 'creation'
    ) {
      e.preventDefault()
      S.console = !S.console
      render()
    }
    if (
      e.target.dataset.resize &&
      ['ArrowLeft', 'ArrowRight'].includes(e.key)
    ) {
      e.preventDefault()
      const side = e.target.dataset.resize === 'side',
        prop = side ? '--side-width' : '--preview-width',
        width =
          e.target.previousElementSibling?.getBoundingClientRect().width || 230
      if (side)
        document.documentElement.style.setProperty(
          prop,
          Math.max(
            175,
            Math.min(360, width + (e.key === 'ArrowRight' ? 10 : -10))
          ) + 'px'
        )
      else {
        const preview = document
          .querySelector('.preview-pane')
          .getBoundingClientRect().width
        document.documentElement.style.setProperty(
          prop,
          Math.max(
            250,
            Math.min(600, preview + (e.key === 'ArrowLeft' ? 10 : -10))
          ) + 'px'
        )
      }
    }
  })
  document.addEventListener('keyup', e => {
    if (e.key === 'Meta') {
      S.pinnedChrome = false
      updateSidebarVisibility()
      scheduleHide()
    }
  })
  document.addEventListener('mousemove', e => {
    if (autoSidebar()) {
      const inside =
        e.clientX <= 14 ||
        !!e.target.closest('.performance-sidebar,.sidebar-reveal-zone')
      if (sidebarPointer !== inside) {
        sidebarPointer = inside
        if (!inside) S.sidebarPeek = false
        updateSidebarVisibility()
      }
    }
    if (!S.immersive || !S.running) return
    if (
      e.clientY > innerHeight - 65 ||
      e.clientX < 12 ||
      e.target.closest('.transport,.sidebar,.popover')
    ) {
      revealChrome()
      clearTimeout(revealTimer)
    } else scheduleHide()
  })
  document.addEventListener('pointerdown', e => {
    sidebarKeyboard = false
    if (modeIntent && !e.target.closest('.mode-control')) cancelModeSwitch()
    sidebarPointerActive = !!e.target.closest('.performance-sidebar')
    if (!sidebarPointerActive) S.sidebarPeek = false
    updateSidebarVisibility()
    const splitter = e.target.closest('[data-resize]')
    if (!splitter) return
    e.preventDefault()
    splitter.classList.add('dragging')
    const side = splitter.dataset.resize === 'side'
    const move = event =>
      document.documentElement.style.setProperty(
        side ? '--side-width' : '--preview-width',
        Math.max(
          side ? 175 : 250,
          Math.min(
            side ? 360 : 650,
            side ? event.clientX : innerWidth - event.clientX
          )
        ) + 'px'
      )
    const end = () => {
      splitter.classList.remove('dragging')
      document.removeEventListener('pointermove', move)
      document.removeEventListener('pointerup', end)
    }
    document.addEventListener('pointermove', move)
    document.addEventListener('pointerup', end)
  })
  let draggedId = null
  document.addEventListener('dragstart', e => {
    draggedId = e.target.closest('[data-project]')?.dataset.project || null
    if (draggedId) e.dataTransfer?.setData('text/plain', draggedId)
    sidebarDragging = !!draggedId
    updateSidebarVisibility()
  })
  document.addEventListener('dragover', e => {
    if (e.target.closest('[data-project]')) e.preventDefault()
  })
  document.addEventListener('dragend', () => {
    draggedId = null
    sidebarDragging = false
    sidebarPointerActive = false
    updateSidebarVisibility()
  })
  document.addEventListener('drop', e => {
    const sourceId = draggedId
    draggedId = null
    sidebarDragging = false
    sidebarPointerActive = false
    updateSidebarVisibility()
    const id = e.target.closest('[data-project]')?.dataset.project
    if (!sourceId || !id || id === sourceId) return
    e.preventDefault()
    const from = projects.findIndex(p => p.id === sourceId),
      to = projects.findIndex(p => p.id === id)
    if (
      projects[from]?.source === 'utility' ||
      projects[to]?.source === 'utility'
    )
      return
    const [p] = projects.splice(from, 1)
    projects.splice(to, 0, p)
    draggedId = null
    render()
  })
  document.getElementById('dialog').addEventListener('close', () => {
    if (!document.getElementById('dialog').open) {
      modalKind = null
      confirmAction = null
      updateSidebarVisibility()
      scheduleHide()
    }
  })
  window.addEventListener('message', e => {
    if (e.data?.type === 'pnds-performer') {
      const id = String(e.data.id),
        p = S.performers.find(p => p.id === id)
      if (!p || childWindows.get(id) !== e.source) return
      if (e.data.action === 'ready') {
        p.hidden = false
        e.source.postMessage(
          {
            type: 'pnds-prototype',
            action: 'runtime',
            running: S.running === S.workspace,
            theme: S.theme,
            language: S.language,
          },
          '*'
        )
        render()
      }
      if (e.data.action === 'hidden') {
        p.hidden = true
        render()
      }
      if (e.data.action === 'gesture') {
        S.gesture = Math.max(
          0,
          Math.min(1, Number(e.data.value?.intensity) || 0)
        )
        document
          .querySelectorAll('.monitor-wrap')
          .forEach(el => (el.innerHTML = scoreArt()))
        updateProjection()
      }
    }
    if (
      e.data?.type === 'pnds-projection-ready' &&
      e.source === projectionWindow
    )
      updateProjection()
  })
  document.addEventListener('pointerup', () => {
    sidebarPointerActive = false
    updateSidebarVisibility()
  })
  document.addEventListener('pointercancel', () => {
    sidebarPointerActive = false
    updateSidebarVisibility()
  })
  document.addEventListener('focusin', updateSidebarVisibility)
  document.addEventListener('focusout', () =>
    setTimeout(updateSidebarVisibility, 0)
  )
  document.addEventListener('pointerout', e => {
    if (
      e.target.closest('.mode-switch') &&
      !e.relatedTarget?.closest?.('.mode-switch')
    ) {
      modeHoverPaused = false
      renderModeSwitch()
    }
  })
  document.addEventListener('mouseleave', () => {
    sidebarPointer = false
    S.sidebarPeek = false
    updateSidebarVisibility()
  })
  window.addEventListener('blur', () => {
    cancelModeSwitch()
    sidebarPointer = false
    sidebarPointerActive = false
    sidebarDragging = false
    S.sidebarPeek = false
    S.pinnedChrome = false
    updateSidebarVisibility()
  })
  window.addEventListener('beforeunload', () => {
    clearTimeout(modeSwitchTimer)
    closeClients()
    projectionWindow?.close()
  })
  const query = new URLSearchParams(location.search)
  if (query.has('projection')) {
    document.body.innerHTML = `<div id="projection" style="height:100dvh;background:var(--surface);overflow:auto">${renderCover(projects[0])}</div>`
    window.addEventListener('message', e => {
      if (e.source !== window.opener || e.data?.type !== 'pnds-projection')
        return
      document.documentElement.dataset.theme = e.data.theme
      document.getElementById('projection').innerHTML = e.data.html
    })
    window.opener?.postMessage({ type: 'pnds-projection-ready' }, '*')
    return
  }
  if (['pond', 'sand', 'stage', 'brutal'].includes(query.get('theme')))
    S.theme = query.get('theme')
  if (query.get('lang') === 'en') S.language = 'en'
  if (query.get('scene')) scenario(query.get('scene'))
  else render()
  window.P.review = {
    scenario,
    saveFile,
    run,
    stopRuntime,
    requestMode,
    refreshPages,
    compile,
    openWorkspace,
    setFile,
    markDraft,
    hasPending,
  }
})()
