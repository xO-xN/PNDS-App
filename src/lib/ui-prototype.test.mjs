import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import { runInContext } from 'node:vm'
import { JSDOM } from 'jsdom'
import { afterEach, describe, expect, it } from 'vitest'

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const prototypePath = path.join(repo, 'docs/prototypes/pnds-ui-prototype.html')
const html = readFileSync(prototypePath, 'utf8')
const translations = JSON.parse(
  readFileSync(path.join(repo, 'locales/prototype.en.json'), 'utf8')
)
const windows = []

function openPrototype(
  source = html,
  url = 'http://localhost/docs/prototypes/pnds-ui-prototype.html'
) {
  const dom = new JSDOM(source, {
    url,
    runScripts: 'outside-only',
    pretendToBeVisual: true,
  })
  const window = dom.window
  windows.push(window)
  window.structuredClone = globalThis.structuredClone
  window.previewMessages = []
  window.BroadcastChannel = class {
    postMessage(message) {
      window.previewMessages.push(message)
    }
    close() {
      return undefined
    }
  }
  window.matchMedia = () => ({ matches: true })
  window.HTMLDialogElement.prototype.showModal = function () {
    this.open = true
  }
  window.HTMLDialogElement.prototype.close = function () {
    this.open = false
    this.dispatchEvent(new window.Event('close'))
  }
  window.HTMLElement.prototype.showPopover = function () {
    return undefined
  }
  window.HTMLElement.prototype.hidePopover = function () {
    return undefined
  }
  runInContext(
    window.document.querySelector('script:not([type])').textContent,
    dom.getInternalVMContext()
  )
  const get = id => window.document.getElementById(id)
  const settle = () => new Promise(resolve => window.setTimeout(resolve, 0))
  const chooseLanguage = language => {
    window.eval('openSettings()')
    get('app-language').value = language
    get('app-language').dispatchEvent(
      new window.Event('change', { bubbles: true })
    )
  }
  return { window, get, settle, chooseLanguage }
}

afterEach(() => {
  windows.splice(0).forEach(window => {
    window.eval(
      'if (typeof uiObserver !== "undefined") uiObserver.disconnect()'
    )
    window.close()
  })
})

describe('standalone UI prototype', () => {
  it('switches existing and newly rendered UI in both directions without changing drafts or runtime', async () => {
    const { window, get, settle, chooseLanguage } = openPrototype()
    window.eval("scenario('workspace'); setFile('public/monitor.js')")
    get('code-input').value += '\n// 作者自己的草稿'
    get('code-input').dispatchEvent(
      new window.Event('input', { bubbles: true })
    )
    const draft = get('code-input').value
    const before = window.eval(
      'JSON.stringify({ session: state.session, dirty: [...state.dirty], project: state.project, readme: state.readme })'
    )
    chooseLanguage('en')
    await settle()
    expect(window.document.documentElement.lang).toBe('en')
    expect(get('dialog-title').textContent).toBe('Settings')
    expect(get('app-language').value).toBe('en')
    expect(window.previewMessages.at(-1).previewLanguage).toBe('en')
    expect(get('save-button').textContent.trim()).toBe('Save')
    expect(get('file-filter').placeholder).toBe('Search files')
    expect(get('settings-button').getAttribute('aria-label')).toBe('Settings')
    expect(get('code-input').value).toBe(draft)
    expect(
      window.eval(
        'JSON.stringify({ session: state.session, dirty: [...state.dirty], project: state.project, readme: state.readme })'
      )
    ).toBe(before)
    expect(get('work-change-status').textContent).toBe('1 unsaved file')
    window.eval("state.dirty.add('server.js'); renderControls()")
    await settle()
    expect(get('work-change-status').textContent).toBe('2 unsaved files')
    window.eval('moduleDialog()')
    await settle()
    expect(get('dialog-title').textContent).toBe('Add PNDS module')
    expect(get('dialog').textContent).toContain(
      'Hub connection & remote node status'
    )
    chooseLanguage('zh-CN')
    await settle()
    expect(get('save-button').textContent.trim()).toBe('保存')
    expect(get('settings-button').getAttribute('aria-label')).toBe('设置')
    expect(get('code-input').value).toBe(draft)
    window.eval('moduleDialog()')
    await settle()
    expect(get('dialog-title').textContent).toBe('添加 PNDS 模块')
  })

  it('translates settings, module details and newly rendered dialogs', async () => {
    const { window, get, settle, chooseLanguage } = openPrototype()
    window.eval("scenario('workspace')")
    chooseLanguage('en')
    const ignored =
      'script,style,textarea,[contenteditable],[data-ui-content],.code-paint,.filename,.tab-filename,.project-card strong,#creation-project-name,#creation-project-path,#score-work-name,#performer-name,#state-json'
    function untranslated(root) {
      const walker = window.document.createTreeWalker(
        root,
        window.NodeFilter.SHOW_TEXT
      )
      const missing = []
      let node
      while ((node = walker.nextNode())) {
        if (
          node.parentElement.closest(ignored) ||
          (node.parentElement.tagName === 'OPTION' &&
            node.parentElement.value === 'zh-CN')
        )
          continue
        if (node.data.trim() === '简体中文') continue
        if (/[\u4e00-\u9fff]/.test(node.data)) missing.push(node.data.trim())
      }
      return missing
    }
    window.eval('closeDialog()')
    await settle()
    expect(untranslated(window.document.body)).toEqual([])
    for (const tab of ['general', 'audio', 'network', 'ports', 'about']) {
      window.eval(`openSettings('${tab}')`)
      await settle()
      expect(untranslated(get('dialog'))).toEqual([])
    }
    for (const id of [
      'qr',
      'client',
      'theme-follow',
      'language-follow',
      'view-sync',
      'hub',
    ]) {
      window.eval(`moduleDetails('${id}')`)
      await settle()
      expect(untranslated(get('dialog'))).toEqual([])
    }
    for (const action of [
      'moduleDialog()',
      'newProjectDialog()',
      'folderPicker()',
      'guide()',
      'packProject()',
    ]) {
      window.eval(action)
      await settle()
      expect(untranslated(get('dialog'))).toEqual([])
    }
  })

  it('adds all six module file groups, provenance and wiring handoffs without claiming runtime verification', async () => {
    const { window, get, settle } = openPrototype()
    window.eval("scenario('workspace'); moduleDialog()")
    expect(get('dialog').querySelectorAll('[data-module]')).toHaveLength(6)
    for (const id of [
      'qr',
      'client',
      'theme-follow',
      'language-follow',
      'view-sync',
      'hub',
    ]) {
      window.eval(`moduleDetails('${id}')`)
      get('dialog').querySelector('[data-action="1"]').click()
    }
    await settle()
    const records = JSON.parse(
      window.eval(
        "state.files.find(file => file.path === 'docs/pnds-modules.json').content"
      )
    )
    expect(records).toHaveLength(6)
    expect(
      records.every(
        record =>
          record.wiring === 'pending' &&
          record.runtimeVerification === 'not-run'
      )
    ).toBe(true)
    expect(
      records.every(record => record.moduleVersion !== record.sourceRelease)
    ).toBe(true)
    expect(window.eval('state.tasks.length')).toBe(7)
    window.eval("setFile('docs/creator-handoff.md')")
    await settle()
    expect(get('inspector').textContent).toContain(
      'Hub 不可达时本地 Performer 仍能控制'
    )
    expect(get('inspector').textContent).toContain('尚未接线或运行验证')
  })

  it('rejects a conflicting multi-file module atomically and protects edited provenance', () => {
    const { window, get } = openPrototype()
    window.eval(
      "scenario('workspace'); state.files.push(file('modules/hub/hub.js', 'code', 'modules', false, 'custom implementation'))"
    )
    const before = window.eval(
      'JSON.stringify({files: state.files, tasks: state.tasks})'
    )
    window.eval("addModule('hub')")
    expect(
      window.eval('JSON.stringify({files: state.files, tasks: state.tasks})')
    ).toBe(before)
    expect(get('toast').textContent).toContain('拒绝覆盖')
    window.eval(
      "addModule('qr'); state.files.find(file => file.path === 'docs/pnds-modules.json').buffer += 'custom edit'"
    )
    window.eval("addModule('theme-follow')")
    expect(window.eval('state.moduleRecords.length')).toBe(1)
    expect(get('toast').textContent).toContain('docs/pnds-modules.json')
  })

  it('preserves user task text and README contents, option values and language across rerenders', async () => {
    const { window, get, settle, chooseLanguage } = openPrototype()
    window.eval(
      "scenario('workspace'); state.tasks.push({name:'打开工程', description:'作者选择的设置', authored:true, done:false})"
    )
    chooseLanguage('en')
    window.eval("closeDialog(); setFile('README.zh-CN.md')")
    await settle()
    expect(get('readme-title').textContent).toBe('潮汐习作')
    expect(get('readme-language').value).toBe('zh-CN')
    window.eval(
      "setFile('docs/creator-handoff.md'); openSettings('network'); render()"
    )
    await settle()
    expect(get('inspector').textContent).toContain('作者选择的设置')
    expect(get('settings-main').textContent).toContain('Network & nodes')
    window.eval('openSettings()')
    await settle()
    expect(get('app-language').value).toBe('en')
    expect(
      get('app-language')
        .parentElement.querySelector('.select-trigger')
        .getAttribute('aria-label')
    ).toBe('App language')
    expect(JSON.parse(get('prototype-translations').textContent)).toEqual(
      translations
    )
  })
  it('uses English assistant settings, suggestion prompts and demo replies in v1.7', async () => {
    const { window, get, settle, chooseLanguage } = openPrototype()
    window.eval("scenario('workspace')")
    window.document.querySelector('[data-version="1.7"]').click()
    chooseLanguage('en')
    window.eval("openSettings('ai')")
    await settle()
    expect(get('settings-main').textContent).toContain('Model service')
    get('api-save').click()
    window.eval('closeDialog()')
    get('assistant-tab').click()
    await settle()
    get('assistant-body').querySelectorAll('[data-prompt]')[2].click()
    await settle()
    expect(get('dialog-title').textContent).toBe(
      'Allow sending project content to the model service?'
    )
    get('dialog').querySelector('[data-action="1"]').click()
    await new Promise(resolve => window.setTimeout(resolve, 1100))
    expect(get('assistant-body').querySelector('.user').textContent).toBe(
      'How do the three PNDS audio modes differ?'
    )
    expect(
      get('assistant-body').querySelector('.assistant-message').textContent
    ).toContain('PNDS has three audio modes:')
    expect(
      get('assistant-body').querySelector('.assistant-message').textContent
    ).not.toMatch(/[\u4e00-\u9fff]/)
  })

  it('follows the interface language in independent Performer test windows and preserves the work name', () => {
    const performerHTML = readFileSync(
      path.join(repo, 'docs/prototypes/pnds-performer-prototype.html'),
      'utf8'
    )
    const { window, get } = openPrototype(
      performerHTML,
      'http://localhost/docs/prototypes/pnds-performer-prototype.html?language=en'
    )
    expect(window.document.documentElement.lang).toBe('en')
    expect(get('phone').textContent).toBe('Phone')
    expect(get('page-status').textContent).toBe('Waiting for main window')
    window.eval(
      `channel.onmessage({data: {type:'performer:state', project:{name:'作者的作品', blank:false}, session:'ready', previewLanguage:'zh-CN'}})`
    )
    expect(get('phone').textContent).toBe('手机')
    expect(get('work-name').textContent).toBe('作者的作品')
    window.eval(
      `channel.onmessage({data: {type:'performer:state', session:'ready', previewLanguage:'en'}})`
    )
    expect(get('page-status').textContent).toBe(
      'Connected · Ready for interaction testing'
    )
    expect(get('work-name').textContent).toBe('作者的作品')
    expect(get('trigger').getAttribute('aria-label')).toBe(
      'Trigger performance event'
    )
    expect(JSON.parse(get('prototype-translations').textContent)).toEqual(
      JSON.parse(
        readFileSync(
          path.join(repo, 'locales/prototype-performer.en.json'),
          'utf8'
        )
      )
    )
  })
})
