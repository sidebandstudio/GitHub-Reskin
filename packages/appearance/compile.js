// compileAppearance: the CSS for Reskin-owned decoration and accent copy, plus the structured
// appearance this renderer draws on GitHub's page (paint.js): page, banner and header paints,
// reading backings, avatar shape and frame, and the heading/body type roles. Owned rules style only
// the owned classes below and the theme's admitted CSS for owned slots, never GitHub elements,
// user content or code text. The github and preview targets emit identical declarations, with the
// structural ones !important in both, so page CSS cannot pull an owned node into the flow or make
// it interactive and a theme's owned CSS reaches the same properties on both.
import { compileCss } from "../format/css/compile.js";
import { admitCss } from "../format/css/admission.js";
import { cssVariables } from "../engine/variables.js";
import { FONT_BY_ID, SYSTEM_MONO, SYSTEM_SANS } from "./registry.js";
import { BOX_EFFECTS, effectCss } from "./effects.js";
import { fontStack } from "./fonts.js";
import { effectiveAppearance } from "./plan.js";
import { structuredCss, structuredPlan } from "./paint.js";

export const TARGETS = Object.freeze(["github", "preview"]);
const HEX = /^#[0-9a-f]{6}$/;
// Owned slots a theme's CSS may place inside a verified illustration's blank corner.
export const CORNER_SLOTS = Object.freeze(["error.notFound.caption"]);

// Structure: no owned node takes pointer input, and only caption copy takes space in the flow. A
// heading strip hangs from a zero-height wrapper into the blank end of the heading's row, the tag
// badge sits in blank space above the name or at the end of one of its lines, and a caption's edge
// hangs over the blank end of the caption's last line, so no decoration moves GitHub content.
const STRUCTURE = [
  "[data-reskin-owned]{pointer-events:none;user-select:none;-webkit-user-select:none}",
  ".rs-slot--overlay{display:block;position:relative;height:0;margin:0;padding:0;border:0;overflow:visible;flex:1 1 0;min-width:0}",
  ".rs-slot--overlay[data-rs-row]{height:auto;align-self:stretch}",
  ".rs-box{position:absolute;box-sizing:border-box;z-index:0;isolation:isolate;margin:0}",
  ".rs-box--strip{right:0;bottom:var(--rs-lift,8px);height:36px;width:min(360px,55%);overflow:hidden;display:flex;align-items:flex-end;justify-content:flex-end}",
  ".rs-slot--overlay[data-rs-row]>.rs-box--strip{bottom:0}",
  ".rs-slot--overlay[data-rs-out]{position:absolute;top:0;right:0;width:100%;flex:none}",
  ".rs-slot--overlay[data-rs-out]>.rs-box--strip{top:0;bottom:auto}",
  // Alternate places when the first would cover native text: the badge moves from above the
  // start of the name to the end of its first or last line, and a strip narrows toward the end of its row. The
  // badge's offsets from its wrapper are measured at mount (mount.js).
  ".rs-slot--overlay[data-rs-alt]>.rs-box--badge{left:auto;right:0}",
  ".rs-slot--overlay[data-rs-alt]>.rs-box--strip{width:min(240px,35%)}",
  ".rs-box--badge{top:auto;right:auto;bottom:var(--rs-y,0px);left:var(--rs-x,0px);display:flex;align-items:center;gap:6px;height:22px;max-width:min(240px,60%)}",
  ".rs-slot--caption{display:block;position:relative;margin:8px 0 0;padding:0}",
  ".rs-box--edge{position:absolute;right:0;bottom:4px;display:block;height:10px;width:min(240px,40%);overflow:hidden}",
  ".rs-slot--caption[data-rs-alt]>.rs-box--edge{width:min(120px,25%)}",
  ".rs-copy{z-index:2;display:block;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;font-style:normal;text-decoration:none}",
  ".rs-copy--caption{white-space:normal}",
  ".rs-fx{position:absolute;box-sizing:border-box;pointer-events:none}",
  // A corner caption: a zero-height paragraph after the illustration holds a frame laid exactly
  // over the illustration (its place is measured at mount), and the copy sits in the frame's blank
  // corner where the theme puts it. Decoration is clipped to the frame, never native content.
  ".rs-slot--caption[data-rs-corner]{height:0;margin:0;overflow:visible}",
  ".rs-frame{position:absolute;display:block;overflow:hidden;z-index:var(--rs-z,0)}",
  // Out of a frame, a caption's copy is ordinary flow whatever the theme places.
  ".rs-slot--caption:not([data-rs-corner])>.rs-copy{position:relative;top:auto;right:auto;bottom:auto;left:auto}",
  // A rotated stamp's corners reach past its box, so a flowing corner caption keeps clear space.
  ".rs-slot--caption[data-rs-flow]{margin:16px 0 24px}",
  ".rs-slot--caption[data-rs-flow]>.rs-copy{width:fit-content;max-width:100%;margin:0 auto}",
  // The banner reserves its own region above the profile; it holds no text and no controls.
  ".rs-banner{display:block;position:relative;height:clamp(56px,12vw,140px);margin:0 0 24px;padding:0;overflow:hidden}",
];

// Adds !important to every declaration of simple rules.
const important = (rule) => rule.replace(/([:][^;{}]+)(?=[;}])/g, "$1!important");

function colors(tokens) {
  for (const key of ["accent", "mutedText", "primaryBackground", "border", "canvas"]) {
    if (!HEX.test(tokens?.[key] ?? "")) throw new Error(`compileAppearance needs a resolved tokens.${key}`);
  }
  return tokens;
}

// Owned boxes follow the theme's corner style: sharp and bevel (unsupported on owned nodes) are
// square, pill is round, rounded keeps a small radius.
function ownedRadius(resolved) {
  const corners = resolved.appearance?.shape?.corners;
  if (!corners) return "6px";
  return { sharp: "0", bevel: "0", pill: "999px" }[corners.style] ?? `${Math.min(corners.radius, 8)}px`;
}

/**
 * The theme's admitted CSS for owned slots. Without a GitHub target registry only owned rules can
 * compile, and a rule for GitHub's own elements fails the whole input closed; with the host's
 * registry those rules compile too, behind its admission markers. The text must be the one the
 * resolution admitted. Returns { css, slots } or null.
 */
export function ownedThemeCss(resolved, prefs, source, cssAllowed, registry = null) {
  const identity = resolved?.appearance?.css;
  if (!identity || typeof source !== "string" || !source) return null;
  const admitted = admitCss(source, "/css");
  if (!admitted.ok || admitted.value.hash !== identity.hash) return null;
  const compiled = compileCss(admitted.value, { registry, cssAllowed: Boolean(cssAllowed), preferences: prefs, policy: resolved.policy });
  if (!compiled.ok || !compiled.css) return null;
  const slots = new Set();
  for (const rule of admitted.value.rules) {
    for (const selector of rule.selectors) {
      const slot = selector.compounds.at(-1)?.attributes.find((a) => a.name === "data-reskin-slot");
      if (slot) slots.add(slot.value);
    }
  }
  return { css: compiled.css, slots: [...slots] };
}

/**
 * The appearance CSS for a resolved theme under the effective preferences, or "" when nothing
 * shows. Accent type applies only to owned copy at or above the font's recorded minimum size;
 * smaller copy keeps the system face. `options.css` is the theme's own CSS source and
 * `options.cssAllowed` the host's decision (packaged built-in in Full, or consent for this hash).
 * `options.registry` is the host's GitHub target registry, which lets the theme's CSS reach the
 * GitHub elements the host admits; that CSS then never applies under forced colors.
 * `options.viewport` ({width, height}) resolves paint sizes in viewport units for the preview,
 * whose frame is as tall as its page. `options.images` is imageAssets(source): the admitted data
 * of the theme's images by hash. Without it image layers are left out and the rest is drawn.
 */
export function compileAppearance(resolved, prefs, target, { css: source = null, cssAllowed = false, registry = null, viewport = null, images = null } = {}) {
  if (!TARGETS.includes(target)) throw new Error(`Unknown appearance target ${target}`);
  const effective = effectiveAppearance(resolved, prefs);
  const plan = structuredPlan(resolved, prefs, images);
  const structured = structuredCss(plan, resolved, target, viewport);
  const owned = effective.text || effective.effects ? ownedThemeCss(resolved, prefs, source, cssAllowed, registry) : null;
  if (!effective.text && !effective.effects && !plan.banner) return structured ? `/* GitHub Reskin appearance, renderer 1 */\n${structured}\n` : "";
  const t = colors(resolved.tokens);
  const font = effective.fonts ? FONT_BY_ID[resolved.font] : null;
  const heading = effective.fonts && resolved.appearance?.fonts?.heading?.source === "native-stack" ? resolved.appearance.fonts.heading.fallback : null;
  const accent = font ? `${font.weight} ${font.minimumAccentPx}px/1 ${fontStack(font.id)}` : `600 14px/1 ${heading ?? SYSTEM_SANS}`;
  const caption = font ? `${font.weight} ${font.minimumAccentPx}px/1.25 ${fontStack(font.id)}` : `400 14px/1.4 ${SYSTEM_SANS}`;

  const rules = [
    ...STRUCTURE.map(important),
    // Skin: what a theme's owned CSS may restyle. The copy takes its type from its box, so a rule
    // for a heading or tag slot reaches its text; a caption's copy is its own face.
    `.rs-box--strip{padding:0 2px 4px 0;color:${t.mutedText};font:${accent};letter-spacing:normal;text-transform:none}`,
    `.rs-box--badge{padding:0 8px;border:1px solid ${t.border};border-radius:${ownedRadius(resolved)};color:${t.mutedText};font:400 12px/1 ${SYSTEM_MONO};letter-spacing:normal;text-transform:none}`,
    ".rs-copy{position:relative;color:inherit;font:inherit;letter-spacing:inherit;text-transform:inherit}",
    `.rs-copy--caption{color:${t.mutedText};font:${caption};letter-spacing:normal;text-transform:none}`,
  ];
  if (effective.effects) {
    for (const id of BOX_EFFECTS.strip) {
      if (!resolved.effects[id]) continue;
      // Without motion there is no animation rule at all, only the static resting state.
      rules.push(...effectCss(id, resolved.effects[id], t).filter((rule) => effective.motion || !/@keyframes|data-rs-play/.test(rule)));
    }
  }
  if (owned) {
    // The audited scalar variables, set only on owned nodes so they never reach GitHub's elements.
    const face = font ? FONT_BY_ID[resolved.font].cssFamily : undefined;
    const variables = Object.entries(cssVariables(resolved, { headingFamily: face })).map(([name, value]) => `${name}:${value}`);
    rules.push(`[data-reskin-owned]{${variables.join(";")}}`, registry ? `@media not (forced-colors:active){${owned.css}}` : owned.css);
  }
  rules.push(
    "@media (prefers-reduced-motion:reduce){.rs-fx{animation:none!important}}",
    "@media (forced-colors:active){[data-reskin-owned]{display:none!important}}",
  );
  return `/* GitHub Reskin appearance, renderer 1 */\n${structured ? `${structured}\n` : ""}${rules.join("\n")}\n`;
}
