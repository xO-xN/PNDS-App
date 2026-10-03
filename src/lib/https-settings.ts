/**
 * #139: the settings「可信 HTTPS」section's pure helpers — the frontend
 * mirror of the Rust domain/port rules (`validate_https_domain` /
 * `validate_https_port` in src-tauri/src/https.rs, enforced authoritatively
 * at the preferences save boundary and at material import). The mirror
 * exists so the inputs can hold back obviously-invalid values from the
 * save queue — one bad field would fail the whole file write.
 */

/** Mirrors the Rust rule: non-privileged entry port, 1024–65535. */
export const HTTPS_PORT_MIN = 1024
export const HTTPS_PORT_MAX = 65535

/** The port input's placeholder — a suggestion, never a default value. */
export const HTTPS_PORT_PLACEHOLDER = '8443'

/**
 * Normalizes operator input the way the backend will: trim, lowercase,
 * strip one trailing root-dot. Returns '' for blank input.
 */
export function normalizeHttpsDomain(raw: string): string {
  const lowered = raw.trim().toLowerCase()
  return lowered.endsWith('.') ? lowered.slice(0, -1) : lowered
}

/** The domain is set when the normalized form is non-blank. */
export function isHttpsDomainSet(domain: string): boolean {
  return normalizeHttpsDomain(domain) !== ''
}

/**
 * Mirrors `validate_https_domain`: a real ASCII DNS name a public CA can
 * issue for — no IP literals, `.local`, scheme/host:port spellings or
 * wildcard (the entry URL needs a concrete host; wildcards are a
 * certificate-side property).
 */
export function isValidHttpsDomain(raw: string): boolean {
  const domain = normalizeHttpsDomain(raw)
  if (domain === '' || domain.length > 253) return false
  if (!/^[\x20-\x7e]*$/.test(domain)) return false
  for (const marker of ['/', '\\', '?', '#', '@', ':', ' ', '%', '[', ']']) {
    if (domain.includes(marker)) return false
  }
  const labels = domain.split('.')
  if (domain.startsWith('.') || domain.endsWith('.') || labels.length < 2) {
    return false
  }
  for (const label of labels) {
    if (
      label.length < 1 ||
      label.length > 63 ||
      label.startsWith('-') ||
      label.endsWith('-') ||
      !/^[a-z0-9-]+$/.test(label)
    ) {
      return false
    }
  }
  const tld = labels[labels.length - 1] ?? ''
  if (tld === 'local') return false
  if (/^\d+$/.test(tld)) return false
  return true
}

/** Mirrors `validate_https_port` for the numeric input's commit gate. */
export function isValidHttpsPort(raw: string): boolean {
  const port = Number(raw.trim())
  return (
    Number.isInteger(port) && port >= HTTPS_PORT_MIN && port <= HTTPS_PORT_MAX
  )
}

/** Parses the port input for the preferences commit; null when unset. */
export function parseHttpsPort(raw: string): number | null {
  const trimmed = raw.trim()
  return trimmed === '' ? null : Number(trimmed)
}
