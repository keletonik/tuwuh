/**
 * Contrast gate.
 *
 * Measures every theme that ships, against the same token values the app
 * renders, and exits non-zero if any pair falls under its WCAG 2.2 floor. This
 * imports the real theme module rather than a copy of the palette, so a change
 * to derivation cannot pass the gate while shipping something else.
 *
 *   node scripts/check-contrast.mjs [--verbose]
 *
 * A pass here is evidence about colour pairs only. It is not a claim that the
 * interface conforms to WCAG: focus order, target size, reflow and the rest are
 * separate checks this script does not attempt.
 */
import { THEME_LIST, contrastPairs } from "../src/lib/themes.ts";

const verbose = process.argv.includes("--verbose");
let failures = 0;
let checked = 0;
const worstPerTheme = [];

for (const theme of THEME_LIST) {
  const pairs = contrastPairs(theme);
  const bad = pairs.filter((p) => p.ratio < p.floor);
  const worst = pairs.reduce((a, b) => (b.ratio - b.floor < a.ratio - a.floor ? b : a));
  checked += pairs.length;
  failures += bad.length;
  worstPerTheme.push({ theme, worst, bad });

  const tag = theme.dark ? "dark " : "light";
  console.log(
    `${bad.length ? "FAIL" : "ok  "} ${theme.id.padEnd(7)} ${tag}  ` +
      `${pairs.length} pairs, tightest: ${worst.label} at ${worst.ratio.toFixed(2)}:1 ` +
      `(floor ${worst.floor})`,
  );

  for (const p of bad) {
    console.log(`       ${p.label}: ${p.ratio.toFixed(2)}:1 < ${p.floor} (${p.fg} on ${p.bg})`);
  }
  if (verbose) {
    for (const p of pairs) {
      console.log(`       ${p.label.padEnd(28)} ${p.ratio.toFixed(2)}:1  ${p.fg} on ${p.bg}`);
    }
  }
}

// Body text is held to AAA where the ladder already reaches it. This is
// reported, never enforced: forcing 7:1 on every theme would flatten the hue
// families into near-white on near-black and lose the differentiation the
// themes exist to provide.
console.log("\nbody text (fg on bg) by theme:");
for (const { theme } of worstPerTheme) {
  const r = contrastPairs(theme).find((p) => p.label === "fg on bg").ratio;
  const grade = r >= 7 ? "AAA" : r >= 4.5 ? "AA " : "---";
  console.log(`  ${theme.id.padEnd(7)} ${r.toFixed(2)}:1  ${grade}`);
}

console.log(
  `\n${checked} pairs checked across ${THEME_LIST.length} themes, ${failures} below floor`,
);
process.exit(failures === 0 ? 0 : 1);
