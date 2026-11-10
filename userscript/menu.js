// The manager's menu as the only way to change settings, for a userscript that is not isolated from
// GitHub's JavaScript (isolation.js). The menu belongs to the manager, outside the page, so a page
// script can neither draw over it nor call its commands. Entries, in order:
//   Open GitHub Reskin          the panel, which then only shows the theme and why it has no controls
//   (after a failed change)     the same change again
//   Turn GitHub Reskin off/on
//   Use Calm/Full appearance
//   Turn extra theme text off/on
//   Turn motion off/on
//   one per theme, the anime title first ("Frieren: Beyond Journey's End · Longroad Petals"), the current one marked
// Each command commits through the host's apply(): its change on the settings as they are inside
// the cross-tab lock. A change that fails adds an entry after Open that tries it again. Labels follow
// the settings (this tab's changes and other tabs') when the manager can remove entries; one that
// cannot gets fixed labels whose switches flip whatever the settings are then.
import { cardLabels } from "../packages/ui/model.js";

export const MENU = Object.freeze({
  open: "Open GitHub Reskin",
  retry: "Last change was not saved. Try it again",
  enabled: (on) => (on ? "Turn GitHub Reskin off" : "Turn GitHub Reskin on"),
  appearance: (calm) => (calm ? "Use Full appearance" : "Use Calm appearance"),
  text: (on) => (on ? "Turn extra theme text off" : "Turn extra theme text on"),
  motion: (on) => (on ? "Turn motion off" : "Turn motion on"),
  fixed: Object.freeze({ enabled: "Turn GitHub Reskin on or off", appearance: "Switch between Full and Calm", text: "Turn extra theme text on or off", motion: "Turn motion on or off" }),
  theme: (card, selected) => {
    const { primary, secondary } = cardLabels(card);
    return `${selected ? "✓ " : ""}${primary} · ${secondary}`;
  },
});

/**
 * @param {object} options
 * @param {(name:string, run:()=>void)=>unknown} options.register the manager's register command
 * @param {((id:unknown)=>unknown)|null} options.unregister its remove command, if it has one
 * @param {{read:Function, apply:Function, subscribe:Function}} options.host
 * @param {object[]} options.cards the bundled themes' cards
 * @param {(theme:object)=>object|null} options.customCard a saved local theme's card
 * @param {()=>void} options.open opens the panel
 * @returns {{ready: Promise<void>, destroy(): void}}
 */
export function createMenu({ register, unregister, host, cards, customCard, open }) {
  const dynamic = typeof unregister === "function";
  let ids = [];
  let failed = null;
  let settings = null;
  let chain = Promise.resolve();
  let built = false;

  function entries() {
    const list = [[MENU.open, null]];
    if (failed) list.push([MENU.retry, failed]);
    if (dynamic && settings) {
      const prefs = settings.preferences;
      list.push([MENU.enabled(settings.enabled), { type: "setEnabled", enabled: !settings.enabled }]);
      list.push([MENU.appearance(prefs.appearance === "calm"), { type: "setPreference", key: "appearance", value: prefs.appearance === "calm" ? "full" : "calm" }]);
      list.push([MENU.text(prefs.text), { type: "setPreference", key: "text", value: !prefs.text }]);
      list.push([MENU.motion(prefs.motion), { type: "setPreference", key: "motion", value: !prefs.motion }]);
    } else {
      list.push([MENU.fixed.enabled, (now) => ({ type: "setEnabled", enabled: !now.enabled })]);
      list.push([MENU.fixed.appearance, (now) => ({ type: "setPreference", key: "appearance", value: now.preferences.appearance === "calm" ? "full" : "calm" })]);
      list.push([MENU.fixed.text, (now) => ({ type: "setPreference", key: "text", value: !now.preferences.text })]);
      list.push([MENU.fixed.motion, (now) => ({ type: "setPreference", key: "motion", value: !now.preferences.motion })]);
    }
    const custom = (settings?.customThemes ?? []).map((theme) => customCard(theme)).filter(Boolean);
    for (const card of [...cards, ...custom]) list.push([MENU.theme(card, dynamic && settings?.selectedThemeId === card.id), { type: "selectTheme", id: card.id }]);
    return list;
  }

  async function run(change) {
    const reply = await host.apply(change);
    failed = reply?.ok ? null : change;
    if (reply?.ok) settings = reply.settings;
    rebuild();
  }

  // Removes every entry and adds the current ones, one rebuild at a time, so their order holds.
  function rebuild() {
    chain = chain.then(async () => {
      if (built && !dynamic) return;
      for (const id of ids.splice(0)) {
        try {
          await unregister(await id);
        } catch {
          // Already gone.
        }
      }
      for (const [name, change] of entries()) {
        try {
          ids.push(register(name, () => (change ? void run(change) : open())));
        } catch {
          // A manager that refuses one entry keeps the others.
        }
      }
      built = true;
    });
    return chain;
  }

  async function refresh() {
    const read = await host.read();
    if (read.ok) settings = read.settings;
    return rebuild();
  }

  const stop = host.subscribe(() => void refresh());
  return {
    ready: refresh(),
    destroy() {
      stop?.();
    },
  };
}
