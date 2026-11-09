// The first-run tab, opened once after a genuine install. Choom Circuit is already selected; a
// choice here commits at once with Undo, like the popup. The preview is C5's shared offline
// fixture painted by the same engine, Primer compiler and appearance as github.com, with its own
// Before/After comparison. See UX.md "First-run tab".
import { extensionResources } from "../../packages/appearance/index.js";
import { configurePreview, mountPreview } from "../../packages/preview/index.js";
import * as primer from "../../packages/primer/index.js";
import { effectivePreferences, selectedSource } from "../../packages/settings/index.js";
import { dormantSlots } from "../content/github/index.js";
import { api, catalog, host, mountPage } from "./common.mjs";

export function mountOnboarding() {
  configurePreview({ primer, modeIndex: primer.MODE_INDEX, resources: extensionResources(api.runtime), dormantSlots: dormantSlots() });

  const more = document.querySelector("[data-rs-more]");
  const all = document.getElementById("rs-all");
  more.addEventListener("click", () => {
    const open = all.hidden;
    all.hidden = !open;
    more.setAttribute("aria-expanded", String(open));
  });

  const container = document.querySelector("[data-rs-preview]");
  let preview = null;
  let completing = null;
  let initialTheme = null;
  let latest = null;

  // Completion is recorded once, on a theme choice or Open GitHub. The installed record already
  // prevents a second welcome tab, so a failed write here is only retried on the next choice.
  function complete(settings) {
    if (completing || settings.onboardingCompleted) return;
    completing = host.commit({ type: "completeOnboarding" }, settings.revision).then((reply) => {
      if (!reply.ok) completing = null;
    });
  }

  const picker = mountPage({
    onChange({ settings, selectedId }) {
      latest = settings;
      initialTheme ??= settings.selectedThemeId;
      if (settings.selectedThemeId !== initialTheme) complete(settings);
      const theme = selectedSource({ ...settings, selectedThemeId: selectedId }, catalog);
      if (!theme) return;
      // The preview always shows the chosen theme; Before is the comparison with GitHub's own look.
      const preferences = { ...effectivePreferences(settings), enabled: true };
      // A bundled theme's own reviewed CSS applies, as on GitHub; a saved theme's waits for consent.
      const cssAllowed = catalog.has(selectedId);
      if (!preview) preview = mountPreview(container, { view: "profile", theme, preferences, cssAllowed });
      else preview.update({ theme, preferences, cssAllowed });
    },
  });

  document.querySelector("[data-rs-before]").addEventListener("change", (event) => preview?.setBefore(event.target.value === "before"));
  document.querySelector("[data-rs-open-github]").addEventListener("click", () => {
    if (latest) complete(latest);
  });
  return picker;
}
