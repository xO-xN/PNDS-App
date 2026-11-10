/* global document, socket */
// This composition belongs to the confirmed chat task, never to Blank defaults.
const microphoneSvg = document.createElementNS(
  'http://www.w3.org/2000/svg',
  'svg'
)
microphoneSvg.setAttribute('viewBox', '0 0 100 100')
microphoneSvg.setAttribute('data-microphone-visual', '')
microphoneSvg.setAttribute('aria-label', 'Microphone score')
document.querySelector('main').append(microphoneSvg)
const microphonePath = (values, y) =>
  values
    .map(
      (value, index) =>
        `${index ? 'L' : 'M'}${(index / (values.length - 1)) * 100} ${y(value)}`
    )
    .join('')
socket.on('pnds:performance', state => {
  microphoneSvg.replaceChildren()
  for (const reading of state.microphone ?? []) {
    const circle = document.createElementNS(
      microphoneSvg.namespaceURI,
      'circle'
    )
    circle.setAttribute('cx', '50')
    circle.setAttribute('cy', '50')
    circle.setAttribute('r', String(reading.radius))
    circle.setAttribute('opacity', String(reading.brightness))
    circle.setAttribute('fill', 'currentColor')
    const wave = document.createElementNS(microphoneSvg.namespaceURI, 'path')
    wave.setAttribute('data-waveform', '')
    wave.setAttribute(
      'd',
      microphonePath(reading.trace, value => 50 - value * 40)
    )
    wave.setAttribute('fill', 'none')
    wave.setAttribute('stroke', '#2563eb')
    const spectrum = document.createElementNS(
      microphoneSvg.namespaceURI,
      'path'
    )
    spectrum.setAttribute('data-fft', '')
    spectrum.setAttribute(
      'd',
      microphonePath(reading.spectrum, value => -value)
    )
    spectrum.setAttribute('fill', 'none')
    spectrum.setAttribute('stroke', '#dc2626')
    microphoneSvg.append(circle, wave, spectrum)
  }
})
