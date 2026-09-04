/**
 * OKLCH to sRGB, and WCAG relative luminance.
 *
 * Themes are derived rather than hand-picked. Choosing surface and text colours
 * by eye in sRGB gives palettes whose contrast varies with hue: the same "mid
 * grey" reads darker in green than in blue. OKLCH is perceptually uniform, so a
 * single lightness ladder produces the same legibility in every hue family, and
 * the contrast gate in scripts/check-contrast.mjs can then be satisfied by
 * construction instead of by adjustment.
 *
 * Values are converted to hex at runtime rather than emitted as `oklch()` in
 * CSS, because the palette also has to reach Monaco and xterm.js, both of which
 * take colour as strings they parse themselves.
 */

export interface Oklch {
  /** Perceptual lightness, 0 to 1. */
  l: number;
  /** Chroma. Roughly 0 to 0.37 for displayable sRGB. */
  c: number;
  /** Hue angle in degrees. */
  h: number;
}

function clamp01(n: number): number {
  return n < 0 ? 0 : n > 1 ? 1 : n;
}

/** Linear-light channel to gamma-encoded sRGB. */
function encode(channel: number): number {
  const v = channel <= 0.0031308 ? channel * 12.92 : 1.055 * channel ** (1 / 2.4) - 0.055;
  return Math.round(clamp01(v) * 255);
}

/**
 * Convert OKLCH to a `#rrggbb` string.
 *
 * Out-of-gamut inputs are clipped per channel rather than gamut-mapped. That is
 * acceptable here because every colour this module is asked for is generated at
 * a chroma low enough to stay inside sRGB; the clamp is a guard, not a
 * conversion strategy.
 */
export function oklchToHex({ l, c, h }: Oklch): string {
  const rad = (h * Math.PI) / 180;
  const a = c * Math.cos(rad);
  const b = c * Math.sin(rad);

  const lc = (l + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const mc = (l - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const sc = (l - 0.0894841775 * a - 1.291485548 * b) ** 3;

  const r = 4.0767416621 * lc - 3.3077115913 * mc + 0.2309699292 * sc;
  const g = -1.2684380046 * lc + 2.6097574011 * mc - 0.3413193965 * sc;
  const bl = -0.0041960863 * lc - 0.7034186147 * mc + 1.707614701 * sc;

  return `#${[encode(r), encode(g), encode(bl)]
    .map((n) => n.toString(16).padStart(2, "0"))
    .join("")}`;
}

/** WCAG 2.2 relative luminance of a `#rrggbb` string. */
export function luminance(hex: string): number {
  const s = hex.replace("#", "").trim();
  if (s.length !== 6) return 0;
  const ch = (i: number) => {
    const v = parseInt(s.slice(i, i + 2), 16) / 255;
    return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * ch(0) + 0.7152 * ch(2) + 0.0722 * ch(4);
}

/** WCAG 2.2 contrast ratio between two `#rrggbb` strings, 1 to 21. */
export function contrast(a: string, b: string): number {
  const la = luminance(a);
  const lb = luminance(b);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

/**
 * Raise or lower `l` until `hex` meets `target` contrast against `against`.
 *
 * Derivation gets a palette close; this closes the gap deterministically so a
 * hue that happens to sit badly against one background is corrected rather than
 * shipped a fraction under the threshold. Returns the input colour unchanged if
 * the target is unreachable, which the contrast gate then reports as a failure
 * rather than silently accepting.
 */
export function meetContrast(
  colour: Oklch,
  against: string,
  target: number,
  direction: "lighter" | "darker" = "lighter",
): Oklch {
  const step = direction === "lighter" ? 0.01 : -0.01;
  let candidate = { ...colour };
  for (let i = 0; i < 100; i += 1) {
    if (contrast(oklchToHex(candidate), against) >= target) return candidate;
    const next = candidate.l + step;
    if (next <= 0 || next >= 1) break;
    candidate = { ...candidate, l: next };
  }
  return candidate;
}
