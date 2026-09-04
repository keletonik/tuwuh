# Tuwuh theme system

Design record for the dark theme set. Written under the project's design gate,
with each claim tagged `VERIFIED`, `INFERRED` or `UNKNOWN`.

## Thesis

> Tuwuh's themes should feel like calibrated reading conditions rather than
> skins, because a file manager is a dense, small-type surface someone stares at
> for hours, expressed through a single perceptual lightness ladder shared by
> every theme and varied only by hue family and contrast tier.

The consequence is that no colour in this project is chosen by eye. Surfaces come
from a fixed OKLCH ladder; text roles are pushed away from their background until
they clear a contrast floor; category tones come from a hue wheel at a lightness
raised until it clears the graphical floor. See `src/lib/themes.ts`.

## Three concepts considered

Each had to differ structurally, not by palette.

| | A: hue families | B: contrast tiers | C: material treatments |
|---|---|---|---|
| Colour logic | one ladder, six hues | one hue, three separation levels | one hue, three surface models |
| What varies | hue character | legibility headroom | how depth is expressed |
| Brief fidelity | 5 | 3 | 2 |
| Distinctiveness | 4 | 3 | 4 |
| Usability | 4 | 5 | 3 |
| Accessibility feasibility | 4 | 5 | 3 |
| Implementation risk (5 = low) | 5 | 5 | 2 |
| Content scalability | 5 | 4 | 3 |
| **Total** | **27** | **25** | **17** |

**Selected: A, with B folded in.** Hue families answer the request for options;
concept B contributed the Carbon tier, so the set also covers someone who needs
more separation than a mid-contrast theme gives. Concept C was rejected because
varying surface treatment (flat, elevated, outlined) changes component structure
rather than tokens, which multiplies the CSS surface for no gain a file manager
can use.

## The themes

| Theme | Family | Surface hue | Tier | Body text |
|---|---|---|---|---|
| Forest | green | 150 | standard | 16.15:1 |
| Basalt | neutral, cool cast | 250 at very low chroma | standard | 15.96:1 |
| Indigo | blue-violet | 276 | standard | 16.05:1 |
| Ember | warm amber | 52 | standard | 16.04:1 |
| Carbon | neutral, near-black | 0 at zero chroma | high | 19.75:1 |
| Birch | the one light theme | 90 | standard, inverted | 15.65:1 |

## Anti-slop diagnostic

| Flagged pattern | Present? | Justification |
|---|---|---|
| Dark theme as default | Yes | The brief asked for dark options specifically. A light theme is retained and derived on the same ladder, so dark is the default rather than the only option. |
| Near-black backgrounds | Only in Carbon | Carbon exists to serve the high-separation case. The other four sit at L 0.17, deliberately above true black, because black surfaces raise halation on small light text. `INFERRED` |
| Colour-coded categories | Yes | Every category also carries its own glyph, so hue is never the only channel. Verified in the screenshot audit below. |
| Purple/blue AI gradient | No | No gradients anywhere in the token set. |
| Six themes as feature-count padding | Contested | Four dark hue families plus one high-contrast tier plus one light. Each family has a stated use, not a name. |

## Evidence

| Gate | Check | Command | Result |
|---|---|---|---|
| Contrast | 27 pairs per theme against WCAG 2.2 floors | `npm run check:contrast` | `VERIFIED` 162 pairs, 0 below floor |
| Body text | fg on bg | same | `VERIFIED` all six at AAA (15.65 to 19.75:1) |
| Non-text | borders and 17 category tones at 3:1 | same | `VERIFIED` tightest 3.03:1 |
| Types | frontend typecheck | `npm run typecheck` | `VERIFIED` exit 0 |
| Build | contrast gate then tsc then bundle | `npm run build` | `VERIFIED` exit 0 |
| Backend | unit tests | `cargo test --lib` | `VERIFIED` 19 passed |
| Visual, all themes | app screenshot per theme, chrome + editor + terminal | screenshot audit | `VERIFIED` six captured, all render |
| Visual, categories | one file per category, three themes | screenshot audit | `VERIFIED` 17 categories, distinct glyph and tone in both polarities |

## Findings from the screenshot audit

1. **Folder and code tones collided in Forest.** The folder tone takes the theme
   accent, which in a green theme lands within about 5 degrees of the code hue, so
   a directory and a `.rs` file read alike. Fixed by lifting the folder tone above
   every file tone in lightness, which also encodes hierarchy. `VERIFIED` by
   re-capture.
2. **Document and image hues are adjacent** (248 and 218) and read similarly at
   16px. Not changed: their glyphs differ clearly, so the dual-channel encoding
   still separates them. `VERIFIED` visually, and accepted.
3. **Monaco stayed dark under the light theme** before this work, because its base
   was hardcoded. Now follows `theme.dark`. `VERIFIED`.
4. **Category tones did not follow the theme at all** before this work: they were
   static values in `:root`, so on the light theme every icon kept colours derived
   for a dark background. `VERIFIED` fixed; tones are now set per theme by
   `applyTheme`.

## Gates not run

Stated rather than implied:

- **No award or studio research.** That arm of the design gate targets marketing
  websites; this is a desktop file manager and the load-bearing evidence here is
  measured contrast, not visual trend. `UNKNOWN` whether current studio practice
  would suggest a different direction.
- **Audit independence is `LOGICAL_ONLY`.** One model reviewed its own work. This
  is not an independent audit and must not be described as one.
- **No Core Web Vitals measurement.** Not meaningful for a local desktop binary
  with no network fetch on the critical path.
- **No screen-reader pass, keyboard-order audit, target-size audit or 320px
  reflow test.** The contrast gate covers WCAG 1.4.3 and 1.4.11 for the token set
  only. `NOT_VERIFIED` for conformance beyond those two criteria.

Status: **CONDITIONAL_PASS**. Colour gates pass with measurement. The remaining
accessibility criteria are unmeasured and bounded above.
