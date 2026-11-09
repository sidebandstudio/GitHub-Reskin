// Which owned nodes a theme adds, before any DOM exists. The plan enforces the document limits:
// at most 24 owned nodes and six animated ones, and only one box per document may move.
import { FLAVOR_SLOT_IDS } from "../contracts/index.js";
import { BOX_EFFECTS, boundedParams, effectNodes } from "./effects.js";
import { LIMITS } from "./registry.js";
import { structuredPlan } from "./paint.js";

// The profile banner is a decorative region, not a flavor slot: a host that can reserve one above
// the profile passes an anchor for this slot.
export const BANNER_SLOT = "profile.banner";

// Each slot's shape: headings get an out-of-flow strip in the blank end of their row, the profile
// tag a badge, captions an in-flow paragraph of copy with an optional out-of-flow edge at the
// blank end of its last line. The footer sign-off is a caption: a line of copy after GitHub's
// copyright, in the footer's own row.
export const SLOT_KINDS = Object.freeze({
  "profile.pinned.heading": "heading",
  "profile.activity.heading": "heading",
  "profile.organizations.heading": "heading",
  "profile.tag": "tag",
  "error.notFound.caption": "caption",
  "empty.pinned.caption": "caption",
  "empty.issues.caption": "caption",
  "contributions.caption": "caption",
  "footer.signoff": "caption",
  "profile.achievements.heading": "heading",
});
const BOX_OF = { heading: "strip", tag: "badge", caption: "edge" };

// Structural nodes: a caption is its paragraph, its copy and an edge box only when the edge draws
// something; a heading or tag is its wrapper, its box and its copy when there is any.
const structural = (kind, copy, decorated) => (kind === "caption" ? 1 + (copy ? 1 : 0) + (decorated ? 1 : 0) : 2 + (copy ? 1 : 0));

/**
 * What a resolved theme may show under the effective preferences. Native and forced-color
 * policies, a disabled extension and Flavor extras off show nothing. Text also needs the theme's
 * own flavor request in English; motion needs effects, Motion and an unreduced, themed resolution.
 */
export function effectiveAppearance(resolved, prefs) {
  const on = resolved?.policy === "themed" && Boolean(prefs?.enabled && prefs?.extras);
  const effects = on && Boolean(prefs.effects) && Object.keys(resolved.effects).length > 0;
  return Object.freeze({
    text: on && Boolean(prefs.text) && resolved.flavor.enabled === true && resolved.flavor.locale === "en",
    fonts: on && Boolean(prefs.fonts) && resolved.font !== "system",
    effects,
    motion: effects && Boolean(prefs.motion) && resolved.motionAllowed === true,
  });
}

/**
 * The owned-node plan for the given slots, in registry order. Each entry is
 * { slot, kind, box, copy, effects: [{ id, nodes }] }, and the totals are counted the way the
 * DOM will be: the slot wrapper, its box, the copy span and every effect node. `styled` lists the
 * slots the theme's admitted CSS styles: that CSS is the whole treatment of a styled tag or caption,
 * so packaged effects stay out of it rather than drawing over or beside its copy.
 */
export function planAppearance(resolved, prefs, slots, { styled = [] } = {}) {
  const effective = effectiveAppearance(resolved, prefs);
  const wanted = new Set(slots);
  const requested = effective.effects ? Object.keys(resolved.effects) : [];
  const entries = [];
  for (const slot of FLAVOR_SLOT_IDS) {
    if (!wanted.has(slot)) continue;
    const kind = SLOT_KINDS[slot];
    const text = resolved.flavor?.slots?.[slot];
    const copy = effective.text && typeof text === "string" && text.trim() ? text : null;
    // Text off removes the tag and captions. A heading strip stays for its effects.
    if (copy || (kind === "heading" && requested.length)) entries.push({ slot, kind, box: BOX_OF[kind], copy, effects: [] });
  }

  // Copy comes first: every slot with text gets its structural nodes before any decoration.
  let owned = entries.reduce((n, e) => n + (e.copy ? structural(e.kind, e.copy, false) : 0), 0);
  while (owned > LIMITS.maxOwnedNodes) owned -= structural(entries.pop().kind, true, false);
  // Then the banner, one node, when Full draws a banner paint and the host reserved its place.
  const banner = wanted.has(BANNER_SLOT) && Boolean(structuredPlan(resolved, prefs).banner) && owned < LIMITS.maxOwnedNodes;
  if (banner) owned += 1;
  // Then decoration, slot by slot, while it fits. drift and echo move in the first box that has
  // them and stay still everywhere else.
  const moved = new Set();
  let animated = 0;
  for (const entry of entries) {
    if (entry.box !== "strip" && styled.includes(entry.slot)) continue;
    const effects = BOX_EFFECTS[entry.box]
      .filter((id) => requested.includes(id))
      .map((id) => {
        const primary = effective.motion && !moved.has(id);
        return { id, nodes: effectNodes(id, boundedParams(id, resolved.effects[id]), { box: entry.box, primary, motion: effective.motion }) };
      });
    const extra = effects.length ? structural(entry.kind, entry.copy, true) - (entry.copy ? structural(entry.kind, entry.copy, false) : 0) + effects.reduce((n, e) => n + e.nodes.length, 0) : 0;
    if (!effects.length || owned + extra > LIMITS.maxOwnedNodes) continue;
    entry.effects = effects;
    owned += extra;
    for (const effect of effects) {
      const moving = effect.nodes.filter((node) => node.animated).length;
      if (moving) moved.add(effect.id);
      animated += moving;
    }
  }
  const planned = entries.filter((entry) => entry.copy || entry.effects.length);
  if (animated > LIMITS.maxAnimatedNodes) throw new Error(`Appearance plan animates ${animated} nodes; the limit is ${LIMITS.maxAnimatedNodes}`);
  return { effective, slots: planned, banner, owned, animated };
}

/** CompiledStyle.ownedNodePlan entries for the given slots: one { slot, animated } per owned node. */
export function ownedNodePlan(resolved, prefs, slots, options) {
  const out = [];
  const plan = planAppearance(resolved, prefs, slots, options);
  if (plan.banner) out.push({ slot: BANNER_SLOT, animated: false });
  for (const entry of plan.slots) {
    for (let i = 0; i < structural(entry.kind, entry.copy, entry.effects.length); i++) out.push({ slot: entry.slot, animated: false });
    for (const effect of entry.effects) for (const node of effect.nodes) out.push({ slot: entry.slot, animated: node.animated });
  }
  return out;
}
