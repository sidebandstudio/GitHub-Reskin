// Safe flavor slot anchors. locateSlots reports where C5 may place an owned, aria-hidden node; it
// never inserts, replaces or rewrites anything itself. A slot yields an anchor only when its route
// matches, the page is English, exactly one candidate passes every guard and GitHub's own words
// are unchanged. Anything else, including a dormant slot, yields nothing.
import { classifyRoute } from "./routes.js";
import { AUTHORED_ROOTS, INTERACTIVE, LIVE_REGIONS, SLOTS } from "./selectors.js";

const HOSTS = {
  guard: (guard) => guard,
  parent: (guard) => guard.parentElement,
  graph: (guard, def) => {
    const container = guard.closest(".js-yearly-contributions");
    const graphs = container ? container.querySelectorAll(def.graph) : [];
    return graphs.length === 1 && graphs[0].querySelector(".js-calendar-graph") ? graphs[0] : null;
  },
};

/** The guard's own text, from its direct text nodes only, with whitespace collapsed. */
export function ownText(element) {
  let text = "";
  for (const node of element.childNodes) if (node.nodeType === 3) text += node.data;
  return text.replace(/\s+/g, " ").trim();
}

const matchesText = (def, guard) => def.text === null || def.text.some((t) => (typeof t === "string" ? ownText(guard) === t : t.test(ownText(guard))));

/** True when the element or an ancestor is a root of text people wrote. */
export const insideAuthored = (element) => Boolean(element.closest(AUTHORED_ROOTS));

/** True when the element or an ancestor below <main> is a control, focusable target or live region. */
export function insideInteractive(element) {
  for (let node = element; node && node.tagName !== "MAIN" && node !== node.ownerDocument.documentElement; node = node.parentElement) {
    if (node.matches(INTERACTIVE) || node.matches(LIVE_REGIONS)) return true;
  }
  return false;
}

// Where the owned node's parent will be, which must itself be safe.
const insertionParent = (host, insert) => (insert === "append" ? host : host.parentElement);

/** Why a candidate fails, or null when it is a safe anchor. */
export function rejectReason(def, guard) {
  if (!guard.closest("main")) return "outside main";
  if (!matchesText(def, guard)) return "GitHub's words differ";
  if (def.child && guard.querySelectorAll(`:scope > ${def.child}`).length !== 1) return "unexpected structure";
  if (def.next && !guard.nextElementSibling?.matches(def.next)) return "unexpected neighbor";
  const host = HOSTS[def.host](guard, def);
  if (!host) return "no host";
  const parent = insertionParent(host, def.insert);
  if (!parent) return "no insertion parent";
  for (const node of new Set([guard, host, parent])) if (insideAuthored(node)) return "inside authored content";
  if (insideInteractive(parent)) return "inside a control";
  if (def.insert === "append" && parent.querySelector(INTERACTIVE)) return "contains a control";
  return null;
}

/** A structural signature of the native anchor, with GitHub's canonical words but no user text. */
function signature(def, host) {
  return [def.slot, host.tagName.toLowerCase(), def.text ? String(def.text[0]) : "", host.childElementCount].join("|");
}

/** Slot definitions by status, for checks and promotional examples. */
export const enabledSlots = () => SLOTS.filter((d) => d.status === "enabled").map((d) => d.slot);
export const dormantSlots = () => SLOTS.filter((d) => d.status !== "enabled").map((d) => d.slot);

/**
 * @param {Document} document
 * @param {string} route the route class the caller computed with classifyRoute
 * @returns {{slot:string, host:Element, insert:'after'|'append'|'before', nativeSignature:string}[]}
 */
export function locateSlots(document, route) {
  const lang = document.documentElement.getAttribute("lang") ?? "";
  if (!/^en(?:-|$)/i.test(lang) || classifyRoute(document) !== route) return [];
  const anchors = [];
  for (const def of SLOTS) {
    if (def.status !== "enabled" || def.route !== route) continue;
    // GitHub's words pick the candidate inside the scope, and authored copies never count;
    // exactly one may remain.
    const candidates = [...document.querySelectorAll(def.scope)].filter((el) => matchesText(def, el) && !insideAuthored(el));
    if (candidates.length !== 1) continue;
    const [guard] = candidates;
    if (rejectReason(def, guard)) continue;
    const host = HOSTS[def.host](guard, def);
    anchors.push({ slot: def.slot, host, insert: def.insert, nativeSignature: signature(def, host) });
  }
  return anchors;
}
