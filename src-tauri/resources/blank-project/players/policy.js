// No seat, voice, score-number or channel policy. Only identity survives a run.
import {
  closeSync,
  constants,
  existsSync,
  fsyncSync,
  fstatSync,
  lstatSync,
  mkdirSync,
  openSync,
  readFileSync,
  renameSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs'
import { randomBytes, randomUUID } from 'node:crypto'
import { fileURLToPath } from 'node:url'

const claimPattern = /^[a-f0-9]{48}$/
const identityPattern =
  /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/
const directory = fileURLToPath(new URL('../.pnds-creation/', import.meta.url))
const file = fileURLToPath(
  new URL('../.pnds-creation/players.json', import.meta.url)
)
const own = (value, key) => Object.hasOwn(value, key)
function checkDirectory() {
  const metadata = lstatSync(directory)
  if (
    !metadata.isDirectory() ||
    metadata.isSymbolicLink() ||
    metadata.mode & 0o077
  )
    throw new Error('Player identity directory must be private and not a link')
}
function load(projectId) {
  try {
    checkDirectory()
  } catch (error) {
    if (error.code === 'ENOENT') return new Map()
    throw new Error(`Player identity storage unavailable: ${error.message}`)
  }
  let descriptor
  try {
    descriptor = openSync(
      file,
      constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK
    )
  } catch (error) {
    if (error.code === 'ENOENT') return new Map()
    throw new Error(`Player identity storage unavailable: ${error.message}`)
  }
  try {
    const metadata = fstatSync(descriptor)
    if (
      !metadata.isFile() ||
      metadata.isSymbolicLink() ||
      metadata.size > 4 * 1024 * 1024 ||
      metadata.mode & 0o077
    )
      throw new Error('Invalid private player identity file')
    const saved = JSON.parse(readFileSync(descriptor, 'utf8'))
    if (
      saved?.schemaVersion !== 1 ||
      saved.projectId !== projectId ||
      !saved.claims ||
      Array.isArray(saved.claims) ||
      typeof saved.claims !== 'object'
    )
      throw new Error('Invalid player identity registry')
    const claims = Object.entries(saved.claims)
    if (
      claims.some(
        ([token, id]) =>
          !claimPattern.test(token) ||
          typeof id !== 'string' ||
          !identityPattern.test(id)
      ) ||
      new Set(claims.map(([, id]) => id)).size !== claims.length
    )
      throw new Error('Invalid player identity mapping')
    return new Map(claims)
  } catch (error) {
    throw new Error(
      `Player identity registry could not be read: ${error.message}`
    )
  } finally {
    closeSync(descriptor)
  }
}
function persist(projectId, claims) {
  mkdirSync(directory, { recursive: true, mode: 0o700 })
  checkDirectory()
  if (existsSync(file)) {
    const metadata = lstatSync(file)
    if (
      !metadata.isFile() ||
      metadata.isSymbolicLink() ||
      metadata.mode & 0o077
    )
      throw new Error('Invalid private player identity target')
  }
  const temporary = `${file}.${randomUUID()}.tmp`
  let descriptor
  try {
    descriptor = openSync(
      temporary,
      constants.O_WRONLY |
        constants.O_CREAT |
        constants.O_EXCL |
        constants.O_NOFOLLOW,
      0o600
    )
    const bytes = JSON.stringify({
      schemaVersion: 1,
      projectId,
      claims: Object.fromEntries(claims),
    })
    if (Buffer.byteLength(bytes) > 4 * 1024 * 1024)
      throw new Error('Player identity registry is full')
    writeFileSync(descriptor, bytes)
    fsyncSync(descriptor)
    closeSync(descriptor)
    descriptor = undefined
    renameSync(temporary, file)
    const parent = openSync(
      directory,
      constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW
    )
    try {
      fsyncSync(parent)
    } finally {
      closeSync(parent)
    }
  } finally {
    if (descriptor !== undefined) closeSync(descriptor)
    try {
      unlinkSync(temporary)
    } catch (error) {
      if (error.code !== 'ENOENT')
        console.error(
          'Player identity temporary cleanup failed:',
          error.message
        )
    }
  }
}

export const playerEvents = Object.freeze({
  join: 'pnds:join',
  joined: 'pnds:joined',
  rejected: 'pnds:rejected',
  control: 'pnds:control',
  action: 'pnds:action',
  state: 'pnds:state',
})

export function createPlayerPolicy({
  projectId,
  onTakeover,
  onJoin,
  onControl = () => {
    /* The piece supplies control semantics. */
  },
  onAction = () => {
    /* The piece supplies action semantics. */
  },
  onRelease = () => {
    /* The piece owns any per-run resources. */
  },
  snapshot = () => ({}),
}) {
  let claims = load(projectId)
  const owners = new Map()
  let failure = null
  const owns = context =>
    typeof context.identity?.id === 'string' &&
    typeof context.socketId === 'string' &&
    owners.get(context.identity.id) === context.socketId
  const policy = {
    owns,
    join({ socketId, token, payload }) {
      if (failure) return { status: 'rejected', reason: failure }
      if (
        !payload ||
        typeof payload !== 'object' ||
        Array.isArray(payload) ||
        (own(payload, 'token') &&
          payload.token !== null &&
          (typeof payload.token !== 'string' ||
            !claimPattern.test(payload.token)))
      )
        return { status: 'rejected', reason: 'Invalid player claim' }
      const recovered = typeof token === 'string' && claims.has(token)
      const claim = recovered ? token : randomBytes(24).toString('hex')
      const id = recovered ? claims.get(claim) : randomUUID()
      if (!recovered) {
        const next = new Map(claims).set(claim, id)
        try {
          persist(projectId, next)
        } catch (error) {
          // A rename may already have succeeded. Refuse further joins until a
          // restart reloads the durable truth instead of overwriting it.
          failure = `Player identity could not be saved: ${error.message}`
          return { status: 'rejected', reason: failure }
        }
        claims = next
      }
      const previous = owners.get(id)
      if (previous && previous !== socketId) {
        owners.delete(id)
        onRelease({ identity: { id }, socketId: previous, token: claim })
        onTakeover?.(previous)
      }
      const assignment = {
        token: claim,
        identity: { id },
        recovered,
        restore: null,
        socketId,
      }
      owners.set(id, socketId)
      try {
        onJoin?.(assignment)
      } catch (error) {
        owners.delete(id)
        onRelease(assignment)
        throw error
      }
      return assignment
    },
    joined(assignment) {
      if (!owns(assignment))
        throw new Error('Player connection has been replaced')
      const { token, identity, recovered, restore } = assignment
      return { token, identity: { ...identity }, recovered, restore }
    },
    control(context, payload) {
      if (owns(context)) return onControl(context, payload)
    },
    action(context, payload) {
      if (owns(context)) return onAction(context, payload)
    },
    release(context) {
      if (!owns(context)) return
      owners.delete(context.identity.id)
      return onRelease(context)
    },
    snapshot() {
      return { players: [...owners.keys()].map(id => ({ id })), ...snapshot() }
    },
  }
  return policy
}
