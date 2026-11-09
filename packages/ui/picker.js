// mountPicker(doc, host, options): theme selection with instant commit and one-change Undo, the
// on/off switch, Full/Calm and the Text and Motion switches. The page's static HTML supplies the
// controls it wants, marked with data-rs="<part>"; the picker binds whichever exist, so the popup,
// first-run page and settings page share one behavior:
//   enabled (checkbox), summary-show, summary-name, summary-note, notices, groups, search,
//   count, gallery, empty, appearance (radio group), text, motion, fonts, effects (checkboxes),
//   motion-note, calm-note, status, error, undo, retry, quick (buttons with data-theme)
// Everything is native: buttons with aria-pressed, labeled inputs, one polite status region and an
// assertive region only for a failed submission. Text from documents enters through textContent.
import { COPY, GROUPS, cardLabels, countText, emptySearchText, failureText, noticeTexts, themeExists, undoTarget, visibleCards } from "./model.js";

const PREFERENCE_SWITCHES = ["text", "motion", "fonts", "effects"];
// A tiny contribution crop: levels per cell, 3 rows of 9 weeks.
const GRAPH_CROP = [0, 1, 0, 2, 1, 0, 3, 1, 0, 2, 0, 1, 3, 4, 2, 1, 0, 1, 0, 2, 4, 3, 1, 2, 0, 1, 2];

/**
 * @param {Document} doc
 * @param {object} host UiHost (host.js)
 * @param {object} options
 * @param {object[]} options.cards bundled theme cards (reskin:cards)
 * @param {object} options.catalog CatalogSource, to check that an Undo target still exists
 * @param {(entry:{id, group, document})=>object} [options.cardFor] card for a saved theme
 * @param {(state:object)=>void} [options.onChange] called after each render with the settings
 * @returns {{ready:Promise<void>, destroy():void, state():object}}
 */
export function mountPicker(doc, host, { cards, catalog, cardFor = null, onChange = () => {} }) {
  const part = (name) => doc.querySelector(`[data-rs="${name}"]`);
  const parts = Object.fromEntries(
    ["enabled", "summary-show", "summary-name", "summary-note", "notices", "groups", "search", "count", "gallery", "empty", "status", "error", "undo", "retry", "motion-note", "calm-note", "quick", "appearance", ...PREFERENCE_SWITCHES].map((name) => [name, part(name)]),
  );
  const cleanups = [];
  const listen = (target, type, handler) => {
    if (!target) return;
    target.addEventListener(type, handler);
    cleanups.push(() => target.removeEventListener(type, handler));
  };

  let state = { settings: null, lastGood: null, ui: {} };
  let group = null;
  let query = "";
  let pendingTheme = null;
  let busy = Promise.resolve();
  let generation = 0;
  let retry = null;
  let customCards = [];
  let customKey = "";
  let destroyed = false;

  const allCards = () => [...cards, ...customCards];
  const cardById = (id) => allCards().find((card) => card.id === id) ?? null;

  function say(text) {
    if (parts.status) parts.status.textContent = text;
  }
  function fail(text, again) {
    retry = again;
    if (parts.error) {
      parts.error.hidden = false;
      parts.error.querySelector("[data-rs-text]").textContent = text;
    }
    if (parts.retry) parts.retry.hidden = !again;
  }
  function clearError() {
    retry = null;
    if (parts.error) parts.error.hidden = true;
  }

  // Saved local themes become cards when the list changes.
  function refreshCustomCards() {
    const custom = state.settings?.customThemes ?? [];
    const key = custom.map((theme) => theme.id).join(",");
    if (key === customKey || !cardFor) return;
    customKey = key;
    customCards = custom.flatMap((theme) => {
      try {
        return [{ ...cardFor({ id: theme.id, group: "mine", document: theme.document }), group: "mine" }];
      } catch {
        return [];
      }
    });
  }

  async function refresh() {
    const mine = ++generation;
    const result = await host.read();
    if (destroyed || mine !== generation) return;
    if (!result.ok) {
      if (result.settings) state = { ...state, settings: result.settings };
      fail(COPY.readFailed, refresh);
      render();
      return;
    }
    state = { settings: result.settings, lastGood: result.lastGood, ui: result.ui };
    group ??= result.ui.group ?? "anime";
    refreshCustomCards();
    render();
  }

  // One commit at a time, in click order. Each reads the newest committed revision.
  function commit(action, { optimisticTheme = null, success, again } = {}) {
    busy = busy.then(async () => {
      if (destroyed || !state.settings) return;
      clearError();
      if (optimisticTheme) {
        pendingTheme = optimisticTheme;
        render();
      }
      say(COPY.saving);
      let reply = await host.commit(action, state.settings.revision);
      // A preference change is disjoint from anything another window chose, so it is applied
      // again on the current settings. A theme choice is never replayed over a newer one.
      if (!reply.ok && reply.code === "conflict" && action.type !== "selectTheme" && reply.current) {
        state = { ...state, settings: reply.current };
        reply = await host.commit(action, reply.current.revision);
      }
      pendingTheme = null;
      if (destroyed) return;
      if (reply.ok) {
        state = { ...state, settings: reply.settings };
        await success?.(reply);
        await refresh();
        return;
      }
      if (reply.current) state = { ...state, settings: reply.current };
      say("");
      fail(failureText(reply), reply.code === "conflict" ? null : again);
      render();
    });
    return busy;
  }

  function selectTheme(id) {
    if (!state.settings || (id === state.settings.selectedThemeId && !pendingTheme)) return;
    const enabled = state.settings.enabled;
    commit({ type: "selectTheme", id }, {
      optimisticTheme: id,
      again: () => selectTheme(id),
      success: () => say(enabled ? COPY.applied : COPY.savedWhileOff),
    });
  }

  function undo() {
    const target = undoTarget(state, catalog);
    if (!target) return;
    // The lastGood this Undo creates records the selection it replaces at the current revision.
    const revision = state.settings.revision;
    commit({ type: "selectTheme", id: target }, {
      optimisticTheme: target,
      again: undo,
      success: async () => {
        await host.writeUi({ undoneAt: revision }).catch(() => {});
        say(COPY.undone);
      },
    });
  }

  function setPreference(key, value) {
    commit({ type: "setPreference", key, value }, { again: () => setPreference(key, value), success: () => say(COPY.preferenceSaved) });
  }

  function setEnabled(enabled) {
    commit({ type: "setEnabled", enabled }, { again: () => setEnabled(enabled), success: () => say(enabled ? COPY.turnedOn : COPY.turnedOff) });
  }

  // Rendering --------------------------------------------------------------------------------

  const el = (tag, className, text) => {
    const node = doc.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  };

  function miniature(card) {
    const mini = el("span", "rs-mini");
    mini.setAttribute("aria-hidden", "true");
    const m = card.mini;
    for (const [name, value] of Object.entries({ canvas: m.canvas, surface: m.surface, border: m.border, text: m.text, muted: m.muted, link: m.link, button: m.button, header: m.header, "header-text": m.headerText })) {
      mini.style.setProperty(`--mini-${name}`, value);
    }
    mini.append(el("span", "rs-mini-head"));
    const body = el("span", "rs-mini-body");
    const repo = el("span", "rs-mini-repo");
    repo.append(el("span", "rs-mini-line rs-mini-link"), el("span", "rs-mini-line rs-mini-muted"), el("span", "rs-mini-button"));
    const graph = el("span", "rs-mini-graph");
    for (const level of GRAPH_CROP) {
      const cell = el("span", "rs-mini-cell");
      cell.style.backgroundColor = m.graph[level];
      graph.append(cell);
    }
    body.append(repo, graph);
    mini.append(body);
    return mini;
  }

  function cardButton(card, selectedId) {
    const button = el("button", "rs-card");
    button.type = "button";
    button.dataset.theme = card.id;
    const pressed = card.id === selectedId;
    button.setAttribute("aria-pressed", String(pressed));
    const labels = cardLabels(card);
    const text = el("span", "rs-card-text");
    text.append(el("span", "rs-card-primary", labels.primary), el("span", "rs-card-secondary", labels.secondary));
    const check = el("span", "rs-card-check");
    const mark = el("span", "rs-card-mark", "✓");
    mark.setAttribute("aria-hidden", "true");
    check.append(mark, "Selected");
    check.hidden = !pressed;
    button.append(miniature(card), text, check);
    return button;
  }

  function renderGroups() {
    if (!parts.groups) return;
    const counts = { anime: cards.filter((c) => c.group === "anime").length, classics: cards.filter((c) => c.group === "classics").length, mine: customCards.length };
    if (!parts.groups.childElementCount) {
      for (const { id, label } of GROUPS) {
        const button = el("button", "rs-group");
        button.type = "button";
        button.dataset.group = id;
        button.append(el("span", "rs-group-label", label), el("span", "rs-group-count"));
        parts.groups.append(button);
      }
    }
    for (const button of parts.groups.querySelectorAll("button[data-group]")) {
      button.setAttribute("aria-pressed", String(!query.trim() && button.dataset.group === group));
      button.querySelector(".rs-group-count").textContent = String(counts[button.dataset.group]);
    }
  }

  function renderGallery(selectedId) {
    if (!parts.gallery) return;
    const shown = visibleCards({ group, query, cards, customCards });
    const focused = doc.activeElement?.closest?.(".rs-card")?.dataset.theme;
    const list = el("ul", "rs-cards");
    for (const card of shown) {
      const item = el("li");
      item.append(cardButton(card, selectedId));
      list.append(item);
    }
    parts.gallery.replaceChildren(list);
    if (focused) parts.gallery.querySelector(`[data-theme="${CSS.escape(focused)}"]`)?.focus();
    if (parts.count) parts.count.textContent = countText(shown.length, query);
    if (parts.empty) {
      parts.empty.hidden = shown.length > 0;
      const text = parts.empty.querySelector("[data-rs-text]");
      if (text) text.textContent = query.trim() ? emptySearchText(query) : group === "mine" ? COPY.noCustom : "";
      const clear = parts.empty.querySelector("[data-rs-clear]");
      if (clear) clear.hidden = !query.trim();
    }
  }

  function render() {
    const { settings } = state;
    renderGroups();
    if (!settings) return;
    const selectedId = pendingTheme ?? settings.selectedThemeId;
    const selected = cardById(selectedId);
    const labels = selected ? cardLabels(selected) : { primary: "", secondary: "" };
    if (parts["summary-show"]) parts["summary-show"].textContent = labels.primary;
    if (parts["summary-name"]) parts["summary-name"].textContent = labels.secondary;
    if (parts["summary-note"]) parts["summary-note"].textContent = settings.enabled ? COPY.where : COPY.off;
    doc.documentElement.dataset.rsEnabled = String(settings.enabled);
    if (parts.enabled) parts.enabled.checked = settings.enabled;
    const prefs = settings.preferences;
    for (const input of parts.appearance?.querySelectorAll("input[type=radio]") ?? []) input.checked = input.value === prefs.appearance;
    for (const key of PREFERENCE_SWITCHES) if (parts[key]) parts[key].checked = prefs[key];
    const reduced = host.reducedMotion();
    if (parts["motion-note"]) parts["motion-note"].hidden = !reduced;
    if (parts["calm-note"]) parts["calm-note"].hidden = prefs.appearance !== "calm";
    if (parts.notices) {
      const texts = noticeTexts(settings);
      parts.notices.hidden = !texts.length;
      const list = parts.notices.querySelector("[data-rs-list]");
      if (list) list.replaceChildren(...texts.map((text) => el("li", "", text)));
    }
    for (const button of parts.quick?.querySelectorAll("button[data-theme]") ?? []) {
      button.setAttribute("aria-pressed", String(button.dataset.theme === selectedId));
    }
    if (parts.undo) parts.undo.hidden = !undoTarget(state, catalog) || Boolean(pendingTheme);
    renderGallery(selectedId);
    onChange({ settings, selectedId, pending: Boolean(pendingTheme) });
  }

  // Events -----------------------------------------------------------------------------------

  listen(parts.gallery, "click", (event) => {
    const button = event.target.closest?.("button[data-theme]");
    if (button) selectTheme(button.dataset.theme);
  });
  listen(parts.quick, "click", (event) => {
    const button = event.target.closest?.("button[data-theme]");
    if (button && themeExists(button.dataset.theme, state.settings ?? { customThemes: [] }, catalog)) selectTheme(button.dataset.theme);
  });
  listen(parts.groups, "click", (event) => {
    const button = event.target.closest?.("button[data-group]");
    if (!button) return;
    group = button.dataset.group;
    query = "";
    if (parts.search) parts.search.value = "";
    host.writeUi({ group }).catch(() => {});
    render();
  });
  listen(parts.search, "input", () => {
    query = parts.search.value;
    render();
  });
  listen(parts.empty?.querySelector("[data-rs-clear]"), "click", () => {
    query = "";
    if (parts.search) {
      parts.search.value = "";
      parts.search.focus();
    }
    render();
  });
  listen(parts.enabled, "change", () => setEnabled(parts.enabled.checked));
  listen(parts.appearance, "change", (event) => {
    if (event.target.name === "appearance") setPreference("appearance", event.target.value);
  });
  for (const key of PREFERENCE_SWITCHES) listen(parts[key], "change", () => setPreference(key, parts[key].checked));
  listen(parts.undo, "click", undo);
  listen(parts.retry, "click", () => retry?.());
  listen(parts.notices?.querySelector("[data-rs-dismiss]"), "click", () => commit({ type: "dismissMigration" }, { success: () => say("Notice dismissed.") }));
  cleanups.push(host.subscribe(() => refresh()));

  const ready = refresh();
  return {
    ready,
    state: () => ({ ...state, group, query, pendingTheme }),
    destroy() {
      destroyed = true;
      for (const cleanup of cleanups.splice(0)) cleanup();
    },
  };
}
