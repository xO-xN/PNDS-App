// Real camera pixels stay in this page's Worker; only a scalar is published.
self.onmessage = ({ data }) => {
  let total = 0
  for (let index = 0; index < data.length; index += 4) {
    total +=
      0.2126 * data[index] + 0.7152 * data[index + 1] + 0.0722 * data[index + 2]
  }
  self.postMessage(total / ((255 * data.length) / 4))
}
