import type { CreationLibrary } from './tauri-bindings'

/** Internal dependencies remain available to the resolver and visible as saved
 * project facts, but are not independent capabilities to recommend or add. */
export function visibleCreationLibraries(libraries: CreationLibrary[]) {
  return libraries.filter(
    library =>
      !!library.referencedVersion ||
      !['socket.io-client', 'qrcode'].includes(library.id)
  )
}
