// Keep prototypes usable via file:// while maintaining locale JSON as the source.
import { readFileSync, writeFileSync } from 'node:fs'
import { fileURLToPath, URL } from 'node:url'

const prototypes = [
  ['pnds-ui-prototype.html', 'prototype.en.json'],
  ['pnds-performer-prototype.html', 'prototype-performer.en.json'],
]
for (const [filename, locale] of prototypes) {
  const prototypePath = fileURLToPath(
    new URL(`../docs/prototypes/${filename}`, import.meta.url)
  )
  const translations = JSON.parse(
    readFileSync(new URL(`../locales/${locale}`, import.meta.url), 'utf8')
  )
  const html = readFileSync(prototypePath, 'utf8')
  const marker =
    /(<script type="application\/json" id="prototype-translations">)[\s\S]*?(<\/script>)/
  if (!marker.test(html))
    throw new Error(`Translation marker missing: ${filename}`)
  const json = JSON.stringify(translations, null, 2).replaceAll('<', '\\u003c')
  writeFileSync(
    prototypePath,
    html.replace(marker, (_, start, end) => `${start}\n${json}\n    ${end}`)
  )
}
