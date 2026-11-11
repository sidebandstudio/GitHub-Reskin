# GitHub Reskin

A browser extension that restyles github.com and gist.github.com in your own browser. Pick one of 13 anime themes or 12 classic editor themes, or build your own, and every open GitHub tab repaints, contribution graph included.

[Preview every theme](https://sidebandstudio.github.io/GitHub-Reskin/) on the site, including on a phone.

The repo also has a GitHub Action that draws your contribution graph as an SVG in your colors, so visitors to your profile see them too.

## Install

GitHub Reskin isn't in the Chrome Web Store or on Firefox Add-ons yet. Until it is, build it from source. The build needs Node 24.22.2 and npm 11.12.1 exactly, and `npm ci` refuses other versions.

1. Clone the repo, then run `npm ci` and `npm run build:chrome`.
2. Open `chrome://extensions` in Chrome, Edge, Brave or Arc, turn on Developer mode, click Load unpacked and pick the `dist/chrome` folder. The `extension` folder holds build inputs and won't load by itself.
3. Reload any GitHub or Gist tabs you already had open, then open GitHub Reskin from your browser's extensions menu.

For Firefox 140 or newer, run `npm run build:firefox`, open `about:debugging#/runtime/this-firefox`, click Load Temporary Add-on and pick `dist/firefox/manifest.json`. Firefox removes it when it restarts. Firefox 140 to 150 gets the theme colors but not the painted backgrounds.

A build from source doesn't update itself. Pull and build again to update.

### Userscript for Safari and other browsers

Safari can't load the extension, and Firefox drops an unsigned one when it restarts. For those browsers, GitHub Reskin also comes as a userscript built from the same code as the extension. It has the same themes, Full and Calm, the same picker card and the same theme builder, and it stays installed.

1. Install a userscript manager. In Firefox, use [Violentmonkey](https://violentmonkey.github.io) or [Tampermonkey](https://www.tampermonkey.net). In Safari on a Mac, iPhone or iPad, use [Userscripts](https://github.com/quoid/userscripts) or Tampermonkey. Safari asks you to turn the extension on in its settings and allow it on github.com.
2. Open [github-reskin.user.js](https://sidebandstudio.github.io/GitHub-Reskin/downloads/github-reskin.user.js) and install it from your manager's prompt. In Userscripts, the prompt is under its toolbar button.
3. Reload any GitHub or Gist tabs you already had open.

To pick a theme, choose Open GitHub Reskin from your manager's menu. Userscripts has no menu, so open `https://github.com/#reskin` instead. A theme applies as soon as you click it, and Undo puts the previous one back. Press Escape, click Close or click the page to close the card.

Make a theme on the card opens the extension's builder in a wider panel: three colors to start, then fonts, effects, flavor text, backgrounds with gradients, patterns and your own images, shape and type, graph and code colors, and details, with one-change Undo and a preview of GitHub that never touches the page until you save. Import takes a chatbot's answer, a theme file or a share code, and Export and share gives the file, the theme JSON or a share code. Copy AI prompt is there too. Your unsaved draft is kept, so closing the panel or reloading GitHub doesn't lose it. Backup & help lists your saved themes to export or remove.

What differs by manager:

- Tampermonkey and Violentmonkey save your choice in the manager's storage, and other GitHub tabs follow a change at once. Managers with only `GM.getValue`, like Userscripts, save it too, and other tabs pick it up when you switch back to them.
- A manager that gives the script no storage gets a labeled session preview: themes apply until you reload, and Export theme file saves the theme you chose. Themes you make there last until the tab closes, so download them to keep them.
- GitHub's page only allows its own font files, so the script hands each theme's fonts to the browser from bytes it carries. Where a browser or manager refuses that, your system's fonts stand in. The builder's preview always uses your system's fonts.
- These settings are separate from the extension's. Theme files are the way to carry a theme between them.
- The card's controls appear only when the script can confirm that GitHub's own scripts can't reach it. Violentmonkey's content mode, Tampermonkey's sandbox and Userscripts run it that way. If your manager runs the script inside GitHub's page, or the script can't tell, it doesn't read or save the manager's storage at all, because GitHub's code could reach it there. The card only shows the current theme, there is no builder or import, and the manager's menu changes settings until you reload: on or off, Full or Calm, extra theme text, motion, and one entry per theme, listed by anime title first.
- Advanced CSS in your own themes stays off in the userscript, and nothing in it can turn that CSS on. A theme you import that carries CSS keeps it, and the builder shows it with a note that custom CSS needs the extension. The bundled themes keep their reviewed CSS.
- GitHub tabs save one at a time, so a change in one tab never silently undoes a change made in another at the same moment. If a tab stays busy, the change fails and offers Retry. github.com and gist.github.com can't take turns this way. Between them the script checks the saved settings just before it writes, but a write the manager delivers late can still replace the other tab's.
- The card is drawn above everything else on GitHub's page, and it closes or ignores the click when the page puts its own element over it. GitHub's page still controls what is drawn around the card. A page script could hide an element over the card where the script can't see it and give a real control a misleading label. That reaches only these theme settings on GitHub. For the full protections, use the extension.

## Themes

Thirteen anime themes lead the picker. Each has an original name and credits its show in plain text: Choom Circuit for Cyberpunk: Edgerunners, Violet Synchrony for Neon Genesis Evangelion, Occult Orbit for Dandadan, Gatewake Protocol for Solo Leveling, Wisteria Emberline for Demon Slayer, Sunward Voyage for One Piece, Fifth Leaf Forge for Black Clover, Cursed Aperture for Jujutsu Kaisen, Peanut Dossier for Spy x Family, Wallward Scout for Attack on Titan, Longroad Petals for Frieren, Ripcord Bureau for Chainsaw Man and Shinigami Margins for Death Note. No logos, character art, screenshots or dialogue from any show are included.

Choom Circuit is the default. It carries forward the Cyberpunk theme from earlier versions.

The twelve classics are Editing Suite, Dracula, Nord, Catppuccin Mocha, Gruvbox, Tokyo Night, Rosé Pine, One Dark and Solarized Dark, plus the light Catppuccin Latte, Rosé Pine Dawn and Solarized Light.

A built-in theme sets more than colors. It restyles the page background, the header, panels, corners, buttons, fonts, code highlighting, diffs, selection, scrollbars, labels, the avatar frame and the contribution graph. Code keeps its monospace font.

Settings from version 1.1.0 carry over the first time the new version runs.

## Full or Calm

The popup switches between two appearances. Full, the default, draws each theme's backgrounds, effects and fonts, and adds a little flavor text in a few safe places, such as a tag on profiles, a caption on the 404 page and a footer sign-off. Calm keeps the colors and drops the rest. GitHub's own buttons, menus and navigation keep their words in both, and anything people wrote stays as they wrote it.

Separate switches turn off the extra text or the motion. If your system asks for reduced motion, nothing moves. Forced colors and GitHub's high contrast modes keep GitHub's native colors.

## Make your own theme

Settings, in the popup, opens the theme builder. It starts with three colors: background, text and accent. More options cover backgrounds and images, shapes and type, code colors, the graph and advanced CSS. The builder imports a theme from a `.reskin.json` file, pasted JSON or a share code that starts with `RS1.`, and exports the same three ways.

To make one with a chatbot, click Copy AI prompt, paste the prompt into ChatGPT, Gemini, Claude or Copilot, describe the theme you want, and import the answer. GitHub Reskin itself never contacts an AI service.

Advanced CSS in a theme you import starts off. It runs only after you review it and turn it on, only in Full, and never on GitHub's account, security, billing or sign-in pages.

## Privacy

The extension asks for one permission, `storage`, plus access to github.com and gist.github.com. It makes no network requests and has no analytics. Your settings and themes stay in your browser, and the userscript keeps them in your userscript manager's storage. See the [privacy policy](https://sidebandstudio.github.io/GitHub-Reskin/privacy/).

## Development

The toolchain is pinned to Node 24.22.2 and npm 11.12.1.

```sh
npm ci
npm test                 # unit tests
npm run build:stores     # dist/chrome, dist/firefox and the userscript
npm run build:site && npm run serve
```

`scripts/README.md` lists every check and browser test surface, and each package under `packages/` has its own README.

Themes live in `themes/anime` and `themes/classics` as `.reskin.json` files, listed in `themes/catalog.json`. `npm run check:themes`, `npm run check:schema` and `npm run check:contrast` check them.

GitHub's standard mode colors live in `vendor/primer`, a frozen snapshot. `node scripts/refresh-primer.mjs` fetches a newer one for review.

The userscript is generated from the same packages by `userscript/build.mjs`. `npm run build:userscript` writes it to `dist/userscript/`, and the site build publishes it on Pages at the address its `@updateURL` names. `userscript/github-reskin.user.js` is a frozen copy, version 1.1.2, that moves installs of the first userscripts (1.0.0 and 1.1.0) to that address, so leave it as it is. Userscript managers only install an update when its version goes up, so raise `version` in `release.config.json` when you change what users see.

## Contribution graph for your profile

The extension only changes what you see. To show your colors to everyone who visits your profile, add this workflow to your profile repo, the one named after you, like `you/you`. Save it as `.github/workflows/contributions.yml`:

```yaml
name: Contribution graph

on:
  schedule:
    - cron: "17 6 * * *"
  workflow_dispatch:

permissions:
  contents: write

jobs:
  update:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v5

      - uses: sidebandstudio/GitHub-Reskin@v1
        with:
          output: assets/contributions.svg
          color: "#f2a93b"

      - name: Commit if changed
        run: |
          git add assets/contributions.svg
          if git diff --cached --quiet; then exit 0; fi
          git config user.name "github-actions[bot]"
          git config user.email "41898282+github-actions[bot]@users.noreply.github.com"
          git commit -m "Refresh contribution graph [skip ci]"
          git pull --rebase
          git push
```

Run it once from the Actions tab, then put this in your README:

```html
<img src="assets/contributions.svg" alt="My GitHub contributions over the last year" width="100%">
```

The workflow redraws the graph once a day, starting around 06:17 UTC. GitHub can start scheduled runs late. It reads the same calendar GitHub uses, through the GraphQL API, so busy and quiet days shade the way they do on your profile. GitHub still shows its own graph under your README, since there's no setting to hide it.

| Input | Default | What it does |
| --- | --- | --- |
| `username` | owner of the repo | Whose graph to draw. Set this when the repo belongs to an organization. |
| `style` | `flat` | `flat` or `cyberpunk`. Needs `sidebandstudio/GitHub-Reskin@main`; `@v1` doesn't have it. |
| `color` | `#f2a93b` in flat | Color of the busiest days. Quieter days get fainter mixes of it. |
| `background` | `#0a0a0b` in flat | Panel color |
| `text` | `#ededea` in flat | Text color. Empty days and labels are mixed from it. |
| `output` | `contributions.svg` | Where the SVG goes |
| `token` | the workflow token | Token for the GraphQL API |

Colors are 6-digit hex, with or without the `#`. Quote them when you include the `#`, because YAML reads an unquoted `#` as the start of a comment. With the default workflow token, the graph shows what visitors see on your profile. That includes private contributions as plain counts if you turned on "Include private contributions on my profile" in your GitHub settings.

To draw it in neon instead, set `style`:

```yaml
      - uses: sidebandstudio/GitHub-Reskin@main
        with:
          output: assets/contributions.svg
          style: cyberpunk
```

The cyberpunk style draws a near-black panel with a faint grid, a cut-corner magenta edge and a monospace font. Days glow, and busier days glow more: they brighten through cyan, and the busiest are yellow. It defaults to `#0b0a17` for `background` and `#00f0ff` for `text`. Set `color`, `background` or `text` and it uses yours instead; with `color` set, days shade toward that one color, the same way the flat style does. A slow scanline passes over the panel, except for visitors whose system asks for reduced motion. Without the motion it's a still image like the flat graph.

To run it on your own computer, you need Node 20 or newer and a GitHub token. With the GitHub CLI:

```sh
GITHUB_TOKEN=$(gh auth token) node index.mjs --username you --color "#7c5cff" --output contributions.svg
GITHUB_TOKEN=$(gh auth token) node index.mjs --username you --style cyberpunk --output contributions.svg
```

## Credits

The classic palettes come from these MIT-licensed projects:

- [Dracula](https://draculatheme.com)
- [Nord](https://www.nordtheme.com)
- [Catppuccin](https://catppuccin.com)
- [Gruvbox](https://github.com/morhetz/gruvbox)
- [Tokyo Night](https://github.com/enkia/tokyo-night-vscode-theme)
- [Rosé Pine](https://rosepinetheme.com)
- [One Dark](https://github.com/atom/atom/tree/master/packages/one-dark-syntax)
- [Solarized](https://ethanschoonover.com/solarized/)

Editing Suite is the amber and near-black from [Ali Tleis's profile](https://github.com/Alitleis123).

The bundled fonts in `assets/fonts` use the SIL Open Font License 1.1.

GitHub Reskin is an independent project by Sideband Studio. It isn't affiliated with or endorsed by GitHub or by anyone behind the shows its themes credit. Show titles only name each theme's inspiration, and every trademark belongs to its owner.

## License

MIT
