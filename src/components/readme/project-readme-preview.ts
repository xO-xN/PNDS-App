import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import {
  prepareReadmeCover,
  readProjectCover,
  readProjectReadme,
  type ProjectReadmeRead,
} from '@/lib/project-readme'
import { parseReadmeCoverPage } from '@/lib/readme-cover-page'

export interface ProjectReadmePreview extends ProjectReadmeRead {
  coverPage: ReturnType<typeof parseReadmeCoverPage>
  cover: string | null
}

export function sameProjectReadme(
  previous: ProjectReadmePreview | null,
  next: ProjectReadmePreview | null
): boolean {
  if (previous === next) return true
  if (!previous || !next) return false
  if (previous.error !== next.error || previous.cover !== next.cover)
    return false
  const before = previous.coverPage
  const after = next.coverPage
  if (!before || !after)
    return before === after && previous.readme === next.readme
  // Sections below the cover introduction and hidden URLs do not affect
  // the audience page. Compare the fields that it actually renders.
  return (
    before.title === after.title &&
    before.composer === after.composer &&
    before.duration === after.duration &&
    before.performers === after.performers &&
    before.contact === after.contact &&
    before.sectionLabel === after.sectionLabel &&
    before.sectionMarkdown === after.sectionMarkdown &&
    before.palette.every((color, index) => color === after.palette[index])
  )
}

/** Resolve the saved README and its optional cover as one presentation. */
export function useProjectReadme(
  path: string | null
): ProjectReadmePreview | null {
  const { i18n } = useTranslation()
  const locale = i18n.resolvedLanguage ?? i18n.language ?? 'en'
  const [loaded, setLoaded] = useState<{
    path: string
    locale: string
    preview: ProjectReadmePreview
  } | null>(null)

  useEffect(() => {
    if (path === null) return
    let cancelled = false
    void (async () => {
      const read = await readProjectReadme(path, locale)
      if (cancelled) return
      const coverPage =
        read.readme === null ? null : parseReadmeCoverPage(read.readme)
      const cover =
        coverPage === null ? null : (await readProjectCover(path)).cover
      if (cancelled) return
      const decoded = await prepareReadmeCover(cover)
      if (!cancelled)
        setLoaded({
          path,
          locale,
          preview: { ...read, coverPage, cover: decoded },
        })
    })()
    return () => {
      cancelled = true
    }
  }, [path, locale])

  return loaded?.path === path && loaded.locale === locale
    ? loaded.preview
    : null
}
