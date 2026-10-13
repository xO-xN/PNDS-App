/* global window */
/* Independent prototype: all settings and diagnostics are in-memory demos. */
;(function () {
  const sectionNames = [
    ['general', '通用', 'General'],
    ['audio', '音频', 'Audio'],
    ['node', '网络与节点', 'Network & node'],
    ['https', '可信 HTTPS', 'Trusted HTTPS'],
    ['dns', '演出 DNS', 'Performance DNS'],
    ['ports', '端口', 'Ports'],
    ['developer', '开发工具', 'Developer tools'],
    ['about', '关于', 'About'],
  ]
  const local = {
    section: 'general',
    token: '',
    domain: 'show.example.org',
    httpsPort: '8443',
    certificate: false,
    certificateDomain: '',
    externalPort: null,
    inspected: false,
    released: false,
    updated: false,
  }
  const p = () => window.P
  const t = (zh, en) => p().t(zh, en)
  const e = value => p().escape(String(value ?? ''))
  const title = (zh, en, detail = '') =>
    `<div class="settings-section-header"><h2 class="section-title">${t(zh, en)}</h2>${detail ? `<p class="subtle">${detail}</p>` : ''}</div>`
  const note = (zh, en) => `<p class="subtle">${t(zh, en)}</p>`
  const button = (action, zh, en, extra = '', style = '') =>
    `<button class="btn ${style}" type="button" data-action="settings:${action}" ${extra}>${t(zh, en)}</button>`
  const field = (label, input, hint = '') =>
    `<div class="field"><div><span class="settings-field-label">${label}</span>${hint ? `<small class="subtle">${hint}</small>` : ''}</div>${input}</div>`
  const textInput = (key, label, value, extra = '') =>
    `<input aria-label="${e(label)}" data-setting="${key}" value="${e(value)}" ${extra}>`
  const select = (key, label, value, options) => {
    const items = options.some(option => String(option[0]) === String(value))
      ? options
      : [[value, value], ...options]
    return `<select aria-label="${e(label)}" data-setting="${key}">${items
      .map(
        ([id, name]) =>
          `<option value="${e(id)}" ${String(id) === String(value) ? 'selected' : ''}>${e(name)}</option>`
      )
      .join('')}</select>`
  }
  const toggle = (key, label, value) =>
    `<label class="settings-toggle"><input type="checkbox" role="switch" aria-label="${e(label)}" data-setting="${key}" ${value ? 'checked' : ''}><span aria-hidden="true"></span></label>`
  const property = (label, value, mono = false) =>
    `<div class="field"><span class="subtle">${label}</span><span class="${mono ? 'mono' : ''}">${e(value)}</span></div>`
  const selectedProject = () => {
    const state = p().state
    if (state.selected && typeof state.selected === 'object')
      return state.selected
    return (
      (state.projects || []).find(
        project =>
          project.id === state.selected || project.path === state.selected
      ) || null
    )
  }
  const projectLabel = () => {
    const project = selectedProject()
    return (
      project?.name || project?.title || t('未选择工程', 'No project selected')
    )
  }
  const ports = () => {
    const project = selectedProject()
    return [
      {
        label: 'Performer',
        port:
          project?.performerPort ||
          project?.manifest?.scoreServer?.performerPort ||
          6868,
      },
      {
        label: 'Monitor',
        port:
          project?.monitorPort ||
          project?.manifest?.scoreServer?.monitorPort ||
          6869,
      },
    ]
  }
  const runningUses = port => {
    const { running, projects } = p().state
    if (!running) return false
    const project =
      typeof running === 'object'
        ? running
        : (projects || []).find(item => item.id === running)
    return [
      project?.performerPort ||
        project?.manifest?.scoreServer?.performerPort ||
        6868,
      project?.monitorPort ||
        project?.manifest?.scoreServer?.monitorPort ||
        6869,
    ].includes(port)
  }
  const rerender = () => p().render()

  function general() {
    const state = p().state
    const themes = [
      ['pond', '池塘', 'Pond'],
      ['sand', '暖沙', 'Sand'],
      ['stage', '暗场', 'Stage'],
      ['brutal', '粗野', 'Brutal'],
    ]
    return `${title('通用', 'General')}
      ${field(
        t('界面语言', 'Language'),
        select(
          'language',
          t('界面语言', 'Language'),
          state.language || 'zh-CN',
          [
            ['zh-CN', '简体中文'],
            ['en', 'English'],
          ]
        )
      )}
      <div class="divider"></div>
      <div class="field-stack"><label>${t('外观', 'Appearance')}</label>
        <div class="settings-theme-grid">${themes
          .map(
            ([
              id,
              zh,
              en,
            ]) => `<button class="settings-theme-option ${state.theme === id ? 'active' : ''}" type="button" data-action="settings:theme" data-theme="${id}" aria-pressed="${state.theme === id}">
              <span class="settings-theme-preview" data-preview-theme="${id}" aria-hidden="true"><i></i><b></b><em></em></span><span>${t(zh, en)}</span>
            </button>`
          )
          .join('')}</div>
      </div>
      ${note('主题与语言立即应用，作品内容保持原文。', 'Appearance and language apply immediately. Project content keeps its original language.')}`
  }

  function audio() {
    const state = p().state
    const device = state.device || 'MacBook Pro Speakers'
    const multichannel = String(device).includes('16')
    return `${title('音频', 'Audio', t('本机输出配置。下次启动或重启工程时应用。', 'Local output settings apply on the next project start or restart.'))}
      ${field(
        t('输出设备', 'Output device'),
        select('device', t('输出设备', 'Output device'), device, [
          ['System Default', t('系统默认', 'System Default')],
          ['MacBook Pro Speakers', 'MacBook Pro Speakers · 2ch'],
          ['BlackHole 16ch', 'BlackHole 16ch · 16ch'],
          ['Aggregate Device', t('聚合设备 · 8ch', 'Aggregate Device · 8ch')],
        ])
      )}
      ${field(
        t('采样率', 'Sample rate'),
        select('rate', t('采样率', 'Sample rate'), state.rate || '48000', [
          ['44100', '44.1 kHz'],
          ['48000', '48 kHz'],
          ['96000', '96 kHz'],
        ])
      )}
      ${property(t('可用输出', 'Available outputs'), multichannel ? '16ch' : device === 'Aggregate Device' ? '8ch' : '2ch')}
      <div class="divider"></div>
      ${property(t('演出音频模式', 'Performance audio mode'), t('使用工程默认值', 'Project default'))}
      ${note('测试时可在创作工作台临时选择音频模式。', 'Choose a temporary test audio mode in the creation workspace.')}
      <div class="notice">${t('音量与静音控制位于运行工具栏。多通道工程保持原始增益。', 'Volume and mute are in the runtime toolbar. Multichannel projects retain their original gain.')}</div>`
  }

  function node() {
    const state = p().state
    return `${title('网络与节点', 'Network & node', t('两种模式共享本机网络配置。', 'Local network settings are shared by both modes.'))}
      ${field(
        t('本地网络', 'Local network'),
        select(
          'lan',
          t('本地网络', 'Local network'),
          state.lan || '192.168.1.24',
          [
            ['192.168.1.24', 'Wi-Fi · 192.168.1.24'],
            [
              '192.168.50.2',
              t('以太网 · 192.168.50.2', 'Ethernet · 192.168.50.2'),
            ],
          ]
        )
      )}
      ${field(t('节点名称', 'Node name'), textInput('nodeName', t('节点名称', 'Node name'), state.nodeName || 'Studio Mac', 'autocomplete="off"'))}
      <div class="divider"></div>
      <h3 class="section-title">${t('远程演出', 'Telematic performance')}</h3>
      ${field(t('Hub 地址', 'Hub address'), textInput('hub', t('Hub 地址', 'Hub address'), state.hub || 'wss://hub.example.org', 'class="mono" autocomplete="off" spellcheck="false" dir="ltr"'))}
      ${field(t('访问 Token', 'Access token'), textInput('nodeToken', t('访问 Token', 'Access token'), local.token, 'type="password" autocomplete="off" placeholder="••••••••"'))}
      ${note('地址、节点与分组在下一次启动时生效。', 'Address, node and room changes apply on the next start.')}
      ${button('network-help', '连接说明', 'Connection guide')}`
  }

  function https() {
    const enabled = !!p().state.https
    const valid = local.certificate && local.certificateDomain === local.domain
    return `${title('可信 HTTPS', 'Trusted HTTPS', t('为需要安全连接的 Performer 页面提供入口。', 'A secure entry point for Performer pages that require HTTPS.'))}
      ${field(t('启用 HTTPS 入口', 'Enable HTTPS entry'), toggle('https', t('启用 HTTPS 入口', 'Enable HTTPS entry'), enabled))}
      ${field(t('域名', 'Domain'), textInput('httpsDomain', t('域名', 'Domain'), local.domain, 'class="mono" autocomplete="off" spellcheck="false" dir="ltr"'))}
      ${field(t('端口', 'Port'), textInput('httpsPort', t('端口', 'Port'), local.httpsPort, 'class="mono" inputmode="numeric" dir="ltr"'))}
      <div class="divider"></div>
      ${field(t('证书材料', 'Certificate material'), `<span class="chip ${valid ? '' : 'subtle'}">${valid ? t('已准备 · 演示', 'Prepared · demo') : local.certificate ? t('域名待核对', 'Domain needs review') : t('尚未准备', 'Not prepared')}</span>`)}
      ${valid ? property(t('适用域名', 'Valid for'), local.certificateDomain, true) : ''}
      <div class="row">${button('certificate-import', local.certificate ? '替换证书' : '准备证书', local.certificate ? 'Replace certificate' : 'Prepare certificate')}${local.certificate ? button('certificate-clear', '移除', 'Remove', '', 'danger') : ''}${button('https-help', '准备指南', 'Setup guide')}</div>
      ${enabled && !valid ? `<div class="notice">${t('完成证书准备后，下一次启动将使用 HTTPS 入口。', 'Prepare the certificate before starting a project with HTTPS.')}</div>` : note('修改在下一次启动时生效。证书有效与设备可访问是独立的检查。', 'Changes apply on the next start. Certificate validity and device reachability are separate checks.')}`
  }

  function dns() {
    const { dns: enabled, lan, running } = p().state
    return `${title('演出 DNS', 'Performance DNS', t('让局域网设备通过演出域名访问本机。', 'Let local devices reach this Mac through the performance domain.'))}
      ${field(t('启用演出 DNS', 'Enable performance DNS'), toggle('dns', t('启用演出 DNS', 'Enable performance DNS'), !!enabled))}
      ${property(t('服务状态', 'Service status'), enabled ? t('运行中 · 演示', 'Running · demo') : t('未启用', 'Off'))}
      ${enabled ? property(t('监听地址', 'Listen address'), `${lan || '192.168.1.24'}:53 · UDP / TCP`, true) : ''}
      ${enabled ? property(t('当前映射', 'Current mapping'), running ? `${local.domain} → ${lan || '192.168.1.24'}` : t('等待工程启动', 'Waiting for project start'), !!running) : ''}
      <div class="divider"></div>
      <div class="row">${button('dns-refresh', '刷新状态', 'Refresh status')}${button('dns-help', '网络配置指南', 'Network setup guide')}</div>
      ${note('设备所在网络需将此 Mac 用作 DNS 服务器。', 'Devices on the network need to use this Mac as their DNS server.')}`
  }

  function portPanel() {
    const rows = ports()
    const running = rows.some(({ port }) => runningUses(port))
    return `${title('端口', 'Ports', t('查看所选工程的服务端口。', 'Service ports for the selected project.'))}
      <div class="row settings-port-heading"><span>${e(projectLabel())}</span>${button('ports-refresh', '刷新', 'Refresh')}</div>
      <div class="settings-port-list">${rows
        .map(({ label, port }) => {
          const runtimeOwned = runningUses(port)
          const occupied = local.externalPort === port && !runtimeOwned
          return `<div class="settings-port-item"><div class="field"><span>${label} <span class="mono subtle">:${port}</span></span><span class="chip ${occupied ? 'danger' : ''}">${runtimeOwned ? t('运行工程使用中', 'Running project') : occupied ? t('被外部进程占用', 'External process') : t('可用', 'Available')}</span></div>
            ${occupied ? `<div class="settings-port-details"><div class="mono subtle">node · PID 4821</div><code class="mono">node /Users/demo/other-score/server.js</code><div class="row">${button('port-release', '释放端口…', 'Release port…', `data-port="${port}"`, 'danger')}</div></div>` : ''}</div>`
        })
        .join('')}</div>
      ${running ? note('请先关闭当前工程，再释放其使用的端口。', 'Close the current project before releasing its ports.') : ''}
      <div class="divider"></div>
      <div class="row">${button('port-scenario', '演示端口冲突', 'Simulate a conflict', rows.every(({ port }) => runningUses(port)) ? 'disabled' : '')}${local.released ? `<span class="subtle">${t('演示端口已释放', 'Demo port released')}</span>` : ''}</div>
      ${note('此原型仅模拟检查与释放，不访问系统进程。', 'This prototype simulates checks and releases without accessing system processes.')}`
  }

  function developer() {
    return `${title('开发工具', 'Developer tools')}
      <div class="settings-tool-row"><div><h3 class="section-title">${t('生成 .pnds', 'Generate .pnds')}</h3>${note('从工程菜单生成当前工程的已保存版本。', 'Package the saved version of the current project from its project menu.')}</div><span class="chip">${t('工程菜单', 'Project menu')}</span></div>
      <div class="divider"></div>
      <div class="settings-tool-row"><div><h3 class="section-title">${t('编译 SynthDef', 'Compile SynthDef')}</h3>${note('选择 SuperCollider 源码后，从文件工具栏运行。', 'Select a SuperCollider source file and use its file toolbar.')}</div><span class="chip">${t('创作工作台', 'Creation workspace')}</span></div>
      <div class="divider"></div>
      <div class="settings-tool-row"><div><h3 class="section-title">${t('交接任务', 'Handoff tasks')}</h3>${note('在工程菜单记录交给外部开发工具的任务。', 'Record tasks for external development tools from the project menu.')}</div><span class="chip">${t('工程菜单', 'Project menu')}</span></div>
      <div class="divider"></div>
      <div class="row">${button('logs', '查看会话日志', 'View session logs')}${button('developer-help', '开发文档', 'Developer documentation')}</div>`
  }

  function about() {
    return `${title('PNDS', 'PNDS', t('数字乐谱的创作与演出工具。', 'A workspace for creating and performing digital scores.'))}
      ${property(t('版本', 'Version'), '1.6.0 · UI Prototype')}
      ${property(t('平台', 'Platform'), 'macOS · Apple Silicon / Intel')}
      <div class="divider"></div>
      <div class="row">${button('check-update', '检查更新', 'Check for updates')}${button('help', '帮助中心', 'Help center')}${button('shortcuts', '键盘快捷键', 'Keyboard shortcuts')}</div>
      ${local.updated ? `<div class="notice">${t('演示环境中的版本已是最新。', 'The version in this demo is up to date.')}</div>` : ''}
      <div class="divider"></div>
      <div class="row">${button('data-folder', '数据文件夹', 'Data folder')}${button('logs', '日志文件夹', 'Log folder')}</div>
      ${note('所有操作仅在本次原型会话中演示。刷新后恢复初始状态。', 'All actions are demonstrations for this prototype session. Reload to reset.')}`
  }

  const renderers = {
    general,
    audio,
    node,
    https,
    dns,
    ports: portPanel,
    developer,
    about,
  }

  function render(section = 'general') {
    local.section = renderers[section] ? section : 'general'
    const heading = sectionNames.find(item => item[0] === local.section)
    return `<div class="settings-layout">
      <nav class="settings-nav" aria-label="${t('设置分类', 'Settings categories')}">${sectionNames
        .map(
          ([id, zh, en]) =>
            `<button type="button" class="${local.section === id ? 'active' : ''}" data-action="settings-section" data-section="${id}" ${local.section === id ? 'aria-current="page"' : ''}>${t(zh, en)}</button>`
        )
        .join('')}</nav>
      <section class="settings-content" aria-label="${e(t(heading[1], heading[2]))}">${renderers[local.section]()}</section>
    </div>`
  }

  function info(heading, body) {
    p().dialog(
      heading,
      `<div class="stack">${body}</div>`,
      button('return', '返回设置', 'Back to settings', '', 'primary')
    )
  }

  function handle(action, element) {
    action = action.replace(/^settings:/, '')
    switch (action) {
      case 'theme':
        p().setTheme(element.dataset.theme)
        return true
      case 'return':
        p().dialog(t('设置', 'Settings'), render(local.section))
        return true
      case 'certificate-import':
        info(
          t('准备 HTTPS 证书', 'Prepare HTTPS certificate'),
          `${property(t('演出域名', 'Performance domain'), local.domain, true)}<div class="notice">${t('使用示例证书链和私钥，查看准备完成后的状态。', 'Use a sample certificate chain and private key to preview the prepared state.')}</div><div class="row">${button('certificate-confirm', '使用演示证书', 'Use demo certificate', '', 'primary')}</div>`
        )
        return true
      case 'certificate-confirm':
        local.certificate = true
        local.certificateDomain = local.domain
        p().dialog(t('设置', 'Settings'), render('https'))
        p().toast(t('演示证书已准备', 'Demo certificate prepared'))
        return true
      case 'certificate-clear':
        local.certificate = false
        local.certificateDomain = ''
        rerender()
        return true
      case 'dns-refresh':
        p().toast(t('演示 DNS 状态已更新', 'Demo DNS status refreshed'))
        return true
      case 'ports-refresh':
        local.inspected = true
        p().toast(t('端口状态已更新 · 演示', 'Port status refreshed · demo'))
        rerender()
        return true
      case 'port-scenario': {
        const target = ports().find(({ port }) => !runningUses(port))
        if (!target) return true
        local.externalPort = target.port
        local.released = false
        rerender()
        return true
      }
      case 'port-release': {
        const port = Number(element.dataset.port)
        if (runningUses(port) || port !== local.externalPort) return true
        p().dialog(
          t('释放被占用的端口？', 'Release the occupied port?'),
          `<div class="stack"><p>${t('结束下面的演示进程，以释放端口。', 'End the demo process below to release the port.')}</p>${property(t('端口', 'Port'), port, true)}${property(t('进程', 'Process'), 'node · PID 4821', true)}<code class="mono">node /Users/demo/other-score/server.js</code>${note('仅改变原型状态，不会终止系统进程。', 'Only prototype state changes. No system process is terminated.')}</div>`,
          `${button('return', '取消', 'Cancel')}${button('port-release-confirm', '确认释放', 'Release port', `data-port="${port}"`, 'danger')}`
        )
        return true
      }
      case 'port-release-confirm':
        if (
          runningUses(Number(element.dataset.port)) ||
          Number(element.dataset.port) !== local.externalPort
        )
          return true
        local.externalPort = null
        local.released = true
        p().log(
          t(
            '演示：释放 node 占用的端口',
            'Demo: released the port occupied by node'
          )
        )
        p().dialog(t('设置', 'Settings'), render('ports'))
        p().toast(t('演示端口已释放', 'Demo port released'))
        return true
      case 'check-update':
        local.updated = true
        rerender()
        p().toast(t('演示版本已是最新', 'The demo version is up to date'))
        return true
      case 'data-folder':
      case 'logs':
        info(
          action === 'logs'
            ? t('会话日志', 'Session logs')
            : t('应用数据', 'Application data'),
          `<p>${action === 'logs' ? t('真实 App 会在 Finder 中显示本机日志。此原型可在创作工作台的控制台查看演示日志。', 'The app reveals local logs in Finder. This prototype shows demo logs in the creation console.') : t('真实 App 会在 Finder 中显示本机偏好与工程索引。', 'The app reveals local preferences and the project index in Finder.')}</p>${note('原型不会访问本机文件。', 'The prototype does not access local files.')}`
        )
        return true
      case 'shortcuts':
        info(
          t('键盘快捷键', 'Keyboard shortcuts'),
          `${property(t('打开工程', 'Open project'), '⌘O')}${property(t('保存当前文件', 'Save current file'), '⌘S')}${property(t('设置', 'Settings'), '⌘,')}${property(t('刷新演出页面', 'Refresh performance page'), '⌘⇧R')}${property(t('静音', 'Mute'), '⌘M')}${property(t('退出展开预览', 'Exit expanded preview'), 'Esc')}`
        )
        return true
      case 'network-help':
      case 'https-help':
      case 'dns-help':
      case 'developer-help':
      case 'help':
        info(
          t('帮助中心', 'Help center'),
          `<p>${t('选择一项了解工作流。', 'Choose a topic to review its workflow.')}</p><div class="settings-help-topics">${button('help-performance', '演出与投影', 'Performance & projection')}${button('help-creation', '创作与测试', 'Creation & testing')}${button('help-network', '网络与 HTTPS', 'Network & HTTPS')}</div>`
        )
        return true
      case 'help-performance':
        info(
          t('演出与投影', 'Performance & projection'),
          `<p>${t('选择作品后加载。演出始终使用工程默认音频模式。浏览其他作品不会停止正在运行的演出。', 'Select and load a work. Performance uses its default audio mode. Browsing other works leaves the current performance running.')}</p><p>${t('投影窗口可在作品简介与演出画面之间切换，关闭投影不会结束工程。', 'The projection window switches between the introduction and live view. Closing it does not stop the project.')}</p>`
        )
        return true
      case 'help-creation':
        info(
          t('创作与测试', 'Creation & testing'),
          `<p>${t('manifest 定义工程，README 描述作品。手动保存后，再刷新页面、编译 SynthDef 或重启测试。', 'The manifest defines the project; the README describes the work. Save first, then refresh pages, compile SynthDefs or restart testing.')}</p><p>${t('测试与打包都使用已保存的文件。未保存草稿保留在当前原型会话中。', 'Testing and packaging use saved files. Unsaved drafts stay in the current prototype session.')}</p>`
        )
        return true
      case 'help-network':
        info(
          t('网络与 HTTPS', 'Network & HTTPS'),
          `<p>${t('选择演出设备可访问的本地网络地址。节点与网络配置在下次启动时应用。', 'Choose a local address reachable by performer devices. Network and node settings apply on the next start.')}</p><p>${t('HTTPS 需要域名、有效证书和可达的网络。演出 DNS 帮助局域网设备解析该域名。', 'HTTPS requires a domain, a valid certificate and a reachable network. Performance DNS helps local devices resolve that domain.')}</p>`
        )
        return true
      default:
        return false
    }
  }

  function change(key, value) {
    if (key === 'nodeToken') {
      local.token = String(value)
      return true
    }
    if (key === 'httpsDomain' || key === 'httpsPort') {
      local[key === 'httpsDomain' ? 'domain' : 'httpsPort'] = String(value)
      return true
    }
    const supported = [
      'language',
      'device',
      'rate',
      'lan',
      'nodeName',
      'hub',
      'https',
      'dns',
      'volume',
    ]
    if (!supported.includes(key)) return false
    p().state[key] =
      key === 'https' || key === 'dns'
        ? value === true || value === 'true'
        : key === 'volume'
          ? Number(value)
          : value
    if (!['nodeName', 'hub'].includes(key)) rerender()
    return true
  }

  window.PNDSSettings = { render, sections: sectionNames, handle, change }
})()
