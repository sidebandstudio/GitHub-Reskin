// mountBackup(doc, options): the Backup & help view. Each saved theme with its own Export and
// Remove, the collection's capacity, the unsaved draft to resume, download or discard, Reset all,
// and short help for the common problems. Remove and Reset all ask through the browser's own
// confirmation, name what goes and suggest Export first; focus lands on the next sensible control.
// A separate settings-backup format is deferred: Export is per theme, the same .reskin.json file
// Make a theme writes.
import { STORAGE_LIMITS } from "../settings/constants.js";
import { customSourceBytes } from "../settings/model.js";
import { exportFile, kib } from "./importer.js";

export const COPY = Object.freeze({
  none: "Your saved themes will appear here.",
  capacity: (count, bytes) => `${count} of ${STORAGE_LIMITS.maxCustomThemes} saved themes, ${kib(bytes)} of ${kib(STORAGE_LIMITS.maxCustomSourceBytes)}.`,
  full: "Your theme collection is full. Export or remove a saved theme, then try again.",
  confirmRemove: (name, selected, fallback) =>
    `Remove "${name}" from Reskin in this browser? This can't be undone.${selected ? ` GitHub switches to ${fallback} first.` : ""}\n\nTo keep a copy, choose Cancel, then Export.`,
  removed: (name) => `Removed ${name}.`,
  confirmReset: (count) =>
    `Reset all of Reskin in this browser? This removes ${count === 1 ? "your saved theme" : `your ${count} saved themes`}, your unsaved draft and your Advanced CSS approvals, and turns every preference back to its default. This can't be undone.\n\nTo keep your themes, choose Cancel, then Export each one.`,
  reset: (name) => `Reskin is reset. ${name} is selected.`,
  failed: "We couldn't change your settings. Nothing was removed. Try again.",
  readFailed: "We couldn't read your settings. Try again.",
  conflict: "Your settings changed in another window. Check the list and try again.",
  noDraft: "There is no unsaved draft.",
  pending: (name) => `You have an unsaved draft: ${name}.`,
  dirty: (name) => `Make a theme has unsaved changes to ${name}.`,
  discarded: "Draft discarded.",
});

/**
 * @param {Document} doc
 * @param {object} options
 * @param {object} options.host UiHost (host.js)
 * @param {object} options.catalog CatalogSource of bundled themes
 * @param {(file:{filename,mime,bytes})=>void} options.download
 * @param {object} [options.builder] the mounted builder, for its draft
 * @param {(message:string)=>boolean} [options.confirm] the browser's confirm()
 */
export function mountBackup(doc, { host, catalog, download, builder = null, confirm = (message) => doc.defaultView.confirm(message) }) {
  const root = doc.querySelector('[data-rk="backup"]');
  if (!root) return null;
  const part = (name) => root.querySelector(`[data-rk="${name}"]`);
  let settings = null;
  let busy = false;

  const say = (text) => (part("status").textContent = text);
  function fail(text) {
    const box = part("error");
    box.hidden = !text;
    box.textContent = text ?? "";
  }

  function item(theme) {
    const document = theme.document;
    const selected = settings.selectedThemeId === theme.id;
    const name = document.name;
    const row = doc.createElement("li");
    row.className = "rk-theme";
    row.dataset.id = theme.id;
    const text = doc.createElement("p");
    text.className = "rk-theme-text";
    const show = doc.createElement("span");
    show.className = "rk-theme-show";
    show.textContent = document.inspiredBy ?? name;
    text.append(show);
    if (document.inspiredBy) {
      const own = doc.createElement("span");
      own.className = "rk-theme-name";
      own.textContent = name;
      text.append(own);
    }
    if (selected) {
      const badge = doc.createElement("span");
      badge.className = "rs-badge";
      badge.textContent = "Selected";
      text.append(badge);
    }
    const actions = doc.createElement("span");
    actions.className = "rs-actions";
    const exportButton = doc.createElement("button");
    Object.assign(exportButton, { type: "button", className: "rs-button", textContent: "Export" });
    exportButton.setAttribute("aria-label", `Export ${name}`);
    exportButton.dataset.export = theme.id;
    const remove = doc.createElement("button");
    Object.assign(remove, { type: "button", className: "rs-button", textContent: "Remove" });
    remove.setAttribute("aria-label", `Remove ${name}`);
    remove.dataset.remove = theme.id;
    actions.append(exportButton, remove);
    row.append(text, actions);
    return row;
  }

  function renderThemes() {
    const themes = settings?.customThemes ?? [];
    // A rebuilt list keeps focus on the same theme's button, when that theme is still there.
    const active = doc.activeElement;
    const kept = part("saved").contains(active) ? Object.entries(active.dataset).find(([key]) => key === "remove" || key === "export") : null;
    part("saved").replaceChildren(...themes.map(item));
    if (kept) part("saved").querySelector(`[data-${kept[0]}="${CSS.escape(kept[1])}"]`)?.focus();
    part("saved").hidden = !themes.length;
    part("empty").hidden = themes.length > 0;
    part("capacity").textContent = COPY.capacity(themes.length, customSourceBytes(themes));
    part("reset-all").disabled = !settings;
  }

  // The draft Make a theme kept from an earlier visit, or its unsaved changes on this page.
  function renderDraft() {
    const { pending, dirty, name } = builder?.draftStatus?.() ?? { pending: null, dirty: false, name: "" };
    part("draft-text").textContent = pending ? COPY.pending(pending.name) : dirty ? COPY.dirty(name) : COPY.noDraft;
    part("draft-actions").hidden = !pending && !dirty;
    part("draft-open").textContent = pending ? "Resume in Make a theme" : "Open Make a theme";
  }

  async function refresh() {
    await builder?.ready;
    const current = await host.read();
    settings = current.ok ? current.settings : null;
    if (!current.ok) fail(COPY.readFailed);
    renderThemes();
    renderDraft();
  }

  // One settings change, against the revision this view shows.
  async function commit(action) {
    if (busy || !settings) return null;
    busy = true;
    try {
      const reply = await host.commit(action, settings.revision);
      if (reply?.ok) {
        settings = reply.settings;
        fail(null);
        return reply;
      }
      if (reply?.code === "conflict") {
        if (reply.current) settings = reply.current;
        fail(COPY.conflict);
      } else fail(COPY.failed);
      renderThemes();
      return null;
    } finally {
      busy = false;
    }
  }

  async function removeTheme(id, button) {
    const theme = settings?.customThemes.find((t) => t.id === id);
    if (!theme) return;
    const selected = settings.selectedThemeId === id;
    const fallbackId = theme.basedOn && catalog.has(theme.basedOn) ? theme.basedOn : catalog.ids[0];
    if (!confirm(COPY.confirmRemove(theme.document.name, selected, catalog.document(fallbackId)?.name))) return button.focus();
    const rows = [...part("saved").children];
    const at = rows.findIndex((row) => row.dataset.id === id);
    const reply = await commit({ type: "deleteCustom", id });
    if (!reply) return button.focus();
    renderThemes();
    say(COPY.removed(theme.document.name));
    // Focus moves to the next theme's Remove, the one before it, or the list's heading.
    const next = part("saved").children[Math.min(at, part("saved").children.length - 1)];
    (next?.querySelector("[data-remove]") ?? part("saved-title")).focus();
  }

  async function resetAll() {
    const count = settings?.customThemes.length ?? 0;
    if (!confirm(COPY.confirmReset(count))) return part("reset-all").focus();
    const reply = await commit({ type: "resetAll" });
    if (reply) {
      renderThemes();
      await builder?.restart?.();
      renderDraft();
      say(COPY.reset(catalog.document(reply.settings.selectedThemeId)?.name ?? ""));
    }
    part("reset-all").focus();
  }

  root.addEventListener("click", (event) => {
    const button = event.target.closest("button");
    if (!button) return;
    if (button.dataset.export) {
      const theme = settings?.customThemes.find((t) => t.id === button.dataset.export);
      if (!theme) return;
      const file = exportFile(theme.document);
      download(file);
      say(`Downloaded ${file.filename}.`);
    } else if (button.dataset.remove) removeTheme(button.dataset.remove, button);
    else if (button === part("reset-all")) resetAll();
    else if (button === part("draft-open")) {
      builder?.resumeDraft?.();
      doc.defaultView.location.hash = "make";
    } else if (button === part("draft-download")) builder?.downloadDraft?.();
    else if (button === part("draft-discard")) {
      builder?.discardDraft?.();
      say(COPY.discarded);
      renderDraft();
      part("draft-title").focus();
    } else if (button === part("make")) doc.defaultView.location.hash = "make";
  });

  const unsubscribe = host.subscribe(() => refresh());
  const onHash = () => {
    if (doc.defaultView.location.hash === "#backup") refresh();
  };
  doc.defaultView.addEventListener("hashchange", onHash);
  const ready = refresh();
  return {
    ready,
    refresh,
    destroy() {
      unsubscribe();
      doc.defaultView.removeEventListener("hashchange", onHash);
    },
  };
}
