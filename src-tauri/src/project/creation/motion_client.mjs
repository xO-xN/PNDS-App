/* global document, PNDSDeviceMotion, addEventListener */
// Authored page wiring, installed by the same creator-confirmed task.
const enableMotion = document.createElement('button')
enableMotion.id = 'enable-motion'
enableMotion.textContent = 'Enable device motion'
const stopMotion = document.createElement('button')
stopMotion.textContent = 'Stop device motion'
const motionStatus = document.createElement('p')
motionStatus.setAttribute('role', 'status')
document.querySelector('main').append(enableMotion, stopMotion, motionStatus)
const motion = PNDSDeviceMotion.createDeviceMotion({
  onState: state => {
    motionStatus.textContent =
      state.status + (state.error ? ': ' + state.error : '')
  },
  onSample: value => globalThis.PNDS_PLAYER?.sendAction(value),
})
enableMotion.addEventListener('click', () => {
  void motion.enable()
})
stopMotion.addEventListener('click', () => motion.stop())
addEventListener('pagehide', () => motion.dispose())
