/* global document, socket */
// Author-saved camera score renderer; not a new Blank default or fixed musical policy.
const cameraSvg = document.createElementNS('http://www.w3.org/2000/svg', 'svg')
cameraSvg.setAttribute('viewBox', '0 0 100 100')
cameraSvg.setAttribute('data-camera-visual', '')
cameraSvg.setAttribute('aria-label', 'Camera hand score')
document.querySelector('main').append(cameraSvg)
socket.on('pnds:performance', state => {
  cameraSvg.replaceChildren()
  for (const source of state.cameraSources ?? []) {
    for (const marker of source.markers) {
      const circle = document.createElementNS(cameraSvg.namespaceURI, 'circle')
      circle.setAttribute('data-source', source.sourceId)
      circle.setAttribute('cx', String(marker.x * 100))
      circle.setAttribute('cy', String(marker.y * 100))
      circle.setAttribute('r', '5')
      circle.setAttribute(
        'fill',
        { pinch: '#ef4444', open: '#22c55e', neutral: '#94a3b8' }[marker.color]
      )
      cameraSvg.append(circle)
    }
  }
})
