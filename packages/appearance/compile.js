// compileAppearance: the CSS for Reskin-owned decoration and accent copy. It styles only the owned
// classes below, never GitHub elements, user content, body or code text. The github and preview
// targets emit identical declarations; github marks the structural ones !important so page CSS
// cannot pull an owned node into the flow or make it interactive.
import { FONT_BY_ID, SYSTEM_MONO, SYSTEM_SANS } from "./registry.js";
import { BOX_EFFECTS, effectCss } from "./effects.js";
import { fontStack } from "./fonts.js";
import { effectiveAppearance } from "./plan.js";

export const TARGETS = Object.freeze(["github", "preview"]);
const HEX = /^#[0-9a-f]{6}$/;

// Structure: no owned node takes pointer input, and only caption copy takes space in the flow. A
// heading strip hangs from a zero-height wrapper into the blank end of the heading's row, the tag
// badge sits over the blank end of the name row, and a caption's edge hangs over the blank end of
// the caption's last line, so no decoration moves GitHub content.
const STRUCTURE = [
  "[data-reskin-owned]{pointer-events:none;user-select:none;-webkit-user-select:none}",
  ".rs-slot--overlay{display:block;position:relative;height:0;margin:0;padding:0;border:0;overflow:visible;flex:1 1 0;min-width:0}",
  ".rs-slot--overlay[data-rs-row]{height:auto;align-self:stretch}",
  ".rs-box{position:absolute;box-sizing:border-box;z-index:0;isolation:isolate;margin:0}",
  ".rs-box--strip{right:0;bottom:var(--rs-lift,8px);height:36px;width:min(360px,55%);overflow:hidden;display:flex;align-items:flex-end;justify-content:flex-end;padding:0 2px 4px 0}",
  ".rs-slot--overlay[data-rs-row]>.rs-box--strip{bottom:0}",
  ".rs-slot--overlay[data-rs-out]{position:absolute;top:0;right:0;width:100%;flex:none}",
  ".rs-slot--overlay[data-rs-out]>.rs-box--strip{top:0;bottom:auto}",
  // Alternate places when the first would cover native text: the badge moves up into the blank
  // space above the name row, and a strip narrows toward the end of its row.
  ".rs-slot--overlay[data-rs-alt]>.rs-box--badge{top:auto;bottom:calc(100% + 4px)}",
  ".rs-slot--overlay[data-rs-alt]>.rs-box--strip{width:min(240px,35%)}",
  ".rs-box--badge{top:4px;right:0;display:flex;align-items:center;gap:6px;height:22px;max-width:min(240px,60%);padding:0 8px}",
  ".rs-slot--caption{display:block;position:relative;margin:8px 0 0;padding:0}",
  ".rs-box--edge{position:absolute;right:0;bottom:4px;display:block;height:10px;width:min(240px,40%);overflow:hidden}",
  ".rs-slot--caption[data-rs-alt]>.rs-box--edge{width:min(120px,25%)}",
  ".rs-copy{position:relative;z-index:2;display:block;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;font-style:normal;letter-spacing:normal;text-transform:none;text-decoration:none}",
  ".rs-copy--caption{white-space:normal}",
  ".rs-fx{position:absolute;box-sizing:border-box;pointer-events:none}",
];

// Adds !important to every declaration of simple rules.
const important = (rule) => rule.replace(/([:][^;{}]+)(?=[;}])/g, "$1!important");

function colors(tokens) {
  for (const key of ["accent", "mutedText", "primaryBackground", "border", "canvas"]) {
    if (!HEX.test(tokens?.[key] ?? "")) throw new Error(`compileAppearance needs a resolved tokens.${key}`);
  }
  return tokens;
}

/**
 * The appearance CSS for a resolved theme under the effective preferences, or "" when nothing
 * shows. Accent type applies only to owned copy at or above the font's recorded minimum size;
 * smaller copy keeps the system face.
 */
export function compileAppearance(resolved, prefs, target) {
  if (!TARGETS.includes(target)) throw new Error(`Unknown appearance target ${target}`);
  const effective = effectiveAppearance(resolved, prefs);
  if (!effective.text && !effective.effects) return "";
  const t = colors(resolved.tokens);
  const font = effective.fonts ? FONT_BY_ID[resolved.font] : null;
  const accent = font ? `${font.weight} ${font.minimumAccentPx}px/1 ${fontStack(font.id)}` : `600 14px/1 ${SYSTEM_SANS}`;
  const caption = font ? `${font.weight} ${font.minimumAccentPx}px/1.25 ${fontStack(font.id)}` : `400 14px/1.4 ${SYSTEM_SANS}`;

  const rules = [
    ...(target === "github" ? STRUCTURE.map(important) : STRUCTURE),
    `.rs-box--badge{border:1px solid ${t.border};border-radius:6px}`,
    `.rs-copy{color:${t.mutedText}}`,
    `.rs-copy--heading{font:${accent}}`,
    `.rs-copy--tag{font:400 12px/1 ${SYSTEM_MONO}}`,
    `.rs-copy--caption{font:${caption}}`,
  ];
  if (effective.effects) {
    for (const id of BOX_EFFECTS.strip) {
      if (!resolved.effects[id]) continue;
      // Without motion there is no animation rule at all, only the static resting state.
      rules.push(...effectCss(id, resolved.effects[id], t).filter((rule) => effective.motion || !/@keyframes|data-rs-play/.test(rule)));
    }
  }
  rules.push(
    "@media (prefers-reduced-motion:reduce){.rs-fx{animation:none!important}}",
    "@media (forced-colors:active){[data-reskin-owned]{display:none!important}}",
  );
  return `/* GitHub Reskin appearance, renderer 1 */\n${rules.join("\n")}\n`;
}
