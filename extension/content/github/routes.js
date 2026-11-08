// Route guards. Classifies the current GitHub document from what GitHub renders itself: the host,
// the route-controller/route-action meta tags and the page's own structural markers. A page that
// does not match one class exactly is `other`, where no slot runs.
import { NOT_FOUND_ILLUSTRATION, PROFILE_CARD, ROUTE_META } from "./selectors.js";

export const ROUTES = Object.freeze(["profile", "repository", "issues", "not-found", "gist", "other"]);

const meta = (document, selector) => document.querySelector(selector)?.getAttribute("content") ?? "";

/** @returns {'profile'|'repository'|'issues'|'not-found'|'gist'|'other'} */
export function classifyRoute(document) {
  const host = document.location?.hostname ?? "";
  if (host === "gist.github.com") return "gist";
  if (host !== "github.com") return "other";
  // GitHub's 404 page keeps the route meta of the path it could not find, so it is checked first.
  if (/^Page not found\b/.test(document.title) && document.querySelectorAll(NOT_FOUND_ILLUSTRATION).length === 1) return "not-found";
  const controller = meta(document, ROUTE_META.controller);
  const action = meta(document, ROUTE_META.action);
  if (controller === "profiles" && action === "show" && document.querySelectorAll(PROFILE_CARD).length === 1) return "profile";
  if (controller === "issues" && action === "index") return "issues";
  if (controller === "files" && document.querySelector("[itemtype='http://schema.org/SoftwareSourceCode']")) return "repository";
  return "other";
}
