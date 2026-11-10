# @github-reskin/preview

One reusable, inert, offline preview of GitHub for the extension UI, userscript, site and films.
It is painted by the same resolver, Primer compiler and appearance code that run on github.com.

```js
import { configurePreview, mountPreview } from "@github-reskin/preview";
configurePreview({ primer, modeIndex, resources, dormantSlots }); // once per host
const handle = mountPreview(container, { view: "profile", theme, preferences, onState });
handle.update({ theme, preferences }); // a newly selected theme plays its one motion pass
handle.setView("diff"); handle.setBefore(true); handle.destroy();
```

`compact: true` asks for the profile's phone composition, for a host that shows the preview in a small fixed window: in the narrow layout the profile keeps the name and tag, one pinned repository and the graph with its legend, and leaves out GitHub's header, the bio and the profile details. Other views and wide layouts are unchanged. `handle.update({ ..., compact })` changes it; an update without `compact` keeps it.

- `primer` is C3's adapter module (`selectMode`, `compileGitHub`), and `modeIndex` is `vendor/primer/modes.json`.
- `resources` is a runtime adapter from `@github-reskin/appearance`.
- `dormantSlots` lists the flavor slots that have no evidence on current GitHub markup. The default matches C3's evidence today: the issues caption only. Hosts pass C3's current `dormantSlots()`. The capture has no Contribution activity section, so that slot has no anchor here.

Views are `profile`, `repo`, `diff`, `empty` and `404`. The profile and repository views model the offline capture of https://github.com/whoisaldo and sidebandstudio/GitHub-Reskin (see `fixture/README.md`). The diff, empty-state and 404 content is fictional. There are no buttons, inputs, Star/Fork controls or sign-in prompts, and links keep their destination only as `data-href`.

## Rendering

A trusted controller in the host page does all the work. It resolves and compiles the theme, paints the view into a hidden layout document, and writes the result out as one complete srcdoc for the styled frame:

- The **styled frame** is sandboxed with an empty token list (`PREVIEW_SANDBOX`): no scripts, no same-origin access, no forms, popups or navigation of the host. Its origin is opaque, the host cannot reach into it, and there is no message protocol with it. Its policy (`PREVIEW_CSP`) allows no request at all: every reviewed weight of the selected heading and body families and the view's images travel embedded as data, read once per page from the resource adapter's packaged URLs. Each coalesced update (at most one per animation frame) replaces the frame with a new one, which is shown once it has loaded. A newer update cancels an older job and removes its frame; destroy releases frames, observers and timers.
- The **layout document** is a same-origin, scriptless, `inert`, `aria-hidden` frame that is never shown. It holds only trusted layers (fixture, native mode CSS, the fonts and owned decoration, never the compiled theme), so the controller can measure decoration placement, motion boxes and height there. A color-only edit keeps its laid-out body and changes only the style layers.
- `serializeFixture` writes elements and attributes from fixed allowlists, escapes all text and attribute values, refuses anything else, and refuses style text containing `<`. Theme strings enter the layout document only through `textContent`.

Both frames grow to fit the content and stay out of the tab order. View and Before/After controls stay in the host. Paint order in the styled frame:

1. GitHub's native mode CSS: the ModeIndex declaration list for the theme's standard mode, as a `:root` rule with that mode's `color-scheme` (`nativeBaseline`).
2. The Primer compiler's preview target (`compilePreview` with the `PREVIEW_VARIABLES` names), applied in After mode; an adapter without it compiles `compileGitHub`.
3. The heading and body families' `@font-face` rules from `roleFontFaceCss`, as on github.com, then `compileAppearance`.

Before mode and `preferences.enabled: false` show native colors only. An invalid theme throws and the last valid preview stays; a job that fails keeps the last valid frame and sets `data-error`.

A selected theme's single motion pass plays only in boxes the page can show at that moment (clipped by scrolling ancestors and the viewport). If a moving box leaves view or the page is hidden during the pass, the frame is replaced with its resting state; the pass never replays on scroll.

The fixture reads colors only through `PREVIEW_VARIABLES` (Primer variable name to resolved color path). It matches C3's mapping, and C3's compiler and native mode CSS must define every one of them.

`createFixtureRenderer(document)` paints a view straight into any trusted document. It is used for the layout document and accessibility tests and is available for build-time prerendering. The host element carries `data-source-hash`, `data-seed-hash`, `data-fingerprint`, `data-policy`, `data-owned-nodes` and `data-playing` for frame and fixture comparisons, `data-requested`/`data-completed` generations, and fires `reskin-preview-complete` (`detail: { generation, ms }`, measured from the first coalesced request to the first paint after the swap).
