// Project-owned offline model bytes. No fetch, CDN, npm install or download fallback.
const fs = require('node:fs')
const path = require('node:path')
const { createHash } = require('node:crypto')
function createHandPoseAssets({ ml5Path }) {
  const hash = bytes => createHash('sha256').update(bytes).digest('hex')
  const directory = fs.realpathSync(__dirname)
  const local = name => {
    const file = path.join(directory, name)
    if (fs.realpathSync(file) !== file) throw new Error(`HandPose asset alias is not allowed: ${name}`)
    const fd = fs.openSync(file, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW | fs.constants.O_NONBLOCK)
    try {
      const opened = fs.fstatSync(fd), current = fs.lstatSync(file)
      if (!opened.isFile() || !current.isFile() || opened.ino !== current.ino || opened.dev !== current.dev) throw new Error(`HandPose asset changed: ${name}`)
      return fs.readFileSync(fd)
    } finally { fs.closeSync(fd) }
  }
  const pinBytes = local('PINNED.json')
  if (hash(pinBytes) !== '298e93dad3ec3af72ca035e65606d9b2fe87b25d73ea78c907ab2ad87773c79b') throw new Error('HandPose fixed pin integrity failed')
  const pin = JSON.parse(pinBytes)
  const routes = new Map()
  const checked = (bytes, expected, name) => {
    if (hash(bytes) !== expected) throw new Error(`HandPose integrity failed: ${name}`)
    return bytes
  }
  if (pin.ml5Version !== '1.4.0' || pin.runtime !== 'tfjs' || pin.modelType !== 'lite') throw new Error('Unsupported HandPose pin')
  routes.set('ml5.js', { type: 'text/javascript; charset=utf-8', bytes: checked(fs.readFileSync(ml5Path), pin.ml5Sha256, 'ml5') })
  for (const kind of ['detector', 'landmark']) {
    const name = `handpose/${kind}/model.json`
    const model = checked(local(`${kind}.model.json`), pin.files[name].sha256, name)
    const parsed = JSON.parse(model)
    if (JSON.stringify(parsed.weightsManifest.flatMap(group => group.paths)) !== '["group1-shard1of1.bin"]') throw new Error(`Unexpected model shard: ${kind}`)
    const count = pin.encodedParts[kind]
    if (!Number.isInteger(count) || count < 1 || count > 8) throw new Error('Invalid model parts')
    const encoded = Array.from({ length: count }, (_, index) => local(`${kind}.weights.${index}.txt`).toString('utf8').trim()).join('')
    if (!/^[A-Za-z0-9+/]+={0,2}$/.test(encoded)) throw new Error('Invalid model encoding')
    const shardName = `handpose/${kind}/group1-shard1of1.bin`
    const bytes = checked(Buffer.from(encoded, 'base64'), pin.files[shardName].sha256, shardName)
    routes.set(name, { type: 'application/json; charset=utf-8', bytes: model })
    routes.set(shardName, { type: 'application/octet-stream', bytes })
  }
  for (const name of ['camera-handpose.js', 'handpose-worker.js', 'handpose-worker-client.js']) routes.set(name, { type: 'text/javascript; charset=utf-8', bytes: local(name) })
  return function serve(request, response, prefix = '/modules/pnds-camera-handpose/') {
    const url = new URL(request.url, 'http://local')
    if (!url.pathname.startsWith(prefix)) return false
    const asset = routes.get(url.pathname.slice(prefix.length))
    if (!asset || !['GET', 'HEAD'].includes(request.method)) { response.writeHead(404); response.end(); return true }
    response.writeHead(200, { 'Content-Type': asset.type, 'Content-Length': asset.bytes.length, 'Cache-Control': 'no-store' })
    response.end(request.method === 'HEAD' ? undefined : asset.bytes)
    return true
  }
}
module.exports = { createHandPoseAssets }
