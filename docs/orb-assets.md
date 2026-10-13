# Loot orb sprites

Created with the built-in ImageGen tool on 2026-10-13. These are original TFT / Golden Spatula-inspired sprites with transparent alpha, included under the project's MIT license. Source PNGs were copied from the Codex generated-image output and resized to 256 × 256 with macOS `sips`, preserving transparency. No generated sprite replaces an existing asset.

| Sprite | Palette and visual treatment |
| --- | --- |
| `assets/textures/orb_gray.png` | Pearl-gray smoky glass, silver highlight, white question mark with gray outline. |
| `assets/textures/orb_blue.png` | Sapphire glass, ice-blue rim, cyan sparks, white question mark. |
| `assets/textures/orb_gold.png` | Golden amber glass, warm rim, gold star sparks, cream-white question mark. |
| `assets/textures/orb_prismatic.png` | Cyan, magenta, violet, gold and mint facets, iridescent swirl, prismatic stars. |
| `assets/textures/orb_void.png` | Purple-black core, violet vortex, magenta energy arcs, lavender question mark. |

## Prompt set

Common prompt: “Production transparent PNG game sprite for a 16-slot desktop signal wheel. Create one original TFT / Golden Spatula style magical loot orb, a polished stylized 3D game icon. Centered round sphere viewed from the front, diameter about 72% of a square canvas, compact translucent aura fully inside the canvas, equal transparent padding and an upper-left highlight. Clear silhouette at 40 pixels, crisp question-mark glyph, strong contrast. Actual alpha background; no background rectangle, checkerboard, floor, ground shadow, UI, border frame, labels, watermark, coins or chest. Only the floating orb and minimal glow.”

- Gray: “Pearl-gray smoky glass sphere, soft white rim, bold white question mark with a dark-gray outline, subtle silver highlights and restrained pale glow.”
- Blue: “Vivid sapphire and cyan glass sphere, brilliant ice-blue rim, tiny luminous blue sparks, bold bright-white question mark and deeper blue lower hemisphere.”
- Gold: “Rich golden amber glass sphere, warm gold rim, sharp four-point gold sparkle highlights, cream-white question mark and intense inner golden light.”
- Prismatic: “Luminous iridescent glass sphere with separate cyan, magenta, violet, gold and mint facets, rainbow swirling energy, clean white question mark and prismatic star sparks.”
- Void: “Purple-black cosmic sphere, dark central vortex, swirling violet veins, magenta rim, lavender question mark and two hooked void energy arcs; strong dark and bright contrast.”

All five reuse the existing `Base` ping sound and ring/pop/bob effects with their own glow colour. Both icon and on-screen art use the same PNG; the normal asset manifest retains it in production builds. Peers need this version to recognize the new orb ping IDs.
