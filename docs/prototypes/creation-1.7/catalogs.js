/* global window, document */
/* Memory-only prototype: catalog versions and paths mirror the shipped 1.6 assets.
 * File content below is illustrative; this prototype never reads or writes a project. */
;(function () {
  const P = (window.P ||= {})
  const packageData = [
    [
      'p5',
      '2.3.4',
      'browser',
      '画面与交互绘制',
      'Drawing and interaction',
      'bU5oNunn4L51hFu3+b6+zAQj+sPIlVyY0JmUCjABVytYwjNwf06EKFiLQgU70z5HPW58qTHRf5G8vM8gNtfbng==',
    ],
    [
      'ml5',
      '1.4.0',
      'browser',
      '浏览器内的机器学习',
      'Machine learning in the browser',
      'gjWRlas0Bp+1eWTht+XrpJdOmdwqOrh5ACBY162PGfLqOt/IqZEtwiZgVhD7khOgO0HApJUCFGFuaiLjSg5BMg==',
    ],
    [
      'express',
      '5.3.0',
      'node',
      '工程服务器与页面路由',
      'Project server and page routes',
      'qCqy1xSoaugxOD4IVHb1ZWdkvCF2W3aE2okKouWj8VwJ+ztskSiXoBnCSJqfKT+cVPJhuJqe9YLbY425+Zh00g==',
    ],
    [
      'qrcode',
      '1.5.4',
      'node',
      '生成演奏者连接二维码',
      'Generate performer QR codes',
      '1ca71Zgiu6ORjHqFBDpnSMTR2ReToX4l1Au1VFLyVeBTFavzQnv5JxMFr3ukHVKpSrSA2MCk0lNJSykjUfz7Zg==',
    ],
    [
      'socket.io',
      '4.8.4',
      'both',
      '服务器与演奏者实时通信',
      'Realtime server and performer communication',
      '9ZV9zg8vN8hO3Y25DhR7nUkJ1VDnBhq5O/JrXhFT9s6+F0gqytSASTHVfCFc2mJXaTfARroErplXlzFWwETZqQ==',
    ],
    [
      'socket.io-client',
      '4.8.4',
      'both',
      '连接实时服务器',
      'Connect to a realtime server',
      '7wjKAvVXYOJsbmUgkWbnhPD4bFpkqrUR0++XOjpGFmqDqsqV1CI93VTraeExLxpjxEqrWgFoSRZu1ihjLWfkAA==',
    ],
    [
      'osc-min',
      '2.1.2',
      'node',
      'OSC 消息编码与解析',
      'Encode and decode OSC messages',
      'dEhg7wBJ+QTHqY4iwnctkaFWzXLq+yHA2olxYfnxBw1fMy/iWJ/b7ovfXfwc/yxLXGiUHQhTxlQSHzL8ueHz6Q==',
    ],
  ].map(([id, version, kind, zh, en, integrity]) => ({
    id,
    version,
    kind,
    zh,
    en,
    integrity,
  }))
  const moduleData = [
    {
      id: 'qr',
      zh: '连接二维码',
      en: 'Connection QR code',
      icon: 'qr',
      purpose: [
        '为演奏者提供工程连接入口。',
        'Provide an entry point for performers.',
      ],
      runtime: 'Node 24 · qrcode 1.5.x · Express 4.x / compatible HTTP',
      adaptation: [
        '将工程解析出的完整演奏者地址接入 HTTP 路由，再选择显示位置。',
        'Pass the resolved performer URL to an HTTP route and choose where to display it.',
      ],
      verify: [
        '使用真实手机扫码，检查地址与页面加载。',
        'Scan with a phone and check the destination and page load.',
      ],
      sourceFiles: ['qr.js'],
    },
    {
      id: 'players',
      zh: '客户端连接与身份恢复',
      en: 'Clients and identity recovery',
      icon: 'users',
      purpose: [
        '管理演奏者连接、身份和重连。',
        'Manage performer connections, identity and reconnection.',
      ],
      runtime: 'Node 24 · Socket.IO 4.x · Browser Socket.IO client',
      adaptation: [
        '由作品决定准入、身份保存及声音恢复策略；monitor 状态另行接入。',
        'The work defines admission, identity persistence and sound recovery; monitor state is separate.',
      ],
      verify: [
        '检查首次连接、断线重连、身份恢复和退出清理。',
        'Check first connection, reconnect, identity recovery and cleanup.',
      ],
      sourceFiles: ['players.js', 'seats-store.js', 'protocol.js', 'client.js'],
    },
    {
      id: 'theme-follow',
      zh: 'Monitor 主题跟随',
      en: 'Monitor theme',
      icon: 'palette',
      purpose: [
        '让工程画面跟随 App 主题。',
        'Let the project monitor follow the App theme.',
      ],
      runtime: 'Browser DOM · No npm dependency',
      adaptation: [
        '仅在 monitor 加载，接入作品的 CSS 配色或绘图回调。',
        'Load in the monitor only and connect the work’s CSS or drawing callback.',
      ],
      verify: [
        '切换四套 App 主题，检查首帧与运行中的画面。',
        'Switch the four App themes and check initial and running frames.',
      ],
      sourceFiles: ['theme-follow.js'],
    },
    {
      id: 'locale-follow',
      zh: 'Monitor 语言跟随',
      en: 'Monitor language',
      icon: 'globe',
      purpose: [
        '让工程画面使用 App 选择的语言。',
        'Use the language selected in the App.',
      ],
      runtime: 'Browser DOM · No npm dependency',
      adaptation: [
        '声明作品支持的语言、回退语言与字符串表回调。',
        'Declare supported locales, a fallback and the work’s string-table callback.',
      ],
      verify: [
        '切换语言并检查未支持语言的回退结果。',
        'Switch locales and check the unsupported-locale fallback.',
      ],
      sourceFiles: ['locale-follow.js'],
    },
    {
      id: 'monitor-state',
      zh: 'Monitor 视图状态',
      en: 'Monitor view state',
      icon: 'monitor',
      purpose: [
        '同步 monitor 的低频视图与显示状态。',
        'Synchronize low-frequency monitor view state.',
      ],
      runtime: 'Node 24 · Socket.IO 4.x · Browser Socket.IO client',
      adaptation: [
        '声明状态键与默认值，使用独立 monitor 通信空间；演奏者不接入。',
        'Declare keys and defaults in a dedicated monitor namespace; performers do not connect.',
      ],
      verify: [
        '检查视图同步、输入校验与服务器重启后的默认状态。',
        'Check synchronization, value validation and defaults after server restart.',
      ],
      sourceFiles: ['monitor-state.js', 'monitor-client.js'],
    },
    {
      id: 'hub',
      zh: '远程协作 Hub',
      en: 'Remote collaboration hub',
      icon: 'network',
      purpose: [
        '可选的跨地点工程协作连接。',
        'Optional connections between locations.',
      ],
      runtime: 'Node 24 · socket.io-client 4.8.x · PNDS hub relay',
      adaptation: [
        '声明远程协作能力并读取 Host 的节点与房间配置；保留本地控制。',
        'Declare telematic capability and use Host node/room configuration while retaining local control.',
      ],
      verify: [
        '分别检查未配置、已连接、断线与本地继续工作。',
        'Check unconfigured, connected and disconnected states, plus continued local control.',
      ],
      sourceFiles: ['hub.js'],
    },
  ].map(entry => ({
    ...entry,
    version: '0.2.0',
    files: [
      ...entry.sourceFiles,
      'package.json',
      'README.md',
      'compatibility.json',
      'LICENSE.md',
      'pnds-module.json',
    ].map(file => `modules/pnds-${entry.id}/${file}`),
  }))
  const sourceRevision =
    'sha256:d0e71422448ff1f8505271b2f3950f4acc8b3f89c6ab9311c277f8e1e19a6301'
  let selected = null
  let category = 'packages'
  let trigger = null
  let feedback = ''
  let completed = false

  const t = (zh, en) => P.t(zh, en)
  const e = value => P.esc(String(value))
  const button = (action, label, extra = '', className = 'secondary') =>
    `<button type="button" class="${className}" data-action="${action}" ${extra}>${label}</button>`
  const label = entry => t(entry.zh, entry.en)
  const dirty = path =>
    Object.hasOwn(P.state.drafts, path) &&
    P.state.drafts[path] !== P.state.files[path]
  const packageKind = entry =>
    entry.kind === 'browser'
      ? t('浏览器', 'Browser')
      : entry.kind === 'both'
        ? 'Node + Browser'
        : 'Node'
  const moduleStatus = entry => {
    const adopted = P.state.modulesAdded[entry.id]
    if (adopted) return 'added'
    return Object.keys(P.state.files).some(path =>
      path.startsWith(`modules/pnds-${entry.id}/`)
    )
      ? 'conflict'
      : 'available'
  }
  const addedVersion = entry => {
    const value = P.state.modulesAdded[entry.id]
    return typeof value === 'string' ? value : value?.version || entry.version
  }
  const tabs = () =>
    `<div class="catalog-tabs" aria-label="${t('添加类型', 'Addition type')}">${button('catalog-packages', t('App 共享包', 'App shared packages'), `aria-pressed="${category === 'packages'}"`, category === 'packages' ? 'primary' : 'secondary')}${button('catalog-modules', t('标准技术模块', 'Standard modules'), `aria-pressed="${category === 'modules'}"`, category === 'modules' ? 'primary' : 'secondary')}</div>`
  const notice = () =>
    feedback
      ? `<div class="callout ${completed ? 'success' : 'warning'}" role="status">${e(feedback)}</div>`
      : ''
  const focusTitle = () => {
    const title = document.getElementById('dialog-title')
    if (title) {
      title.tabIndex = -1
      title.focus()
    }
  }

  function listPackages(focusId) {
    category = 'packages'
    selected = null
    feedback = ''
    completed = false
    const body = `${tabs()}<p class="muted">${t('使用 App 随附的固定版本，为工程添加库引用。接入代码与实际验证由作品决定。', 'Reference exact libraries bundled with the App. Source wiring and verification belong to the work.')}</p><div class="catalog-grid">${packageData
      .map(entry => {
        const reference = P.state.catalogRefs[entry.id]
        return `<button type="button" class="catalog-card" data-action="catalog-package" data-id="${entry.id}"><span class="catalog-card-head"><strong>${e(entry.id)}</strong><span class="badge">${entry.version}</span></span><span>${label(entry)}</span><span class="catalog-card-foot"><span class="muted">${packageKind(entry)}</span><span class="badge ${reference === entry.version ? 'success' : ''}">${reference === entry.version ? t('已引用', 'Referenced') : reference ? t(`已引用 ${reference}`, `Referenced ${reference}`) : t('可添加', 'Available')}</span></span></button>`
      })
      .join(
        ''
      )}</div><p class="muted catalog-note">${t('“已引用”表示工程保存了这一版本的引用，接线与兼容性仍需验证。', '“Referenced” means the reference is saved. Wiring and compatibility still need verification.')}</p>`
    P.openDialog(
      t('App 共享包', 'App shared packages'),
      body,
      button('catalog-close', t('完成', 'Done'))
    )
    if (focusId)
      document
        .querySelector(`[data-action="catalog-package"][data-id="${focusId}"]`)
        ?.focus()
  }

  function packageDetail(id, newVersion = '') {
    const entry = packageData.find(item => item.id === id)
    if (!entry) return
    selected = id
    const reference = P.state.catalogRefs[id]
    const already = reference === entry.version
    const manifestDirty = dirty('manifest.json')
    const body = `<div class="detail-meta"><span class="badge">${packageKind(entry)}</span><span class="badge">${t('App 随附版本', 'Bundled version')} ${entry.version}</span>${reference ? `<span class="badge">${t('工程引用', 'Project reference')} ${e(reference)}</span>` : ''}</div>
      <p>${label(entry)}</p>${notice()}
      ${reference && !already ? `<div class="callout warning">${t(`这会将工程当前的 ${id} ${reference} 引用替换为 ${entry.version}。保存后请检查接线与兼容性。`, `This replaces the project’s ${id} ${reference} reference with ${entry.version}. Check wiring and compatibility after saving.`)}</div>` : ''}
      <div class="callout">${t('保存时一起更新 manifest 中的库引用和工程版本。库由 App 提供，工程保留自己的路由、代码和资源。', 'Saving updates the library reference and project version together. The App provides the library; the work owns its routes, code and resources.')}</div>
      <div class="detail-meta"><span>${t('当前工程版本', 'Current project version')}</span><strong>${e(P.state.projectVersion)}</strong></div>
      ${already ? `<div class="callout success">${t('工程已引用这一版本。下一步可与 AI 讨论如何接入；运行中的工程会在手动重启后读取新引用。', 'This version is referenced. Discuss wiring with the assistant; a running project reads the reference on manual restart.')}</div>` : `<label class="field" for="catalog-project-version"><span>${t('新的工程版本', 'New project version')}</span><input id="catalog-project-version" value="${e(newVersion)}" placeholder="${t('例如 0.1.1', 'e.g. 0.1.1')}" autocomplete="off"><small class="muted">${t('输入与当前不同的版本号，例如 0.1.1。', 'Enter a version different from the current one, such as 0.1.1.')}</small></label>`}
      ${manifestDirty ? `<div class="callout warning">${t('manifest.json 有未保存草稿。请先在文件区处理草稿，再添加共享包。', 'manifest.json has an unsaved draft. Resolve it in Files before adding a package.')}</div>` : ''}
      <p class="muted">${entry.id === 'ml5' ? t('模型与作品资源由工程提供；添加库不会下载模型或开启摄像头。', 'Models and work assets belong to the project. Adding the library does not download models or enable the camera.') : entry.kind === 'browser' ? t('通过工程自己的页面路由使用浏览器文件。', 'Serve the browser file through the project’s own page route.') : t('工程可以同时使用 App 共享包与自己的依赖。', 'Projects can combine App shared packages and their own dependencies.')}</p>
      <details><summary>${t('来源与完整性', 'Source and integrity')}</summary><p class="muted">${t('固定的 npm 发布源', 'Pinned npm release')}</p><code class="catalog-source">https://registry.npmjs.org/${e(entry.id)}/-/${e(entry.id)}-${entry.version}.tgz</code><code class="catalog-source">sha512-${e(entry.integrity)}</code></details>`
    P.openDialog(
      `${entry.id} ${entry.version}`,
      body,
      `${button('catalog-packages-back', t('返回目录', 'Back to catalog'))}${button('catalog-close', t('关闭', 'Close'))}${already ? '' : button('catalog-adopt', t('保存引用与版本', 'Save reference and version'), `data-id="${entry.id}" ${manifestDirty ? 'disabled' : ''}`, 'primary')}`
    )
    focusTitle()
  }

  function adoptPackage(id) {
    const entry = packageData.find(item => item.id === id)
    if (!entry || P.state.catalogRefs[id] === entry.version) return
    const version =
      document.getElementById('catalog-project-version')?.value.trim() || ''
    if (dirty('manifest.json')) {
      feedback = t(
        '请先处理 manifest.json 的未保存草稿。',
        'Resolve the unsaved manifest.json draft first.'
      )
      packageDetail(id, version)
      return
    }
    if (
      !/^\d+\.\d+\.\d+(?:-[\w.-]+)?$/.test(version) ||
      version === P.state.projectVersion
    ) {
      feedback = t(
        '请输入新的工程版本号，例如 0.1.1；它需要与当前版本不同。',
        'Enter a new project version, such as 0.1.1, different from the current version.'
      )
      packageDetail(id, version)
      document.getElementById('catalog-project-version')?.focus()
      return
    }
    let manifest
    try {
      manifest = JSON.parse(P.state.files['manifest.json'] || '{}')
    } catch {
      feedback = t(
        'manifest.json 需要有效的 JSON，处理后可重试。',
        'manifest.json needs valid JSON before you can retry.'
      )
      packageDetail(id, version)
      return
    }
    P.state.catalogRefs[id] = entry.version
    P.state.projectVersion = version
    manifest.schemaVersion = 2
    manifest.version = version
    manifest.sharedLibraries = Object.entries(P.state.catalogRefs).map(
      ([packageId, packageVersion]) => ({
        id: packageId,
        version: packageVersion,
      })
    )
    P.markChanged('manifest.json', `${JSON.stringify(manifest, null, 2)}\n`)
    completed = true
    feedback = t(
      `已引用 ${id} ${entry.version}，工程版本更新为 ${version}。`,
      `Referenced ${id} ${entry.version}; project version is now ${version}.`
    )
    P.render()
    packageDetail(id)
    P.toast(
      t(
        '引用已保存 · 接线待完成 · 运行画面保持当前状态',
        'Reference saved · Wiring pending · Running monitor unchanged'
      )
    )
  }

  function listModules(focusId) {
    category = 'modules'
    selected = null
    feedback = ''
    completed = false
    const body = `${tabs()}<p class="muted">${t('把可维护的模块源码加入工程，再通过交接文档安排接线与验证。', 'Add maintainable module source, then arrange wiring and verification through the handoff.')}</p><div class="catalog-grid">${moduleData
      .map(entry => {
        const status = moduleStatus(entry)
        return `<button type="button" class="catalog-card" data-action="catalog-module" data-id="${entry.id}"><span class="catalog-card-head"><strong>${label(entry)}</strong><span class="badge">${status === 'added' ? e(addedVersion(entry)) : entry.version}</span></span><span>${t(...entry.purpose)}</span><span class="catalog-card-foot"><span class="muted">${entry.files.length} ${t('个文件', 'files')}</span><span class="badge ${status === 'added' ? 'success' : status === 'conflict' ? 'warning' : ''}">${status === 'added' ? t('文件已加入', 'Files added') : status === 'conflict' ? t('目录冲突', 'Directory conflict') : t('可添加', 'Available')}</span></span></button>`
      })
      .join(
        ''
      )}</div><p class="muted catalog-note">${t('模块由工程维护。文件加入后，接线与运行验证会单独记录。', 'The project maintains its modules. Wiring and runtime verification are recorded separately.')}</p>`
    P.openDialog(
      t('标准技术模块', 'Standard technical modules'),
      body,
      button('catalog-close', t('完成', 'Done'))
    )
    if (focusId)
      document
        .querySelector(`[data-action="catalog-module"][data-id="${focusId}"]`)
        ?.focus()
  }

  function moduleDetail(id) {
    const entry = moduleData.find(item => item.id === id)
    if (!entry) return
    selected = id
    const status = moduleStatus(entry)
    const draftBlocked = ['docs/creator-handoff.md', ...entry.files].some(dirty)
    const body = `<div class="detail-meta"><span class="badge">${t('随附版本', 'Bundled version')} ${entry.version}</span><span class="badge">Host protocol 1</span>${status === 'added' ? `<span class="badge success">${t('已加入', 'Added')} ${e(addedVersion(entry))}</span>` : ''}</div><p>${t(...entry.purpose)}</p>${notice()}
      ${status === 'conflict' ? `<div class="callout warning">${t('目标目录已存在，且没有可识别的模块来源记录。请交给外部智能体检查合并；此处保留文件。', 'The destination exists without a recognized module record. Ask an external agent to review and merge; existing files remain intact.')}</div>` : ''}
      ${status === 'added' ? `<div class="callout success">${t('文件已加入，接线与验证状态由交接记录说明。可以继续查看已有交接。', 'Files are added. The handoff records wiring and verification status; continue with the existing handoff.')}</div>` : `<div class="callout">${t('添加模块源码、来源记录，并在交接文档中追加接线任务。现有工程入口和运行画面保持当前状态。', 'Add source files and provenance, then append a wiring task to the handoff. Existing entry code and the running monitor keep their current state.')}</div>`}
      <h3>${t('兼容与接线', 'Compatibility and wiring')}</h3><p class="muted">${e(entry.runtime)}</p><p>${t(...entry.adaptation)}</p><h3>${t('验证要点', 'Verification')}</h3><p>${t(...entry.verify)}</p>
      <details open><summary>${t('加入工程的文件', 'Files added to the project')} · ${entry.files.length}</summary><ul class="file-list">${entry.files.map(path => `<li><code>${e(path)}</code></li>`).join('')}</ul></details>
      ${draftBlocked && status !== 'added' ? `<div class="callout warning">${t('交接文档或目标文件有未保存草稿。请先处理草稿，再添加模块。', 'The handoff or a destination file has an unsaved draft. Resolve it before adding the module.')}</div>` : ''}
      ${status === 'added' && addedVersion(entry) !== entry.version ? `<p class="muted">${t('保留工程实际采用的旧版。升级与合并由外部智能体处理。', 'The adopted version is retained. Upgrades and merges are handled by an external agent.')}</p>` : ''}
      <details><summary>${t('来源', 'Source')}</summary><p>PNDS Template · 0.5.1</p><code class="catalog-source">https://github.com/xO-xN/PNDS-Template</code><code class="catalog-source">${sourceRevision}</code></details>`
    P.openDialog(
      label(entry),
      body,
      `${button('catalog-modules-back', t('返回目录', 'Back to catalog'))}${button('catalog-close', t('关闭', 'Close'))}${status === 'added' ? button('catalog-handoff', t('查看接线交接', 'View wiring handoff'), '', 'primary') : button('catalog-add-module', t('加入文件与交接任务', 'Add files and handoff task'), `data-id="${entry.id}" ${status === 'conflict' || draftBlocked ? 'disabled' : ''}`, 'primary')}`
    )
    focusTitle()
  }

  function addModule(id) {
    const entry = moduleData.find(item => item.id === id)
    if (!entry || moduleStatus(entry) !== 'available') return
    if (['docs/creator-handoff.md', ...entry.files].some(dirty)) {
      feedback = t(
        '请先处理交接文档或目标文件中的未保存草稿。',
        'Resolve unsaved drafts in the handoff or destination files first.'
      )
      moduleDetail(id)
      return
    }
    const source = {
      repository: 'https://github.com/xO-xN/PNDS-Template',
      revision: sourceRevision,
      version: '0.5.1',
    }
    entry.files.forEach(path => {
      const name = path.split('/').at(-1)
      let text = `// Prototype placeholder for ${path}\n// Shipped module ${entry.id} ${entry.version}; wiring is pending.\n`
      if (name === 'pnds-module.json')
        text = `${JSON.stringify({ id, version: entry.version, source }, null, 2)}\n`
      if (name === 'package.json')
        text = `${JSON.stringify({ private: true, type: 'commonjs' }, null, 2)}\n`
      if (name === 'compatibility.json')
        text = `${JSON.stringify({ version: entry.version, hostProtocol: 1, runtime: entry.runtime.split(' · '), adaptation: entry.adaptation }, null, 2)}\n`
      if (name === 'README.md')
        text = `# ${label(entry)}\n\n${t(...entry.purpose)}\n\n${t(...entry.adaptation)}\n\n${t(...entry.verify)}\n\n${t('此原型仅演示文件加入流程。', 'This prototype only demonstrates the file-addition workflow.')}\n`
      if (name === 'LICENSE.md')
        text = 'Prototype placeholder for the bundled MIT license.\n'
      P.markChanged(path, text)
    })
    P.state.modulesAdded[id] = { version: entry.version, status: 'files-added' }
    const title = t(`接入${entry.zh}`, `Wire ${entry.en}`)
    const detail = `${t(...entry.adaptation)} ${t(...entry.verify)}`
    P.state.handoffTasks.push({
      id: `module-${id}-${entry.version}`,
      title,
      detail,
      intent: title,
      files: entry.files,
      status: 'pending',
      acceptance: t(...entry.verify),
    })
    const handoff =
      P.state.files['docs/creator-handoff.md'] || '# Creator handoff\n'
    P.markChanged(
      'docs/creator-handoff.md',
      `${handoff}\n## ${title} · ${entry.version}\n\n${detail}\n\n${t('文件已加入；接线与运行验证待完成。', 'Files added; wiring and runtime verification pending.')}\n\n${entry.files.map(path => `- ${path}`).join('\n')}\n`
    )
    completed = true
    feedback = t(
      `已加入 ${entry.files.length} 个文件，并追加接线任务。`,
      `Added ${entry.files.length} files and a wiring task.`
    )
    P.render()
    moduleDetail(id)
    P.toast(
      t(
        '模块文件已加入 · 继续交接接线 · 当前画面保持运行',
        'Module files added · Continue with wiring handoff · Monitor unchanged'
      )
    )
  }

  P.initCatalogs = function () {
    P.state.catalogRefs ||= {}
    P.state.modulesAdded ||= {}
    P.state.handoffTasks ||= []
    P.catalogData = { packages: packageData, modules: moduleData }
  }

  P.catalogAction = function (action, el) {
    if (!action.startsWith('catalog-')) return false
    const id = el?.dataset.id
    if (action === 'catalog-packages' || action === 'catalog-modules') {
      if (!document.getElementById('dialog')?.open) trigger = el
      if (action === 'catalog-packages') listPackages()
      else listModules()
    } else if (action === 'catalog-package') {
      feedback = ''
      completed = false
      packageDetail(id)
    } else if (action === 'catalog-module') {
      feedback = ''
      completed = false
      moduleDetail(id)
    } else if (action === 'catalog-packages-back') listPackages(selected)
    else if (action === 'catalog-modules-back') listModules(selected)
    else if (action === 'catalog-adopt') adoptPackage(id)
    else if (action === 'catalog-add-module') addModule(id)
    else if (action === 'catalog-handoff') {
      P.closeDialog()
      P.state.activeView = 'handoff'
      P.render()
    } else if (action === 'catalog-close') {
      P.closeDialog()
      trigger?.focus()
    }
    return true
  }
})()
