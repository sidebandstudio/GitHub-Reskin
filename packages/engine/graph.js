// Contribution graph ramps, levels 0..4. A ramp is valid when its five colors are distinct,
// luminance moves away from the canvas level by level (up on dark bases, down on light),
// contrast against level 0 strictly increases, adjacent OKLab lightness differs by at least 0.04
// and every active level reaches 3:1 against the graph canvas.
import { BLACK, WHITE, contrast, luminance, mix, oklab } from "./color.js";

export const GRAPH_MIN_CONTRAST = 3;
export const GRAPH_MIN_OKLAB_STEP = 0.04;
const DERIVED_STEPS = [0.35, 0.55, 0.78, 1];

// Lightness direction of the ramp, from the explicit base alone: increasing luminance on dark
// bases, decreasing on light. A base that contradicts its colors never reaches the ramp; the
// engine refuses it with a base-polarity issue so the caller can offer the other base.
export const rampDirection = (base) => (base === "dark" ? "up" : "down");

const lightnessCache = new Map();
function lightness(hex) {
  let value = lightnessCache.get(hex);
  if (value === undefined) {
    if (lightnessCache.size > 65536) lightnessCache.clear();
    lightnessCache.set(hex, (value = oklab(hex)[0]));
  }
  return value;
}

/** Problems with a ramp, as readable strings. Empty means valid. */
export function graphProblems(levels, canvas, direction, { first = false } = {}) {
  const problems = [];
  const push = (problem) => problems.push(problem) && first;
  if (new Set(levels.map((c) => c.toLowerCase())).size !== 5 && push("levels are not five distinct colors")) return problems;
  for (let i = 1; i < 5; i++) {
    const [a, b] = [luminance(levels[i - 1]), luminance(levels[i])];
    if ((direction === "up" ? !(b > a) : !(b < a)) && push(`level ${i} is not ${direction === "up" ? "lighter" : "darker"} than level ${i - 1}`)) return problems;
    if (contrast(levels[i], canvas) < GRAPH_MIN_CONTRAST && push(`level ${i} is below ${GRAPH_MIN_CONTRAST}:1 against the canvas`)) return problems;
    if (i > 1 && !(contrast(levels[i], levels[0]) > contrast(levels[i - 1], levels[0])) && push(`level ${i} does not stand out more from level 0 than level ${i - 1}`)) return problems;
    if (Math.abs(lightness(levels[i].toLowerCase()) - lightness(levels[i - 1].toLowerCase())) < GRAPH_MIN_OKLAB_STEP && push(`levels ${i - 1} and ${i} are too close in lightness`)) return problems;
  }
  return problems;
}

export const deriveRamp = (canvas, text, seed) => [mix(canvas, text, 0.09), ...DERIVED_STEPS.map((t) => mix(canvas, seed, t))];

// Levels 1..4 spread evenly from the first k/255 mix (at least 0.35) that reaches 3:1 on the
// canvas up to the seed. Contrast grows monotonically along the mix, so a binary search finds it.
function spacedRamp(canvas, text, seed) {
  const reaches = (k) => contrast(mix(canvas, seed, k / 255), canvas) >= GRAPH_MIN_CONTRAST;
  let [lo, hi] = [Math.ceil(0.35 * 255), 255];
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (reaches(mid)) hi = mid;
    else lo = mid + 1;
  }
  const first = lo / 255;
  return [mix(canvas, text, 0.09), ...[0, 1, 2, 3].map((i) => mix(canvas, seed, first + ((1 - first) * i) / 3))];
}

/**
 * A valid ramp for this canvas, trying in a fixed order: the supplied ramp, the derived ramp,
 * the derived ramp with its seed moved toward the direction's extreme in 1/255 steps, an evenly
 * spaced ramp along the same path, then the documented seed ramp. `method` names the step used.
 * @returns {{levels:string[], method:string, problems:string[]}}
 */
export function resolveRamp({ supplied, canvas, text, seed, base, fallback }) {
  const direction = rampDirection(base);
  const ok = (levels) => !graphProblems(levels, canvas, direction, { first: true }).length;
  if (supplied && ok(supplied)) return { levels: supplied.map((c) => c.toLowerCase()), method: "supplied", problems: [] };
  const derived = deriveRamp(canvas, text, seed);
  if (ok(derived)) return { levels: derived, method: "derived", problems: [] };
  const extreme = direction === "up" ? WHITE : BLACK;
  for (let k = 1; k <= 255; k++) {
    const levels = deriveRamp(canvas, text, mix(seed, extreme, k / 255));
    if (ok(levels)) return { levels, method: "derived-strengthened", problems: [] };
  }
  for (let k = 0; k <= 255; k++) {
    const levels = spacedRamp(canvas, text, mix(seed, extreme, k / 255));
    if (ok(levels)) return { levels, method: "spaced", problems: [] };
  }
  if (fallback && ok(fallback)) return { levels: [...fallback], method: "seed", problems: [] };
  // Level 0 itself can sit too close to the canvas extreme; move it back toward the canvas.
  for (let k = 0; k <= 255; k++) {
    const levels = spacedRamp(canvas, mix(text, canvas, k / 255), extreme);
    if (ok(levels)) return { levels, method: "spaced-neutral", problems: [] };
  }
  const levels = spacedRamp(canvas, text, extreme);
  return { levels, method: "unresolved", problems: graphProblems(levels, canvas, direction) };
}
