/** Only explicitly bounded App task blocks are offered for automatic updates.
 * Older free-form content remains available in the existing-content editor. */
export function handoffEntries(text: string) {
  const entries: { id: string; title: string; status: string; text: string }[] =
    []
  const markers = [...text.matchAll(/^<!-- pnds-task:([a-f\d-]{36}) -->\r?$/gm)]
  for (const marker of markers) {
    const id = marker[1]
    if (!id || marker.index === undefined) continue
    const start = marker.index
    const rest = text.slice(start + marker[0].length)
    const end = new RegExp(
      `^<!-- (?:pnds-task-end:${id}|pnds-task-revision:${id}:[a-f\\d]{64}) -->\\r?$`,
      'm'
    ).exec(rest)
    if (!end || /^<!-- pnds-task:/m.test(rest.slice(0, end.index))) continue
    const block = text.slice(
      start,
      start + marker[0].length + end.index + end[0].length
    )
    const title = /^## (.+)$/m.exec(block)?.[1]?.trim()
    if (!title) continue
    const entry = {
      id,
      title,
      status:
        /^Status(?: \/ 状态)?:[\t ]*(.+)$/m.exec(block)?.[1]?.trim() ??
        'pending',
      text: block,
    }
    const previous = entries.findIndex(item => item.id === id)
    if (previous >= 0) entries.splice(previous, 1)
    entries.push(entry)
  }
  return entries
}
