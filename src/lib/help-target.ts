import type { HelpTarget } from './events'

/** URL and live navigation carry the same source locale and section. */
export function helpTargetUrl(target: HelpTarget): string {
  if (target.kind === 'search') return 'help.html?search=1'
  const params = new URLSearchParams({ doc: target.docId })
  if (target.anchor) params.set('anchor', target.anchor)
  if (target.locale) params.set('locale', target.locale)
  return `help.html?${params}`
}

export function parseHelpTarget(search: string): HelpTarget | undefined {
  const params = new URLSearchParams(search)
  const docId = params.get('doc')
  if (docId !== null) {
    const anchor = params.get('anchor')
    const locale = params.get('locale')
    return {
      kind: 'doc',
      docId,
      ...(anchor ? { anchor } : {}),
      ...(locale === 'en' || locale === 'zh-CN' ? { locale } : {}),
    }
  }
  return params.get('search') === '1' ? { kind: 'search' } : undefined
}
