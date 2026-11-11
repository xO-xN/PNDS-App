import { expect, it } from 'vitest'
import {
  MIN_SPECTRUM_DB,
  readSpectrum,
  spectrumColumns,
  spectrumEnd,
  spectrumFraction,
  spectrumPitch,
} from './audio-spectrum'

it('retains a narrow high-frequency peak in a compact logarithmic plot', () => {
  const frame = {
    fftSize: 8192,
    sampleRate: 48_000,
    magnitudes: Array<number>(4096).fill(0),
  }
  expect(spectrumColumns(frame, 100)).toEqual(
    Array<number>(100).fill(MIN_SPECTRUM_DB)
  )
  frame.magnitudes[2701] = 0.5
  const columns = spectrumColumns(frame, 100)
  expect(Math.max(...columns)).toBeCloseTo(-6.02)
  expect(columns.indexOf(Math.max(...columns))).toBeCloseTo(
    Math.round(
      spectrumFraction((2701 * 48_000) / 8192, spectrumEnd(frame)) * 99
    ),
    0
  )
})

it('interpolates the nearby peak and labels its nearest note', () => {
  const frame = {
    fftSize: 8192,
    sampleRate: 48_000,
    magnitudes: Array<number>(4096).fill(0),
  }
  frame.magnitudes[74] = 0.23
  frame.magnitudes[75] = 0.5
  frame.magnitudes[76] = 0.27
  const reading = readSpectrum(
    frame,
    spectrumFraction(440, spectrumEnd(frame)),
    0.02
  )
  expect(reading.peak).toBe(true)
  expect(reading.frequency).toBeGreaterThan((75 * 48_000) / 8192)
  expect(reading.frequency).toBeCloseTo(440, 0)
  expect(spectrumPitch(reading.frequency).note).toBe('A4')
  expect(readSpectrum(frame, 0.9, 0.01)).toMatchObject({
    peak: false,
    db: MIN_SPECTRUM_DB,
  })
})
