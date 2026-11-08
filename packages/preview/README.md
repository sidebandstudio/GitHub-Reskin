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

- `primer` is C3's adapter module (`selectMode`, `compileGitHub`), and `modeIndex` is `vendor/primer/modes.json`.
- `resources` is a runtime adapter from `@github-reskin/appearance`.
- `dormantSlots` lists the flavor slots that have no evidence on current GitHub markup. The default is activity heading, organizations heading and issues caption. Hosts pass C3's current list.

Views are `profile`, `repo`, `diff`, `empty` and `404`. The profile and repository views model the offline capture of https://github.com/whoisaldo and sidebandstudio/GitHub-Reskin (see `fixture/README.md`). The diff, empty-state and 404 content is fictional. There are no buttons, inputs, Star/Fork controls or sign-in prompts, and links keep their destination only as `data-href`.

## Rendering

The fixture renders in a same-origin `srcdoc` iframe sandboxed without scripts, so GitHub-shaped CSS and the host page's CSS cannot reach each other. The iframe grows to fit its content and stays out of the tab order. Paint order:

1. GitHub's native mode CSS for the theme's standard base.
2. `compileGitHub`, applied in After mode.
3. `compileAppearance`, plus the selected face's `@font-face`.

Before mode and `preferences.enabled: false` show native colors only. An invalid theme throws and the last valid preview stays.

The fixture reads colors only through `PREVIEW_VARIABLES` (Primer variable name to resolved color path). C3's compiler and native mode CSS must define every one of them.

`createFixtureRenderer(document)` paints a view straight into any document. It is used by accessibility tests and is available for build-time prerendering. The host element carries `data-source-hash`, `data-seed-hash`, `data-fingerprint`, `data-policy` and `data-owned-nodes` for frame and fixture comparisons.
