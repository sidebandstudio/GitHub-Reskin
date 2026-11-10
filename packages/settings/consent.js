// Approval of a saved theme's advanced CSS, decided in this one place. The repository runs
// settleConsent on every commit and at initialization, and nothing else writes cssConsent.
//
// The rule: settings.cssConsent[id] exists only for the canonical sanitized CSS hash and the
// current sanitizer version of the stored theme `id`. It is created only by redeeming an approval
// ticket, which the explicit Enable advanced CSS action issues to one editor for one target (one
// saved theme, or the new theme that editor's next save creates) and that exact CSS. A ticket is
// used once. It is dropped when its editor withdraws it or saves, when its target is removed, has
// its approval revoked or its CSS changed, on Reset all and when the sanitizer changes. An
// approval otherwise survives only while its theme keeps exactly that CSS and nothing revokes it.
// So no copy, re-add, Undo, Reset, resume, import, rename, second window, retried write or
// migration can create, restore, widen or move one: none of them holds a ticket the repository
// still honours for that theme and text.
//
// Only SHA-256 digests of the editor and ticket secrets are stored, so storage holds nothing that
// redeems an approval.
import { ISSUE_CODES } from "../contracts/index.js";
import { STORAGE_LIMITS } from "./constants.js";
import { ActionError, isPlainObject, issue, LOCAL_ID, SHA256_HEX } from "./model.js";

/** The issue code for a ticket the repository no longer honours; the builder asks for Enable again. */
export const APPROVAL_ISSUE = "approval";
export const NEW_TARGET = "new";
export const EDITOR_ID = /^[A-Za-z0-9_-]{16,64}$/;
export const TICKET = /^[A-Za-z0-9_-]{16,128}$/;

const approvalError = (message) => new ActionError("invalid", [{ ...issue(ISSUE_CODES.invalid, "/action/approval", message), reason: APPROVAL_ISSUE }]);
const isTarget = (value) => value === NEW_TARGET || (typeof value === "string" && LOCAL_ID.test(value));

/** SHA-256 of a secret as lowercase hex: what storage keeps instead of the secret. */
export async function digest(text) {
  const bytes = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return [...new Uint8Array(bytes)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/** The stored pending approvals; anything malformed is dropped, which only ever removes approval. */
export function readApprovals(value) {
  if (!Array.isArray(value)) return [];
  return value.filter(
    (a) => isPlainObject(a) && SHA256_HEX.test(a.ticket ?? "") && SHA256_HEX.test(a.editor ?? "") && isTarget(a.target) && SHA256_HEX.test(a.hash ?? "") && Number.isSafeInteger(a.sanitizerVersion),
  ).slice(-STORAGE_LIMITS.maxApprovals);
}

// The sanitized hash of a document's CSS under this sanitizer, or null. Memoized per CSS text, so
// one settle sanitizes each distinct CSS once.
function hasher(css) {
  const memo = new Map();
  return (document) => {
    if (css.sanitizerVersion === null || typeof document?.css !== "string") return null;
    if (!memo.has(document.css)) {
      const result = css.inspect({ css: document.css }).css;
      memo.set(document.css, result?.ok && result.sanitizerVersion === css.sanitizerVersion ? result.hash : null);
    }
    return memo.get(document.css);
  };
}

/**
 * Issues a ticket for the explicit Enable advanced CSS choice: `editor` approves exactly `text` for
 * `target`, a saved theme's ID or "new". Replaces that editor's earlier ticket for the target.
 * @returns {{approvals, hash, sanitizerVersion}}
 */
export function mintApproval(settings, approvals, { editor, ticket, target, text }, css) {
  if (target !== NEW_TARGET && !settings.customThemes.some((theme) => theme.id === target)) throw approvalError("That saved theme no longer exists.");
  const hash = hasher(css)({ css: text });
  if (!hash) throw approvalError("This advanced CSS cannot be approved: it is missing, invalid or not sanitized by this version of Reskin.");
  const entry = { ticket, editor, target, hash, sanitizerVersion: css.sanitizerVersion };
  const kept = approvals.filter((a) => !(a.editor === editor && a.target === target));
  return { approvals: [...kept, entry].slice(-STORAGE_LIMITS.maxApprovals), hash, sanitizerVersion: css.sanitizerVersion };
}

/** Drops every ticket an editor holds: its person turned Enable off or changed the CSS. */
export const withdrawApprovals = (approvals, editor) => approvals.filter((a) => a.editor !== editor);

// The explicit revocations an action makes.
const revokes = (action, id) =>
  (action?.type === "saveCustom" && action.id === id && action.approval === null) || (action?.type === "setCssConsent" && action.id === id && action.granted === false);

/**
 * cssConsent and the pending approvals after `before` became `next`. Every commit and the
 * initialization pass go through here. Throws ActionError (reason "approval") when `grant` names a
 * ticket that is unknown, used, for another editor or target, or for other CSS.
 * @param {object} before the stored settings the action applied to
 * @param {object} next the settings the action produced; its cssConsent is ignored
 * @param {object[]} approvals stored pending approvals (readApprovals)
 * @param {object} options
 * @param {object} options.css CssAdmission
 * @param {object} [options.action] the action, for its explicit revocations
 * @param {{id, target, ticket, editor}|null} [options.grant] digests of the ticket this action
 *   redeems for theme `id`, which must have been issued for `target`
 * @param {string|null} [options.editor] digest of the editor whose save this is: its other tickets go
 * @returns {{cssConsent, approvals}}
 */
export function settleConsent(before, next, approvals, { css, action = null, grant = null, editor = null }) {
  const hashOf = hasher(css);
  const version = css.sanitizerVersion;
  const earlier = new Map(before.customThemes.map((theme) => [theme.id, theme]));
  const present = new Set(next.customThemes.map((theme) => theme.id));
  // Targets whose tickets are void: removed, revoked, CSS changed or approval lost.
  const voided = new Set([...earlier.keys()].filter((id) => !present.has(id)));
  const cssConsent = {};
  let used = null;
  for (const theme of next.customThemes) {
    const hash = hashOf(theme.document);
    const was = earlier.get(theme.id);
    const had = before.cssConsent?.[theme.id];
    const revoked = revokes(action, theme.id);
    // Kept: the same stored theme, the same sanitized CSS, the current sanitizer, not revoked.
    if (was && had && hash && !revoked && hashOf(was.document) === hash && had.hash === hash && had.sanitizerVersion === version) cssConsent[theme.id] = { hash, sanitizerVersion: version };
    // Created: only by the ticket issued for this target and exactly this CSS.
    if (grant && grant.id === theme.id) {
      const entry = approvals.find((a) => a.ticket === grant.ticket && a.editor === grant.editor);
      if (!entry || entry.target !== grant.target || !hash || entry.hash !== hash || entry.sanitizerVersion !== version) {
        throw approvalError("Advanced CSS needs your approval again. Turn on Enable advanced CSS, then save.");
      }
      cssConsent[theme.id] = { hash, sanitizerVersion: version };
      used = entry;
    }
    if (revoked || (was && hashOf(was.document) !== hash) || (had && !cssConsent[theme.id])) voided.add(theme.id);
  }
  if (grant && !used) throw approvalError("Advanced CSS needs your approval again. Turn on Enable advanced CSS, then save.");
  const kept = action?.type === "resetAll" ? [] : approvals.filter((a) => a !== used && !voided.has(a.target) && a.sanitizerVersion === version && !(editor && a.editor === editor));
  return { cssConsent, approvals: kept };
}
