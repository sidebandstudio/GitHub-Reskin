// A test double for C3's locateSlots, following the schema's locator rules on the adversarial page:
// scoped structural anchors, canonical English text as a guard inside that scope only, one
// unambiguous match, and no interactive descendants. Authored README, comment and issue text
// containing the same words must never match.
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
  add("profile.tag", one(main, ".h-card .vcard-names"), "before");
  add("profile.pinned.heading", one(main, ".js-pinned-items-reorder-container > h2", (h) => plain(h, ["Pinned", "Popular repositories"])), "after");
  add("profile.activity.heading", one(main, "#js-contribution-activity > h2", (h) => plain(h, ["Contribution activity"])), "after");
  add("profile.organizations.heading", one(main, ".h-card h2", (h) => plain(h, ["Organizations"])), "after");
  add("contributions.caption", one(main, ".js-calendar-graph", (g) => g.querySelector(".ContributionCalendar-day[data-level]")), "after");
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
