/**
 * Theme derivation.
 *
 * Every theme is the same perceptual lightness ladder in a different hue
 * family. That is the whole design decision: a file manager is a dense,
 * small-type surface read for hours, so the themes differ in the reading
 * *condition* they create, not in decoration. Because the ladder is fixed and
 * expressed in OKLCH, "Forest at muted" and "Ember at muted" are equally
 * legible, which hand-picking sRGB hex cannot guarantee.
 *
 * Nothing here is a literal hex value chosen by eye. Surfaces come from the
 * ladder; category tones come from a hue wheel at a lightness the derivation
 * raises until it meets the contrast floor. `scripts/check-contrast.mjs`
 * re-measures the generated result and fails the build if any pair falls short,
 * so the palette is verified rather than asserted.
 */
import { contrast, meetContrast, oklchToHex, type Oklch } from "./oklch.ts";

export type ThemeId = "forest" | "basalt" | "indigo" | "ember" | "carbon" | "birch";

export type ToneKey =
  | "folder" | "code" | "document" | "spreadsheet" | "presentation" | "pdf"
  | "image" | "video" | "audio" | "archive" | "executable" | "font"
  | "config" | "database" | "disk" | "book" | "other";

export interface ThemeTokens {
  id: ThemeId;
  name: string;
  /** Drives Monaco's base theme and the icon-tone contrast direction. */
  dark: boolean;
  blurb: string;
  bg: string;
  bg1: string;
  bg2: string;
  fg: string;
  muted: string;
  accent: string;
  wood: string;
  border: string;
  danger: string;
  warn: string;
  editorBg: string;
  tones: Record<ToneKey, string>;
}

/**
 * WCAG 2.2 floors. Text is 1.4.3 at 4.5:1; icons and borders are graphical
 * objects under 1.4.11 at 3:1. Applying the text floor to icons would force
 * every category tone so pale that the categories stop being distinguishable
 * from each other, which trades one legibility problem for another.
 */
export const TEXT_CONTRAST = 4.5;
export const NON_TEXT_CONTRAST = 3;

/** Hue angle per category. Neutral entries carry no chroma. */
const TONE_HUES: Record<ToneKey, { h: number; c: number }> = {
  folder: { h: 0, c: -1 }, // sentinel: takes the theme accent hue
  code: { h: 145, c: 0.115 },
  document: { h: 248, c: 0.075 },
  spreadsheet: { h: 168, c: 0.105 },
  presentation: { h: 45, c: 0.105 },
  pdf: { h: 25, c: 0.115 },
  image: { h: 218, c: 0.105 },
  video: { h: 312, c: 0.105 },
  audio: { h: 196, c: 0.1 },
  archive: { h: 85, c: 0.1 },
  executable: { h: 18, c: 0.12 },
  font: { h: 292, c: 0.09 },
  config: { h: 0, c: 0.008 },
  database: { h: 205, c: 0.095 },
  disk: { h: 240, c: 0.035 },
  book: { h: 62, c: 0.085 },
  other: { h: 0, c: 0.004 },
};

interface Family {
  id: ThemeId;
  name: string;
  blurb: string;
  dark: boolean;
  /** Hue of the surface ladder. */
  surfaceHue: number;
  /** Chroma of the surface ladder. Near zero reads as neutral grey. */
  surfaceChroma: number;
  accentHue: number;
  accentChroma: number;
  /** "high" trades hue character for maximum separation. */
  tier: "standard" | "high";
}

const FAMILIES: Family[] = [
  {
    id: "forest",
    name: "Forest",
    blurb: "Green, mid contrast. The original palette, re-derived.",
    dark: true,
    surfaceHue: 150,
    surfaceChroma: 0.022,
    accentHue: 150,
    accentChroma: 0.11,
    tier: "standard",
  },
  {
    id: "basalt",
    name: "Basalt",
    blurb: "Neutral grey with a cool cast. No hue competing with file colours.",
    dark: true,
    surfaceHue: 250,
    surfaceChroma: 0.006,
    accentHue: 225,
    accentChroma: 0.105,
    tier: "standard",
  },
  {
    id: "indigo",
    name: "Indigo",
    blurb: "Cool blue-violet. Highest surface chroma of the dark set.",
    dark: true,
    surfaceHue: 276,
    surfaceChroma: 0.028,
    accentHue: 276,
    accentChroma: 0.115,
    tier: "standard",
  },
  {
    id: "ember",
    name: "Ember",
    blurb: "Warm amber-brown. Lower blue output for long evening sessions.",
    dark: true,
    surfaceHue: 52,
    surfaceChroma: 0.02,
    accentHue: 58,
    accentChroma: 0.11,
    tier: "standard",
  },
  {
    id: "carbon",
    name: "Carbon",
    blurb: "Near-black, maximum separation. Body text clears AAA.",
    dark: true,
    surfaceHue: 0,
    surfaceChroma: 0,
    accentHue: 200,
    accentChroma: 0.11,
    tier: "high",
  },
  {
    id: "birch",
    name: "Birch",
    blurb: "The one light theme, on the same ladder inverted.",
    dark: false,
    surfaceHue: 90,
    surfaceChroma: 0.012,
    accentHue: 155,
    accentChroma: 0.12,
    tier: "standard",
  },
];

/** Surface lightness ladders. Dark themes climb; the light theme descends. */
const LADDER = {
  standard: { bg: 0.17, bg1: 0.212, bg2: 0.252, border: 0.33, muted: 0.7, fg: 0.94 },
  high: { bg: 0.12, bg1: 0.163, bg2: 0.205, border: 0.38, muted: 0.79, fg: 0.99 },
  light: { bg: 0.965, bg1: 0.93, bg2: 0.895, border: 0.8, muted: 0.5, fg: 0.22 },
};

function build(f: Family): ThemeTokens {
  const ladder = !f.dark ? LADDER.light : LADDER[f.tier];
  const surface = (l: number): Oklch => ({ l, c: f.surfaceChroma, h: f.surfaceHue });

  const bg = oklchToHex(surface(ladder.bg));
  const bg1 = oklchToHex(surface(ladder.bg1));
  const bg2 = oklchToHex(surface(ladder.bg2));

  // Text roles are pushed away from the background until they clear the text
  // floor. On a light theme "away" means darker.
  const away = f.dark ? "lighter" : "darker";
  const fg = oklchToHex(meetContrast({ l: ladder.fg, c: f.surfaceChroma, h: f.surfaceHue }, bg2, 7, away));
  const muted = oklchToHex(
    meetContrast({ l: ladder.muted, c: f.surfaceChroma * 1.6, h: f.surfaceHue }, bg1, TEXT_CONTRAST, away),
  );
  // The accent is used as link-like text as well as for focus rings, so it is
  // held to the text floor, not the graphical one.
  const accent = oklchToHex(
    meetContrast({ l: f.dark ? 0.76 : 0.55, c: f.accentChroma, h: f.accentHue }, bg, TEXT_CONTRAST, away),
  );
  const wood = oklchToHex(meetContrast({ l: f.dark ? 0.81 : 0.5, c: 0.055, h: 80 }, bg, TEXT_CONTRAST, away));
  const danger = oklchToHex(meetContrast({ l: f.dark ? 0.68 : 0.52, c: 0.15, h: 25 }, bg, TEXT_CONTRAST, away));
  const warn = oklchToHex(meetContrast({ l: f.dark ? 0.79 : 0.52, c: 0.12, h: 75 }, bg, TEXT_CONTRAST, away));
  // Borders are graphical, so 3:1 against the surface they separate.
  const border = oklchToHex(
    meetContrast({ l: ladder.border, c: f.surfaceChroma * 1.4, h: f.surfaceHue }, bg, NON_TEXT_CONTRAST, away),
  );

  const toneStart = f.dark ? 0.74 : 0.5;
  const tones = {} as Record<ToneKey, string>;
  for (const [key, spec] of Object.entries(TONE_HUES) as [ToneKey, { h: number; c: number }][]) {
    const isFolder = spec.c < 0;
    const hue = isFolder ? f.accentHue : spec.h;
    const chroma = isFolder ? f.accentChroma : spec.c;
    // Folders take the theme accent, which in a green theme lands within a few
    // degrees of the code hue and makes a directory and a .rs file read alike.
    // Lifting the folder above every file tone separates them by lightness
    // instead, and doubles as hierarchy: folders are what you navigate.
    const start = isFolder ? Math.min(toneStart + (f.dark ? 0.09 : -0.09), 0.95) : toneStart;
    // Measured against bg2, the lightest surface a row sits on, so a tone that
    // passes here also passes on the darker default row background.
    tones[key] = oklchToHex(
      meetContrast({ l: start, c: chroma, h: hue }, bg2, NON_TEXT_CONTRAST, away),
    );
  }

  return {
    id: f.id,
    name: f.name,
    dark: f.dark,
    blurb: f.blurb,
    bg,
    bg1,
    bg2,
    fg,
    muted,
    accent,
    wood,
    border,
    danger,
    warn,
    editorBg: bg,
    tones,
  };
}

export const THEMES: Record<ThemeId, ThemeTokens> = Object.fromEntries(
  FAMILIES.map((f) => [f.id, build(f)]),
) as Record<ThemeId, ThemeTokens>;

export const THEME_LIST: ThemeTokens[] = FAMILIES.map((f) => THEMES[f.id]);

export const DARK_THEMES: ThemeTokens[] = THEME_LIST.filter((t) => t.dark);

export function themeById(id: string): ThemeTokens {
  return THEMES[id as ThemeId] ?? THEMES.forest;
}

/**
 * Every pair the contrast gate checks, with the floor that applies to it.
 * Exported so the checker measures exactly what ships rather than a copy of
 * the rules that could drift from it.
 */
export function contrastPairs(t: ThemeTokens): {
  label: string;
  fg: string;
  bg: string;
  floor: number;
  ratio: number;
}[] {
  const pairs: { label: string; fg: string; bg: string; floor: number }[] = [
    { label: "fg on bg", fg: t.fg, bg: t.bg, floor: TEXT_CONTRAST },
    { label: "fg on bg1", fg: t.fg, bg: t.bg1, floor: TEXT_CONTRAST },
    { label: "fg on bg2", fg: t.fg, bg: t.bg2, floor: TEXT_CONTRAST },
    { label: "muted on bg", fg: t.muted, bg: t.bg, floor: TEXT_CONTRAST },
    { label: "muted on bg1", fg: t.muted, bg: t.bg1, floor: TEXT_CONTRAST },
    { label: "accent on bg", fg: t.accent, bg: t.bg, floor: TEXT_CONTRAST },
    { label: "wood on bg1", fg: t.wood, bg: t.bg1, floor: TEXT_CONTRAST },
    { label: "danger on bg", fg: t.danger, bg: t.bg, floor: TEXT_CONTRAST },
    { label: "warn on bg", fg: t.warn, bg: t.bg, floor: TEXT_CONTRAST },
    { label: "border on bg", fg: t.border, bg: t.bg, floor: NON_TEXT_CONTRAST },
  ];
  for (const [key, value] of Object.entries(t.tones)) {
    pairs.push({ label: `tone ${key} on bg2`, fg: value, bg: t.bg2, floor: NON_TEXT_CONTRAST });
  }
  return pairs.map((p) => ({ ...p, ratio: contrast(p.fg, p.bg) }));
}
