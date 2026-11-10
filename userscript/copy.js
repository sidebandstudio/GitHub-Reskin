// What the userscript says in its own words, beside the extension's shared copy: the storage and
// capability notes on the card and the builder, and the Advanced CSS notes build.mjs puts where
// the settings page offers Enable advanced CSS. Plain data, so tests read it too.
const NO_CSS = "Advanced CSS in your own themes stays off in the userscript.";
export const COPY = Object.freeze({
  durable: `Saved by your userscript manager. Export a theme file to keep a copy or move it to the extension. ${NO_CSS}`,
  session: `This userscript manager can't save themes here. You can preview and export a file. ${NO_CSS}`,
  builderSession: "This userscript manager can't keep themes. What you save here lasts until this tab closes, so download the theme file to keep it.",
  menuOnly: `Your userscript manager runs this script inside GitHub's page, where GitHub's code could reach saved settings, so nothing is saved here. Changes from the manager's menu last until you reload. Saving, making and importing themes needs the extension or a manager that keeps scripts apart from the page. ${NO_CSS}`,
  noControls: `Your userscript manager runs this script inside GitHub's page and has no menu, so settings can't be changed or saved and themes can't be made or imported here. Use the extension or a manager that keeps scripts apart from the page. ${NO_CSS}`,
  sessionLabel: "Session preview",
  exported: "Theme file saved to your downloads.",
  exportFailed: "The theme file could not be saved. Try again.",
});

export const CSS_NOTE = "Custom CSS needs the GitHub Reskin extension. A theme keeps its CSS here, and it stays off in the userscript.";
export const IMPORT_CSS_NOTE = "This theme carries advanced CSS. It imports with its CSS off: custom CSS needs the GitHub Reskin extension.";
