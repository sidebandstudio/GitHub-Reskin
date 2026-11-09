# @github-reskin/appearance

Renderer 1's theme identity, implemented once: the ten parametric effects, the bundled fonts, the
owned decoration nodes for flavor slots, and the structured appearance this renderer draws on
GitHub's page (`paint.js`): page, profile banner and header paints, opaque reading backings, avatar
shape and frame, and the heading/body type roles. The GitHub content adapter, the shared
preview, the userscript and the site all use this package.

| Export | Behavior |
| --- | --- |
| `compileAppearance(resolved, prefs, target, { css, cssAllowed, registry, viewport })` | The structured appearance (below), then CSS for owned nodes: accent copy, effect geometry, the finite motion rules when motion is effective, a reduced-motion stop and a forced-colors hide. `""` when nothing shows. `github` and `preview` emit the same declarations; `github` marks the structural ones `!important`. Never interpolates theme strings other than admitted `gradientCss` values. `css` is the theme's own CSS and `cssAllowed` the host's decision (a packaged built-in in Full, or consent for its hash); rules for owned slots compile behind the host's `[data-reskin-css="active"]` scope marker. Without `registry` a rule for GitHub's own elements fails the whole input closed; with the host's `CSS_TARGET_REGISTRY` (C3b) those rules compile behind its admission markers, and the theme's CSS sits inside `not (forced-colors: active)`. `viewport` resolves vw/vh paint sizes for the preview, whose frame is as tall as its page. |
| `mountAppearance(root, resolved, prefs, anchors, { css, cssAllowed, registry })` | Creates owned nodes at verified `SlotAnchor`s inside `root` and returns `{ destroy(), play(), motionBoxes(), owned, animated }`. `play()` runs the single motion pass for an explicit theme selection, only in boxes inside the viewport, and returns a box to rest if it leaves the viewport during the pass. Load, scrolling and navigation never call it. `motionBoxes()` lists the boxes allowed to move, for a host that tests visibility itself (the preview controller). |
| `fontFaceCss(fontId, resourceUrl)` | One `@font-face` (swap, Latin `unicode-range`) for a bundled face. Accepts only extension URLs, same-site paths and `data:font/woff2` URLs. |
| `extensionResources(runtime)`, `siteResources(base)`, `embeddedResources({fonts, assets})`, `noResources` | Runtime resource adapters: `{ fontUrl(id), assetUrl(path) }`. The only source of asset locations. |
| `effectiveAppearance`, `planAppearance`, `ownedNodePlan` | Preference gating and the node plan, also usable for `CompiledStyle.ownedNodePlan`. |
| `FONTS`, `EFFECTS`, `LIMITS`, `effectCss`, `boundedParams` | Registry and templates. Bounds and defaults come from the schema through `@github-reskin/format`. |

## Structured appearance

| Layer | Full | Calm | Effects off |
| --- | --- | --- | --- |
| Page and header paint | Solid color plus up to four layers: structured gradients, patterns and admitted `gradientCss`. An auto-sized straight repeating gradient is drawn as one tiled period, the same pixels without a page-tall image. Embedded images draw from the source's admitted data by hash (`imageAssets`): on the page fitted to the first screen (a tile repeats down the page), in the header and banner fitted to the box. | Solid color only | Solid color only |
| Reading backings | Panels that hold authored or code text (`.Box`, `.markdown-body`, diff and blob tables, blankslates) get an opaque `--bgColor-default` backing at no specificity whenever the page has layers | not needed | not needed |
| Text on a paint | Every layer's fills are composited over the base and checked against the text drawn on that surface at 4.5:1: every stop and band, repeating ones included, and colors sampled between stops in sRGB, and in OKLab when a stop is not a legacy sRGB color. The only band left out is a hard band of at most 2px at the start of a linear gradient painted once over the box, such as a header's bottom rule. A paint that fails, cannot be evaluated or has too many combinations to check is not drawn and leaves a note. An image's pixels are unknown, so it draws under a veil of the paint's color: its own opacity, plus the least veil (in 1/100 steps) that keeps every text at 4.5:1 over both a black and a white pixel. An image that would need more than a 95% veil is left out with a note. The banner holds no text and draws its image as it is. | | |
| Profile banner | One owned, empty, `aria-hidden` region the host reserves above the profile | none | none |
| Avatar | `.avatar-user` shape (circle, square, rounded, bevel with `corner-shape` or square, arch) and a none/solid/double/neon frame | shape and a solid frame | shape and a solid frame |
| Type | Heading role on GitHub headings and chrome (never authored prose or code), body role on the page, uppercase and tracking; code, diff and editor text keep their native family, tracking and case, also inside a heading | same | same |

Fonts off removes both roles, tracking and case. Native, high-contrast and forced-color resolutions get none of it.

## Local image conversion (raster.js)

For the theme builder: `convertRaster(bytes, {crop, maxSide, format, quality, compress, others, signal})` reads a local file's header (at most 2 MiB, PNG/JPEG/WebP/GIF, 2048px a side, 2,097,152 pixels, and the document's 6,291,456-pixel allowance beside `others`) before one decode, keeps an animated image's first frame, crops, scales and encodes a still WebP or PNG through a canvas, strips the encoder's own metadata chunks (Chromium writes an sRGB ICC profile into every WebP) and returns a proposal with before/after sizes and a note, or `image-limit` with both sizes when the output passes its byte budget. Compress steps WebP quality down from 0.9 to 0.4. It never writes into a theme: `setRasterLayer` and `removeRasterLayer` apply an accepted proposal within the layer, byte and pixel caps. `createRasterQueue()` runs jobs one at a time and cancels the job a newer one for the same key replaces; every bitmap and canvas is released when a job ends. The primitives come from `browserRasterEnv(scope)`, so a worker can run the same code with `OffscreenCanvas`.

On the page, every structured rule sits inside `@container style(--reskin-on: 1)`. The Primer adapter's compiled CSS raises that switch on the mode islands it themes and clears it on native, high-contrast, unknown and suppressed ones, so each subject follows its nearest island exactly as the adapter's own component rules do; an island's own element is never a subject. A role's inherited type is reset at every island, `data-reskin-native` and `data-reskin-protected` element below a heading or the body, and code keeps its tracking and case, with resets of no specificity that GitHub's own rules still override. Engines without container style queries (Gecko before Firefox 151) draw none of the structured rules. Owned nodes are mounted only where the switch is raised, so the adapter's CSS must be in the document first. The preview's layout document, which leaves out the adapter's stylesheet, raises the switch on its root, the fixture's only island. Buttons, borders, radii and shadows on GitHub's elements, syntax/diff, selection, scrollbars, pills and the graph belong to the Primer adapter.

`tests/fixture-app/product/trace.mjs` traces a 10,000-line diff and a full-year graph under the maximum structured background in Chromium and Firefox.

## Placement

Every owned node is `aria-hidden`, pointer-transparent and unfocusable, and enters copy only through
`textContent`.

- **Heading slots** hang a strip of at most 360x36px into the blank end of the heading row from a zero-height wrapper, so block flow is untouched. In a flex row the wrapper fills the free space; under grid or column layout it leaves the flow entirely.
- **The profile tag** is a badge laid over blank space beside or above the name.
- **A theme's CSS** styles the exact owned node for a slot (`data-reskin-slot`): the strip or badge, whose copy takes its type from it, or a caption's copy. A tag or caption the theme's CSS styles carries no packaged effects, since that CSS is its whole treatment.
- **The 404 caption** can sit in the illustration's blank corner: a zero-height paragraph after the illustration holds a frame laid exactly over it, and the theme's CSS places the copy with `position:absolute` and percentage offsets inside the frame. Under 480px, over native text, or when the copy does not fit, it falls back to an ordinary flow caption. The placement is measured again whenever the illustration or its row changes size (viewport, zoom, late images) and when a font finishes loading, and the observer is disconnected on destroy.
- **Captions** are in-flow paragraphs of copy. They are the only owned nodes that take space, and only when Text is on. A caption's edge hangs out of flow over the blank end of its last line, so turning Effects on or off never moves content.

Before an overlay is kept, its box is measured against the host's native text and its native neighbors; owned copy, including an appended slot's own copy, is not an obstacle. A caption edge is measured against the caption's copy. If a box would cover them, it tries one alternate place; if that is not blank either, the slot is left out (a caption keeps its copy and drops its edge). Anchors inside `.markdown-body`, comments, issue titles, code, tables, SVG or interactive elements are refused.

## Limits

A document gets at most 24 owned nodes and 6 animated ones. Flavor copy is placed before any decoration. Only the first box with drift or echo moves; other boxes keep the static rest state. Motion is a single pass using transform and opacity only: at most 1200 ms for drift and 200 ms for echo. Motion requires enabled, extras, effects and motion, plus `resolved.motionAllowed` (which is false under reduced motion and native policies). Native, high-contrast and forced-color policies get no decoration.

## Checks

`checks.mjs` serves `check:fonts`, `check:effects` (`--themes <dir>` adds staged themes) and the fixture surface for `test:e2e`/`check:a11y`. `audit.mjs` and `woff2.mjs` are Node-only and never bundled.
