// Route guards. Classifies the current GitHub document from what GitHub renders itself: the host,
// the route-controller/route-action meta tags and the page's own structural markers. A page that
// does not match one class exactly is `other`, where no slot runs. All markers come from one
// document query.
import { NOT_FOUND_ILLUSTRATION, PROFILE_CARD, ROUTE_META, SOURCE_CODE } from "./selectors.js";

export const ROUTES = Object.freeze(["profile", "repository", "issues", "not-found", "gist", "other"]);

/** Every element classifyRoute reads, as one selector list. */
export const ROUTE_SIGNALS = [ROUTE_META.controller, ROUTE_META.action, NOT_FOUND_ILLUSTRATION, PROFILE_CARD, SOURCE_CODE].join(",");

/**
 * The route class from the result of one ROUTE_SIGNALS query, possibly mixed with other elements.
 * @param {Document} document
 * @param {Iterable<Element>} nodes in document order
 */
export function routeFromSignals(document, nodes) {
  const host = document.location?.hostname ?? "";
  if (host === "gist.github.com") return "gist";
  if (host !== "github.com") return "other";
  let controller = null;
  let action = null;
  let notFound = 0;
  let cards = 0;
  let sourceCode = false;
  for (const node of nodes) {
    // The first meta of each name counts, as querySelector would return it.
    if (controller === null && node.matches(ROUTE_META.controller)) controller = node.getAttribute("content") ?? "";
    else if (action === null && node.matches(ROUTE_META.action)) action = node.getAttribute("content") ?? "";
    if (node.matches(NOT_FOUND_ILLUSTRATION)) notFound++;
    if (node.matches(PROFILE_CARD)) cards++;
    if (node.matches(SOURCE_CODE)) sourceCode = true;
  }
  // GitHub's 404 page keeps the route meta of the path it could not find, so it is checked first.
  if (/^Page not found\b/.test(document.title) && notFound === 1) return "not-found";
  if (controller === "profiles" && action === "show" && cards === 1) return "profile";
  if (controller === "issues" && action === "index") return "issues";
  if (controller === "files" && sourceCode) return "repository";
  return "other";
}

/** @returns {'profile'|'repository'|'issues'|'not-found'|'gist'|'other'} */
export function classifyRoute(document) {
  const host = document.location?.hostname ?? "";
  if (host !== "github.com") return routeFromSignals(document, []);
  return routeFromSignals(document, document.querySelectorAll(ROUTE_SIGNALS));
}
