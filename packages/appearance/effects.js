// The ten parametric effect templates. Each draws original CSS geometry from resolved role colors
// (ARCHITECTURE.md's effect-to-role table) with the effect's opacity or strength applied, inside
// Reskin-owned boxes: a heading strip, the profile-tag badge or a caption edge. No template reads
// theme strings, samples page content, loads a resource, filters, loops or animates anything but
// transform and opacity. Geometry is shared: no theme picks a hue, path, rotation or tick count.
import { EFFECT_PARAMETERS, EFFECTS } from "./registry.js";

const HEX = /^#[0-9a-f]{6}$/;
// Fixed-precision numbers, so the same theme always compiles to the same bytes.
export const num = (value) => String(Math.round(value * 1000) / 1000);

/** `rgb(r g b / alpha)` for a resolved hex color. */
export function rgba(hex, alpha) {
  const value = String(hex).toLowerCase();
  if (!HEX.test(value)) throw new Error(`Effect color ${hex} is not a resolved hex color`);
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(value.slice(i, i + 2), 16));
  return `rgb(${r} ${g} ${b} / ${num(Math.min(1, Math.max(0, alpha)))})`;
}

/** Parameters clamped to their schema bounds, with defaults for anything missing. */
export function boundedParams(id, params = {}) {
  const spec = EFFECT_PARAMETERS[id];
  if (!spec) throw new Error(`Unknown effect ${id}`);
  const out = {};
  for (const [name, rule] of Object.entries(spec)) {
    const value = params[name];
    if (rule.enum) out[name] = rule.enum.includes(value) ? value : rule.default;
    else if (typeof value !== "number" || !Number.isFinite(value)) out[name] = rule.default;
    else {
      const clamped = Math.min(rule.maximum, Math.max(rule.minimum, value));
      out[name] = rule.type === "integer" ? Math.round(clamped) : clamped;
    }
  }
  return out;
}

// Where each effect draws. Strips carry everything; the small badge leaves out drifting flecks and
// orbit rings; a caption edge is only a rail, with glow on it.
export const BOX_EFFECTS = Object.freeze({
  strip: ["grid", "scanlines", "paper", "rules", "echo", "rail", "glow", "orbit", "seal", "drift"],
  badge: ["grid", "scanlines", "paper", "rules", "echo", "rail", "glow", "seal"],
  edge: ["rail", "glow"],
});

/**
 * The owned nodes one effect adds to one box. `primary` is the single box allowed to move; drift
 * and echo copies elsewhere stay static. Returns [{ className, animated }].
 */
export function effectNodes(id, params, { box, primary, motion }) {
  if (!BOX_EFFECTS[box].includes(id)) return [];
  const animated = Boolean(primary && motion && EFFECTS[id].motion);
  if (id === "drift") {
    // At rest only the first fleck shows, which is also the reduced-motion fallback; the others
    // exist only while they can make their one pass.
    const count = animated ? params.count : 1;
    return Array.from({ length: count }, (_, i) => ({ className: `rs-fx rs-fx-drift rs-p${i + 1}`, animated }));
  }
  if (id === "echo") return [1, 2].map((i) => ({ className: `rs-fx rs-fx-echo rs-e${i}`, animated }));
  return [{ className: `rs-fx rs-fx-${id}`, animated: false }];
}

// Rules for one effect, given the resolved tokens and its bounded parameters.
const TEMPLATES = {
  glow({ strength }, t) {
    const c = rgba(t.accent, strength);
    return [
      `.rs-fx-glow{left:0;right:0;bottom:0;height:1px;background:${c};box-shadow:0 0 6px 1px ${c}}`,
      `.rs-box--badge>.rs-fx-glow{top:0;height:auto;background:none;border:1px solid ${c};border-radius:inherit;box-shadow:0 0 6px 0 ${c}}`,
    ];
  },
  grid({ opacity, size }, t) {
    const c = rgba(t.mutedText, opacity);
    return [`.rs-fx-grid{inset:0;background-image:linear-gradient(to right,${c} 1px,transparent 1px),linear-gradient(to bottom,${c} 1px,transparent 1px);background-size:${size}px ${size}px}`];
  },
  scanlines({ opacity, spacing }, t) {
    const c = rgba(t.mutedText, opacity);
    return [`.rs-fx-scanlines{inset:0;background-image:repeating-linear-gradient(to bottom,${c} 0 1px,transparent 1px ${spacing}px)}`];
  },
  paper({ texture, opacity, scale }, t) {
    const c = rgba(t.mutedText, opacity);
    if (texture === "halftone") {
      const r = num(scale * 0.18);
      const dot = `radial-gradient(circle,${c} 0 ${r}px,transparent ${num(scale * 0.18 + 0.6)}px)`;
      return [`.rs-fx-paper{inset:0;background:${dot} 0 0/${scale}px ${scale}px,${dot} ${num(scale / 2)}px ${num(scale / 2)}px/${scale}px ${scale}px}`];
    }
    // Grain: three fixed fleck tiles of coprime sizes, so the pattern reads as irregular without
    // any random input.
    const fleck = (x, y, r) => `radial-gradient(circle at ${x}% ${y}%,${c} 0 ${r}px,transparent ${num(r + 0.5)}px)`;
    return [
      `.rs-fx-paper{inset:0;background-image:${fleck(23, 31, 0.7)},${fleck(71, 64, 0.6)},${fleck(46, 88, 0.8)};background-size:${scale * 3}px ${scale * 3}px,${scale * 5}px ${scale * 5}px,${scale * 7}px ${scale * 7}px}`,
    ];
  },
  rail({ shape, opacity, thickness: w }, t) {
    const c = rgba(t.accent, opacity);
    const solid = `linear-gradient(${c},${c})`;
    const shapes = {
      // A diagonal cable that drops into a straight run.
      slash: [Math.max(10, w + 6), `${solid} right bottom/calc(100% - 10px) ${w}px no-repeat,linear-gradient(to top right,transparent calc(50% - ${num(w * 0.7)}px),${c} calc(50% - ${num(w * 0.7)}px) calc(50% + ${num(w * 0.7)}px),transparent calc(50% + ${num(w * 0.7)}px)) left bottom/10px 10px no-repeat`],
      // A run broken by one raised notch.
      notch: [w + 4, `${solid} left bottom/30% ${w}px no-repeat,${solid} right bottom/62% ${w}px no-repeat,${solid} 31% top/6% ${w}px no-repeat`],
      // Shallow teeth above a base line.
      tooth: [w + 4, `${solid} left bottom/100% ${w}px no-repeat,linear-gradient(135deg,${c} 25%,transparent 25%) left top/8px 4px repeat-x,linear-gradient(225deg,${c} 25%,transparent 25%) left top/8px 4px repeat-x`],
      // Paired arcs, one row up and one down, forming a wave.
      wave: [8, `radial-gradient(circle at 50% 100%,transparent ${num(6 - w)}px,${c} ${num(6 - w)}px 6px,transparent 6px) left bottom/16px 8px repeat-x,radial-gradient(circle at 50% 0,transparent ${num(6 - w)}px,${c} ${num(6 - w)}px 6px,transparent 6px) 8px top/16px 8px repeat-x`],
      // A dashed route with waypoints.
      route: [7, `repeating-linear-gradient(to right,${c} 0 6px,transparent 6px 10px) left center/100% ${w}px no-repeat,radial-gradient(circle,${c} 0 2.5px,transparent 3px) left center/48px 7px repeat-x`],
    };
    const [height, background] = shapes[shape];
    return [`.rs-fx-rail{left:0;right:0;bottom:0;height:${height}px;background:${background}}`];
  },
  rules({ style, opacity, spacing }, t) {
    const c = rgba(t.primaryBackground, opacity);
    const solid = `linear-gradient(${c},${c})`;
    if (style === "margin") return [`.rs-fx-rules{inset:0;background:${solid} 12px 0/1px 100% no-repeat}`];
    if (style === "ruled") return [`.rs-fx-rules{inset:0;background-image:repeating-linear-gradient(to bottom,transparent 0 ${spacing - 1}px,${c} ${spacing - 1}px ${spacing}px)}`];
    // Ticks: the one shared geometry. Five equal 6x1px marks at top offsets 0,4,0,4,0, separated by spacing.
    const ticks = [0, 4, 0, 4, 0].map((y, i) => `${solid} ${i * (6 + spacing)}px ${y}px/6px 1px no-repeat`).join(",");
    return [`.rs-fx-rules{left:8px;top:6px;width:${5 * 6 + 4 * spacing}px;height:5px;background:${ticks}}`];
  },
  orbit({ shape, count, opacity }, t) {
    const ring = rgba(t.accent, opacity);
    const dot = rgba(t.primaryBackground, opacity);
    const [width, height] = { circle: [10, 10], ellipse: [24, 8], arc: [12, 12] }[shape];
    const border = shape === "arc" ? `border:1px solid transparent;border-top-color:${ring};border-right-color:${ring}` : `border:1px solid ${ring}`;
    const rings = [];
    if (count >= 2) rings.push(`.rs-fx-orbit::before{content:"";position:absolute;inset:-4px;border:inherit;border-radius:50%}`);
    if (count >= 3) rings.push(`.rs-fx-orbit::after{content:"";position:absolute;inset:-8px;border:inherit;border-radius:50%}`);
    return [
      `.rs-fx-orbit{right:${count >= 3 ? 12 : 8}px;top:calc(50% - ${height / 2}px);width:${width}px;height:${height}px;${border};border-radius:50%;background:radial-gradient(circle at 85% 15%,${dot} 0 2px,transparent 2.5px)}`,
      ...rings,
    ];
  },
  seal({ shape, size, opacity }, t) {
    const c = rgba(t.primaryBackground, opacity);
    const solid = `linear-gradient(${c},${c})`;
    const base = `.rs-fx-seal{left:4px;top:calc(50% - ${num(size / 2)}px);width:${size}px;height:${size}px}`;
    const badge = `.rs-box--badge>.rs-fx-seal{position:relative;left:auto;top:auto;flex:none;width:${Math.min(size, 16)}px;height:${Math.min(size, 16)}px}`;
    const pseudo = (part, rule) => `.rs-fx-seal::${part}{content:"";position:absolute;box-sizing:border-box;${rule}}`;
    const shapes = {
      diamond: [pseudo("before", `inset:15%;border:1.5px solid ${c};transform:rotate(45deg)`)],
      brackets: [pseudo("before", `left:0;top:0;bottom:0;width:30%;border:1.5px solid ${c};border-right:0`), pseudo("after", `right:0;top:0;bottom:0;width:30%;border:1.5px solid ${c};border-left:0`)],
      compass: [`.rs-fx-seal{border:1.5px solid ${c};border-radius:50%}`, pseudo("after", `width:1.5px;height:35%;right:12%;top:-10%;background:${c};transform:rotate(35deg)`)],
      sprig: [
        `.rs-fx-seal{background:radial-gradient(ellipse 18% 32% at 50% 40%,${c} 0 96%,transparent 100%)}`,
        pseudo("before", `left:2%;top:42%;width:42%;height:24%;border-radius:0 100% 0 100%;background:${c};transform:rotate(-28deg)`),
        pseudo("after", `right:2%;top:42%;width:42%;height:24%;border-radius:100% 0 100% 0;background:${c};transform:rotate(28deg)`),
      ],
      rosette: [`.rs-fx-seal{background:${solid} 35% 0/32% 32% no-repeat,${solid} 100% 35%/32% 32% no-repeat,${solid} 65% 100%/32% 32% no-repeat,${solid} 0 65%/32% 32% no-repeat}`],
    };
    return [base, badge, ...shapes[shape]];
  },
  drift({ shape, durationMs, distance, opacity }, t) {
    const c = rgba(t.mutedText, opacity);
    const look = {
      mote: `width:4px;height:4px;border-radius:50%;background:${c}`,
      ember: `width:5px;height:5px;border-radius:1px;background:${c};transform:rotate(45deg)`,
      petal: `width:8px;height:5px;border-radius:0 100% 0 100%;background:${c}`,
      wisp: `width:18px;height:6px;border-top:1px solid ${c};border-radius:50%`,
    }[shape];
    const turn = shape === "ember" ? " rotate(45deg)" : "";
    const d = distance;
    // Fixed resting places in the strip's blank middle. Only the first is visible at rest.
    const rest = [["30%", "8px"], ["46%", "16px"], ["58%", "6px"], ["68%", "14px"]];
    return [
      `.rs-fx-drift{${look}}`,
      ...rest.map(([right, top], i) => `.rs-fx-drift.rs-p${i + 1}{right:${right};top:${top}${i ? ";opacity:0" : ""}}`),
      `@keyframes rs-drift-in{from{opacity:0;transform:translate(-${d}px,${num(d / 2)}px)${turn}}to{opacity:1;transform:${turn.trim() || "none"}}}`,
      `@keyframes rs-drift-pass{0%{opacity:0;transform:${turn.trim() || "none"}}35%{opacity:1}100%{opacity:0;transform:translate(${d}px,-${num(d / 2)}px)${turn}}}`,
      `.rs-box[data-rs-play] .rs-fx-drift.rs-p1{animation:rs-drift-in ${durationMs}ms ease-out 1 both}`,
      ...[2, 3, 4].map((i) => `.rs-box[data-rs-play] .rs-fx-drift.rs-p${i}{animation:rs-drift-pass ${Math.round(durationMs * (1 - (i - 1) * 0.12))}ms ease-out 1 both}`),
    ];
  },
  echo({ offset: o, durationMs, opacity }, t) {
    const a = rgba(t.accent, opacity);
    const p = rgba(t.primaryBackground, opacity);
    return [
      // Two copies of the box geometry, never of its text: outlines behind a badge, rails under a strip.
      `.rs-fx-echo{left:0;top:0;width:min(96px,100%);height:100%;border:1px solid ${a};border-radius:inherit;z-index:-1}`,
      `.rs-fx-echo.rs-e2{border-color:${p}}`,
      `.rs-fx-echo.rs-e1{transform:translate(${o}px,${o}px)}`,
      `.rs-fx-echo.rs-e2{transform:translate(-${o}px,-${o}px)}`,
      `.rs-box--strip>.rs-fx-echo{left:auto;right:0;top:auto;bottom:0;height:2px;border:0;background:${a};z-index:0}`,
      `.rs-box--strip>.rs-fx-echo.rs-e2{background:${p}}`,
      `@keyframes rs-echo-1{from{opacity:0;transform:translate(${3 * o}px,${3 * o}px)}to{opacity:1;transform:translate(${o}px,${o}px)}}`,
      `@keyframes rs-echo-2{from{opacity:0;transform:translate(-${3 * o}px,-${3 * o}px)}to{opacity:1;transform:translate(-${o}px,-${o}px)}}`,
      `.rs-box[data-rs-play]>.rs-fx-echo.rs-e1{animation:rs-echo-1 ${durationMs}ms ease-out 1 both}`,
      `.rs-box[data-rs-play]>.rs-fx-echo.rs-e2{animation:rs-echo-2 ${durationMs}ms ease-out 1 both}`,
    ];
  },
};

/** CSS rules for one requested effect. */
export function effectCss(id, params, tokens) {
  return TEMPLATES[id](boundedParams(id, params), tokens);
}

/** The longest motion of a theme's effects, in ms, or 0. */
export function motionMs(effects) {
  return Math.max(0, ...["drift", "echo"].filter((id) => effects[id]).map((id) => boundedParams(id, effects[id]).durationMs));
}
