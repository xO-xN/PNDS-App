export const MIN_SPECTRUM_DB = -85
export const MAX_SPECTRUM_DB = 0
export const MIN_SPECTRUM_HZ = 26

export interface AudioSpectrum {
  fftSize: number
  sampleRate: number
  magnitudes: number[]
}

export function spectrumEnd(frame: AudioSpectrum): number {
  const lastBin = (frame.magnitudes.length - 1) * binSpacing(frame)
  return Math.min(21_000, lastBin)
}

export function spectrumFraction(frequency: number, end: number): number {
  return Math.log(frequency / MIN_SPECTRUM_HZ) / Math.log(end / MIN_SPECTRUM_HZ)
}

function frequencyAt(fraction: number, end: number): number {
  return MIN_SPECTRUM_HZ * (end / MIN_SPECTRUM_HZ) ** fraction
}

function binSpacing(frame: AudioSpectrum): number {
  return frame.sampleRate / frame.fftSize
}

function magnitudeDb(magnitude: number): number {
  return Math.max(MIN_SPECTRUM_DB, 20 * Math.log10(magnitude))
}

function interpolatedDb(frame: AudioSpectrum, index: number): number {
  const lower = Math.floor(index)
  const fraction = index - lower
  const left = magnitudeDb(frame.magnitudes[lower] ?? 0)
  const right = magnitudeDb(frame.magnitudes[lower + 1] ?? 0)
  return left + (right - left) * fraction
}

/** Preserve the strongest FFT bin in every horizontal pixel. */
export function spectrumColumns(frame: AudioSpectrum, width: number): number[] {
  const end = spectrumEnd(frame)
  const spacing = binSpacing(frame)
  const lastColumn = Math.max(1, width - 1)
  return Array.from({ length: width }, (_, column) => {
    const lower = frequencyAt(Math.max(0, column - 0.5) / lastColumn, end)
    const upper = frequencyAt(
      Math.min(lastColumn, column + 0.5) / lastColumn,
      end
    )
    const first = Math.ceil(lower / spacing)
    const last = Math.floor(upper / spacing)
    if (first > last)
      return interpolatedDb(
        frame,
        frequencyAt(column / lastColumn, end) / spacing
      )
    let peak = 0
    for (let bin = first; bin <= last; bin += 1)
      peak = Math.max(peak, frame.magnitudes[bin] ?? 0)
    return magnitudeDb(peak)
  })
}

export interface SpectrumReading {
  frequency: number
  db: number
  peak: boolean
}

/** Snap to a nearby spectral peak, then interpolate between its FFT bins. */
export function readSpectrum(
  frame: AudioSpectrum,
  fraction: number,
  snapFraction: number
): SpectrumReading {
  const end = spectrumEnd(frame)
  const spacing = binSpacing(frame)
  const target = frequencyAt(fraction, end)
  const first = Math.max(
    1,
    Math.ceil(frequencyAt(Math.max(0, fraction - snapFraction), end) / spacing)
  )
  const last = Math.min(
    frame.magnitudes.length - 2,
    Math.floor(frequencyAt(Math.min(1, fraction + snapFraction), end) / spacing)
  )
  let bestDistance = snapFraction
  let reading: SpectrumReading = {
    frequency: target,
    db: interpolatedDb(frame, target / spacing),
    peak: false,
  }
  for (let bin = first; bin <= last; bin += 1) {
    const left = magnitudeDb(frame.magnitudes[bin - 1] ?? 0)
    const center = magnitudeDb(frame.magnitudes[bin] ?? 0)
    const right = magnitudeDb(frame.magnitudes[bin + 1] ?? 0)
    if (center <= MIN_SPECTRUM_DB + 6 || center < left || center <= right)
      continue
    const offset = (0.5 * (left - right)) / (left - 2 * center + right)
    const frequency = (bin + offset) * spacing
    const distance = Math.abs(spectrumFraction(frequency, end) - fraction)
    if (distance > bestDistance) continue
    bestDistance = distance
    reading = {
      frequency,
      db: center - 0.25 * (left - right) * offset,
      peak: true,
    }
  }
  return reading
}

const NOTE_NAMES = [
  'C',
  'C♯',
  'D',
  'D♯',
  'E',
  'F',
  'F♯',
  'G',
  'G♯',
  'A',
  'A♯',
  'B',
]

export function spectrumPitch(frequency: number): {
  note: string
  cents: number
} {
  const pitch = 69 + 12 * Math.log2(frequency / 440)
  const midi = Math.round(pitch)
  const name = NOTE_NAMES[((midi % 12) + 12) % 12]
  return {
    note: `${name}${Math.floor(midi / 12) - 1}`,
    cents: Math.round((pitch - midi) * 100),
  }
}
