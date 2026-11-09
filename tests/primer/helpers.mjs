// Shared helpers for the Primer adapter tests. Not a test file itself.
import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { build } from "esbuild";

export const ROOT = resolve(fileURLToPath(new URL("../..", import.meta.url)));
export const readJson = (path) => JSON.parse(readFileSync(join(ROOT, path), "utf8"));
export const readText = (path) => readFileSync(join(ROOT, path), "utf8");

export const PREFS = Object.freeze({ enabled: true, extras: true, text: true, motion: true, fonts: true, effects: true });
export const EXTRAS_OFF = Object.freeze({ ...PREFS, extras: false, text: false, motion: false, fonts: false, effects: false });

/**
 * A ThemedResolved test double built from a seed's own ColorSet, for compiler tests that do not
 * exercise the engine. Real resolutions come from the C2 engine in engine.integration.mjs.
 */
export function resolvedFromSeed(seed, overrides = {}) {
  const colors = structuredClone(seed.colors);
  for (const [path, value] of Object.entries(overrides)) {
    const keys = path.split("/").slice(1);
    keys.slice(0, -1).reduce((node, key) => node[key], colors)[keys.at(-1)] = value;
  }
  return {
    ...colors,
    rendererVersion: 1,
    sourceHash: "0".repeat(64),
    seedId: seed.id,
    seedHash: seed.sourceHash,
    base: seed.base,
    policy: "themed",
    font: "system",
    effects: {},
    flavor: { enabled: true, locale: "en", slots: { "profile.tag": "</style><script>alert(1)</script>" } },
    motionAllowed: true,
    appearance: appearanceFor(colors),
    repairs: [],
    pairAudit: [],
  };
}

/**
 * A resolved appearance record for a v1 theme with no expansion groups, from a ColorSet: native
 * shape, square cells without glow, and the extended syntax defaults THEME-EXPANSION.md names.
 * `overrides` replaces whole groups, such as {shape: {...}} or {graph: {...}}.
 */
export function appearanceFor(colors, overrides = {}) {
  const t = colors.tokens;
  const s = colors.syntax;
  const pill = { background: t.labelBackground, text: t.labelText, border: t.labelBorder };
  return {
    colors: {
      syntax: { operator: s.keyword, punctuation: s.variable, constant: s.number, tag: s.keyword, attribute: s.type, regex: s.string, escape: s.number, invalid: colors.semantics.danger.text, inserted: t.diffAddedText, deleted: t.diffRemovedText, markupHeading: t.codeText, markupEmphasis: t.codeText, markupLink: t.link, markupQuote: s.comment, markupList: s.keyword },
      page: { background: t.canvas },
      header: { background: t.inset, text: t.mutedText },
      scrollbar: { thumb: t.mutedText, track: t.inset },
      labels: { ...pill },
      topics: { ...pill },
      graph: { cellBoundary: t.controlBorder },
    },
    paints: { page: null, profileBanner: null, header: null },
    shape: { corners: null, borders: null, shadows: null, buttons: null, avatar: null },
    fonts: { heading: { id: "system", requested: "system", source: "system", family: null, fallback: null, weights: [] }, body: { id: "system", requested: "system", source: "system", family: null, fallback: null, weights: [] } },
    typography: null,
    graph: { cellStyle: "square", cellRadius: null, glow: null },
    details: { scrollbarWidth: "auto", labels: null, topics: null },
    css: null,
    notes: [],
    ...overrides,
  };
}

export function nativeResolved(policy, base = "dark") {
  return {
    rendererVersion: 1, sourceHash: "0".repeat(64), seedId: null, seedHash: null, base, policy,
    tokens: null, semantics: null, syntax: null, ansi: null, graph: null,
    font: "system", effects: {}, flavor: { enabled: false, locale: "en", slots: {} },
    motionAllowed: false, appearance: null, repairs: [], pairAudit: [],
  };
}

/** The content adapter bundled as an IIFE that sets globalThis.ReskinGitHub, for browser pages. */
export async function adapterBundle() {
  const result = await build({ entryPoints: [join(ROOT, "extension/content/github/index.js")], bundle: true, format: "iife", globalName: "ReskinGitHub", write: false, platform: "browser", logLevel: "silent" });
  return result.outputFiles[0].text;
}

/**
 * The C2 engine: packages/engine in this checkout once C2 has merged, otherwise the checkout named
 * by RESKIN_ENGINE_ROOT. Throws when neither exists; nothing is skipped silently.
 */
export async function loadEngine() {
  const roots = [ROOT, process.env.RESKIN_ENGINE_ROOT].filter(Boolean).map((r) => resolve(r));
  const root = roots.find((r) => existsSync(join(r, "packages/engine/index.js")) && existsSync(join(r, "themes/catalog.json")));
  if (!root) {
    const error = new Error("The C2 engine is not available: packages/engine is not merged here and RESKIN_ENGINE_ROOT names no checkout with packages/engine and themes/catalog.json.");
    error.code = "RESKIN_NO_ENGINE";
    throw error;
  }
  const engine = await import(pathToFileURL(join(root, "packages/engine/index.js")).href);
  const pairs = JSON.parse(readFileSync(join(root, "packages/engine/pairs.json"), "utf8"));
  const catalog = JSON.parse(readFileSync(join(root, "themes/catalog.json"), "utf8"));
  const classics = catalog.filter((e) => e.group === "classics").map((e) => ({ id: e.id, theme: JSON.parse(readFileSync(join(root, e.file), "utf8")) }));
  let adversarial = [];
  const checks = join(root, "packages/engine/checks.mjs");
  if (existsSync(checks)) adversarial = (await import(pathToFileURL(checks).href)).adversarialThemes?.(120) ?? [];
  const fixtureDirs = ["tests/fixtures/roundtrip", "tests/fixtures/schema/repair", "tests/fixtures/schema/valid"];
  const fixtures = [];
  for (const dir of fixtureDirs) {
    if (!existsSync(join(root, dir))) continue;
    const { readdirSync } = await import("node:fs");
    for (const f of readdirSync(join(root, dir)).filter((n) => n.endsWith(".reskin.json")).sort()) fixtures.push({ id: `${dir}/${f}`, theme: JSON.parse(readFileSync(join(root, dir, f), "utf8")) });
  }
  return { root, engine, pairs, classics, adversarial, fixtures };
}

/** A ColorPath value from a resolved theme or ColorSet. */
export const at = (value, path) => path.split("/").slice(1).reduce((node, key) => node?.[key], value);
