// Pure picker state: groups, the Undo target and the words the picker shows. No DOM or storage.
import { LOCAL_THEME_ID_PREFIX } from "../contracts/index.js";
import { MIGRATION_NOTICE_TEXT } from "../settings/constants.js";
import { searchCards } from "./catalog.js";

export const GROUPS = Object.freeze([
  { id: "anime", label: "Anime" },
  { id: "classics", label: "Classics" },
  { id: "mine", label: "My themes" },
]);

export const COPY = Object.freeze({
  applied: "Applied to GitHub.",
  savedWhileOff: "Saved. Reskin is off, so GitHub stays as it is until you turn it on.",
  off: "Off. Your next theme is ready when you turn Reskin on.",
  where: "Your theme will appear on GitHub and Gist.",
  saving: "Saving…",
  undone: "Theme change undone.",
  turnedOn: "Reskin is on.",
  turnedOff: "Reskin is off. GitHub shows its own colors.",
  preferenceSaved: "Saved.",
  conflict: "Settings changed in another window, so your choice was not applied. Here is the current setup; choose again.",
  saveFailed: "We couldn't save that change. Your previous choice is still applied.",
  readFailed: "Reskin couldn't read its settings. Try again.",
  reducedMotion: "Paused by your device's reduced-motion setting",
  calmKeeps: "Calm keeps colors, graph and code colors, and hides wallpaper, flavor text, glow and motion. Your Text and Motion choices are kept.",
  noCustom: "Your saved themes will appear here.",
  reload: "Already had GitHub open? Reload that tab once to see your theme.",
});

/** The cards of a group, with saved local themes as "mine". */
export function groupCards(group, cards, customCards = []) {
  if (group === "mine") return customCards;
  return cards.filter((card) => card.group === group);
}

/** The cards a query shows: every group while searching, else the current group. */
export function visibleCards({ group, query, cards, customCards = [] }) {
  if (query && query.trim()) return searchCards([...cards, ...customCards], query);
  return groupCards(group, cards, customCards);
}

/** The visible result count, for the search status. */
export function countText(count, query) {
  const themes = `${count} ${count === 1 ? "theme" : "themes"}`;
  return query && query.trim() ? `${themes} found` : themes;
}

export const emptySearchText = (query) => `No themes match "${query.trim()}".`;

/** The labels of a card: the show first, its theme name beneath; a Classic leads with its name. */
export function cardLabels(card) {
  return card.show ? { primary: card.show, secondary: card.name } : { primary: card.name, secondary: card.group === "mine" ? "My theme" : "Classic" };
}

/** Whether a theme ID still exists: bundled, or one of the saved local themes. */
export function themeExists(id, settings, catalog) {
  if (typeof id !== "string") return false;
  if (id.startsWith(LOCAL_THEME_ID_PREFIX)) return settings.customThemes.some((theme) => theme.id === id);
  return catalog.has(id);
}

/**
 * The theme Undo would restore, or null. lastGood is C4's one prior committed selection; Undo
 * restores it once, and the ui record remembers which lastGood it used so the swapped-back
 * selection is not offered as another Undo.
 */
export function undoTarget({ settings, lastGood, ui }, catalog) {
  if (!settings || !lastGood || typeof lastGood.themeId !== "string") return null;
  if (lastGood.themeId === settings.selectedThemeId) return null;
  if (ui?.undoneAt === lastGood.revision) return null;
  return themeExists(lastGood.themeId, settings, catalog) ? lastGood.themeId : null;
}

/** The migration notices to show, in the reviewed English. */
export const noticeTexts = (settings) => (settings?.migration?.notices ?? []).map((code) => MIGRATION_NOTICE_TEXT[code]).filter(Boolean);

/** Message for a failed commit reply. */
export function failureText(reply) {
  if (reply?.code === "conflict") return COPY.conflict;
  const detail = reply?.issues?.find((issue) => issue?.message)?.message;
  return reply?.code === "storage" && detail && /full|exceed/i.test(detail) ? detail : COPY.saveFailed;
}
