// Build-time capture page (site/prerender.mjs). It mounts the same engine.mjs the site loads, so a
// captured first paint is the live preview a visitor's browser renders. Never part of the site.
import { DEFAULT_PREFERENCES, DOCS, mountPreview } from "../engine.mjs";

let handle = null;

window.reskinCapture = async ({ slug, width, calm = false, view = "profile", compact = false }) => {
  handle?.destroy();
  const stage = document.getElementById("stage");
  stage.style.width = `${width}px`;
  const preferences = calm ? { ...DEFAULT_PREFERENCES, extras: false } : DEFAULT_PREFERENCES;
  handle = mountPreview(stage, { view, theme: DOCS[slug], preferences, cssAllowed: true, compact });
  // The host exists at once; its first job completes in a later animation frame.
  const host = stage.querySelector("[data-reskin-preview]");
  await new Promise((resolve, reject) => {
    host.addEventListener("reskin-preview-complete", resolve, { once: true });
    host.addEventListener("reskin-preview-error", (event) => reject(new Error(event.detail.message)), { once: true });
  });
  // Images and fonts settle in the styled frame after load.
  await new Promise((resolve) => setTimeout(resolve, 150));
  const layout = host.querySelector('iframe[aria-hidden="true"]').contentDocument;
  const box = (selector) => layout.querySelector(selector)?.getBoundingClientRect() ?? null;
  // The gallery card: the first pinned repository through the contribution graph's box, without
  // the flavor caption some themes add below it, so every card shows the same region.
  const pinned = box(".pinned-item-list-item");
  const graph = box(".ContributionCalendar");
  const frame = host.getBoundingClientRect();
  // Where the phone window's proof ends: the first pinned repository and the graph's legend.
  const legend = box(".ContributionCalendar-legend");
  return {
    height: Math.round(frame.height),
    sourceHash: host.dataset.sourceHash,
    seedHash: host.dataset.seedHash,
    fingerprint: host.dataset.fingerprint,
    policy: host.dataset.policy,
    ownedNodes: Number(host.dataset.ownedNodes),
    card: pinned && graph ? { top: Math.max(0, Math.floor(pinned.top) - 12), bottom: Math.ceil(graph.bottom) + 12 } : null,
    ends: { pinned: pinned ? Math.ceil(pinned.bottom) : null, legend: legend?.height ? Math.ceil(legend.bottom) : null },
  };
};
