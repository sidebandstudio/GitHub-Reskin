// GitHub component rules from the resolved appearance: corners and borders of boxes, buttons and
// pills, the primary button's shadow, neutral label and topic pairs, scrollbars and contribution
// cell shape and glow. Each rule names GitHub's own stable classes or component attributes,
// recorded on github.com on 2026-11-08, and only presentation properties: no layout, size, text,
// hit target or focus outline changes. The compiler scopes every rule to eligible islands and
// keeps protected UI out of all of them. Pure.
//
// A target is a list of alternatives, each led by its own class, element or attribute, never one
// :is() of several, so engines index each by that key and test it only against those elements.
//
// Full keeps every request. Calm keeps colors, corners and borders, renders bevels square and
// drops shadows and glow. Effects off drops shadows and glow too.

// Panels. A box's first and last children carry its corners, as GitHub's own Box rules do. They
// have no key of their own, so the parent test comes right after the position test.
const BOX = ".Box";
const BOX_FIRST = ":first-child:is(.Box > *)";
const BOX_LAST = ":last-child:is(.Box > *)";
const all = (keys, rest) => keys.map((key) => `${key}${rest}`).join(",");
// Legacy and Primer React buttons, outside button groups, whose joined corners stay GitHub's.
const BUTTON = all([".btn", '[data-component="Button"]', '[data-component="IconButton"]'], ':not(.btn-link,.btn-octicon,.BtnGroup-item,.BtnGroup > *,[data-component="ButtonGroup"] *)');
// The primary button's shadow keeps GitHub's own focus styles: a focused primary button has its
// inner contrasting ring, so the rule leaves it while focused.
const PRIMARY_KEYS = [".btn-primary", '[data-component="Button"][data-variant="primary"]'];
const PRIMARY = all(PRIMARY_KEYS, ':not(:focus-visible,:disabled,[aria-disabled="true"])');
const PRIMARY_HOVER = all(PRIMARY_KEYS, ':hover:not(:focus-visible,:disabled,[aria-disabled="true"])');
// Neutral labels only. Status variants, issue labels and achievement tiers keep their meaning.
const LABEL = '.Label:not(.Label--primary,.Label--accent,.Label--success,.Label--attention,.Label--severe,.Label--danger,.Label--done,.Label--sponsors,.achievement-tier-label,.hx_IssueLabel,.IssueLabel),[data-component="Label"]:is([data-variant="secondary"],[data-variant="default"],:not([data-variant]))';
// Issue labels take the label shape only; their category colors stay GitHub's formula.
const ISSUE_LABEL = ".hx_IssueLabel,.IssueLabel";
// Legacy topic pills. GitHub's React topic pills carry only a hashed class; they read the mapped
// accent and topic border variables instead.
const TOPIC = ".topic-tag";
// Contribution calendar days and legend swatches, both .ContributionCalendar-day, and the SVG
// calendar where GitHub still renders one.
const CELL = ".ContributionCalendar-day";
const SVG_CELL = "rect.ContributionCalendar-day";
// Activity overview markers.
const POINT = "ellipse.activity-overview-point";

// The static per-level glow maxima for levels 1..4.
const GLOW_MAX = [2, 4, 6, 9];
// Native shadows stay at or below this opacity and blur; the crisp-rule exception does not apply
// to a glow. Graph cells have their own bound, at most 0.85 from the schema.
const SHADOW_ALPHA = 0.8;
const SHADOW_BLUR = 24;
const GLOW_ALPHA = 0.85;

const px = (n) => (n === 0 ? "0" : `${Math.round(n * 100) / 100}px`);
const mix = (hex, alpha, cap = SHADOW_ALPHA) => `color-mix(in srgb,${hex} ${Math.round(Math.min(alpha, cap) * 100)}%,transparent)`;
const important = (declarations) => declarations.map((d) => `${d} !important`).join(";");

/** Full or Calm, from the primary switch or, without it, the compatible extras flag. */
export function appearanceMode(prefs) {
  return prefs.appearance === "calm" || prefs.appearance === "full" ? prefs.appearance : prefs.extras === false ? "calm" : "full";
}

// Corner declarations for a style and radius. `bevel` asks for the bevelled variant, which the
// compiler emits only where corner-shape draws; elsewhere a bevel is square.
function corners(style, radius, bevel) {
  if (style === "sharp") return ["border-radius:0"];
  if (style === "pill") return ["border-radius:999px"];
  if (style === "bevel") return bevel ? [`border-radius:${px(radius)}`, "corner-shape:bevel"] : ["border-radius:0"];
  return [`border-radius:${px(radius)}`];
}
function cornerPair(style, radius, bevel, sides) {
  const value = corners(style, radius, bevel)[0].split(":")[1];
  return [...sides.map((s) => `border-${s}-radius:${value}`), ...(style === "bevel" && bevel ? ["corner-shape:bevel"] : [])];
}

const PILL_RADIUS = { sharp: 0, rounded: 6, bevel: 8, pill: 999 };

/**
 * The component rules for one resolution: `{target, body, shape}` with `shape` true for rules
 * whose bevel needs corner-shape. `variant` is "bevel" for engines that draw corner-shape and
 * "square" for the rest.
 * @param {object} resolved ThemedResolved with its appearance record
 * @param {object} prefs EffectivePreferences
 * @param {{variant:'bevel'|'square'}} options
 * @returns {{id:string, target:string, body:string}[]}
 */
export function componentRules(resolved, prefs, { variant }) {
  const appearance = resolved.appearance;
  if (!appearance) return [];
  const mode = appearanceMode(prefs);
  const decorate = mode === "full" && prefs.effects;
  // Calm keeps simple corners: a bevel is square there.
  const bevel = variant === "bevel" && mode === "full";
  const rules = [];
  const add = (id, target, declarations) => declarations.length && rules.push({ id, target, body: important(declarations) });
  const { shape, graph, details, colors } = appearance;

  if (shape.corners) {
    const { style, radius } = shape.corners;
    add("box", BOX, corners(style, radius, bevel));
    add("box-first", BOX_FIRST, cornerPair(style, radius, bevel, ["top-left", "top-right"]));
    add("box-last", BOX_LAST, cornerPair(style, radius, bevel, ["bottom-left", "bottom-right"]));
  }
  if (shape.borders) {
    const { width, style, color } = shape.borders;
    add("box-border", BOX, [`border-width:${px(width)}`, `border-style:${style}`, `border-color:${color}`]);
  }
  if (shape.buttons) add("button", BUTTON, corners(shape.buttons.style === "bevel" ? "bevel" : "rounded", shape.buttons.radius, bevel));
  if (shape.shadows && decorate && shape.shadows.style !== "none") {
    const { style, color, opacity, blur, offset } = shape.shadows;
    const rest = Math.min(blur, SHADOW_BLUR);
    const hover = Math.min(Math.round(blur * 1.6), SHADOW_BLUR);
    const shadow = (b, a) => (style === "hard" ? `${px(offset)} ${px(offset)} 0 ${mix(color, a)}` : `0 ${px(style === "soft" ? offset : 0)} ${px(b)} ${mix(color, a)}`);
    add("primary", PRIMARY, [`box-shadow:${shadow(rest, opacity)}`]);
    if (style !== "hard") add("primary-hover", PRIMARY_HOVER, [`box-shadow:${shadow(hover, opacity + 0.25)}`]);
  }
  for (const [id, target, request, pair] of [
    ["label", LABEL, details.labels, colors.labels],
    ["topic", TOPIC, details.topics, colors.topics],
  ]) {
    if (!request) continue;
    add(`${id}-color`, target, [`color:${pair.text}`, `background-color:${pair.background}`, `border-color:${pair.border}`]);
    if (request.style) add(`${id}-shape`, target, corners(request.style, PILL_RADIUS[request.style], bevel));
  }
  if (details.labels?.style) add("issue-label-shape", ISSUE_LABEL, corners(details.labels.style, PILL_RADIUS[details.labels.style], bevel));

  // Contribution cells: shape in every mode, glow only in Full with effects. Round stays round
  // in Calm; glow and diamond cells are square. Diamond draws nothing extra in this version.
  const style = graph.cellStyle === "round" ? "round" : graph.cellStyle === "glow" && decorate ? "glow" : "square";
  const radius = graph.cellRadius ?? (graph.cellStyle === "square" ? null : 1);
  if (style === "round") {
    add("cell-shape", CELL, ["border-radius:50%"]);
    add("svg-cell-shape", SVG_CELL, ["rx:5px", "ry:5px"]);
  } else if (radius !== null) {
    add("cell-shape", CELL, [`border-radius:${px(radius)}`]);
    add("svg-cell-shape", SVG_CELL, [`rx:${px(radius)}`, `ry:${px(radius)}`]);
  }
  if (style === "glow" && graph.glow) {
    for (const level of graph.glow.levels) {
      const size = Math.min(graph.glow.radius, GLOW_MAX[level - 1]);
      const color = graph.glow.color ?? resolved.graph[level];
      add(`cell-glow-${level}`, `${CELL}[data-level="${level}"]`, [`box-shadow:0 0 ${px(size)} ${mix(color, graph.glow.opacity, GLOW_ALPHA)}`]);
    }
  }
  add("overview-point", POINT, [`stroke:${resolved.graph[4]}`, `fill:${resolved.graph[0]}`]);
  return rules;
}

/** Declarations every eligible island carries for its scrollbars: thumb and track, and the width. */
export function scrollbarDeclarations(resolved) {
  const colors = resolved.appearance?.colors?.scrollbar;
  if (!colors) return [];
  const width = resolved.appearance.details?.scrollbarWidth === "thin" ? ["scrollbar-width:thin"] : [];
  return [`scrollbar-color:${colors.thumb} ${colors.track}`, ...width];
}
