// mountAppearance: creates the owned decoration for verified slot anchors and removes all of it on
// destroy. Copy enters only through textContent. Every owned node is aria-hidden, unfocusable and
// pointer-transparent, and no GitHub element is edited, moved, relabeled or restyled.
import { LIMITS } from "./registry.js";
import { motionMs } from "./effects.js";
import { planAppearance } from "./plan.js";

export const OWNED_ATTRIBUTE = "data-reskin-owned";
const INSERTS = ["after", "append", "before"];
// Defense in depth behind the adapter's own locator rules: never decorate inside authored or
// interactive content, even if an anchor points there.
const FORBIDDEN = [
  ".markdown-body", ".comment-body", ".js-comment-body", ".blob-wrapper", ".js-file-content", ".diff-table", ".js-issue-title",
  "pre", "code", "table", "svg", "a", "button", "input", "select", "textarea", "label", "form", "summary",
  "[contenteditable]", "[role=button]", "[role=tab]", "[role=menuitem]", "[role=link]", "[tabindex]",
].join(",");

/** Anchors that may be decorated: one per slot, inside root, outside authored or interactive content. */
export function usableAnchors(root, anchors) {
  const seen = new Set();
  const out = [];
  for (const anchor of anchors || []) {
    const host = anchor?.host;
    if (!host || host.nodeType !== 1 || !host.isConnected || !INSERTS.includes(anchor.insert) || seen.has(anchor.slot)) continue;
    if (root !== host && !root.contains(host)) continue;
    if (host.closest(FORBIDDEN) || host.querySelector(`[${OWNED_ATTRIBUTE}]`)) continue;
    const neighbor = anchor.insert === "after" ? host.nextElementSibling : anchor.insert === "before" ? host.previousElementSibling : null;
    if (neighbor?.hasAttribute(OWNED_ATTRIBUTE)) continue;
    seen.add(anchor.slot);
    out.push(anchor);
  }
  return out;
}

const noop = Object.freeze({ destroy() {}, play: () => false, motionBoxes: () => [], owned: 0, animated: 0 });

const overlaps = (a, b) => a.width > 0 && a.height > 0 && b.width > 0 && b.height > 0 && a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom;

// The line boxes of every text node under node, optionally skipping text inside owned nodes.
function textRects(doc, node, skipOwned) {
  const rects = [];
  const range = doc.createRange();
  const walker = doc.createTreeWalker(node, 4);
  for (let text = walker.nextNode(); text; text = walker.nextNode()) {
    if (!text.data.trim() || (skipOwned && text.parentElement?.closest(`[${OWNED_ATTRIBUTE}]`))) continue;
    range.selectNodeContents(text);
    rects.push(...range.getClientRects());
  }
  return rects;
}

// What an overlay box may not cover: the line boxes of the host's own native text and the boxes
// of its native neighbors. Owned copy is never an obstacle: an appended slot's copy sits inside
// its own box, beneath the host.
function obstacles(doc, host) {
  const rects = textRects(doc, host, true);
  const native = (node, step) => {
    while (node?.hasAttribute(OWNED_ATTRIBUTE)) node = node[step];
    return node;
  };
  for (const node of [native(host.previousElementSibling, "previousElementSibling"), native(host.nextElementSibling, "nextElementSibling")]) if (node) rects.push(node.getBoundingClientRect());
  return rects;
}

/**
 * Mounts the owned nodes for root's anchors. Returns { destroy(), play(), motionBoxes(), owned,
 * animated }. play() runs the theme's one finite pass of motion, for an explicit theme selection
 * only; it returns false and leaves the static state when motion is off, reduced, hidden or
 * offscreen, and stops a box's pass when the box leaves the viewport.
 */
export function mountAppearance(root, resolved, prefs, anchors) {
  const doc = root?.ownerDocument ?? root;
  const view = doc?.defaultView;
  if (!doc?.createElement || view?.matchMedia?.("(forced-colors: active)").matches) return noop;
  const usable = usableAnchors(root, anchors);
  const plan = planAppearance(resolved, prefs, usable.map((anchor) => anchor.slot));
  if (!plan.slots.length) return noop;

  const created = [];
  const moving = [];
  const make = (tag, className, parent) => {
    const node = doc.createElement(tag);
    node.className = className;
    if (parent) parent.append(node);
    return node;
  };
  for (const entry of plan.slots) {
    const anchor = usable.find((a) => a.slot === entry.slot);
    const caption = entry.kind === "caption";
    const wrapper = make(caption ? "p" : "span", `rs-slot rs-slot--${caption ? "caption" : entry.kind === "tag" ? "overlay rs-slot--tag" : "overlay"}`);
    wrapper.setAttribute(OWNED_ATTRIBUTE, entry.slot);
    wrapper.setAttribute("aria-hidden", "true");
    let copy = null;
    if (entry.copy) {
      copy = make("span", `rs-copy rs-copy--${entry.kind}`);
      copy.textContent = entry.copy;
    }
    let box = null;
    if (!caption || entry.effects.length) box = make("span", `rs-box rs-box--${entry.box}`, wrapper);
    for (const effect of entry.effects) {
      for (const node of effect.nodes) {
        make("span", node.className, box);
        if (node.animated && !moving.includes(box)) moving.push(box);
      }
    }
    // Copy reads after the decoration so it stacks above it; a caption's copy leads its paragraph.
    if (copy) (caption ? wrapper.prepend(copy) : box.append(copy));
    // A zero-height wrapper leaves block flow untouched. In a flex row it fills the free space
    // beside the host; under grid or column layout it would become an item, so it leaves the
    // flow and hangs from the top right of the containing block instead. An appended wrapper's
    // container is the host itself.
    const container = anchor.insert === "append" ? anchor.host : anchor.host.parentElement;
    if (!caption && container) {
      const parent = view?.getComputedStyle?.(container);
      const display = parent?.display ?? "block";
      if (/flex/.test(display) && !/column/.test(parent.flexDirection)) wrapper.setAttribute("data-rs-row", "");
      else if (!/^(block|flow-root|list-item)$/.test(display)) wrapper.setAttribute("data-rs-out", "");
    }
    if (anchor.insert === "after") anchor.host.after(wrapper);
    else if (anchor.insert === "before") anchor.host.before(wrapper);
    else anchor.host.append(wrapper);
    // Decoration must land in blank space. An overlay may not cover the host's native text or a
    // native neighbor; a caption edge, which hangs out of flow at the end of its paragraph, may
    // not cover the caption's own copy either. If the first place is not blank, try the one
    // alternate place; if that is not blank either, leave the slot out (a caption keeps its copy
    // and drops only its edge).
    if (box) {
      // Leaving the root's area counts as blocked too: a box nobody can see is not blank space.
      const bounds = (root.nodeType === 9 ? root.documentElement : root).getBoundingClientRect();
      const blocked = () => {
        const rect = box.getBoundingClientRect();
        const covered = caption ? textRects(doc, wrapper, false) : obstacles(doc, anchor.host);
        return rect.top < bounds.top || rect.left < bounds.left || rect.right > bounds.right || covered.some((other) => overlaps(rect, other));
      };
      if (blocked()) {
        wrapper.setAttribute("data-rs-alt", "");
        if (blocked()) {
          if (moving.includes(box)) moving.splice(moving.indexOf(box), 1);
          if (caption && copy) {
            wrapper.removeAttribute("data-rs-alt");
            box.remove();
          } else {
            wrapper.remove();
            continue;
          }
        }
      }
    }
    created.push(wrapper);
  }
  const owned = created.reduce((n, wrapper) => n + 1 + wrapper.querySelectorAll("*").length, 0);
  const animated = moving.reduce((n, box) => n + box.querySelectorAll(".rs-fx-drift, .rs-fx-echo").length, 0);

  const duration = Math.min(LIMITS.maxAnimationMs, motionMs(resolved.effects)) + 50;
  let timer = null;
  let watcher = null;
  const stop = () => {
    if (timer !== null) view?.clearTimeout(timer);
    timer = null;
    watcher?.disconnect();
    watcher = null;
    for (const box of moving) box.removeAttribute("data-rs-play");
  };
  const onVisibility = () => doc.hidden && stop();
  doc.addEventListener?.("visibilitychange", onVisibility);
  // The pass ends when the last animation in a playing box ends. A frame without scripts (the
  // preview's sandbox) runs no timers of its own, but still delivers these events.
  const onEnd = (event) => {
    const box = event.currentTarget;
    if (!box.getAnimations?.({ subtree: true }).some((a) => a.playState === "running")) box.removeAttribute("data-rs-play");
  };
  for (const box of moving) {
    box.addEventListener("animationend", onEnd);
    box.addEventListener("animationcancel", onEnd);
  }
  let destroyed = false;
  const motionAllowed = () => !destroyed && plan.effective.motion && moving.length > 0 && !doc.hidden && !view?.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
  // A box is visible when it intersects this document's viewport. That is the page's viewport on
  // github.com; a host that renders decoration in a frame of its own decides with motionBoxes().
  const inViewport = (box) => {
    const rect = box.getBoundingClientRect();
    return rect.width > 0 && rect.height > 0 && rect.bottom > 0 && rect.right > 0 && rect.top < (view?.innerHeight ?? 0) && rect.left < (view?.innerWidth ?? 0);
  };

  return {
    owned,
    animated: plan.effective.motion ? animated : 0,
    /** The boxes that may make a pass now, before any visibility test; [] when motion is off. */
    motionBoxes: () => (motionAllowed() ? [...moving] : []),
    play() {
      if (!motionAllowed()) return false;
      const visible = moving.filter(inViewport);
      if (!visible.length) return false;
      stop();
      for (const box of visible) box.setAttribute("data-rs-play", "");
      timer = view.setTimeout(stop, duration);
      // A box that leaves the viewport during its pass returns to rest at once and does not
      // play again when it comes back.
      if (typeof view.IntersectionObserver === "function") {
        watcher = new view.IntersectionObserver((entries) => {
          for (const entry of entries) if (!entry.isIntersecting) entry.target.removeAttribute("data-rs-play");
        });
        for (const box of visible) watcher.observe(box);
      }
      return true;
    },
    destroy() {
      if (destroyed) return;
      destroyed = true;
      stop();
      doc.removeEventListener?.("visibilitychange", onVisibility);
      for (const box of moving) {
        box.removeEventListener("animationend", onEnd);
        box.removeEventListener("animationcancel", onEnd);
      }
      for (const node of created) node.remove();
      created.length = 0;
    },
  };
}
