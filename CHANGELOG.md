# Changelog

## 2.0.0, not released yet

A rebuild of the extension for a public release in the Chrome Web Store and on Firefox Add-ons.

- 13 anime themes, each with an original name that credits its show in plain text, next to the 12 classic editor themes. Choom Circuit carries forward the Cyberpunk theme and is the default.
- Built-in themes restyle the page background, header, panels, corners, buttons, fonts, code highlighting, diffs, selection, scrollbars, labels, the avatar frame and the contribution graph.
- Full and Calm appearances. Calm keeps a theme's colors and fonts and drops its background images and gradients, profile banner, glow and other effects, and added text.
- Flavor text appears only in a few safe places, such as a profile tag, the 404 caption and a footer sign-off. GitHub's own buttons, menus and navigation keep their words, where 1.1.0's Cyberpunk slang renamed some of them.
- GitHub's dimmed, colorblind and tritanopia modes get their own color mapping instead of being replaced by the standard palette. High contrast modes and forced colors stay native.
- A theme builder on the settings page. It starts with three colors and opens up backgrounds and images, shapes and type, code colors, the graph and advanced CSS. It imports and exports `.reskin.json` files, theme JSON and `RS1.` share codes, and Copy AI prompt writes a prompt for a chatbot.
- The userscript has the same builder when its manager runs it apart from GitHub's own scripts. Advanced CSS stays off in the userscript, and a theme imported there keeps its CSS switched off. When the manager runs it inside GitHub's page, only the manager's menu changes settings, until the page reloads.
- The userscript installs from the site and updates from there.
- Advanced CSS from an imported theme runs only after you approve that exact CSS, only in Full, and never on GitHub's account, security, billing or sign-in pages.
- 18 bundled font families under the SIL Open Font License.
- One offline, reproducible build makes the Chrome package, the Firefox 140+ package and the userscript from the same packages.
- Settings from 1.1.0 carry over the first time 2.0.0 runs.
- A showcase site at https://sidebandstudio.github.io/GitHub-Reskin/.

## 1.1.0

- Thirteen color themes, with Cyberpunk as the default. Cyberpunk added condensed fonts, glow, beveled corners, a grid and scanlines, and street slang for some of GitHub's labels.
- Four editable colors with readable contrast worked out for the rest.
- A userscript for Firefox, Safari and other browsers.
- The contribution graph GitHub Action gained a `cyberpunk` style.
