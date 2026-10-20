/** Fluorescent hue and pastel companion from the work's strongest palette hue.
 * Black/neutral palettes fall back to the reference's green color island. */
export function coverFogColors(palette: readonly string[]): [string, string] {
  const candidates = palette
    .map(hex => {
      if (!/^#[\da-f]{3,4}$|^#[\da-f]{6}([\da-f]{2})?$/iu.test(hex))
        return { hue: 160, score: 0 }
      const raw = hex.replace('#', '')
      const six =
        raw.length <= 4 ? [...raw].map(c => c + c).join('') : raw.slice(0, 6)
      const [r = 0, g = 0, b = 0] = [0, 2, 4].map(
        i => parseInt(six.slice(i, i + 2), 16) / 255
      )
      const max = Math.max(r, g, b),
        min = Math.min(r, g, b),
        d = max - min,
        light = (max + min) / 2
      const hue =
        d === 0
          ? 160
          : max === r
            ? 60 * (((g - b) / d + 6) % 6)
            : max === g
              ? 60 * ((b - r) / d + 2)
              : 60 * ((r - g) / d + 4)
      const score = d * (light > 0.17 && light < 0.75 ? 1 : 0.1)
      return { hue, score }
    })
    .sort((a, b) => b.score - a.score)
  const strongest = candidates[0]
  const hue = strongest && strongest.score > 0.05 ? strongest.hue : 160
  return [`hsl(${hue} 100% 45%)`, `hsl(${(hue + 28) % 360} 100% 79%)`]
}
