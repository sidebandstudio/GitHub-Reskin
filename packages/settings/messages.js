// The typed message boundary between extension pages, content scripts and the background. Every
// request is validated here before the background acts on it; anything else is refused.
import { INTERNAL_PAGES, ISSUE_CODES, SETTINGS_REQUEST_TYPES } from "../contracts/index.js";
import { actionIssues } from "./actions.js";
import { EXTRA_REQUEST_TYPES, SAFE_QUERY_KEYS, SAFE_QUERY_VALUE } from "./constants.js";
import { isPlainObject, issue } from "./model.js";

export const REQUEST_TYPES = Object.freeze([...SETTINGS_REQUEST_TYPES, ...EXTRA_REQUEST_TYPES]);
// Requests a content script may send. Everything else changes state or opens a page and needs an
// extension page as the sender.
export const READ_ONLY_REQUESTS = Object.freeze(["get"]);
const REQUEST_ID = /^[A-Za-z0-9_-]{1,64}$/;

const bad = (path, message) => [issue(ISSUE_CODES.invalid, path, message)];
const hasOnly = (value, keys) => Object.keys(value).every((key) => keys.includes(key));

/** Problems with a query for an internal page: only theme, view and from, each a short token. */
export function queryIssues(query) {
  if (query === undefined) return [];
  if (!isPlainObject(query) || !hasOnly(query, SAFE_QUERY_KEYS) || !Object.values(query).every((v) => typeof v === "string" && SAFE_QUERY_VALUE.test(v))) {
    return bad("/action/query", "A page query holds only theme, view and from as short tokens.");
  }
  return [];
}

/** Problems with a SettingsRequest. Empty means the request is well formed. */
export function requestIssues(request) {
  if (!isPlainObject(request) || !REQUEST_TYPES.includes(request.type)) return bad("/type", "Unknown request.");
  if (typeof request.requestId !== "string" || !REQUEST_ID.test(request.requestId)) return bad("/requestId", "requestId must be a short token.");
  const { type, action } = request;
  switch (type) {
    case "get":
      return hasOnly(request, ["type", "requestId"]) ? [] : bad("", "get takes no other fields.");
    case "commit":
      if (!hasOnly(request, ["type", "requestId", "expectedRevision", "action"])) return bad("", "commit has unknown fields.");
      if (!Number.isSafeInteger(request.expectedRevision) || request.expectedRevision < 0) return bad("/expectedRevision", "expectedRevision must be a revision.");
      return actionIssues(action);
    case "draft":
      if (!hasOnly(request, ["type", "requestId", "action"]) || !isPlainObject(action)) return bad("/action", "draft needs an action.");
      if (action.type === "load" || action.type === "discard") return hasOnly(action, ["type"]) ? [] : bad("/action", "That draft action takes no fields.");
      if (action.type === "save") return hasOnly(action, ["type", "draft"]) && isPlainObject(action.draft) && isPlainObject(action.draft.document) ? [] : bad("/action/draft", "A saved draft needs a document.");
      return bad("/action/type", "Unknown draft action.");
    case "open-page":
      if (!hasOnly(request, ["type", "requestId", "action"]) || !isPlainObject(action) || !hasOnly(action, ["page", "query"])) return bad("/action", "open-page needs a page.");
      if (!INTERNAL_PAGES.includes(action.page)) return bad("/action/page", "Only the onboarding and settings pages can be opened.");
      return queryIssues(action.query);
    case "recovery":
      if (!hasOnly(request, ["type", "requestId", "action"]) || !isPlainObject(action) || !hasOnly(action, ["type"]) || !["load", "lastGood"].includes(action.type)) return bad("/action", "recovery takes load or lastGood.");
      return [];
  }
  return bad("/type", "Unknown request.");
}
