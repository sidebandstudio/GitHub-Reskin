// Reads GitHub's own mode attributes and media state for selectMode. Read-only: it never writes
// data-color-mode, data-light-theme, data-dark-theme or any GitHub preference.

const COLOR_MODES = ["light", "dark", "auto"];

/**
 * The root element's NativeMode, or null when GitHub has not set a recognizable color mode.
 * @param {Document} document
 * @param {{matchMedia:(q:string)=>{matches:boolean}}} view the window
 */
export function readNativeMode(document, view) {
  const root = document.documentElement;
  const colorMode = root.getAttribute("data-color-mode");
  if (!COLOR_MODES.includes(colorMode)) return null;
  return {
    colorMode,
    lightTheme: root.getAttribute("data-light-theme") ?? "",
    darkTheme: root.getAttribute("data-dark-theme") ?? "",
    systemDark: Boolean(view.matchMedia("(prefers-color-scheme: dark)").matches),
  };
}

export const forcedColorsActive = (view) => Boolean(view.matchMedia("(forced-colors: active)").matches);
export const reducedMotion = (view) => Boolean(view.matchMedia("(prefers-reduced-motion: reduce)").matches);

/** The root attributes a lifecycle observer watches to recompute the mode plan. */
export const MODE_ATTRIBUTES = Object.freeze(["data-color-mode", "data-light-theme", "data-dark-theme"]);
