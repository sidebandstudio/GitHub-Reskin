// mountColors(doc, host, {catalog}): 1.0's color card. The selected theme's four colors, each a
// native color input beside its hex field. A change saves the theme with that color: a bundled
// theme becomes a saved copy based on it, "<name> (edited)", and is selected; a saved theme is
// changed in place. Reset to theme selects the bundled theme a saved one came from. The page
// supplies data-rc="rows", "reset" and "note"; without rows nothing is mounted.
import { LOCAL_THEME_ID_PREFIX } from "../contracts/index.js";
import { basePolarityIssue } from "../engine/index.js";
import { selectedSource } from "../settings/index.js";

export const COLOR_FIELDS = Object.freeze([
  { key: "background", label: "Background" },
  { key: "text", label: "Text" },
  { key: "accent", label: "Accent" },
  { key: "contribution", label: "Contribution graph" },
]);

export const COPY = Object.freeze({
  pick: "Pick a theme to edit its colors.",
  saved: "Saved.",
  failed: "We couldn't save that color. Try again.",
  invalid: "Use a 6-digit hex color, like #f2a93b.",
  edited: (name) => `${name} (edited)`,
});

const HEX = /^#?([0-9a-f]{6})$/i;

/** A 6-digit hex color as #rrggbb, or null. */
export function parseHex(value) {
  const match = HEX.exec(String(value).trim());
  return match ? `#${match[1].toLowerCase()}` : null;
}

/** The card's four colors for a theme document; the graph follows the accent unless set. */
export function colorsOf(document) {
  const { background, text, accent, contribution } = document.colors;
  return { background, text, accent, contribution: contribution ?? accent };
}

/**
 * The theme with one color changed, renamed "<name> (edited)" when it is a new copy. A background
 * that no longer suits the base switches the base, as 1.0 took dark or light from the background.
 */
export function editedDocument(document, key, value, { copy }) {
  const next = structuredClone(document);
  next.colors = { ...next.colors, [key]: value };
  if (copy) next.name = COPY.edited(document.name);
  if (basePolarityIssue(next)) next.base = next.base === "dark" ? "light" : "dark";
  return next;
}

/** The commit for a changed color of the selected theme, or null when no theme is selected. */
export function colorAction(settings, catalog, key, value) {
  const source = selectedSource(settings, catalog);
  if (!source) return null;
  const id = settings.selectedThemeId;
  if (!id.startsWith(LOCAL_THEME_ID_PREFIX)) return { type: "saveCustom", document: editedDocument(source, key, value, { copy: true }), basedOn: id, select: true };
  const saved = settings.customThemes.find((theme) => theme.id === id);
  const action = { type: "saveCustom", id, document: editedDocument(source, key, value, { copy: false }), select: true };
  if (saved?.basedOn) action.basedOn = saved.basedOn;
  return action;
}

/** The bundled theme Reset to theme returns to, or null. */
export function resetTarget(settings, catalog) {
  const id = settings?.selectedThemeId;
  if (typeof id !== "string" || !id.startsWith(LOCAL_THEME_ID_PREFIX)) return null;
  const basedOn = settings.customThemes.find((theme) => theme.id === id)?.basedOn;
  return basedOn && catalog.has(basedOn) ? basedOn : null;
}

export function mountColors(doc, host, { catalog }) {
  const rows = doc.querySelector('[data-rc="rows"]');
  if (!rows) return null;
  const reset = doc.querySelector('[data-rc="reset"]');
  const note = doc.querySelector('[data-rc="note"]');
  const say = (text) => note && (note.textContent = text);
  let settings = null;
  let busy = Promise.resolve();
  let destroyed = false;
  const inputs = new Map();

  for (const { key, label } of COLOR_FIELDS) {
    const row = doc.createElement("div");
    row.className = "rs-color";
    const name = doc.createElement("label");
    name.htmlFor = `rc-${key}`;
    name.textContent = label;
    const swatch = doc.createElement("input");
    swatch.type = "color";
    swatch.id = `rc-${key}`;
    const hex = doc.createElement("input");
    hex.type = "text";
    hex.className = "rs-hex";
    hex.spellcheck = false;
    hex.autocomplete = "off";
    hex.maxLength = 7;
    hex.setAttribute("aria-label", `${label} hex`);
    row.append(name, swatch, hex);
    rows.append(row);
    inputs.set(key, { swatch, hex });
    swatch.addEventListener("input", () => {
      hex.value = swatch.value;
      hex.removeAttribute("aria-invalid");
    });
    swatch.addEventListener("change", () => save(key, swatch.value));
    hex.addEventListener("change", () => {
      const value = parseHex(hex.value);
      if (!value) {
        hex.setAttribute("aria-invalid", "true");
        return say(COPY.invalid);
      }
      hex.removeAttribute("aria-invalid");
      swatch.value = value;
      save(key, value);
    });
  }

  function render() {
    const source = settings ? selectedSource(settings, catalog) : null;
    const colors = source ? colorsOf(source) : null;
    for (const [key, { swatch, hex }] of inputs) {
      swatch.disabled = hex.disabled = !colors;
      if (!colors) continue;
      swatch.value = colors[key];
      if (doc.activeElement !== hex) hex.value = colors[key];
    }
    if (reset) reset.disabled = !resetTarget(settings, catalog);
    if (!colors && note) note.textContent = COPY.pick;
  }

  async function refresh() {
    const read = await host.read();
    if (destroyed || !read.ok) return;
    settings = read.settings;
    if (note?.textContent === COPY.pick) note.textContent = "";
    render();
  }

  // One save at a time, each on the newest settings.
  function commit(makeAction) {
    busy = busy.then(async () => {
      const read = await host.read();
      if (destroyed || !read.ok) return say(COPY.failed);
      const action = makeAction(read.settings);
      if (!action) return;
      const reply = await host.commit(action, read.settings.revision);
      if (destroyed) return;
      if (reply?.ok) settings = reply.settings;
      say(reply?.ok ? COPY.saved : COPY.failed);
      render();
    });
    return busy;
  }
  const save = (key, value) => commit((current) => colorAction(current, catalog, key, value));
  reset?.addEventListener("click", () =>
    commit((current) => {
      const target = resetTarget(current, catalog);
      return target ? { type: "selectTheme", id: target } : null;
    }),
  );

  const stop = host.subscribe(() => void refresh());
  const ready = refresh();
  return {
    ready,
    destroy() {
      destroyed = true;
      stop();
    },
  };
}
