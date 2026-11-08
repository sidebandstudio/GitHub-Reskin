# @github-reskin/appearance

Renderer 1's theme identity, implemented once: the ten parametric effects, the eight bundled accent
fonts and the owned decoration nodes for flavor slots. The GitHub content adapter, the shared
preview, the userscript and the site all use this package.

| Export | Behavior |
| --- | --- |
| `compileAppearance(resolved, prefs, target)` | CSS for owned nodes only: accent copy, effect geometry, the finite motion rules when motion is effective, a reduced-motion stop and a forced-colors hide. `""` when nothing shows. `github` and `preview` emit the same declarations; `github` marks the structural ones `!important`. Never interpolates theme strings. |
| `mountAppearance(root, resolved, prefs, anchors)` | Creates owned nodes at verified `SlotAnchor`s inside `root` and returns `{ destroy(), play(), owned, animated }`. `play()` runs the single motion pass for an explicit theme selection. Load, scrolling and navigation never call it. |
| `fontFaceCss(fontId, resourceUrl)` | One `@font-face` (swap, Latin `unicode-range`) for a bundled face. Accepts only extension URLs, same-site paths and `data:font/woff2` URLs. |
| `extensionResources(runtime)`, `siteResources(base)`, `embeddedResources({fonts, assets})`, `noResources` | Runtime resource adapters: `{ fontUrl(id), assetUrl(path) }`. The only source of asset locations. |
| `effectiveAppearance`, `planAppearance`, `ownedNodePlan` | Preference gating and the node plan, also usable for `CompiledStyle.ownedNodePlan`. |
| `FONTS`, `EFFECTS`, `LIMITS`, `effectCss`, `boundedParams` | Registry and templates. Bounds and defaults come from the schema through `@github-reskin/format`. |

## Placement

Every owned node is `aria-hidden`, pointer-transparent and unfocusable, and enters copy only through
`textContent`.

- **Heading slots** hang a strip of at most 360x36px into the blank end of the heading row from a zero-height wrapper, so block flow is untouched. In a flex row the wrapper fills the free space; under grid or column layout it leaves the flow entirely.
- **The profile tag** is a badge laid over blank space beside or above the name.
- **Captions** are in-flow paragraphs. They are the only owned nodes that take space, and only when Text is on.

Before an overlay is kept, its box is measured against the host's text and its native neighbors. If it would cover them, it tries one alternate place; if that is not blank either, the slot is left out. Anchors inside `.markdown-body`, comments, issue titles, code, tables, SVG or interactive elements are refused.

## Limits

A document gets at most 24 owned nodes and 6 animated ones. Flavor copy is placed before any decoration. Only the first box with drift or echo moves; other boxes keep the static rest state. Motion is a single pass using transform and opacity only: at most 1200 ms for drift and 200 ms for echo. Motion requires enabled, extras, effects and motion, plus `resolved.motionAllowed` (which is false under reduced motion and native policies). Native, high-contrast and forced-color policies get no decoration.

## Checks

`checks.mjs` serves `check:fonts`, `check:effects` (`--themes <dir>` adds staged themes) and the fixture surface for `test:e2e`/`check:a11y`. `audit.mjs` and `woff2.mjs` are Node-only and never bundled.
