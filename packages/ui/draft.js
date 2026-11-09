// The builder's draft as pure data: one theme document, the one previous valid document Undo
// restores, and the edits that change it. Every edit touches only its own path, so a color change
// keeps imported code colors, images, CSS and every other field exactly as they were. No DOM or
// storage; builder.js binds these to the page and the background keeps the recoverable draft.
import { basePolarityIssue } from "../engine/index.js";
import { validateTheme } from "../format/index.js";
import { LIMITS } from "../contracts/index.js";

export const DRAFT_VERSION = 1;

export const COPY = Object.freeze({
  tooManyEffects: "Choose up to 3 effects. Turn one off first.",
  baseSwapped: "Swapped Background and Text so text stays readable on the new base. Undo puts them back.",
  undone: "Last change undone.",
  nothingToUndo: "Nothing to undo yet.",
});

const isObject = (value) => value !== null && typeof value === "object" && !Array.isArray(value);
const segments = (path) => path.split("/").slice(1);

/** The value at a JSON pointer, or undefined. */
export function valueAt(document, path) {
  let node = document;
  for (const key of segments(path)) {
    if (!isObject(node) && !Array.isArray(node)) return undefined;
    node = node[key];
  }
  return node;
}

/**
 * A copy of the document with `value` at `path`. `undefined` removes the member, and any object
 * left empty by that removal goes too, so an edit never leaves `"code": {}` behind.
 */
export function withValue(document, path, value) {
  const keys = segments(path);
  const next = structuredClone(document);
  const chain = [next];
  for (const key of keys.slice(0, -1)) {
    const node = chain.at(-1);
    if (!isObject(node[key]) && !Array.isArray(node[key])) {
      if (value === undefined) return next;
      node[key] = {};
    }
    chain.push(node[key]);
  }
  const last = keys.at(-1);
  if (value === undefined) {
    delete chain.at(-1)[last];
    for (let i = chain.length - 1; i > 0; i--) {
      if (isObject(chain[i]) && Object.keys(chain[i]).length === 0) delete chain[i - 1][keys[i - 1]];
      else break;
    }
  } else chain.at(-1)[last] = structuredClone(value);
  return next;
}

/**
 * An edit's result: `{ok:true, document}` for a valid document, or `{ok:false, message, path}`
 * naming the first problem, so an out-of-range or partial value never replaces the last valid one.
 */
export function checked(document) {
  const result = validateTheme(document);
  if (!result.ok) {
    const issue = result.issues[0];
    return { ok: false, message: issue.message, path: issue.path, issues: result.issues };
  }
  return { ok: true, document };
}

/** Sets one field. `levels` are the resolved graph levels, used when the edit creates `contributions`. */
export function setField(document, path, value, { levels = null } = {}) {
  let next = document;
  // `levels` is required whenever contributions is present, so a graph style starts from the
  // levels the preview shows.
  if (path.startsWith("/contributions/") && path !== "/contributions/levels" && !document.contributions && value !== undefined) {
    if (!levels) return { ok: false, message: "Choose the graph colors first.", path: "/contributions/levels" };
    next = withValue(next, "/contributions/levels", levels);
  }
  return checked(withValue(next, path, value));
}

/** Sets one of the five graph levels, starting from the levels the preview shows. */
export function setGraphLevel(document, index, color, levels) {
  const current = [...(document.contributions?.levels ?? levels)];
  current[index] = color;
  return checked(withValue(document, "/contributions/levels", current));
}

/**
 * Light or Dark. When the colors would contradict the new base, the proposal swaps Background
 * and Text, so the switch stays readable; `note` says so and Undo restores both.
 */
export function switchBase(document, base) {
  if (document.base === base) return { ok: true, document, note: null };
  const next = withValue(document, "/base", base);
  if (!checked(next).ok) return checked(next);
  if (!basePolarityIssue(next)) return { ok: true, document: next, note: null };
  const swapped = withValue(withValue(next, "/colors/background", document.colors.text), "/colors/text", document.colors.background);
  const result = checked(swapped);
  return result.ok ? { ...result, note: basePolarityIssue(swapped) ? null : COPY.baseSwapped } : result;
}

/** The one-tap fix for a base that contradicts the colors: the other base, colors unchanged. */
export function fixBase(document) {
  return checked(withValue(document, "/base", document.base === "dark" ? "light" : "dark"));
}

/** Turns an effect on with the schema's defaults, keeping imported parameters until it is removed. */
export function setEffect(document, id, on) {
  const effects = document.effects ?? {};
  if (Boolean(effects[id]) === on) return { ok: true, document };
  if (on && Object.keys(effects).length >= LIMITS.maxEffectsPerTheme) return { ok: false, message: COPY.tooManyEffects, path: `/effects/${id}` };
  return checked(withValue(document, `/effects/${id}`, on ? {} : undefined));
}

/** A flavor slot's text; an empty value omits the slot. */
export function setFlavorSlot(document, slot, text) {
  const value = text.trim() ? text : undefined;
  return checked(withValue(document, `/flavor/slots/${slot.replaceAll("~", "~0").replaceAll("/", "~1")}`, value));
}

/** The Advanced CSS source; empty removes it. */
export const setCss = (document, css) => checked(withValue(document, "/css", css.trim() ? css : undefined));

/** The number of paint layers a background target holds. */
export const layerCount = (document, target) => document.backgrounds?.[target]?.layers?.length ?? 0;

/** Appends a structured gradient or pattern layer to a background target. */
export function addLayer(document, target, layer) {
  if (layerCount(document, target) >= LIMITS.maxBackgroundLayers) return { ok: false, message: `A background holds up to ${LIMITS.maxBackgroundLayers} layers. Remove one first.`, path: `/backgrounds/${target}/layers` };
  const layers = [...(document.backgrounds?.[target]?.layers ?? []), layer];
  return checked(withValue(document, `/backgrounds/${target}/layers`, layers));
}

/** Removes one layer; the target's other layers and color stay. */
export function removeLayer(document, target, index) {
  const layers = (document.backgrounds?.[target]?.layers ?? []).filter((_, i) => i !== index);
  return checked(withValue(document, `/backgrounds/${target}/layers`, layers.length ? layers : undefined));
}

/**
 * The draft state: the document, the one previous valid document, and where it came from.
 * `basedOn` is the bundled theme a new local theme records; `savedId` the local theme it edits.
 */
export function createDraft({ document, basedOn = null, savedId = null, cssEnabled = false }) {
  return { document, previous: null, basedOn, savedId, cssEnabled };
}

/** Accepts a completed edit: the current document becomes the one Undo restores. */
export function commitEdit(draft, document, patch = {}) {
  if (JSON.stringify(document) === JSON.stringify(draft.document) && !Object.keys(patch).length) return draft;
  return { ...draft, ...patch, previous: { document: draft.document, cssEnabled: draft.cssEnabled, savedId: draft.savedId }, document };
}

/** Undo restores the previous document once, then becomes unavailable. There is no Redo. */
export function undo(draft) {
  if (!draft.previous) return draft;
  const { document, cssEnabled, savedId } = draft.previous;
  return { ...draft, document, cssEnabled, savedId, previous: null };
}

/** The record the background keeps as the recoverable draft. No Undo history is stored. */
export function draftRecord(draft, { baseRevision, now = Date.now() } = {}) {
  const record = { draftVersion: DRAFT_VERSION, document: draft.document, cssEnabled: Boolean(draft.cssEnabled), updatedAt: now };
  if (draft.basedOn) record.basedOn = draft.basedOn;
  if (draft.savedId) record.savedId = draft.savedId;
  if (Number.isSafeInteger(baseRevision)) record.baseRevision = baseRevision;
  return record;
}

/** A stored draft record as a draft, or null when it is missing, from another version or invalid. */
export function draftFromRecord(record) {
  if (!isObject(record) || record.draftVersion !== DRAFT_VERSION || !isObject(record.document)) return null;
  if (!validateTheme(record.document).ok) return null;
  return {
    ...createDraft({
      document: record.document,
      basedOn: typeof record.basedOn === "string" ? record.basedOn : null,
      savedId: typeof record.savedId === "string" ? record.savedId : null,
      cssEnabled: record.cssEnabled === true,
    }),
    baseRevision: Number.isSafeInteger(record.baseRevision) ? record.baseRevision : null,
    updatedAt: Number.isFinite(record.updatedAt) ? record.updatedAt : null,
  };
}

/** The suggested name for a copy of a theme: "My Choom Circuit", within the 64-character limit. */
export function copyName(name) {
  const base = name.startsWith("My ") ? name : `My ${name}`;
  return base.length <= 64 ? base : base.slice(0, 64).trimEnd();
}
