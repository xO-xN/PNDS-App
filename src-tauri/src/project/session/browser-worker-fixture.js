/* global fetch, postMessage */
fetch('./asset.json?worker=7')
  .then(response => response.json())
  .then(value => postMessage(value))
globalThis.onmessage = async () => {
  const response = await fetch('./asset.json?forbidden-old-worker=1')
  postMessage({ status: response.status })
}
