// mountAppearance: creates the owned decoration for verified slot anchors and removes all of it on
// destroy. Copy enters only through textContent. Every owned node is aria-hidden, unfocusable and
// pointer-transparent, and no GitHub element is edited, moved, relabeled or restyled.
import { LIMITS } from "./registry.js";
import { motionMs } from "./effects.js";
import { BANNER_SLOT, planAppearance } from "./plan.js";
import { CORNER_SLOTS, ownedThemeCss } from "./compile.js";
import { THEMED_SWITCH } from "./paint.js";

export const OWNED_ATTRIBUTE = "data-reskin-owned";
// The node a theme's owned CSS styles carries its exact slot, as the CSS compiler requires.
export const SLOT_ATTRIBUTE = "data-reskin-slot";
// Below this width an illustration has no reliable blank corner, and a corner caption flows.
const CORNER_MIN_WIDTH = 480;
// The profile tag's distance above the line box of the name it labels.
const TAG_GAP = 2;
// A native neighbor with more elements than this counts as its whole box.
const NEIGHBOR_ELEMENTS = 32;
const CLEAR = /^(transparent|rgba\(.*,\s*0\))$/;
const DRAWN = /^(img|svg|video|canvas|iframe|input|select|textarea|button)$/i;
const INSERTS = ["after", "append", "before"];
// Defense in depth behind the adapter's own locator rules: never decorate inside authored or
// interactive content, even if an anchor points there.
const FORBIDDEN = [
  ".markdown-body", ".comment-body", ".js-comment-body", ".blob-wrapper", ".js-file-content", ".diff-table", ".js-issue-title",
  "pre", "code", "table", "svg", "a", "button", "input", "select", "textarea", "label", "form", "summary",
  "[contenteditable]", "[role=button]", "[role=tab]", "[role=menuitem]", "[role=link]", "[tabindex]",
].join(",");

// Whether the Primer adapter themes the mode island node's content follows. Its compiled CSS must
// be in the document first; without it nothing is themed and nothing is decorated.
const themedAt = (node) => node?.ownerDocument?.defaultView?.getComputedStyle(node).getPropertyValue(THEMED_SWITCH).trim() === "1";

/**
 * Anchors that may be decorated: one per slot, inside root, outside authored or interactive
 * content, where the owned node's parent is in a mode island the Primer adapter themes.
 */
export function usableAnchors(root, anchors) {
  const seen = new Set();
  const out = [];
  for (const anchor of anchors || []) {
    const host = anchor?.host;
    if (!host || host.nodeType !== 1 || !host.isConnected || !INSERTS.includes(anchor.insert) || seen.has(anchor.slot)) continue;
    if (root !== host && !root.contains(host)) continue;
    if (host.closest(FORBIDDEN) || host.querySelector(`[${OWNED_ATTRIBUTE}]`)) continue;
    if (!themedAt(anchor.insert === "append" ? host : host.parentElement)) continue;
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

// The nearest native element from node in one direction, skipping owned ones.
function nativeSibling(node, step) {
  while (node?.hasAttribute(OWNED_ATTRIBUTE)) node = node[step];
  return node;
}

// What an overlay box may not cover: the line boxes of the host's own native text and the boxes
// of its native neighbors. Owned copy is never an obstacle: an appended slot's copy sits inside
// its own box, beneath the host.
function obstacles(doc, host) {
  const rects = textRects(doc, host, true);
  for (const node of [nativeSibling(host.previousElementSibling, "previousElementSibling"), nativeSibling(host.nextElementSibling, "nextElementSibling")]) if (node) rects.push(node.getBoundingClientRect());
  return rects;
}

// An element paints its border box, or the ellipse inside it when every corner is rounded by half
// the box or more, as GitHub draws avatars.
function isRound(style, box) {
  return ["TopLeft", "TopRight", "BottomRight", "BottomLeft"].every((corner) => {
    const radius = style[`border${corner}Radius`];
    return radius.endsWith("%") ? parseFloat(radius) >= 50 : parseFloat(radius) >= Math.min(box.width, box.height) / 2;
  });
}

function covers(rect, { box, round }) {
  if (!overlaps(rect, box)) return false;
  if (!round) return true;
  // The point of rect nearest the ellipse's center lies inside the ellipse.
  const cx = box.left + box.width / 2;
  const cy = box.top + box.height / 2;
  const x = Math.max(rect.left, Math.min(cx, rect.right)) - cx;
  const y = Math.max(rect.top, Math.min(cy, rect.bottom)) - cy;
  return (x / (box.width / 2)) ** 2 + (y / (box.height / 2)) ** 2 < 1;
}

// What a native neighbor paints: its text and every element that draws something (an image or
// control, a background, a border or a shadow). A transparent wrapper, such as the link around
// an avatar, is not an obstacle; owned nodes take no pointer input, so they never block it.
function painted(view, doc, node) {
  const elements = [node, ...node.querySelectorAll("*")];
  if (!view || elements.length > NEIGHBOR_ELEMENTS) return [{ box: node.getBoundingClientRect() }];
  const shapes = textRects(doc, node, true).map((box) => ({ box }));
  for (const element of elements) {
    const style = view.getComputedStyle(element);
    const border = ["Top", "Right", "Bottom", "Left"].some((side) => parseFloat(style[`border${side}Width`]) > 0 && !CLEAR.test(style[`border${side}Color`]));
    if (style.visibility === "hidden") continue;
    if (!DRAWN.test(element.tagName) && style.backgroundImage === "none" && CLEAR.test(style.backgroundColor) && style.boxShadow === "none" && !border) continue;
    const box = element.getBoundingClientRect();
    shapes.push({ box, round: isRound(style, box) });
  }
  return shapes;
}

// What the profile tag may not cover. It sits above or beside the first line of its host, so
// beyond the host's native text and what its native neighbors paint, every element placed before
// the host or before one of its ancestors inside root is an obstacle by its whole box.
function tagObstacles(view, doc, root, host) {
  const shapes = textRects(doc, host, true).map((box) => ({ box }));
  const neighbors = [nativeSibling(host.previousElementSibling, "previousElementSibling"), nativeSibling(host.nextElementSibling, "nextElementSibling")];
  for (const node of neighbors) if (node) shapes.push(...painted(view, doc, node));
  for (let node = host; node && node !== root && root.contains(node); node = node.parentElement) {
    for (let before = node.previousElementSibling; before; before = before.previousElementSibling) {
      if (!neighbors.includes(before) && !before.hasAttribute(OWNED_ATTRIBUTE)) shapes.push({ box: before.getBoundingClientRect() });
    }
  }
  return shapes;
}

// The nearest native element after node, skipping owned ones.
function nativeAfter(node) {
  let next = node.nextElementSibling;
  while (next?.hasAttribute(OWNED_ATTRIBUTE)) next = next.nextElementSibling;
  return next;
}

/**
 * Mounts the owned nodes for root's anchors. Returns { destroy(), play(), motionBoxes(), owned,
 * animated }. play() runs the theme's one finite pass of motion, for an explicit theme selection
 * only; it returns false and leaves the static state when motion is off, reduced, hidden or
 * offscreen, and stops a box's pass when the box leaves the viewport. `options` carries the same
 * { css, cssAllowed, registry } as compileAppearance, so a corner caption is framed only when the
 * theme's CSS will place it.
 */
export function mountAppearance(root, resolved, prefs, anchors, { css = null, cssAllowed = false, registry = null } = {}) {
  const doc = root?.ownerDocument ?? root;
  const view = doc?.defaultView;
  if (!doc?.createElement || view?.matchMedia?.("(forced-colors: active)").matches) return noop;
  const usable = usableAnchors(root, anchors);
  const styled = new Set(usable.length ? (ownedThemeCss(resolved, prefs, css, cssAllowed, registry)?.slots ?? []) : []);
  const plan = planAppearance(resolved, prefs, usable.map((anchor) => anchor.slot), { styled: [...styled] });
  if (!plan.slots.length && !plan.banner) return noop;

  const created = [];
  const moving = [];
  const make = (tag, className, parent) => {
    const node = doc.createElement(tag);
    node.className = className;
    if (parent) parent.append(node);
    return node;
  };
  const insert = (anchor, node) => {
    if (anchor.insert === "after") anchor.host.after(node);
    else if (anchor.insert === "before") anchor.host.before(node);
    else anchor.host.append(node);
  };
  const face = (node, slot) => {
    node.setAttribute(OWNED_ATTRIBUTE, slot);
    node.setAttribute(SLOT_ATTRIBUTE, slot);
    node.setAttribute("aria-hidden", "true");
  };
  // Leaving the root's area counts as blocked too: a box nobody can see is not blank space.
  const outside = (rect) => {
    const bounds = (root.nodeType === 9 ? root.documentElement : root).getBoundingClientRect();
    return rect.top < bounds.top || rect.left < bounds.left || rect.right > bounds.right;
  };
  // Decoration must land in blank space. An overlay may not cover the host's native text or a
  // native neighbor; a caption edge, which hangs out of flow at the end of its paragraph, may not
  // cover the caption's own copy either. If the first place is not blank, try the one alternate
  // place. Returns false when that is not blank either: the caller leaves the slot out (a caption
  // keeps its copy and drops only its edge).
  const settle = (box, wrapper, caption, host) => {
    const blocked = () => {
      const rect = box.getBoundingClientRect();
      const covered = caption ? textRects(doc, wrapper, false) : obstacles(doc, host);
      return outside(rect) || covered.some((other) => overlaps(rect, other));
    };
    if (!blocked()) return true;
    wrapper.setAttribute("data-rs-alt", "");
    if (!blocked()) return true;
    wrapper.removeAttribute("data-rs-alt");
    return false;
  };
  // The profile tag labels the name like a kicker: just above the first line of its host's text, at
  // its start. Where that is not blank space it sits at the end of that line instead, then at the
  // end of the host's last line. Every place is measured from the lines, so the tag follows the
  // name wherever GitHub's layout puts it, and nothing native moves. Returns false, with the
  // badge detached, when no place is blank.
  const tags = [];
  const placeTag = (tag) => {
    const { wrapper, box, host } = tag;
    wrapper.removeAttribute("data-rs-alt");
    if (!box.isConnected) wrapper.append(box);
    const hostBox = host.getBoundingClientRect();
    tag.size = `${Math.round(hostBox.width)}x${Math.round(hostBox.height)}`;
    const lines = textRects(doc, host, true).filter((rect) => rect.width > 0 && rect.height > 0);
    const at = wrapper.getBoundingClientRect();
    const blocked = () => {
      const rect = box.getBoundingClientRect();
      return outside(rect) || tagObstacles(view, doc, root, host).some((shape) => covers(rect, shape));
    };
    if (lines.length) {
      const [first] = lines;
      const last = lines.at(-1);
      box.style.setProperty("--rs-x", `${first.left - at.left}px`);
      box.style.setProperty("--rs-y", `${at.bottom - first.top + TAG_GAP}px`);
      if (!blocked()) return true;
      wrapper.setAttribute("data-rs-alt", "");
      const height = box.getBoundingClientRect().height;
      for (const line of last === first ? [first] : [first, last]) {
        box.style.setProperty("--rs-y", `${at.bottom - line.bottom + (line.height - height) / 2}px`);
        if (!blocked()) return true;
      }
      wrapper.removeAttribute("data-rs-alt");
    }
    box.remove();
    return false;
  };
  // A corner caption the theme places: lay a frame exactly over the illustration and keep the copy
  // in its blank corner. A narrow illustration, a corner that covers native text or copy that does
  // not fit the frame falls back to an ordinary flow caption, whose edge must then land in blank
  // space. The illustration's size follows the viewport, zoom and late images, so this runs again
  // whenever it changes.
  const corners = [];
  const place = (corner) => {
    const { wrapper, copy, edge, host, frame } = corner;
    wrapper.removeAttribute("data-rs-flow");
    wrapper.removeAttribute("data-rs-alt");
    edge?.remove();
    frame.append(copy);
    wrapper.append(frame);
    wrapper.setAttribute("data-rs-corner", "");
    const art = host.getBoundingClientRect();
    const at = wrapper.getBoundingClientRect();
    corner.size = `${Math.round(art.width)}x${Math.round(art.height)}/${Math.round(at.width)}`;
    // The frame stacks at the illustration's own z-index and after it, so it paints above the
    // illustration and whatever the illustration covers, such as GitHub's 404 backdrop.
    const z = parseInt(view?.getComputedStyle?.(host).zIndex, 10);
    frame.style.cssText = `left:${art.left - at.left}px;bottom:${at.top - art.bottom}px;width:${art.width}px;height:${art.height}px;--rs-z:${Number.isFinite(z) ? z : 0}`;
    const rect = copy.getBoundingClientRect();
    const fits = rect.left >= art.left && rect.right <= art.right && rect.top >= art.top && rect.bottom <= art.bottom;
    const next = nativeAfter(wrapper);
    const covered = [...textRects(doc, host, true), ...(next ? textRects(doc, next, true) : [])].some((other) => overlaps(rect, other));
    if (art.width >= CORNER_MIN_WIDTH && fits && !covered) return;
    wrapper.removeAttribute("data-rs-corner");
    wrapper.setAttribute("data-rs-flow", "");
    wrapper.prepend(copy);
    frame.remove();
    if (edge) {
      wrapper.append(edge);
      if (!settle(edge, wrapper, true, host)) edge.remove();
    }
  };
  if (plan.banner) {
    const banner = make("div", "rs-banner");
    banner.setAttribute(OWNED_ATTRIBUTE, BANNER_SLOT);
    banner.setAttribute("aria-hidden", "true");
    insert(usable.find((a) => a.slot === BANNER_SLOT), banner);
    created.push(banner);
  }
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
    // The face a theme's CSS for this slot styles: a heading strip or tag badge, whose copy takes
    // its type from it, or a caption's own copy.
    if (caption ? copy : box) face(caption ? copy : box, entry.slot);
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
    insert(anchor, wrapper);
    if (caption && copy && CORNER_SLOTS.includes(entry.slot) && styled.has(entry.slot) && anchor.insert === "after") {
      const corner = { wrapper, copy, edge: box, host: anchor.host, frame: make("span", "rs-frame"), size: "" };
      corners.push(corner);
      place(corner);
      created.push(wrapper);
      continue;
    }
    if (entry.kind === "tag") {
      const tag = { wrapper, box, host: anchor.host, size: "" };
      if (!placeTag(tag)) {
        wrapper.remove();
        continue;
      }
      tags.push(tag);
      created.push(wrapper);
      continue;
    }
    if (box && !settle(box, wrapper, caption, anchor.host)) {
      if (!caption || !copy) {
        wrapper.remove();
        continue;
      }
      box.remove();
    }
    created.push(wrapper);
  }
  const owned = created.reduce((n, wrapper) => n + 1 + wrapper.querySelectorAll("*").length, 0);
  // Boxes left out, and a corner caption's edge while the caption sits in its corner, are detached.
  const live = () => moving.filter((box) => box.isConnected);
  const animated = live().reduce((n, box) => n + box.querySelectorAll(".rs-fx-drift, .rs-fx-echo").length, 0);

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
  // Corner captions are measured again when their illustration or its row changes size, and the
  // tag when its host does, at most once a frame, and both when a late font changes text sizes.
  let sizes = null;
  const remeasure = (force) => {
    for (const corner of corners) {
      const art = corner.host.getBoundingClientRect();
      const row = corner.wrapper.getBoundingClientRect();
      if (force || corner.size !== `${Math.round(art.width)}x${Math.round(art.height)}/${Math.round(row.width)}`) place(corner);
    }
    for (const tag of tags) {
      const host = tag.host.getBoundingClientRect();
      if (force || tag.size !== `${Math.round(host.width)}x${Math.round(host.height)}`) placeTag(tag);
    }
  };
  const onFonts = () => remeasure(true);
  if (corners.length || tags.length) {
    if (typeof view?.ResizeObserver === "function") {
      sizes = new view.ResizeObserver(() => remeasure(false));
      for (const corner of corners) {
        sizes.observe(corner.host);
        sizes.observe(corner.wrapper);
      }
      for (const tag of tags) sizes.observe(tag.host);
    }
    doc.fonts?.addEventListener?.("loadingdone", onFonts);
  }
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
  const motionAllowed = () => !destroyed && plan.effective.motion && live().length > 0 && !doc.hidden && !view?.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
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
    motionBoxes: () => (motionAllowed() ? live() : []),
    play() {
      if (!motionAllowed()) return false;
      const visible = live().filter(inViewport);
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
      sizes?.disconnect();
      doc.fonts?.removeEventListener?.("loadingdone", onFonts);
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
