// A test double for C3's locateSlots, following the schema's locator rules on the adversarial page
// with the same hosts and insert modes C3 reports on github.com: the three profile headings and
// the tag append inside their native host, and the contribution caption follows the graph
// wrapper, ahead of the activity overview. Scoped structural anchors, canonical English text as
// a guard inside that scope only, one unambiguous match, and no interactive descendants.
// Authored README, comment and issue text containing the same words must never match.
const INTERACTIVE = "a,button,input,select,textarea,summary,[tabindex],[contenteditable],[role=button],[role=tab],[role=menuitem],[role=link]";
const plain = (node, words) => node && !node.querySelector(INTERACTIVE) && words.includes(node.textContent.trim().replace(/\s+/g, " "));

function one(doc, selector, test = () => true) {
  const found = [...doc.querySelectorAll(selector)].filter((node) => !node.closest(".markdown-body,.comment-body,.js-issue-title") && test(node));
  return found.length === 1 ? found[0] : null;
}

export function locateSlots(doc) {
  const main = one(doc, "main.application-main");
  if (!main) return [];
  const anchors = [];
  const add = (slot, host, insert) => host && anchors.push({ slot, host, insert, nativeSignature: `adversarial:${slot}` });
  add("profile.tag", one(main, ".h-card .vcard-names-container", (c) => c.querySelectorAll(":scope > h1.vcard-names").length === 1), "append");
  add("profile.pinned.heading", one(main, ".js-pinned-items-reorder-container > h2", (h) => plain(h, ["Pinned", "Popular repositories"])), "append");
  add("profile.activity.heading", one(main, "#js-contribution-activity > h2", (h) => plain(h, ["Contribution activity"])), "append");
  add("profile.organizations.heading", one(main, ".h-card h2", (h) => plain(h, ["Organizations"])), "append");
  add("contributions.caption", one(main, ".js-yearly-contributions .graph-before-activity-overview", (g) => g.querySelector(".js-calendar-graph .ContributionCalendar-day[data-level]")), "after");
  return anchors;
}

// Anchors a broken adapter might produce: authored content, controls and a duplicate slot.
export function hostileAnchors(doc) {
  const pick = (selector) => doc.querySelector(selector);
  return [
    { slot: "profile.pinned.heading", host: pick(".markdown-body h2"), insert: "after", nativeSignature: "hostile" },
    { slot: "profile.activity.heading", host: pick(".comment-body h3"), insert: "after", nativeSignature: "hostile" },
    { slot: "profile.tag", host: pick(".js-issue-title"), insert: "before", nativeSignature: "hostile" },
    { slot: "contributions.caption", host: pick("button.btn-follow"), insert: "after", nativeSignature: "hostile" },
    { slot: "profile.organizations.heading", host: pick(".markdown-body .vcard-names"), insert: "after", nativeSignature: "hostile" },
    { slot: "error.notFound.caption", host: pick("summary"), insert: "append", nativeSignature: "hostile" },
  ].filter((anchor) => anchor.host);
}
