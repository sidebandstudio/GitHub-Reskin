# GitHub Reskin

A browser extension that themes GitHub. Click it, pick a theme or set your own colors, and every open GitHub tab repaints. That includes the contribution graph, which normally stays green or switches to whatever GitHub picks for a holiday.

The repo also has a GitHub Action that draws your contribution graph as an SVG in your colors, so visitors to your profile see them too.

## Install

The extension isn't in the Chrome Web Store or on Firefox Add-ons yet. To load it from this repo:

1. On the repo page, click Code, then Download ZIP, and unzip it.
2. Chrome, Edge, Brave or Arc: open `chrome://extensions`, turn on Developer mode, click Load unpacked and pick the `extension` folder.
3. Firefox 140 or newer: open `about:debugging#/runtime/this-firefox`, click Load Temporary Add-on and pick `extension/manifest.json`. Firefox drops temporary add-ons when it restarts.

Reload any GitHub or Gist tabs you already had open, then click GitHub Reskin in your browser's extensions menu to pick a theme.

## Themes and colors

Thirteen themes come with it. Cyberpunk is the default. The other dark ones are Editing Suite, Dracula, Nord, Catppuccin Mocha, Gruvbox, Tokyo Night, Rosé Pine, One Dark and Solarized Dark. The light ones are Catppuccin Latte, Rosé Pine Dawn and Solarized Light.

Cyberpunk is electric yellow and cyan on a near-black blue-violet, and it changes more than colors:

- Headings, the header, tabs, buttons, counters and labels use condensed and monospace system fonts. Font sizes and spacing stay as GitHub has them.
- Headings, the selected tab, primary buttons, focus rings, hovered links and contribution graph cells glow. Busier days glow more. Code, diffs and body text don't.
- Buttons, labels, boxes and menus get beveled corners instead of round ones. Browsers without `corner-shape` support cut the corners of labels and counters with a clip path and keep the rest rounded.
- A faint grid and scanlines sit behind the page, and the header has a neon edge. Scrollbars, selected text and the text cursor use the accent.
- The GitHub logo and the repo title glitch when you hover them. If your system is set to reduce motion, nothing moves.
- The popup takes on the same look.

The effects use whatever colors you set, so editing Cyberpunk's colors keeps the effects in your colors.

Under the themes you can change four colors: background, text, accent and the contribution graph. GitHub Reskin works out the rest, like borders, muted text and button colors. "Reset to theme" puts the theme's colors back, and the switch at the top turns the theme off.

It adjusts the colors it works out so they stay readable:

- Muted text and links move toward your text color until they reach WCAG AA contrast, 4.5:1.
- Primary buttons get a darker shade of your accent when GitHub's white button text wouldn't read on the accent itself.
- If your text color is hard to read on your background, the popup warns you. GitHub's main text still uses your color, but borders, muted text and links are then worked out from black or white instead.

## How it works

The extension recolors github.com and gist.github.com through the color variables GitHub's own CSS uses. A dark theme also brings in GitHub's standard dark colors for code, diffs and labels, and a light theme brings the light ones. These replace whatever palette your GitHub account uses, including dimmed, high contrast, colorblind and tritanopia, so code stays readable under any theme. If you use a colorblind palette, diffs go back to GitHub's standard red and green while a theme is on.

Cyberpunk's effects come out of the same generated CSS, using only system fonts and CSS gradients. Your settings stay in the browser, and the extension makes no network requests. It also caches the generated CSS in github.com's local storage, so a full page load doesn't flash GitHub's own colors first.

## Add a theme

Themes live in [`extension/themes.js`](extension/themes.js). A theme needs an `id`, a `name` and four colors: `bg`, `text`, `accent` and `graph`. You can also give `surface`, `border` and `muted` if the original palette has them, and `effects: "cyberpunk"` to add Cyberpunk's effects. Run `node --test` to check that every theme keeps its text, links and button text readable, and that themes without effects produce the same CSS as before.

GitHub's standard light and dark colors live in `extension/github-modes.js`, which is generated. If GitHub changes its colors, `node scripts/github-modes.mjs` rebuilds that file from github.com's current CSS.

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

      - uses: Alitleis123/GitHub-Reskin@v1
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
| `style` | `flat` | `flat` or `cyberpunk` |
| `color` | `#f2a93b` in flat | Color of the busiest days. Quieter days get fainter mixes of it. |
| `background` | `#0a0a0b` in flat | Panel color |
| `text` | `#ededea` in flat | Text color. Empty days and labels are mixed from it. |
| `output` | `contributions.svg` | Where the SVG goes |
| `token` | the workflow token | Token for the GraphQL API |

Colors are 6-digit hex, with or without the `#`. Quote them when you include the `#`, because YAML reads an unquoted `#` as the start of a comment. With the default workflow token, the graph shows what visitors see on your profile. That includes private contributions as plain counts if you turned on "Include private contributions on my profile" in your GitHub settings.

To draw it in neon instead, set `style`:

```yaml
      - uses: whoisaldo/GitHub-Reskin@main
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

## Theme credits

The theme palettes come from these MIT-licensed projects:

- [Dracula](https://draculatheme.com)
- [Nord](https://www.nordtheme.com)
- [Catppuccin](https://catppuccin.com)
- [Gruvbox](https://github.com/morhetz/gruvbox)
- [Tokyo Night](https://github.com/enkia/tokyo-night-vscode-theme)
- [Rosé Pine](https://rosepinetheme.com)
- [One Dark](https://github.com/atom/atom/tree/master/packages/one-dark-syntax)
- [Solarized](https://ethanschoonover.com/solarized/)

Editing Suite is the amber and near-black from [my profile](https://github.com/Alitleis123).

## License

MIT
