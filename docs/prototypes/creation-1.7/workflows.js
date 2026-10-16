/* global window, document, navigator */
/* Memory-only interaction prototype. No filesystem, model, or Git operations. */
window.initWorkflows = function initWorkflows(P) {
  const s = P.state
  const t = (...args) => P.t(...args)
  const esc = value => P.esc(String(value ?? ''))
  const copy = value => JSON.parse(JSON.stringify(value))
  const saved = () => ({ ...s.files })
  const drafts = () =>
    Object.keys(s.drafts).filter(path => s.drafts[path] !== s.files[path])
  const handoffPath = 'docs/creator-handoff.md'
  let sequence = 1
  let pendingTask = null
  let recordPreview = null
  let gitSetupOptions = null
  s.resources ||= {
    'audio/room-tone.wav': {
      size: '48.2 MB',
      fingerprint: 'b47c…a912',
      large: true,
    },
  }
  s.handoffBaselines ||= []
  s.gitSnapshot ||= saved()
  s.gitResources ||= {}
  s.history ||= []
  s.handoffTasks ||= []
  s.changed ||= new Set()
  s.workflowTab ||= 'handoff'
  if (s.hasGit && !s.history.length) {
    s.history.push({
      id: 'a82f1c0',
      message: '创建 潮汐 工程',
      author: s.author || '林声',
      time: '2026-10-15 10:24',
      files: Object.keys(s.files),
      snapshot: saved(),
      resources: {},
      previous: {},
    })
  }

  function now() {
    return new Date().toLocaleString('sv-SE').slice(0, 16)
  }

  function button(action, label, kind = 'secondary', attrs = '') {
    return `<button class="${kind}" data-action="${action}" ${attrs}>${label}</button>`
  }

  function cancel() {
    return button('wf-cancel', t('取消', 'Cancel'))
  }

  function resourceChanges(before = {}) {
    return [...new Set([...Object.keys(before), ...Object.keys(s.resources)])]
      .filter(
        path =>
          JSON.stringify(before[path]) !== JSON.stringify(s.resources[path])
      )
      .map(path => ({
        path,
        binary: true,
        before: before[path],
        after: s.resources[path],
      }))
  }

  function textChanges(before = {}) {
    return [...new Set([...Object.keys(before), ...Object.keys(s.files)])]
      .filter(path => before[path] !== s.files[path])
      .map(path => ({ path, before: before[path], after: s.files[path] }))
  }

  function currentChanges(includeExcluded = false) {
    const changes = [
      ...textChanges(s.gitSnapshot),
      ...resourceChanges(s.gitResources).filter(
        change =>
          includeExcluded ||
          s.gitResources[change.path] ||
          !(change.after || change.before)?.large
      ),
    ]
    for (const path of s.externalStaged || []) {
      const existing = changes.find(change => change.path === path)
      if (existing) existing.externalStaged = true
      else if (s.files[path] !== undefined)
        changes.push({
          path,
          before: s.gitSnapshot[path],
          after: s.files[path],
          externalStaged: true,
        })
    }
    return changes
  }

  function changeStatus(change) {
    if (change.externalStaged)
      return t('外部暂存 · 待处理', 'Externally staged · resolve first')
    if (change.before === undefined) return t('新增', 'Added')
    if (change.after === undefined) return t('删除', 'Deleted')
    return t('修改', 'Modified')
  }

  function lineDiff(before, after) {
    const oldLines = before === undefined ? [] : String(before).split('\n')
    const newLines = after === undefined ? [] : String(after).split('\n')
    const a = oldLines.slice(0, 240)
    const b = newLines.slice(0, 240)
    const matrix = Array.from(
      { length: a.length + 1 },
      () => new Uint16Array(b.length + 1)
    )
    for (let i = a.length - 1; i >= 0; i--) {
      for (let j = b.length - 1; j >= 0; j--) {
        matrix[i][j] =
          a[i] === b[j]
            ? matrix[i + 1][j + 1] + 1
            : Math.max(matrix[i + 1][j], matrix[i][j + 1])
      }
    }
    const lines = []
    let i = 0
    let j = 0
    while (i < a.length || j < b.length) {
      if (i < a.length && j < b.length && a[i] === b[j]) {
        lines.push(
          `<div><span class="diff-sign"> </span>${esc(a[i]) || ' '}</div>`
        )
        i++
        j++
      } else if (
        i < a.length &&
        (j >= b.length || matrix[i + 1][j] >= matrix[i][j + 1])
      ) {
        lines.push(
          `<div class="remove-line"><span class="diff-sign">−</span>${esc(a[i]) || ' '}</div>`
        )
        i++
      } else {
        lines.push(
          `<div class="add-line"><span class="diff-sign">+</span>${esc(b[j]) || ' '}</div>`
        )
        j++
      }
    }
    return `<div class="diff" aria-label="${t('保存版文本差异', 'Saved text differences')}"><pre>${lines.join('')}</pre></div>${oldLines.length > 240 || newLines.length > 240 ? `<p class="muted">${t('原型只展示前 240 行。', 'This prototype shows the first 240 lines.')}</p>` : ''}`
  }

  function binarySummary(change) {
    const before = change.before
    const after = change.after
    return `<div class="resource-summary"><div><span class="muted">${t('交接前 / 记录前', 'Before')}</span><strong>${before ? esc(before.size) : '—'}</strong><code>${before ? esc(before.fingerprint) : '—'}</code></div><span aria-hidden="true">→</span><div><span class="muted">${t('当前保存版', 'Saved now')}</span><strong>${after ? esc(after.size) : '—'}</strong><code>${after ? esc(after.fingerprint) : '—'}</code></div></div><p class="muted">${t('资源只比较大小和指纹；交接基线不保存可恢复的资源副本。', 'Resources are compared by size and fingerprint; handoff baselines do not store recoverable resource copies.')}</p>`
  }

  function diffCard(change, options = {}) {
    const { historyId } = options
    const canOpen = !change.binary && s.files[change.path] !== undefined
    return `<article class="card change-card"><div class="toolbar"><code class="file-path">${esc(change.path)}</code><span class="badge">${changeStatus(change)}</span>${change.binary ? `<span class="badge">${t('资源摘要', 'Resource summary')}</span>` : ''}</div>${change.binary ? binarySummary(change) : lineDiff(change.before, change.after)}<div class="toolbar">${canOpen ? button('wf-current-file', t('当前文件', 'Current file'), 'secondary', `data-path="${esc(change.path)}"`) : ''}${historyId && canOpen && change.after !== undefined ? button('wf-load-history', t('将此版本载入草稿', 'Load this version into draft'), 'secondary', `data-path="${esc(change.path)}" data-commit="${esc(historyId)}"`) : ''}</div></article>`
  }

  function draftNotice() {
    const paths = drafts()
    return paths.length
      ? `<div class="callout"><strong>${t(`${paths.length} 个未保存草稿单独保留`, `${paths.length} unsaved drafts remain separate`)}</strong><p>${t('此处比较和记录的是已保存文件。', 'Comparison and version recording use saved files.')}</p><small>${paths.map(esc).join(' · ')}</small></div>`
      : ''
  }

  function baseSelector() {
    if (s.handoffBaselines.length < 2) return ''
    return `<div class="toolbar baseline-switcher" aria-label="${t('选择交接起点', 'Choose handoff baseline')}">${s.handoffBaselines.map(base => button('wf-select-baseline', `${esc(base.title)} · ${esc(base.time)}`, base.id === s.baseline?.id ? 'primary' : 'secondary', `data-id="${esc(base.id)}"`)).join('')}</div>`
  }

  function handoffView() {
    const tasks = s.handoffTasks
    return `<section class="workflow-page stack"><header class="page-head"><div><p class="eyebrow">${t('把想法交给外部编程智能体', 'Continue with an external coding agent')}</p><h1>${t('创作交接', 'Creative handoff')}</h1><p class="muted">${t('确认任务与验收，再把文档交给你使用的编程智能体。', 'Confirm the task and acceptance criteria, then share the document with your coding agent.')}</p></div>${button('wf-preview-handoff', t('预览并确认交接', 'Review handoff'), 'primary')}</header>${s.baseline ? `<div class="callout success"><strong>${t('已保留本次交接的比较起点', 'Handoff comparison baseline saved')}</strong><p>${esc(s.baseline.time)} · ${t('保存版文件', 'Saved files')} · ${Object.keys(s.baseline.files).length} ${t('项', 'items')}</p><div class="toolbar">${button('wf-copy-handoff', t('复制任务说明', 'Copy task brief'))}${button('wf-show-changes', t('查看交接后的变化', 'Compare after handoff'))}</div></div>` : `<div class="callout"><strong>${t('任务先写清，工程保持运行', 'Define the task while your project keeps running')}</strong><p>${t('首次确认后保留保存版起点，方便回来核对整个工程。', 'Confirming a handoff saves a baseline for reviewing the entire project when you return.')}</p></div>`}<div class="stack">${tasks.length ? tasks.map(task => `<article class="card task-card"><div class="toolbar"><span class="badge">${esc(task.status || t('待交接', 'Ready for handoff'))}</span><span class="muted">${esc(task.id)}</span></div><h2>${esc(task.title)}</h2><p>${esc(task.detail || t('在保留当前画面与声音关系的前提下完善实现。', 'Refine the implementation while preserving the current relationship between visuals and sound.'))}</p><div class="task-files">${(task.files || []).map(path => `<code>${esc(path)}</code>`).join('')}</div><div class="toolbar">${button('wf-preview-handoff', t('核对交接内容', 'Review task'), 'secondary', `data-task="${esc(task.id)}"`)}</div></article>`).join('') : `<article class="empty-state"><h2>${t('还没有交接任务', 'No handoff tasks yet')}</h2><p>${t('在对话中完善想法，需要跨文件实现时再交接。', 'Develop an idea in conversation, then hand off work that spans files.')}</p></article>`}</div>${s.baseline ? `<div class="demo-strip"><span>${t('原型演示', 'Prototype demo')}</span>${button('wf-simulate-external', t('模拟外部实现并提交', 'Simulate external work + commit'))}<small>${t('用于体验“Git 已干净，交接比较仍保留”的返回流程。', 'Try returning after an external commit: a clean Git state still has handoff differences.')}</small></div>` : ''}</section>`
  }

  function changesView() {
    const compare = s.workflowTab !== 'git'
    const changes =
      compare && s.baseline
        ? [
            ...textChanges(s.baseline.files),
            ...resourceChanges(s.baseline.resources),
          ]
        : compare
          ? []
          : currentChanges()
    const taskPaths = new Set(s.baseline?.taskFiles || [])
    changes.sort(
      (a, b) => Number(taskPaths.has(b.path)) - Number(taskPaths.has(a.path))
    )
    return `<section class="workflow-page stack"><header class="page-head"><div><p class="eyebrow">${t('理解变化，再核对效果', 'Understand changes, then verify the experience')}</p><h1>${t('工程变化', 'Project changes')}</h1></div>${s.hasGit ? button('wf-record', t('记录版本', 'Record version'), 'primary') : button('wf-enable-git', t('启用本地版本记录', 'Enable local history'), 'primary')}</header><div class="toolbar segmented" role="tablist" aria-label="${t('变化视图', 'Change view')}"><button role="tab" aria-selected="${compare}" class="${compare ? 'active' : ''}" data-action="wf-compare-tab">${t('交接后的变化', 'Since handoff')}${s.baseline ? ` <span class="badge">${compare ? changes.length : textChanges(s.baseline.files).length + resourceChanges(s.baseline.resources).length}</span>` : ''}</button><button role="tab" aria-selected="${!compare}" class="${!compare ? 'active' : ''}" data-action="wf-git-tab">${t('待记录的变化', 'Unrecorded changes')} <span class="badge">${currentChanges().length}</span></button></div>${compare ? baseSelector() : ''}${compare && s.baseline ? `<div class="comparison-context"><span class="badge">${t('交接保存版', 'Handoff snapshot')}</span><span>${esc(s.baseline.time)}</span><span aria-hidden="true">→</span><span class="badge">${t('当前保存版', 'Saved now')}</span></div>` : ''}${draftNotice()}${compare && !s.baseline ? `<div class="empty-state"><h2>${t('先确认一次交接', 'Confirm a handoff first')}</h2><p>${t('已有任务尚未记录比较起点时，无法还原当时工程。', 'Existing tasks without a baseline cannot reconstruct the earlier project.')}</p>${button('wf-show-handoff', t('打开创作交接', 'Open handoff'), 'primary')}</div>` : changes.length ? `<div class="toolbar"><span class="muted">${t(`${changes.length} 个文件有变化`, `${changes.length} changed files`)}</span><span class="spacer"></span>${button('checks', t('运行检查', 'Run checks'))}${button('wf-verification', t('核对验收项', 'Review acceptance'))}</div>${changes.map(change => diffCard(change)).join('')}` : `<div class="empty-state"><h2>${compare ? t('相对此次交接，还没有变化', 'No changes since this handoff') : t('代码变化已记录', 'Code changes are recorded')}</h2><p>${compare ? t('外部完成后，返回这里核对整个工程。', 'Return after external work to review the whole project.') : t('交接比较仍可独立查看；尚未纳入的大资源会单独提示。', 'Handoff comparisons remain available. Excluded large resources are shown separately.')}</p>${compare ? button('wf-simulate-external', t('模拟外部实现并提交', 'Simulate external work + commit')) : button('wf-compare-tab', t('查看交接后的变化', 'Compare since handoff'))}</div>`}<details class="workflow-details"><summary>${t('比较范围与资源', 'Comparison scope and resources')}</summary><p>${t('比较源码、配置、文档与资源清单；依赖、缓存、敏感项和 Git 内部数据排除。二进制只保留指纹和体积摘要。', 'Compare source, configuration, documents, and resources. Dependencies, caches, sensitive files, and Git internals are excluded. Binary resources retain only size and fingerprint summaries.')}</p></details>${s.baseline ? `<div class="demo-strip"><span>${t('原型演示', 'Prototype demo')}</span>${button('wf-simulate-external', t('模拟外部实现并提交', 'Simulate external work + commit'))}</div>` : ''}</section>`
  }

  function historyView() {
    if (!s.hasGit)
      return `<section class="workflow-page stack"><header class="page-head"><div><p class="eyebrow">${t('在本机保留创作的每个阶段', 'Keep each creative stage on this Mac')}</p><h1>${t('本地版本记录', 'Local version history')}</h1></div></header><article class="card"><h2>${t('为这个工程建立初始版本', 'Create an initial version for this project')}</h2><p>${t('先预览文件范围与署名，再启用。已有工程不会因打开而自动建立 Git 仓库。', 'Review files and authorship before enabling. Opening an existing project does not create a repository.')}</p>${button('wf-enable-git', t('启用本地版本记录', 'Enable local history'), 'primary')}<p class="muted">${t('App 提供 Git，无需登录或另装工具。', 'Git is included with the App. No login or extra tools required.')}</p></article></section>`
    const selected =
      s.history.find(item => item.id === s.selectedCommit) || s.history[0]
    const paths = selected?.files || []
    const path = paths.includes(s.historyFile)
      ? s.historyFile
      : paths.find(item => selected.snapshot?.[item] !== undefined) || paths[0]
    return `<section class="workflow-page stack"><header class="page-head"><div><p class="eyebrow">${t('保存创作阶段，随时理解过去的改动', 'Save creative milestones and understand past changes')}</p><h1>${t('本地版本记录', 'Local version history')}</h1></div>${button('wf-record', t('记录版本', 'Record version'), 'primary')}</header><div class="callout"><span>${t('保存文件后，由你决定何时记录版本。历史内容先载入草稿，核对后再保存。', 'You choose when to record saved files. Historical text loads into a draft for review before saving.')}</span></div><div class="history-layout"><div class="history-list" aria-label="${t('版本列表', 'Versions')}">${s.history.map(item => `<button class="history-item ${item.id === selected?.id ? 'selected' : ''}" data-action="wf-select-history" data-id="${esc(item.id)}"><strong>${esc(item.message)}</strong><span>${esc(item.author)} · ${esc(item.time)}</span><code>${esc(item.id)}</code></button>`).join('')}</div><div class="stack history-detail">${selected ? `<div class="toolbar"><strong>${esc(selected.message)}</strong><span class="badge">${paths.length} ${t('个文件', 'files')}</span></div><div class="file-list history-files">${paths.map(file => button('wf-select-history-file', esc(file), file === path ? 'primary' : 'secondary', `data-path="${esc(file)}"`)).join('')}</div>${path ? diffCard({ path, before: selected.previous?.[path] ?? selected.previousResources?.[path], after: selected.snapshot?.[path] ?? selected.resources?.[path], binary: Boolean(selected.resources?.[path] || selected.previousResources?.[path]) }, { historyId: selected.id }) : `<p class="muted">${t('此版本没有可查看的文件。', 'No files to view in this version.')}</p>`}` : `<div class="empty-state">${t('尚无版本记录', 'No versions yet')}</div>`}</div></div></section>`
  }

  function defaultTask() {
    return {
      id: 'creative-01',
      title: t(
        '让触摸密度影响音符与画面',
        'Let touch density shape notes and visuals'
      ),
      detail: t(
        '保留现在的环形乐谱。让参与者的触摸密度共同影响音符出现频率，并在 monitor 显示连接人数与密度反馈。',
        'Keep the circular score. Let the collective density of performer touches shape note frequency, with connection count and density feedback on the monitor.'
      ),
      files: [
        'web/monitor/sketch.js',
        'web/client/client.js',
        'server/index.js',
      ],
      status: t('待交接', 'Ready for handoff'),
    }
  }

  function acceptanceFor(task = {}) {
    if (Array.isArray(task.acceptance) && task.acceptance.length)
      return task.acceptance
    if (typeof task.acceptance === 'string' && task.acceptance.trim())
      return [task.acceptance]
    return [
      t(
        '多位参与者的输入产生预期反馈，断线重连后恢复。',
        'Multiple performers produce the intended response and recover after reconnecting.'
      ),
      t(
        '原有画面与声音仍可手动验证，未覆盖项明确列出。',
        'Existing visuals and sound can be manually verified; untested areas are listed.'
      ),
      t(
        '接线、修改文件与检查结果写回交接单。',
        'Wiring, changed files, and check results are documented in the handoff.'
      ),
    ]
  }

  function draftSaveError(paths) {
    for (const path of paths) {
      if (s.diskConflicts?.[path])
        return t(
          `${path} 的保存版已变化。请先处理草稿冲突。`,
          `${path} has changed on disk. Resolve the draft conflict first.`
        )
      if (path.endsWith('.json')) {
        try {
          JSON.parse(s.drafts[path])
        } catch {
          return t(
            `${path} 的 JSON 格式无效。请先修正草稿再交接。`,
            `${path} contains invalid JSON. Fix the draft before handing off.`
          )
        }
      }
    }
    return null
  }

  function previewHandoff(taskId) {
    pendingTask = copy(
      s.handoffTasks.find(task => task.id === taskId) ||
        s.handoffTasks[0] ||
        defaultTask()
    )
    const paths = drafts()
    P.openDialog(
      t('确认创作交接', 'Confirm creative handoff'),
      `<div class="stack"><label class="field"><span>${t('任务', 'Task')}</span><input id="wf-task-title" value="${esc(pendingTask.title)}"></label><label class="field"><span>${t('创作意图', 'Creative intent')}</span><textarea id="wf-task-detail" rows="3">${esc(pendingTask.detail || '')}</textarea></label><div><span class="muted">${t('涉及文件', 'Related files')}</span><div class="task-files">${(pendingTask.files || []).map(path => `<code>${esc(path)}</code>`).join('')}</div></div><div class="card"><strong>${t('回来后这样验收', 'Acceptance when you return')}</strong><ul>${acceptanceFor(
        pendingTask
      )
        .map(item => `<li>${esc(item)}</li>`)
        .join(
          ''
        )}</ul></div>${paths.length ? `<fieldset class="field draft-choice"><legend>${t(`${paths.length} 个文件尚未保存`, `${paths.length} files have unsaved drafts`)}</legend><small>${paths.map(esc).join(' · ')}</small><label><input type="radio" name="wf-drafts" value="save" checked> ${t('先保存草稿再交接', 'Save drafts before handing off')}</label><label><input type="radio" name="wf-drafts" value="saved"> ${t('仅按保存版交接，保留草稿', 'Hand off saved files and keep drafts')}</label></fieldset>` : ''}<p class="muted">${t('确认后写入 docs/creator-handoff.md，并保留本次保存版作为比较起点。', 'Confirming writes docs/creator-handoff.md and captures a saved-file baseline.')}</p></div>`,
      `${cancel()}${button('wf-confirm-handoff', t('确认并保存交接', 'Confirm and save handoff'), 'primary')}`
    )
  }

  function confirmHandoff() {
    if (!pendingTask) return
    pendingTask.title =
      document.getElementById('wf-task-title')?.value.trim() ||
      pendingTask.title
    pendingTask.detail =
      document.getElementById('wf-task-detail')?.value.trim() ||
      pendingTask.detail
    const saveFirst =
      document.querySelector('input[name="wf-drafts"]:checked')?.value !==
      'saved'
    if (saveFirst) {
      const paths = drafts()
      const error = draftSaveError(paths)
      if (error) return P.toast(error)
      for (const path of paths) {
        P.markChanged(path, s.drafts[path])
        Reflect.deleteProperty(s.drafts, path)
      }
    }
    const existing = s.handoffTasks.find(task => task.id === pendingTask.id)
    const task = {
      ...pendingTask,
      status: t('已交接 · 待核对', 'Handed off · review pending'),
    }
    if (existing) Object.assign(existing, task)
    else s.handoffTasks.push(task)
    const revision =
      s.handoffBaselines.filter(base => base.taskId === task.id).length + 1
    const body = `${s.files[handoffPath] || '# 创作交接\n'}\n## ${task.title} · r${revision}\n\n${task.detail}\n\n文件：${(task.files || []).join('、')}\n\n验收：${acceptanceFor(task).join('；')}\n\n状态：待实现与人工核对\n`
    P.markChanged(handoffPath, body)
    if (!saveFirst && s.drafts[handoffPath] !== undefined) {
      s.diskConflicts ||= {}
      s.diskConflicts[handoffPath] = true
    }
    const baseline = {
      id: `handoff-${sequence++}`,
      taskId: task.id,
      title: task.title,
      revision,
      time: now(),
      taskFiles: [...(task.files || [])],
      acceptance: [...acceptanceFor(task)],
      files: saved(),
      resources: copy(s.resources),
    }
    s.handoffBaselines.push(baseline)
    s.baseline = baseline
    pendingTask = null
    s.activeView = 'handoff'
    P.closeDialog()
    P.render()
    P.toast(
      t(
        '交接已保存，比较起点已保留。',
        'Handoff saved with a comparison baseline.'
      )
    )
  }

  function previewFiles(changes, initial = false) {
    return `<div class="file-list version-file-list">${changes
      .map(change => {
        const resource = change.after || change.before
        const large = Boolean(change.binary && resource?.large)
        const tracked = Boolean(s.gitResources[change.path])
        return `<label class="version-file"><input type="checkbox" name="wf-file" value="${esc(change.path)}" ${!large || tracked ? 'checked' : ''}><span><code>${esc(change.path)}</code><small>${large ? `${esc(resource.size)} · ${t('纳入后会增加历史体积', 'Including this grows version history')}` : initial ? t('纳入初始版本', 'Include in the initial version') : changeStatus(change)}${tracked ? ` · ${t('已跟踪', 'Tracked')}` : ''}</small></span>${large ? `<span class="badge">${tracked ? t('已跟踪资源', 'Tracked resource') : t('默认排除', 'Excluded by default')}</span>` : ''}</label>`
      })
      .join('')}</div>`
  }

  function openRecord() {
    if (!s.hasGit) return openGitSetup()
    const changes = currentChanges(true)
    recordPreview = { files: saved(), resources: copy(s.resources), changes }
    P.openDialog(
      t('记录一个创作版本', 'Record a creative version'),
      `<div class="stack"><p>${t('选择这次要记录的完整文件。未保存草稿保留在编辑器中。', 'Choose complete files for this version. Unsaved drafts stay in the editor.')}</p>${draftNotice()}${changes.length ? previewFiles(changes) : `<div class="empty-state">${t('没有新的保存版变化。', 'No new saved-file changes.')}</div>`}<label class="field"><span>${t('版本说明', 'Version message')}</span><input id="wf-commit-message" placeholder="${t('例如：完成触摸密度与画面的联动', 'e.g. Connect touch density with visuals')}" value="${t('完善 潮汐 的交互与画面', 'Refine 潮汐 interaction and visuals')}"></label><p class="muted">${t('只记录所选文件，不刷新画面，也不保存草稿。', 'Only selected files are recorded. This does not refresh the preview or save drafts.')}</p><details class="workflow-details"><summary>${t('署名与外部暂存', 'Authorship and external staging')}</summary><p>${esc(s.gitAuthor || s.author || '林声')} · ${esc(s.gitEmail || 'creator@local.invalid')}</p><p>${t('外部工具已暂存的选中文件需要先在外部处理。', 'Selected files staged by an external tool must be resolved there first.')}</p><label><input type="checkbox" id="wf-staged-conflict"> ${t('原型演示：模拟所选文件有外部暂存', 'Prototype: simulate an externally staged selected file')}</label></details></div>`,
      `${cancel()}${button('wf-confirm-record', t('记录所选文件', 'Record selected files'), 'primary', changes.length ? '' : 'disabled')}`
    )
  }

  function selectedPaths() {
    return [...document.querySelectorAll('input[name="wf-file"]:checked')].map(
      input => input.value
    )
  }

  function commitSelected(message, paths, initial = false) {
    const previous = { ...s.gitSnapshot }
    const previousResources = copy(s.gitResources)
    if (initial) {
      s.gitSnapshot = {}
      s.gitResources = {}
    }
    for (const path of paths) {
      if (Object.hasOwn(s.files, path)) s.gitSnapshot[path] = s.files[path]
      else Reflect.deleteProperty(s.gitSnapshot, path)
      if (Object.hasOwn(s.resources, path))
        s.gitResources[path] = copy(s.resources[path])
      else Reflect.deleteProperty(s.gitResources, path)
      s.changed.delete(path)
    }
    const id = `c7a${String(sequence++).padStart(4, '0')}`
    s.history.unshift({
      id,
      message,
      author: s.gitAuthor || s.author || '本机创作者',
      time: now(),
      files: paths,
      snapshot: { ...s.gitSnapshot },
      resources: copy(s.gitResources),
      previous: initial ? {} : previous,
      previousResources,
    })
    s.selectedCommit = id
    s.historyFile = null
  }

  function confirmRecord() {
    if (!recordPreview) return
    const paths = selectedPaths()
    const message = document.getElementById('wf-commit-message')?.value.trim()
    if (!paths.length)
      return P.toast(t('先选择至少一个文件。', 'Choose at least one file.'))
    if (!message)
      return P.toast(t('请填写版本说明。', 'Add a version message.'))
    const externallyStaged =
      s.externalStaged instanceof Set
        ? s.externalStaged
        : new Set(s.externalStaged || [])
    if (
      document.getElementById('wf-staged-conflict')?.checked ||
      paths.some(path => externallyStaged.has(path))
    )
      return P.toast(
        t(
          '所选文件已有外部暂存。请在外部工具处理后再记录；现有暂存保持不变。',
          'A selected file is already staged externally. Resolve it in your external tool; staging stays unchanged.'
        )
      )
    if (
      JSON.stringify(recordPreview.files) !== JSON.stringify(s.files) ||
      JSON.stringify(recordPreview.resources) !== JSON.stringify(s.resources)
    ) {
      P.toast(
        t(
          '文件在预览后发生变化，请重新核对。',
          'Files changed after preview. Please review again.'
        )
      )
      openRecord()
      return
    }
    commitSelected(message, paths)
    recordPreview = null
    s.activeView = 'history'
    P.closeDialog()
    P.render()
    P.toast(
      t(
        '版本已记录，运行画面保持原状。',
        'Version recorded. The running preview is unchanged.'
      )
    )
  }

  function makeNewProject(input) {
    const classic = input.template === 'classic'
    const name = input.name || t('未命名工程', 'Untitled project')
    const author = input.author || t('本机创作者', 'Local creator')
    const manifest = {
      schemaVersion: 2,
      name,
      version: '0.1.0',
      author,
      monitor: { entry: 'web/monitor/index.html' },
      audio: {
        supportedModes: classic ? ['none', 'internal', 'external'] : ['none'],
      },
      sharedLibraries: [{ id: 'p5', version: '2.3.4' }],
    }
    const files = {
      'manifest.json': '',
      'README.md': `# ${name}\n\n${t('创作者', 'Creator')}：${author}\n\n${classic ? t('从 Classic 模板开始创作。', 'A project starting from the Classic template.') : t('从 Blank 空白骨架开始创作。', 'A project starting from the Blank structure.')}\n`,
      'web/monitor/index.html':
        '<!doctype html>\n<html><head><meta charset="utf-8"></head><body><script src="sketch.js"></script></body></html>\n',
      'web/monitor/sketch.js': `// ${name}\nconst score = { density: ${classic ? '0.32' : '0.1'}, radius: 140 };\n\nfunction setup() {\n  createCanvas(windowWidth, windowHeight);\n}\n\nfunction draw() {\n  background(23, 33, 37);\n  noFill();\n  stroke(164, 201, 184);\n  circle(width / 2, height / 2, score.radius * 2);\n}\n`,
    }
    if (classic) {
      manifest.performer = { entry: 'web/performer/index.html' }
      files['web/performer/index.html'] =
        '<!doctype html>\n<html><body><main id="touch-surface">Touch to participate</main></body></html>\n'
      files['server/index.js'] =
        "// Prototype Classic server entry\nimport express from 'express';\nconst app = express();\napp.use(express.static('web'));\n"
      files['supercollider/source/score.scd'] =
        'SynthDef(\\score, { |out = 0, freq = 220, amp = 0.1|\n    Out.ar(out, SinOsc.ar(freq) * amp ! 2);\n}).add;\n'
    }
    files['manifest.json'] = JSON.stringify(manifest, null, 2)
    return {
      name,
      author,
      email: input.email || '',
      template: classic ? 'classic' : 'blank',
      files,
      resources: {},
    }
  }

  function adoptNewProject(project) {
    for (const performer of s.performers || []) performer?.close?.()
    Object.assign(s, {
      projectName: project.name,
      projectVersion: '0.1.0',
      projectTemplate: project.template,
      template: project.template,
      author: project.author,
      gitAuthor: project.author,
      files: { ...project.files },
      resources: {},
      drafts: {},
      changed: new Set(),
      messages: [],
      input: '',
      attachment: null,
      authorized: false,
      catalogRefs: { p5: '2.3.4' },
      modulesAdded: {},
      handoffTasks: [],
      baseline: null,
      handoffBaselines: [],
      gitSnapshot: {},
      gitResources: {},
      history: [],
      historyLoaded: {},
      selectedCommit: null,
      historyFile: null,
      externalStaged: new Set(),
      externalSimulation: false,
      diskConflicts: {},
      undo: {},
      redo: {},
      executed: null,
      showDiff: false,
      proposal: false,
      parameters: null,
      parameterEdits: [],
      runtimeParameters: { density: 0.32, easing: 0.08 },
      newProjectCreated: true,
      running: false,
      pendingRuntime: false,
      pendingRestart: false,
      checked: false,
      audio: 'none',
      appliedAudio: 'none',
      performers: [],
      touches: 0,
      logs: [t('新工程已建立 · 尚未运行', 'New project created · not running')],
      activeFile: 'web/monitor/sketch.js',
      editorMode: 'code',
      find: false,
      pendingNewProject: null,
    })
    pendingTask = null
    recordPreview = null
  }

  function openGitSetup(options = {}) {
    const project = options.newProject
      ? makeNewProject(s.pendingNewProject || {})
      : null
    gitSetupOptions = { ...options, project }
    const files = Object.entries(project?.files || s.files).map(
      ([path, after]) => ({
        path,
        after,
      })
    )
    const resources = Object.entries(project?.resources || s.resources).map(
      ([path, after]) => ({
        path,
        after,
        binary: true,
      })
    )
    P.openDialog(
      options.newProject
        ? t('建立工程初始版本', 'Create the initial project version')
        : t('启用本地版本记录', 'Enable local version history'),
      `<div class="stack">${project ? `<div class="callout"><strong>${esc(project.name)}</strong> · ${project.template === 'classic' ? 'Classic' : 'Blank'}<p>${t('确认后创建新工程并记录初始版本。', 'Confirm to create this project and record its initial version.')}</p></div>` : ''}<p>${t('在当前工程建立 Git 仓库，并自动记录初始版本。无需登录外部账号。', 'Create a Git repository in this project and record its initial version. No external account required.')}</p>${project && drafts().length ? `<div class="callout warning">${t(`切换到新工程会放弃当前 ${drafts().length} 个未保存草稿，并停止测试。取消可返回继续处理。`, `Switching will discard ${drafts().length} current drafts and stop testing. Cancel to return to them.`)}</div>` : ''}${previewFiles([...files, ...resources], true)}<div class="form-row"><label class="field"><span>${t('版本署名', 'Author name')}</span><input id="wf-author" value="${esc(project?.author || s.author || '本机创作者')}"></label><label class="field"><span>${t('邮箱 · 选填', 'Email · optional')}</span><input id="wf-email" type="email" value="${esc(project?.email || '')}" placeholder="creator@local.invalid"></label></div><p class="muted">${t('邮箱留空时使用 creator@local.invalid；只设置本工程，不改全局 Git 配置。', 'An empty email uses creator@local.invalid. Only this project is configured; global Git settings stay unchanged.')}</p><details class="workflow-details"><summary>${t('默认排除的内容', 'Excluded by default')}</summary><p>${t('依赖、缓存、敏感项，以及大型音频、视频和模型。大资源可在上方主动选择纳入。', 'Dependencies, caches, sensitive files, and large audio, video, or model resources. Large resources can be explicitly included above.')}</p></details></div>`,
      `${cancel()}${button('wf-confirm-git', t('启用并记录初始版本', 'Enable and record initial version'), 'primary')}`
    )
  }

  function confirmGitSetup() {
    const name = document.getElementById('wf-author')?.value.trim()
    const emailInput = document.getElementById('wf-email')
    const paths = selectedPaths()
    if (!name) return P.toast(t('请填写版本署名。', 'Enter an author name.'))
    if (emailInput?.value && !emailInput.checkValidity())
      return P.toast(
        t(
          '请检查邮箱格式，或留空使用本机地址。',
          'Check the email format, or leave it empty to use the local placeholder.'
        )
      )
    if (!paths.length)
      return P.toast(
        t('请选择初始版本的文件。', 'Choose files for the initial version.')
      )
    if (gitSetupOptions?.project) adoptNewProject(gitSetupOptions.project)
    s.gitAuthor = name
    s.gitEmail = emailInput?.value.trim() || 'creator@local.invalid'
    s.hasGit = true
    s.history = []
    commitSelected(
      t('建立工程初始版本', 'Create initial project version'),
      paths,
      true
    )
    const callback = gitSetupOptions?.onComplete
    gitSetupOptions = null
    P.closeDialog()
    s.activeView = 'history'
    P.render()
    callback?.()
    P.toast(
      t(
        '本地版本记录已启用，初始版本已保存。',
        'Local version history enabled; initial version saved.'
      )
    )
  }

  function loadHistorical(path, commitId) {
    const item = s.history.find(commit => commit.id === commitId)
    const text = item?.snapshot?.[path]
    if (text === undefined || s.files[path] === undefined)
      return P.toast(
        t(
          '这里只能载入当前仍存在的文本文件。',
          'Only existing text files can be loaded here.'
        )
      )
    if (s.drafts[path] !== undefined && s.drafts[path] !== s.files[path]) {
      P.openDialog(
        t('此文件有未保存草稿', 'This file has an unsaved draft'),
        `<div class="stack"><code>${esc(path)}</code><p>${t('先返回编辑器处理当前草稿，再载入历史内容。当前草稿不会被覆盖。', 'Resolve the current draft in the editor before loading historical text. Your draft will not be overwritten.')}</p></div>`,
        `${cancel()}${button('wf-current-file', t('返回当前草稿', 'Open current draft'), 'primary', `data-path="${esc(path)}"`)}`
      )
      return
    }
    s.drafts[path] = text
    s.historyLoaded ||= {}
    s.historyLoaded[path] = item.id
    P.closeDialog()
    P.openFile(path)
    P.toast(
      t(
        '历史文本已载入草稿。核对后手动保存。',
        'Historical text loaded into a draft. Review it, then save manually.'
      )
    )
  }

  function simulateExternal() {
    if (!s.baseline)
      return P.toast(
        t(
          '先确认交接，以保留比较起点。',
          'Confirm a handoff to save a baseline first.'
        )
      )
    const path = 'web/monitor/sketch.js'
    const original =
      s.baseline.files[path] || s.files[path] || 'const pulse = 0.35;\n'
    const replaced = original.replace(/(0\.35|0\.45|0\.55)/, '0.72')
    P.markChanged(
      path,
      `${replaced}\n// Collective touch density drives the visual pulse.\nconst density = Math.min(1, participants.activeTouches / 12);\n`
    )
    P.markChanged(
      'web/shared/touch-density.js',
      'export function touchDensity(activeTouches, limit = 12) {\n  return Math.min(1, activeTouches / limit);\n}\n'
    )
    P.markChanged(
      handoffPath,
      `${s.files[handoffPath] || ''}\n### 外部实现记录\n- 已接入多人触摸密度；等待真实参与者验收。\n- 静态检查通过；声音与画面关系需手动核对。\n`
    )
    s.resources['audio/room-tone.wav'] = {
      size: '52.6 MB',
      fingerprint: 'e09d…3b71',
      large: true,
    }
    if (s.hasGit) {
      commitSelected(
        t(
          '接入多人触摸密度反馈（外部提交）',
          'Connect collective touch density (external commit)'
        ),
        Object.keys(s.files)
      )
    }
    s.externalSimulation = true
    s.activeView = 'changes'
    s.workflowTab = 'handoff'
    P.render()
    P.toast(
      t(
        '已模拟外部实现；原运行画面保留，交接比较仍然可见。',
        'External work simulated; the running preview is preserved and handoff differences remain visible.'
      )
    )
  }

  P.gitSetup = openGitSetup
  P.workflowDiff = lineDiff
  P.workflowView = view =>
    view === 'handoff'
      ? handoffView()
      : view === 'changes'
        ? changesView()
        : view === 'history'
          ? historyView()
          : ''
  P.workflowAction = (action, el) => {
    if (!action.startsWith('wf-')) return false
    switch (action) {
      case 'wf-cancel':
        pendingTask = null
        recordPreview = null
        gitSetupOptions = null
        P.closeDialog()
        break
      case 'wf-preview-handoff':
        previewHandoff(el?.dataset.task)
        break
      case 'wf-confirm-handoff':
        confirmHandoff()
        break
      case 'wf-show-handoff':
        s.activeView = 'handoff'
        P.render()
        break
      case 'wf-show-changes':
      case 'wf-compare-tab':
        s.activeView = 'changes'
        s.workflowTab = 'handoff'
        P.render()
        break
      case 'wf-git-tab':
        s.activeView = 'changes'
        s.workflowTab = 'git'
        P.render()
        break
      case 'wf-select-baseline':
        s.baseline =
          s.handoffBaselines.find(base => base.id === el.dataset.id) ||
          s.baseline
        P.render()
        break
      case 'wf-current-file':
        P.closeDialog()
        P.openFile(el.dataset.path)
        break
      case 'wf-copy-handoff': {
        const value = s.files[handoffPath] || ''
        if (navigator.clipboard?.writeText) {
          navigator.clipboard
            .writeText(value)
            .then(() =>
              P.toast(
                t(
                  '任务说明已复制，比较起点保持不变。',
                  'Task brief copied; the baseline stays unchanged.'
                )
              )
            )
            .catch(() =>
              P.openDialog(
                t('复制任务说明', 'Copy task brief'),
                `<textarea rows="12" class="copy-brief" readonly>${esc(value)}</textarea>`,
                button('wf-cancel', t('关闭', 'Close'))
              )
            )
        } else
          P.openDialog(
            t('复制任务说明', 'Copy task brief'),
            `<textarea rows="12" class="copy-brief" readonly>${esc(value)}</textarea>`,
            button('wf-cancel', t('关闭', 'Close'))
          )
        break
      }
      case 'wf-simulate-external':
        simulateExternal()
        break
      case 'wf-record':
        openRecord()
        break
      case 'wf-confirm-record':
        confirmRecord()
        break
      case 'wf-enable-git':
        openGitSetup()
        break
      case 'wf-confirm-git':
        confirmGitSetup()
        break
      case 'wf-select-history':
        s.selectedCommit = el.dataset.id
        s.historyFile = null
        P.render()
        break
      case 'wf-select-history-file':
        s.historyFile = el.dataset.path
        P.render()
        break
      case 'wf-load-history':
        loadHistorical(el.dataset.path, el.dataset.commit)
        break
      case 'wf-verification':
        P.openDialog(
          t('交接验收', 'Handoff acceptance'),
          `<div class="stack"><p>${t('先检查保存版，再由你核对真实创作效果。', 'Check saved files, then verify the actual creative result yourself.')}</p>${acceptanceFor(
            s.baseline || {}
          )
            .map(
              item =>
                `<label class="check-row"><input type="checkbox"> ${esc(item)}</label>`
            )
            .join(
              ''
            )}<div class="callout">${s.running ? t('当前工程正在运行：可继续静态检查；自动运行检查需要先手动停止工程。', 'The project is running: static checks remain available. Stop the project manually before automatic runtime checks.') : t('工程已停止，可运行适用检查。默认不启用音频。', 'The project is stopped. Applicable checks are available; audio defaults to None.')}</div></div>`,
          `${button('wf-cancel', t('返回比较', 'Back to comparison'))}${button('checks', t('运行检查', 'Run checks'), 'primary')}`
        )
        break
      default:
        return false
    }
    return true
  }
}
