// The picker's pure state: search, groups, labels, the one-change Undo target and failure copy.
import assert from "node:assert/strict";
import test from "node:test";
import { catalogCards, readCatalogEntries } from "../../packages/ui/bundle.mjs";
import { searchCards } from "../../packages/ui/catalog.js";
import { cleanUi } from "../../packages/ui/host.js";
import { COPY, cardLabels, countText, emptySearchText, failureText, groupCards, noticeTexts, undoTarget, visibleCards } from "../../packages/ui/model.js";
import { ROOT } from "../../scripts/build.mjs";

const cards = catalogCards(await readCatalogEntries(ROOT));
const catalog = { has: (id) => cards.some((card) => card.id === id) };
const custom = [{ id: "local:00000000-0000-4000-8000-000000000001", group: "mine", name: "My Choom Circuit", show: null, mini: cards[0].mini }];
const settings = (patch = {}) => ({ revision: 5, selectedThemeId: "anime.frieren", customThemes: [{ id: custom[0].id, document: {} }], migration: { notices: [] }, ...patch });

test("groups hold thirteen anime, twelve Classics and the saved themes", () => {
  assert.equal(groupCards("anime", cards).length, 13);
  assert.equal(groupCards("classics", cards).length, 12);
  assert.deepEqual(groupCards("mine", cards, custom), custom);
  assert.equal(groupCards("anime", cards)[0].id, "anime.cyberpunk-edgerunners");
});

test("search matches the show or the theme name, ignores case and accents, and spans every group", () => {
  assert.deepEqual(searchCards(cards, "edgerunners").map((c) => c.id), ["anime.cyberpunk-edgerunners"]);
  assert.deepEqual(searchCards(cards, "CHOOM circuit").map((c) => c.id), ["anime.cyberpunk-edgerunners"]);
  assert.deepEqual(searchCards(cards, "frieren").map((c) => c.id), ["anime.frieren"]);
  assert.deepEqual(searchCards(cards, "rosé").map((c) => c.id).sort(), ["rose-pine", "rose-pine-dawn"]);
  assert.deepEqual(visibleCards({ group: "anime", query: "dracula", cards, customCards: custom }).map((c) => c.id), ["dracula"]);
  assert.deepEqual(visibleCards({ group: "classics", query: "my choom", cards, customCards: custom }), custom);
  assert.equal(visibleCards({ group: "classics", query: "  ", cards }).length, 12);
  assert.equal(countText(13, ""), "13 themes");
  assert.equal(countText(1, "nord"), "1 theme found");
  assert.equal(emptySearchText("  zzz "), 'No themes match "zzz".');
});

test("the anime title is the primary label; a Classic leads with its own name", () => {
  assert.deepEqual(cardLabels(cards[0]), { primary: "Cyberpunk: Edgerunners", secondary: "Choom Circuit" });
  assert.deepEqual(cardLabels(cards.find((c) => c.id === "nord")), { primary: "Nord", secondary: "Classic" });
  assert.deepEqual(cardLabels(custom[0]), { primary: "My Choom Circuit", secondary: "My theme" });
});

test("Undo offers the one prior selection once, and only while that theme exists", () => {
  const lastGood = { themeId: "anime.cyberpunk-edgerunners", sourceHash: "0".repeat(64), revision: 4 };
  assert.equal(undoTarget({ settings: settings(), lastGood, ui: {} }, catalog), "anime.cyberpunk-edgerunners");
  assert.equal(undoTarget({ settings: settings(), lastGood: null, ui: {} }, catalog), null);
  assert.equal(undoTarget({ settings: settings({ selectedThemeId: lastGood.themeId }), lastGood, ui: {} }, catalog), null);
  // After an Undo, the swapped-back selection is not offered again until a new choice.
  assert.equal(undoTarget({ settings: settings(), lastGood, ui: { undoneAt: 4 } }, catalog), null);
  assert.equal(undoTarget({ settings: settings(), lastGood: { ...lastGood, revision: 6 }, ui: { undoneAt: 4 } }, catalog), "anime.cyberpunk-edgerunners");
  // A deleted saved theme or an unknown ID cannot be restored.
  assert.equal(undoTarget({ settings: settings({ customThemes: [] }), lastGood: { ...lastGood, themeId: custom[0].id }, ui: {} }, catalog), null);
  assert.equal(undoTarget({ settings: settings(), lastGood: { ...lastGood, themeId: custom[0].id }, ui: {} }, catalog), custom[0].id);
  assert.equal(undoTarget({ settings: settings(), lastGood: { ...lastGood, themeId: "gone" }, ui: {} }, catalog), null);
});

test("the ui record keeps only the gallery group and the Undo marker", () => {
  assert.deepEqual(cleanUi({ group: "classics", undoneAt: 3, extra: 1 }), { group: "classics", undoneAt: 3 });
  assert.deepEqual(cleanUi({ group: "everything", undoneAt: "3" }), {});
  assert.deepEqual(cleanUi(null), {});
});

test("failures say what happened and keep the previous choice", () => {
  assert.equal(failureText({ ok: false, code: "conflict" }), COPY.conflict);
  assert.equal(failureText({ ok: false, code: "storage", issues: [{ message: "Storage failed: quota" }] }), COPY.saveFailed);
  assert.equal(failureText({ ok: false, code: "storage", issues: [{ message: "Your theme collection is full. Export or remove a saved theme, then try again." }] }), "Your theme collection is full. Export or remove a saved theme, then try again.");
  assert.equal(failureText(undefined), COPY.saveFailed);
  assert.deepEqual(noticeTexts(settings({ migration: { notices: ["cyberpunk-alias", "unknown-code"] } })), ["Cyberpunk is now Choom Circuit. Your colors are here. Find Cyberpunk: Edgerunners, Choom Circuit, in Anime."]);
});
