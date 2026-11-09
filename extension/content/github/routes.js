// Route guards. Classifies the current GitHub document from what GitHub renders itself: the host,
// the route-controller/route-action meta tags and the page's own structural markers. A page that
// does not match one class exactly is `other`, where no slot runs. All markers come from one
// document query.
import { MARKETING_MAIN, NOT_FOUND_ILLUSTRATION, PROFILE_CARD, ROUTE_META, SOURCE_CODE } from "./selectors.js";

export const ROUTES = Object.freeze(["profile", "repository", "pull-files", "commit", "issues", "not-found", "marketing", "gist", "other"]);

// GitHub's logged-out Brand pages: the home page, Features, Pricing and Sponsors (github.com,
// 2026-11-08). The signed-in dashboard shares dashboard#index but has no marketing main.
const MARKETING = ["dashboard/index", "site_landing_pages/show", "site_pricing/index"];

/** Every element classifyRoute reads, as one selector list. */
export const ROUTE_SIGNALS = [ROUTE_META.controller, ROUTE_META.action, NOT_FOUND_ILLUSTRATION, PROFILE_CARD, SOURCE_CODE, MARKETING_MAIN].join(",");

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
  let marketing = 0;
  for (const node of nodes) {
    // The first meta of each name counts, as querySelector would return it.
    if (controller === null && node.matches(ROUTE_META.controller)) controller = node.getAttribute("content") ?? "";
    else if (action === null && node.matches(ROUTE_META.action)) action = node.getAttribute("content") ?? "";
    if (node.matches(NOT_FOUND_ILLUSTRATION)) notFound++;
    if (node.matches(PROFILE_CARD)) cards++;
    if (node.matches(SOURCE_CODE)) sourceCode = true;
    if (node.matches(MARKETING_MAIN)) marketing++;
  }
  // GitHub's 404 page keeps the route meta of the path it could not find, so it is checked first.
  if (/^Page not found\b/.test(document.title) && notFound === 1) return "not-found";
  if (controller === "profiles" && action === "show" && cards === 1) return "profile";
  if (controller === "issues" && action === "index") return "issues";
  if ((controller === "files" || (controller === "blob" && action === "show")) && sourceCode) return "repository";
  if (controller === "pull_requests" && action === "files" && sourceCode) return "pull-files";
  if (controller === "commit" && action === "show" && sourceCode) return "commit";
  if (marketing === 1 && MARKETING.includes(`${controller}/${action}`)) return "marketing";
  return "other";
}

/** @returns {'profile'|'repository'|'pull-files'|'commit'|'issues'|'not-found'|'marketing'|'gist'|'other'} */
export function classifyRoute(document) {
  const host = document.location?.hostname ?? "";
  if (host !== "github.com") return routeFromSignals(document, []);
  return routeFromSignals(document, document.querySelectorAll(ROUTE_SIGNALS));
}

/**
 * The same classification, querying only what the route meta needs: the head's meta tags, then at
 * most one structural check, so a 50,000-element diff pays no document-wide match of every route
 * signal. Admission runs it on every classification; startup discovery keeps one combined query.
 */
export function classifyRouteLazily(document) {
  const host = document.location?.hostname ?? "";
  if (host !== "github.com") return routeFromSignals(document, []);
  const meta = (selector) => {
    const node = document.querySelector(selector);
    return node ? (node.getAttribute("content") ?? "") : null;
  };
  const controller = meta(ROUTE_META.controller);
  const action = meta(ROUTE_META.action);
  const count = (selector) => document.querySelectorAll(selector).length;
  const sourceCode = () => document.querySelector(SOURCE_CODE) !== null;
  if (/^Page not found\b/.test(document.title) && count(NOT_FOUND_ILLUSTRATION) === 1) return "not-found";
  if (controller === "profiles" && action === "show") return count(PROFILE_CARD) === 1 ? "profile" : "other";
  if (controller === "issues" && action === "index") return "issues";
  if (controller === "files" || (controller === "blob" && action === "show")) return sourceCode() ? "repository" : "other";
  if (controller === "pull_requests" && action === "files") return sourceCode() ? "pull-files" : "other";
  if (controller === "commit" && action === "show") return sourceCode() ? "commit" : "other";
  if (MARKETING.includes(`${controller}/${action}`)) return count(MARKETING_MAIN) === 1 ? "marketing" : "other";
  return "other";
}
