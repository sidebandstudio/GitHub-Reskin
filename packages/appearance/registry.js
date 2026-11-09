// The renderer-1 appearance registry: the eight bundled fonts, the ten effects and the owned-node
// limits. Parameter bounds and defaults come from the schema through @github-reskin/format, so
// there is one copy of them; this file adds what only the renderer needs.
import { EFFECT_IDS, FONT_IDS } from "../contracts/index.js";
import { EFFECT_PARAMETERS, FONTS as SCHEMA_FONTS } from "../format/index.js";

const freeze = (value) => {
  if (value && typeof value === "object") {
    Object.values(value).forEach(freeze);
    Object.freeze(value);
  }
  return value;
};

// x-reskin.effectGlobalLimits, plus the echo bound from the effect's own schema.
export const LIMITS = freeze({
  maxOwnedNodes: 24,
  maxAnimatedNodes: 6,
  maxPatchWidthPx: 360,
  maxPatchHeightPx: 96,
  maxAnimatedElementPx: 96,
  maxAnimationMs: 1200,
  maxEchoMs: 200,
});

// Box heights, all within the 96px patch bound. A heading strip sits in the blank end of a
// heading row; a badge is the profile tag; a caption edge hangs at the blank end of the caption copy.
export const BOX = freeze({ strip: { height: 28, maxWidth: 360 }, badge: { height: 22, maxWidth: 240 }, edge: { height: 6, maxWidth: 240 } });

// Font fallbacks by shape, so a blocked or missing face keeps a similar width and tone.
const CONDENSED = '"Arial Narrow", "Roboto Condensed", system-ui, sans-serif';
const SERIF = 'Georgia, "Times New Roman", serif';
const SANS = "system-ui, -apple-system, \"Segoe UI\", sans-serif";
const DISPLAY = 'Impact, "Arial Black", system-ui, sans-serif';

// cssFamily is the @font-face name. Josefin Sans declares the Reserved Font Name "Josefin Sans",
// so its subset and CSS family carry a neutral name; see assets/fonts/README.md.
const RENDER = {
  rajdhani: { cssFamily: "Reskin Rajdhani", fallback: CONDENSED },
  "barlow-condensed": { cssFamily: "Reskin Barlow Condensed", fallback: CONDENSED },
  fraunces: { cssFamily: "Reskin Fraunces", fallback: SERIF },
  alegreya: { cssFamily: "Reskin Alegreya", fallback: SERIF },
  "cormorant-garamond": { cssFamily: "Reskin Cormorant Garamond", fallback: SERIF },
  "josefin-sans": { cssFamily: "Reskin Geometric Accent", fallback: SANS },
  bungee: { cssFamily: "Reskin Bungee", fallback: DISPLAY },
  "space-grotesk": { cssFamily: "Reskin Space Grotesk", fallback: SANS },
};

// Every bundled family: schema id, family, weight and minimum accent size, plus its CSS name,
// fallback stack and packaged path. "system" ships no file and is not listed.
export const FONTS = freeze(
  SCHEMA_FONTS.filter((font) => font.id !== "system").map((font) => ({
    id: font.id,
    family: font.family,
    weight: font.weight,
    minimumAccentPx: font.minimumAccentPx,
    ...RENDER[font.id],
    path: `assets/fonts/${font.id}/${font.id}.woff2`,
    license: `assets/fonts/${font.id}/OFL.txt`,
  })),
);
export const FONT_BY_ID = freeze(Object.fromEntries(FONTS.map((font) => [font.id, font])));
export const SYSTEM_SANS = SANS;
export const SYSTEM_MONO = 'ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, "Liberation Mono", monospace';

// Each effect's owned target, resolved color roles (ARCHITECTURE.md's frozen effect-to-role
// table) and whether it has any motion. Only drift and echo move, and only once on selection.
export const EFFECTS = freeze({
  glow: { target: "owned-badge", colors: ["accent"], motion: false },
  grid: { target: "owned-margin-strip", colors: ["mutedText"], motion: false },
  scanlines: { target: "owned-margin-strip", colors: ["mutedText"], motion: false },
  paper: { target: "owned-margin-strip", colors: ["mutedText"], motion: false },
  rail: { target: "owned-caption-edge", colors: ["accent"], motion: false },
  rules: { target: "owned-margin-strip", colors: ["primaryBackground"], motion: false },
  orbit: { target: "owned-margin-strip", colors: ["accent", "primaryBackground"], motion: false },
  seal: { target: "owned-badge", colors: ["primaryBackground"], motion: false },
  drift: { target: "owned-margin-strip", colors: ["mutedText"], motion: true },
  echo: { target: "owned-badge", colors: ["accent", "primaryBackground"], motion: true },
});

export { EFFECT_PARAMETERS, EFFECT_IDS, FONT_IDS };

// Problems with the registry against the contracts, as messages. check:effects and the tests run it.
export function registryProblems() {
  const problems = [];
  const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
  if (!same(Object.keys(EFFECTS), [...EFFECT_IDS])) problems.push(`effects ${Object.keys(EFFECTS)} differ from contracts ${EFFECT_IDS}`);
  if (!same(Object.keys(EFFECT_PARAMETERS), [...EFFECT_IDS])) problems.push("schema effect parameters differ from contracts");
  if (!same(FONTS.map((f) => f.id), FONT_IDS.filter((id) => id !== "system"))) problems.push("bundled fonts differ from contracts");
  for (const font of FONTS) if (!font.cssFamily || !font.fallback) problems.push(`font ${font.id} has no CSS family or fallback`);
  return problems;
}
