// The popup card. Saves to storage.local, and the content script repaints GitHub on change.
(function () {
  "use strict";
  const { THEMES, DEFAULTS, EDITABLE, palette, load, isHex } = globalThis.GitHubReskin;
  const LABELS = { bg: "Background", text: "Text", accent: "Accent", graph: "Contribution graph" };
  const $ = (id) => document.getElementById(id);
  const currentTheme = () => THEMES.find((t) => t.id === settings.theme) || THEMES[0];
  let settings = { ...DEFAULTS };

  // The theme is saved with every change. Colors edited in 1.0 have no saved theme, and load()
  // gives them Editing Suite without saving it.
  function save(patch) {
    settings = { ...settings, ...patch };
    render();
    chrome.storage.local.set({ theme: settings.theme, ...patch });
  }

  function setColor(key, value) {
    const p = palette(settings);
    const custom = Object.fromEntries(EDITABLE.map((k) => [k, p[k]]));
    // The theme is saved with the colors, so they stay on it if the default theme changes.
    save({ theme: currentTheme().id, custom: { ...custom, [key]: value.toLowerCase() } });
  }

  for (const theme of THEMES) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "theme";
    button.dataset.id = theme.id;
    const swatch = document.createElement("span");
    swatch.className = "swatch";
    swatch.style.background = theme.bg;
    const { shades } = palette({ theme: theme.id });
    // Two weeks of the theme's graph shades.
    for (const level of [0, 1, 3, 2, 4, 1, 0, 2, 4, 3, 1, 0, 3, 4]) {
      const day = document.createElement("i");
      day.style.background = shades[level];
      swatch.append(day);
    }
    const name = document.createElement("span");
    name.className = "name";
    name.textContent = theme.name;
    button.append(swatch, name);
    button.addEventListener("click", () => save({ theme: theme.id, custom: null }));
    $("themes").append(button);
  }

  for (const key of EDITABLE) {
    const row = document.createElement("label");
    row.className = "color";
    const label = document.createElement("span");
    label.textContent = LABELS[key];
    const picker = document.createElement("input");
    picker.type = "color";
    picker.setAttribute("aria-label", `${LABELS[key]} color`);
    const hex = document.createElement("input");
    hex.type = "text";
    hex.spellcheck = false;
    hex.maxLength = 7;
    hex.setAttribute("aria-label", `${LABELS[key]} hex value`);
    picker.dataset.key = hex.dataset.key = key;
    picker.addEventListener("input", () => setColor(key, picker.value));
    hex.addEventListener("input", () => {
      const value = "#" + hex.value.trim().replace(/^#/, "");
      const ok = isHex(value);
      hex.setAttribute("aria-invalid", String(!ok));
      if (ok) setColor(key, value);
    });
    row.append(label, picker, hex);
    $("colors").append(row);
  }

  $("enabled").addEventListener("change", (e) => save({ enabled: e.target.checked }));
  $("reset").addEventListener("click", () => save({ custom: null }));

  function render() {
    const p = palette(settings);
    const style = document.documentElement.style;
    for (const key of ["bg", "surface", "border", "muted", "strong", "graph"]) style.setProperty(`--${key}`, p[key]);
    style.setProperty("--accent", p.link);
    // The popup keeps readable text even while you try a text color that isn't.
    style.setProperty("--text", p.ink);
    $("warning").hidden = p.ink === p.text;
    style.colorScheme = p.dark ? "dark" : "light";
    // The popup takes on the theme's effects too, styled in popup.css.
    document.body.dataset.effects = p.effects || "";

    $("enabled").checked = settings.enabled;
    document.body.classList.toggle("off", !settings.enabled);
    for (const button of $("themes").children) {
      button.setAttribute("aria-pressed", String(button.dataset.id === currentTheme().id));
    }
    for (const input of $("colors").querySelectorAll("input")) {
      // Leave the field you're typing in alone.
      if (document.activeElement === input) continue;
      input.value = p[input.dataset.key];
      input.removeAttribute("aria-invalid");
    }
    $("reset").disabled = !settings.custom;
    const name = currentTheme().name;
    $("status").textContent = settings.enabled ? (settings.custom ? `${name}, edited` : name) : "Off";
  }

  // The card stays inert until settings load, so the load can't overwrite an early click.
  load(chrome.storage.local).then((stored) => {
    settings = stored;
    render();
    document.querySelector("main").inert = false;
  });
})();
