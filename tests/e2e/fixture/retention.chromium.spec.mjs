// Retained references after destroy, measured with Chromium's collector: destroyed handles that
// callers still hold must not keep their host, frames or serialized documents alive, including a
// handle destroyed while its font read never settles.
import { PREFS, decorated, expect, test } from "./helpers.mjs";

test("destroyed handles held by callers retain no host, frame or srcdoc", async ({ page, fixtureApp }) => {
  await page.goto(fixtureApp.url("preview.html"));
  // A font file that never arrives, so the last handle is destroyed mid-read.
  await page.route("**/bungee.woff2", () => {});
  const counts = await page.evaluate(async ([themes, stalled, preferences]) => {
    window.heldHandles = [];
    window.refs = [];
    for (const theme of [...themes, stalled]) {
      const box = document.createElement("div");
      document.body.append(box);
      const handle = window.reskinPreview.mountPreview(box, { view: "profile", theme, preferences });
      const host = box.firstElementChild;
      if (theme === stalled) await new Promise((resolve) => setTimeout(resolve, 300));
      else await new Promise((resolve) => host.addEventListener("reskin-preview-complete", resolve, { once: true }));
      window.refs.push(new WeakRef(host), ...[...host.querySelectorAll("iframe")].map((frame) => new WeakRef(frame)));
      window.heldHandles.push(handle);
      handle.destroy();
      box.remove();
    }
    return { refs: window.refs.length };
  }, [["nord", "dracula", "gruvbox", "tokyo-night"].map((id) => decorated(id, { rail: {}, echo: {} })), decorated("one-dark", { rail: {} }, { font: "bungee" }), PREFS]);
  expect(counts.refs).toBeGreaterThanOrEqual(5 * 2);
  const cdp = await page.context().newCDPSession(page);
  for (let i = 0; i < 4; i++) {
    await cdp.send("HeapProfiler.collectGarbage");
    await page.waitForTimeout(50);
  }
  const retained = await page.evaluate(() => ({
    handles: window.heldHandles.length,
    alive: window.refs.map((ref) => ref.deref()).filter(Boolean).map((node) => `${node.localName}${node.srcdoc ? ` srcdoc ${node.srcdoc.length}` : ""}`),
  }));
  expect(retained).toEqual({ handles: 5, alive: [] });
});
