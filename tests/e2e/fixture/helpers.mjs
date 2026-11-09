// Shared setup for the fixture surface. The app is built by packages/appearance/checks.mjs (run
// through npm run test:e2e or check:a11y) into RESKIN_FIXTURE_APP, by default dist/fixture/product.
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { test as base, expect } from "../../helpers/e2e.mjs";
import { EFFECT_PARAMETERS } from "../../../packages/format/index.js";

const ROOT = fileURLToPath(new URL("../../../", import.meta.url));
export const APP = process.env.RESKIN_FIXTURE_APP || join(ROOT, "dist/fixture/product");
export const PREFS = Object.freeze({ enabled: true, extras: true, text: true, motion: true, fonts: true, effects: true });

export const test = base.extend({
  fixtureApp: [
    async ({ serveDir }, use) => {
      if (!existsSync(join(APP, "app.js"))) throw new Error(`The fixture app is not built at ${APP}. Run npm run test:e2e -- --project=fixture-chromium.`);
      const server = await serveDir(APP, { host: "127.0.0.1" });
      await use({ url: (page) => new URL(page, server.url).href });
    },
    { scope: "worker" },
  ],
});
export { expect };

export const classic = (id) => JSON.parse(readFileSync(join(ROOT, `themes/classics/${id}.reskin.json`), "utf8"));

const SLOTS = {
  "profile.pinned.heading": "Pinned sentinel copy",
  "profile.activity.heading": "Activity sentinel copy",
  "profile.organizations.heading": "Crew sentinel copy",
  "profile.tag": "// sentinel tag",
  "error.notFound.caption": "Lost sentinel caption.",
  "empty.pinned.caption": "Empty pins sentinel caption.",
  "empty.issues.caption": "Empty issues sentinel caption.",
  "contributions.caption": "Calendar sentinel caption.",
};

/** A Classic with the given effects (defaults filled per id), an accent font and all eight slots. */
export function decorated(id, effects, { font = "rajdhani", flavor = true } = {}) {
  const theme = classic(id);
  return {
    ...theme,
    name: `${theme.name} decorated`,
    fonts: { accent: font },
    effects: Object.fromEntries(Object.entries(effects).map(([effect, params]) => [effect, { ...Object.fromEntries(Object.entries(EFFECT_PARAMETERS[effect]).map(([k, rule]) => [k, rule.default])), ...params }])),
    ...(flavor ? { flavor: { enabled: true, locale: "en", slots: SLOTS } } : {}),
  };
}

/** One theme per effect shape: every effect and every shape variant at least once. */
export function effectThemes() {
  const out = [];
  for (const [effect, spec] of Object.entries(EFFECT_PARAMETERS)) {
    const variant = Object.entries(spec).find(([, rule]) => rule.enum);
    for (const value of variant ? variant[1].enum : [null]) out.push({ effect, label: value ? `${effect} ${value}` : effect, theme: decorated("dracula", { [effect]: variant ? { [variant[0]]: value } : {} }) });
  }
  return out;
}

/** Mounts a preview and waits until its frame has painted. */
export async function mount(page, app, options, { slots } = {}) {
  if (!page.url().includes("preview.html")) await page.goto(app.url(slots ? "preview.html?slots=all" : "preview.html"));
  await page.evaluate((o) => window.reskinPreview.mount(o), { view: "profile", preferences: PREFS, ...options });
  await painted(page);
}

/** Waits until every requested preview update has completed in a shown frame. */
export async function painted(page) {
  await page.waitForFunction(() => {
    const host = document.querySelector("[data-reskin-preview][data-completed]");
    return host && host.getAttribute("data-completed") === host.getAttribute("data-requested") && host.querySelectorAll("iframe:not([aria-hidden])").length === 1;
  });
}

/** The styled frame: sandboxed without scripts, so only the test driver can evaluate in it. */
export async function previewFrame(page) {
  const handle = await page.locator("#preview iframe:not([aria-hidden])").elementHandle();
  return handle.contentFrame();
}

/**
 * Runs fn(frameDocument, arg) in the styled frame. The frame's policy blocks eval, so fn travels
 * as source to the driver's own evaluation, which the policy does not govern.
 */
export const inFrame = async (page, fn, arg) => (await previewFrame(page)).evaluate(`(${fn.toString()})(document, ${JSON.stringify(arg ?? null)})`);

/** Every non-owned element's box, in document order. */
export const nativeBoxes = (doc) =>
  [...doc.body.querySelectorAll("*")]
    .filter((node) => !node.closest("[data-reskin-owned]"))
    .map((node) => {
      const r = node.getBoundingClientRect();
      return [node.tagName, node.className?.baseVal ?? node.className, Math.round(r.x * 100) / 100, Math.round(r.y * 100) / 100, Math.round(r.width * 100) / 100, Math.round(r.height * 100) / 100];
    });

/** rgb(r, g, b) for a #rrggbb color, as getComputedStyle reports it. */
export const rgb = (hex) => `rgb(${[1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16)).join(", ")})`;

/** The value each preview variable should carry for theme: emitted in After, native in Before. */
export const expected = (page, theme, before = false) => page.evaluate(([t, b]) => window.reskinPreview.expected(t, b), [theme, before]);

/** Updates the preview and waits for the replacement frame. */
export async function update(page, theme, preferences = PREFS) {
  await page.evaluate(([t, p]) => window.reskinPreview.update({ theme: t, preferences: p }), [theme, preferences]);
  await painted(page);
}
