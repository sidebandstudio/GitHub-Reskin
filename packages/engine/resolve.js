// resolveTheme: a pure, deterministic derivation of every renderer-1 color from portable source
// and one immutable ModeSeed, followed by the frozen contrast repairs. See "Resolution and
// contrast" in ARCHITECTURE.md for the initial values and the repair order implemented here.
import { ISSUE_CODES, SYNTAX_ROLES } from "../contracts/index.js";
import { canonicalize, validateTheme, EFFECT_PARAMETERS } from "../format/index.js";
import { BLACK, WHITE, bestInk, contrast, fit, luminance, mix } from "./color.js";
import { deriveRamp, resolveRamp } from "./graph.js";
import PAIRS from "./pairs.json" with { type: "json" };
import { assertContext, pairMatrixProblems } from "./seed.js";
import { sha256 } from "./sha256.js";
import { ACCESSIBILITY_NOTICE, ANSI_ROLES, COLOR_PATHS, SEMANTIC_ROLES, TOKEN_KEYS } from "./vocabulary.js";

export const PAIR_MATRIX = PAIRS;
const SURFACES = ["canvas", "surface", "inset", "raised", "hover", "active"].map((k) => `/tokens/${k}`);
const OVERRIDABLE_SEMANTICS = ["success", "danger", "warning", "done"];
// Records whose fill is repaired instead of the ink: the emphasis ink is shared across statuses.
const REPAIR_BACKGROUND = (id) => id === "emphasisText" || /^semantic\.[a-z]+\.emphasis$/.test(id);
const MAX_PASSES = 6;

let matrixChecked = false;
function records() {
  if (!matrixChecked) {
    const problems = pairMatrixProblems(PAIRS);
    if (problems.length) throw new Error(`packages/engine/pairs.json is invalid: ${problems.join("; ")}`);
    matrixChecked = true;
  }
  return PAIRS.records;
}
const recordById = (id) => records().find((r) => r.id === id);

export function deepFreeze(value) {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const item of Object.values(value)) deepFreeze(item);
  }
  return value;
}

const lower = (hex) => hex.toLowerCase();

/** Hash of the canonical portable source. */
export const sourceHash = (theme) => sha256(new TextEncoder().encode(canonicalize(theme)));

// Mutable working color set keyed by ColorPath, remembering each path's initial value and the
// reason for its first correction.
class Colors {
  constructor(base) {
    this.base = base;
    this.values = new Map();
    this.initial = new Map();
    this.reasons = new Map();
  }
  init(path, hex) {
    this.values.set(path, lower(hex));
    this.initial.set(path, lower(hex));
  }
  get(path) {
    const value = this.values.get(path);
    if (value === undefined) throw new Error(`resolver read ${path} before deriving it`);
    return value;
  }
  set(path, hex, reason) {
    if (this.get(path) === hex) return false;
    this.values.set(path, hex);
    if (!this.reasons.has(path)) this.reasons.set(path, reason);
    return true;
  }
  repairs() {
    return COLOR_PATHS.filter((p) => this.values.get(p) !== this.initial.get(p)).map((path) => ({
      persistence: "render",
      path,
      before: this.initial.get(path),
      after: this.values.get(path),
      reason: this.reasons.get(path),
    }));
  }
}

const contrastReason = (record) => `Adjusted to reach ${record.minimum}:1 for ${record.id}.`;

// Moves backgrounds other than the canvas toward the canvas, 1/255 at a time, until `ink` reaches
// the minimum on each. This is the step-3 surface repair: the root background never moves.
function separateSurfaces(colors, record, ink) {
  const canvas = colors.get("/tokens/canvas");
  for (const path of record.backgrounds) {
    if (path === "/tokens/canvas") continue;
    const start = colors.get(path);
    if (contrast(ink, start) >= record.minimum) continue;
    for (let k = 1; k <= 255; k++) {
      const moved = mix(start, canvas, k / 255);
      if (contrast(ink, moved) >= record.minimum || k === 255) {
        colors.set(path, moved, `Moved toward the background so ${record.id} stays readable on every surface.`);
        break;
      }
    }
  }
}

// The extreme on the foreground's side of the canvas: white for a lighter foreground, black for a
// darker one, or null when they match.
function sideOf(color, canvas) {
  const [a, b] = [luminance(color), luminance(canvas)];
  return a === b ? null : a > b ? WHITE : BLACK;
}

// Repairs one record. Returns true when anything changed.
function repair(colors, record) {
  const fg = colors.get(record.foreground);
  const backgrounds = () => record.backgrounds.map((bg) => colors.get(bg));
  if (backgrounds().every((bg) => contrast(fg, bg) >= record.minimum)) return false;
  if (REPAIR_BACKGROUND(record.id)) {
    let changed = false;
    for (const bg of record.backgrounds) changed = colors.set(bg, fit(colors.get(bg), [fg], record.minimum, colors.base), contrastReason(record)) || changed;
    return changed;
  }
  let fixed = fit(fg, backgrounds(), record.minimum, colors.base);
  if (record.backgrounds.length > 1) {
    // A foreground on several surfaces keeps its side of the canvas whenever that side can pass
    // on the canvas: surfaces move back toward the canvas rather than the ink flipping polarity.
    // Flipping would derive the surfaces toward the other extreme next time, and never settle.
    const canvas = colors.get("/tokens/canvas");
    const side = sideOf(fg, canvas);
    const keep = side && contrast(side, canvas) >= record.minimum ? side : bestInk(canvas, colors.base);
    if (!fixed || sideOf(fixed, canvas) !== sideOf(keep, canvas)) {
      separateSurfaces(colors, record, keep);
      fixed = fit(fg, backgrounds(), record.minimum, colors.base);
    }
  }
  return fixed ? colors.set(record.foreground, fixed, contrastReason(record)) : false;
}
const repairId = (colors, id) => repair(colors, recordById(id));

// One PairResult per foreground/background pair of a ColorSet, with unrounded ratios.
function auditSet(set) {
  const value = (path) => {
    const [, group, a, b] = path.split("/");
    return b === undefined ? set[group][a] : set[group][a][b];
  };
  const results = [];
  for (const record of records()) {
    for (const background of record.backgrounds) {
      const ratio = contrast(value(record.foreground), value(background));
      results.push({ id: record.id, foreground: record.foreground, background, ratio, minimum: record.minimum, passed: ratio >= record.minimum });
    }
  }
  return results;
}

/**
 * Derives and repairs every color. Returns the working set plus the graph outcome; the caller
 * decides what becomes portable source and what stays render output.
 */
export function deriveColors(theme, seed) {
  const { base } = theme;
  const s = seed.colors;
  const ov = theme.overrides ?? {};
  const syntaxOv = ov.syntax ?? {};
  const accessible = seed.family !== "standard";
  const colors = new Colors(base);
  const T = (key) => `/tokens/${key}`;
  const tok = (key) => colors.get(T(key));
  const init = (key, value) => colors.init(T(key), value);

  // Core colors, then the surface family mixed toward the repaired ink.
  init("canvas", theme.colors.background);
  init("accent", theme.colors.accent);
  init("text", theme.colors.text);
  colors.set(T("text"), fit(tok("text"), [tok("canvas")], 4.5, base), contrastReason(recordById("text")));
  const canvas = tok("canvas");
  const ink = tok("text");
  init("surface", ov.surface ?? mix(canvas, ink, 0.05));
  init("raised", ov.raised ?? mix(canvas, ink, 0.08));
  init("hover", ov.hover ?? mix(canvas, ink, 0.12));
  init("active", mix(canvas, ink, 0.16));
  init("inset", ov.inset ?? mix(canvas, BLACK, base === "dark" ? 0.3 : 0.03));
  init("border", ov.border ?? mix(canvas, ink, 0.18));
  init("mutedText", ov.mutedText ?? mix(canvas, ink, 0.65));
  init("accentMuted", ov.accentMuted ?? mix(canvas, tok("accent"), 0.16));
  init("inputBackground", canvas);
  repairId(colors, "text");
  repairId(colors, "mutedText");
  init("link", ov.link ?? tok("accent"));
  repairId(colors, "link");
  init("controlBorder", ov.controlBorder ?? tok("border"));
  repairId(colors, "controlBorder");

  // Focus, accent emphasis and the primary button states.
  init("focusOuter", ov.focus ?? tok("accent"));
  repairId(colors, "focusOuter");
  init("focusInner", bestInk(tok("focusOuter"), base));
  repairId(colors, "focusInner");
  init("accentEmphasis", tok("accent"));
  init("emphasisText", s.tokens.emphasisText);
  repairId(colors, "emphasisText");
  init("primaryBackground", ov.primaryBackground ?? tok("accent"));
  init("primaryText", ov.primaryText ?? bestInk(tok("primaryBackground"), base));
  repairId(colors, "primaryText");
  const rest = tok("primaryBackground");
  const restInk = tok("primaryText");
  const away = bestInk(restInk, base);
  init("primaryHoverBackground", mix(rest, away, 0.08));
  init("primaryPressedBackground", mix(rest, away, 0.16));
  for (const key of ["primaryHoverText", "primaryPressedText", "primaryIcon"]) init(key, restInk);
  init("primaryBorder", tok("controlBorder"));
  init("primaryCounterBackground", mix(rest, restInk, 0.16));
  init("primaryCounterText", bestInk(tok("primaryCounterBackground"), base));
  for (const id of ["primaryHoverText", "primaryPressedText", "primaryIcon", "primaryCounterText", "primaryBorder"]) repairId(colors, id);

  // Selection, code, diff and component pairs.
  init("selectionBackground", ov.selectionBackground ?? mix(canvas, tok("accent"), 0.3));
  init("selectionText", ov.selectionText ?? tok("text"));
  init("codeBackground", tok("inset"));
  init("codeText", tok("text"));
  init("neutralBackground", tok("surface"));
  init("neutralText", tok("text"));
  for (const [line, word] of [["diffAdded", "diffWordAdded"], ["diffRemoved", "diffWordRemoved"]]) {
    init(`${line}Background`, mix(canvas, s.tokens[`${line}Background`], 0.35));
    init(`${word}Background`, mix(canvas, s.tokens[`${word}Background`], 0.55));
    init(`${line}Text`, s.tokens[`${line}Text`]);
    init(`${word}Text`, s.tokens[`${word}Text`]);
  }
  init("tooltipBackground", tok("raised"));
  init("tooltipText", tok("text"));
  init("overlayBackground", tok("raised"));
  init("overlayText", tok("text"));
  init("inputText", tok("text"));
  init("inputPlaceholder", tok("mutedText"));
  init("disabledBackground", tok("surface"));
  init("disabledText", tok("mutedText"));
  init("disabledBorder", tok("controlBorder"));
  init("counterBackground", tok("active"));
  init("counterText", tok("text"));
  init("labelBackground", tok("accentMuted"));
  init("labelText", tok("link"));
  init("labelBorder", tok("controlBorder"));
  for (const id of ["selectionText", "codeText", "neutralText", "diffAddedText", "diffRemovedText", "diffWordAddedText", "diffWordRemovedText", "tooltipText", "overlayText", "inputText", "inputPlaceholder", "disabledText", "counterText", "labelText", "disabledBorder", "labelBorder"]) {
    repairId(colors, id);
  }

  // Status colors. Accessibility families always use their own seed inks.
  for (const role of SEMANTIC_ROLES) {
    const P = (field) => `/semantics/${role}/${field}`;
    const supplied = OVERRIDABLE_SEMANTICS.includes(role) ? ov[role] : undefined;
    colors.init(P("text"), supplied ?? s.semantics[role].text);
    if (supplied && accessible) colors.set(P("text"), lower(s.semantics[role].text), `${ACCESSIBILITY_NOTICE}.`);
    const textRecord = recordById(`semantic.${role}.text`);
    const onSurfaces = { ...textRecord, backgrounds: textRecord.backgrounds.filter((bg) => SURFACES.includes(bg)) };
    repair(colors, onSurfaces);
    colors.init(P("mutedBackground"), mix(canvas, colors.get(P("text")), 0.12));
    repair(colors, textRecord);
    colors.init(P("border"), colors.get(P("text")));
    colors.init(P("emphasisBackground"), s.semantics[role].emphasisBackground);
    colors.init(P("onEmphasis"), tok("emphasisText"));
    repairId(colors, `semantic.${role}.border`);
    repairId(colors, `semantic.${role}.emphasis`);
  }

  for (const role of SYNTAX_ROLES) {
    colors.init(`/syntax/${role}`, syntaxOv[role] ?? s.syntax[role]);
    repairId(colors, `syntax.${role}`);
  }
  for (const role of ANSI_ROLES) {
    colors.init(`/ansi/${role}`, s.ansi[role]);
    repairId(colors, `ansi.${role}`);
  }

  // A later surface move can affect an earlier pair; repeat the matrix until nothing changes.
  for (let pass = 0; pass < MAX_PASSES; pass++) {
    let changed = false;
    for (const record of records()) changed = repair(colors, record) || changed;
    if (!changed) break;
  }

  const supplied = theme.contributions?.levels?.map(lower);
  const graphSeed = lower(theme.colors.contribution ?? theme.colors.accent);
  const graph = resolveRamp({ supplied, canvas, text: tok("text"), seed: graphSeed, base, fallback: s.graph });
  const initialGraph = supplied ?? deriveRamp(canvas, tok("text"), graphSeed);
  graph.levels.forEach((level, i) => {
    colors.init(`/graph/${i}`, initialGraph[i]);
    colors.set(`/graph/${i}`, level, "Contribution colors adjusted so every level is visible and in order.");
  });
  return { colors, graph };
}

function colorSet(colors) {
  const tokens = Object.fromEntries(TOKEN_KEYS.map((key) => [key, colors.get(`/tokens/${key}`)]));
  const semantics = Object.fromEntries(
    SEMANTIC_ROLES.map((role) => [role, Object.fromEntries(["text", "mutedBackground", "emphasisBackground", "onEmphasis", "border"].map((f) => [f, colors.get(`/semantics/${role}/${f}`)]))]),
  );
  const syntax = Object.fromEntries(SYNTAX_ROLES.map((role) => [role, colors.get(`/syntax/${role}`)]));
  const ansi = Object.fromEntries(ANSI_ROLES.map((role) => [role, colors.get(`/ansi/${role}`)]));
  const graph = [0, 1, 2, 3, 4].map((i) => colors.get(`/graph/${i}`));
  return { tokens, semantics, syntax, ansi, graph };
}

function resolvedEffects(theme) {
  const effects = {};
  for (const [id, params] of Object.entries(EFFECT_PARAMETERS)) {
    const requested = theme.effects?.[id];
    if (!requested) continue;
    effects[id] = Object.fromEntries(Object.entries(params).map(([name, spec]) => [name, requested[name] ?? spec.default]));
  }
  return effects;
}

function resolvedFlavor(theme) {
  if (!theme.flavor) return { enabled: false, locale: "en", slots: {} };
  return { enabled: theme.flavor.enabled ?? true, locale: theme.flavor.locale ?? "en", slots: { ...(theme.flavor.slots ?? {}) } };
}

export function assertTheme(theme, caller) {
  const result = validateTheme(theme);
  if (!result.ok) throw new TypeError(`${caller} needs a valid theme: ${result.issues.map((i) => `${i.path || "/"} ${i.code}`).join(", ")}`);
}

/**
 * Step 1 of resolution: the explicit base is honored, never inferred. When readable core text on
 * the background has to sit on the other side of it (darker than the background on a dark base,
 * lighter on a light one), the base contradicts the colors. This returns that conflict as an Issue
 * at /base for the caller to offer the other base, or null. Switching the base always clears it.
 * @param {import("../contracts/index.js").ThemeV1} theme
 * @returns {import("../contracts/index.js").Issue | null}
 */
export function basePolarityIssue(theme) {
  assertTheme(theme, "basePolarityIssue");
  return polarityIssue(theme);
}

function polarityIssue(theme) {
  const { base } = theme;
  const canvas = lower(theme.colors.background);
  const text = fit(lower(theme.colors.text), [canvas], 4.5, base);
  if (luminance(text) > luminance(canvas) === (base === "dark")) return null;
  const other = base === "dark" ? "light" : "dark";
  return {
    code: ISSUE_CODES.basePolarity,
    path: "/base",
    message: `This theme's base is ${base}, but text can only be read on its background as ${base === "dark" ? "dark text on a light" : "light text on a dark"} background. Switch the base to ${other}, or choose a ${base === "dark" ? "darker" : "lighter"} background.`,
    severity: "error",
  };
}

// Engine entry points refuse a contradictory base in an already validated theme; the error carries
// the Issue to show.
export function assertBasePolarity(theme) {
  const issue = polarityIssue(theme);
  if (issue) throw Object.assign(new Error(issue.message), { code: issue.code, issue });
}

/**
 * @param {import("../contracts/index.js").ThemeV1} theme
 * @param {{seed:object|null, policy:string, reducedMotion:boolean, forcedColors:boolean}} context
 */
export function resolveTheme(theme, context) {
  assertTheme(theme, "resolveTheme");
  assertContext(context);
  const { seed } = context;
  const hash = sourceHash(theme);
  if (context.forcedColors || context.policy !== "themed") {
    return deepFreeze({
      rendererVersion: 1,
      sourceHash: hash,
      seedId: seed?.id ?? null,
      seedHash: seed?.sourceHash ?? null,
      base: theme.base,
      policy: context.forcedColors ? "forced-colors" : context.policy,
      tokens: null,
      semantics: null,
      syntax: null,
      ansi: null,
      graph: null,
      font: "system",
      effects: {},
      flavor: { enabled: false, locale: "en", slots: {} },
      motionAllowed: false,
      repairs: [],
      pairAudit: [],
    });
  }
  if (!seed) throw new TypeError("A themed ResolveContext needs a seed");
  if (seed.base !== theme.base) throw new TypeError(`Seed ${seed.id} is ${seed.base}; the theme's base is ${theme.base}`);
  if (seed.highContrast) throw new TypeError(`Seed ${seed.id} is high contrast; high-contrast modes stay native`);
  assertBasePolarity(theme);
  const { colors } = deriveColors(theme, seed);
  const set = colorSet(colors);
  return deepFreeze({
    ...set,
    rendererVersion: 1,
    sourceHash: hash,
    seedId: seed.id,
    seedHash: seed.sourceHash,
    base: theme.base,
    policy: "themed",
    font: theme.fonts?.accent ?? "system",
    effects: resolvedEffects(theme),
    flavor: resolvedFlavor(theme),
    motionAllowed: !context.reducedMotion,
    repairs: colors.repairs(),
    pairAudit: auditSet(set),
  });
}

/** Every PairResult for a themed resolution, one per foreground/background pair, unrounded. */
export function auditPairs(resolved) {
  if (!resolved || resolved.policy !== "themed") throw new TypeError("auditPairs takes a themed ResolvedTheme; native policies have no colors to audit");
  return deepFreeze(auditSet(resolved));
}
