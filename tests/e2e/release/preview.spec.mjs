// The builder preview's resolve time in both engines: every catalog theme edited four times, as
// the builder edits a draft, each resolved once after a warm-up pass. check:budgets gates the
// slower engine's p95 against BUDGETS.previewResolveP95Ms.
import { expect, test } from "../../helpers/e2e.mjs";
import { catalogThemes, record, resolvePage, summary, timeResolves } from "./helpers.mjs";

test("the preview resolves builder edits of every catalog theme, timed for the release budget", async ({ page, serveDir, browser }, info) => {
  const themes = await catalogThemes();
  const resolver = await resolvePage(serveDir);
  try {
    await page.goto(resolver.url);
    const times = await timeResolves(page, themes);
    expect(times).toHaveLength(themes.length * 4);
    expect(times.every((ms) => Number.isFinite(ms) && ms >= 0)).toBe(true);
    const result = summary(times);
    await record(info, "preview", { previewResolveP95Ms: result.p95, previewResolve: result }, `${info.project.use.browserName} ${browser.version()}`);
  } finally {
    await resolver.cleanup();
  }
});
