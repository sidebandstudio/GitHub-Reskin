// The advanced CSS policy of THEME-EXPANSION.md as data: every allowlist and bound the sanitizer
// and the registry compiler enforce. No parser here, so the viewer entry can verify policy hashes
// and compile admitted rules without loading css-tree. POLICY_HASH covers all of it; changing any
// entry changes the hash, which invalidates build-time proofs and CSS consent.
import { CSS_MARKERS, CSS_VARIABLES, EFFECT_TARGETS, FLAVOR_SLOT_IDS, LIMITS, SANITIZER_VERSION } from "../../contracts/index.js";
import { sha256 } from "../../engine/sha256.js";
import { CSS_POLICY } from "../schema-registry.js";

const freeze = (value) => {
  if (value && typeof value === "object") {
    Object.values(value).forEach(freeze);
    Object.freeze(value);
  }
  return value;
};

// Native GitHub nodes may receive only these. Shorthands beyond the named ones are rejected.
const NATIVE_PROPERTIES = [
  "color",
  "background-color",
  "background-image",
  "background-size",
  "background-position",
  "background-repeat",
  "border-color",
  "border-top-color",
  "border-right-color",
  "border-bottom-color",
  "border-left-color",
  "border-width",
  "border-style",
  "border-radius",
  "border-top-left-radius",
  "border-top-right-radius",
  "border-bottom-left-radius",
  "border-bottom-right-radius",
  "corner-shape",
  "box-shadow",
  "text-shadow",
  "font-family",
  "font-weight",
  "letter-spacing",
  "text-transform",
  "caret-color",
  "accent-color",
  "scrollbar-color",
  "scrollbar-width",
  "fill",
  "stroke",
  "stroke-width",
];
// Exact owned decoration selectors may also use these, bounded to their reviewed anchor.
const OWNED_PROPERTIES = ["border", "padding", "margin", "width", "height", "max-width", "max-height", "font-size", "line-height", "transform", "transform-origin", "opacity", "content"];
// Only a verified illustration-corner decoration may also place itself inside its blank frame.
const CORNER_PROPERTIES = ["position", "top", "right", "bottom", "left"];
const CORNER_SLOTS = ["error.notFound.caption"];

export const POLICY = freeze({
  sanitizerVersion: SANITIZER_VERSION,
  parser: CSS_POLICY.parser,
  limits: {
    sourceBytes: LIMITS.cssUtf8Bytes,
    rules: CSS_POLICY.maxRules,
    selectors: CSS_POLICY.maxSelectors,
    declarations: CSS_POLICY.maxDeclarations,
    astNodes: CSS_POLICY.maxAstNodes,
    nesting: CSS_POLICY.maxNesting,
    selectorComponents: 32,
    variableEdges: CSS_POLICY.variableMaxDependencyEdges,
    gradientBytes: LIMITS.gradientCssUtf8Bytes,
    gradientSizeCharacters: LIMITS.gradientCssSizeCharacters,
    layers: CSS_POLICY.maxBackgroundLayers,
    stops: CSS_POLICY.maxGradientColorStops,
    positionsPerStop: CSS_POLICY.maxPositionsPerColorStop,
    shadowEntries: CSS_POLICY.maxShadowEntries,
    shadowBlur: CSS_POLICY.maxShadowBlurPx,
    shadowBlurSum: CSS_POLICY.maxShadowBlurSumPx,
    shadowOffset: CSS_POLICY.maxShadowOffsetPx,
    shadowSpreadMin: CSS_POLICY.minShadowSpreadPx,
    shadowSpreadMax: CSS_POLICY.maxShadowSpreadPx,
    nativeShadowAlpha: CSS_POLICY.nativeShadowMaxOpacity,
    crispOffset: CSS_POLICY.opaqueCrispRuleMaxOffsetPx,
    textShadowAlpha: 0.8,
    gradientPositionPx: 2048,
    gradientPositionPercent: 200,
    radialSizePx: 4096,
    radialSizePercent: 200,
    repeatingPeriodMinPx: 2,
    repeatingPeriodMaxPx: 2048,
    backgroundSizePx: 4096,
    backgroundSizePercent: 200,
    backgroundPositionPx: 4096,
    backgroundPositionPercent: 200,
    mediaWidthPx: 10000,
  },
  atRules: ["media"],
  // Deferred general conveniences: rejected with their own reason until increment 2.
  deferredAtRules: ["supports"],
  mediaFeatures: {
    "prefers-reduced-motion": ["reduce", "no-preference"],
    hover: ["hover", "none"],
    pointer: ["fine", "coarse", "none"],
    "min-width": "length",
    "max-width": "length",
  },
  mediaTypes: ["all", "screen"],
  pseudoClasses: ["hover", "active", "focus", "focus-visible", "checked", "disabled", "first-child", "last-child"],
  statePseudoClasses: ["hover", "active", "focus", "focus-visible", "checked", "disabled"],
  selectorFunctions: ["is", "where", "not"],
  pseudoElements: ["before", "after"],
  // html, body and :root map to the admitted page backing, never to the whole document.
  rootSelectors: ["html", "body"],
  combinators: [" ", ">"],
  attributes: ["data-testid", "data-component", "data-reskin-slot", "aria-current"],
  ownedSlots: [...FLAVOR_SLOT_IDS, ...EFFECT_TARGETS],
  cornerSlots: CORNER_SLOTS,
  markers: Object.values(CSS_MARKERS),
  nativeProperties: NATIVE_PROPERTIES,
  ownedProperties: OWNED_PROPERTIES,
  cornerProperties: CORNER_PROPERTIES,
  // Inherited properties: on a native subject they need a leaf or a uniformly admitted subtree.
  inheritable: ["color", "font-family", "font-weight", "letter-spacing", "text-transform", "caret-color", "accent-color", "text-shadow", "scrollbar-color", "fill", "stroke", "stroke-width"],
  colorProperties: ["color", "background-color", "border-color", "border-top-color", "border-right-color", "border-bottom-color", "border-left-color", "caret-color", "accent-color", "scrollbar-color", "fill", "stroke"],
  // Removed when Fonts is off.
  fontProperties: ["font-family", "font-weight", "letter-spacing", "text-transform"],
  functions: [
    "rgb",
    "rgba",
    "hsl",
    "hsla",
    "oklch",
    "color-mix",
    "calc",
    "min",
    "max",
    "clamp",
    "var",
    "linear-gradient",
    "radial-gradient",
    "repeating-linear-gradient",
    "repeating-radial-gradient",
    "rotate",
    "translate",
    "translatex",
    "translatey",
  ],
  gradients: ["linear-gradient", "radial-gradient", "repeating-linear-gradient", "repeating-radial-gradient"],
  // Named for their reason; every other function is rejected as unsupported anyway.
  resourceFunctions: ["url", "image-set", "-webkit-image-set", "image", "cross-fade", "-webkit-cross-fade", "paint", "element", "-moz-element", "src", "attr", "counter", "counters", "env", "expression"],
  units: ["px", "em", "rem", "deg", "vw", "vh"],
  variables: CSS_VARIABLES,
  themeVariablePattern: "^--theme-[a-z0-9]+(?:-[a-z0-9]+)*$",
  genericFamilies: ["sans-serif", "serif", "monospace", "system-ui", "ui-sans-serif", "ui-serif", "ui-monospace", "ui-rounded", "cursive", "fantasy"],
  // Application-owned lexer grammar for a property css-tree 3.1.0 does not know.
  grammars: { "corner-shape": "[ round | scoop | bevel | notch | square | squircle ]{1,4}" },
});

const canonicalJson = (value) => {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value && typeof value === "object") return `{${Object.keys(value).sort().map((k) => `${JSON.stringify(k)}:${canonicalJson(value[k])}`).join(",")}}`;
  return JSON.stringify(value);
};

/** SHA-256 of the canonical policy. Proofs and consent recorded under another hash are stale. */
export const POLICY_HASH = sha256(new TextEncoder().encode(canonicalJson(POLICY)));

export const has = (list, value) => list.includes(value);
