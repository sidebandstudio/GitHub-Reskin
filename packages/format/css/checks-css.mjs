// check:css: every named case of tests/fixtures/css-review-r41-cases.json and
// css-policy-cases.json, run through the real sanitizer, registry compiler, safe sinks and format
// admission, plus the faithful Choom CSS. A case passes only when its whole-input outcome matches.
// Runtime-transition and scope cases are judged on the compiled selectors with selector-model.mjs:
// after the host revokes admission the way ARCHITECTURE.md's lifetime requires, nothing may
// match. Browser timing, request interception and memory traces stay C5/C6's Chromium and Firefox
// gates; this check proves the format side of each case. Node only.
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { LIMITS } from "../../contracts/index.js";
import { compileCss, escapeCssForHtml, escapeHtmlText, parseImport, rasterInfo, sanitizeCss, sanitizeGradientCss, styleElementHtml, transportEquivalent, unsafeForStyleElement, validateTheme } from "../index.js";
import { crc32 } from "../share.js";
import { POLICY, POLICY_HASH } from "./policy.js";
import { append, element, matchedElements } from "./selector-model.mjs";

const readJson = (path) => JSON.parse(readFileSync(path, "utf8"));
const clone = (value) => JSON.parse(JSON.stringify(value));
const MINIMAL = { schemaVersion: 1, name: "Probe", base: "dark", colors: { background: "#0a0a17", text: "#e4f3ff", accent: "#fcee0a" } };
const FULL = { enabled: true, appearance: "full", extras: true, text: true, motion: true, fonts: true, effects: true };

// A registry for one case: the synthetic fixture, with .AppHeader moved to page-backing or an
// exact predicate added when the case's setup asks for it.
function registryFor(base, testCase) {
  const registry = clone(base);
  const setup = testCase.setup ?? {};
  if (/page-backing/.test(setup.kind ?? "")) for (const s of registry.subjects) if (s.classes.includes("AppHeader")) s.kind = "page-backing";
  if (/predicate/.test(setup.registry ?? "") && testCase.css) {
    const [, name, value] = /\[(data-testid|aria-current)="([^"]*)"\]/.exec(testCase.css) ?? [];
    if (name) for (const s of registry.subjects) if (s.classes.includes("AppHeader")) s.predicates = [...(s.predicates ?? []), { name, value }];
  }
  return registry;
}

function pipeline(css, registry, options = {}) {
  const sanitized = sanitizeCss(css, options);
  if (!sanitized.ok) return { ok: false, issues: sanitized.issues };
  const compiled = compileCss(sanitized.value, { registry, cssAllowed: true, preferences: FULL, ...options.compile });
  return compiled.ok ? { ok: true, sanitized: sanitized.value, compiled } : { ok: false, issues: compiled.issues, sanitized: sanitized.value };
}

// A model page: the host scope with the native gate, a header subject with its kind marker.
function page({ gate = true, kind = "header-chrome" } = {}) {
  const html = element("html", { attrs: { "data-reskin-css": "active", ...(gate ? { "data-reskin-css-native": "active" } : {}) } });
  const body = append(html, element("body"));
  const header = append(body, element("header", { classes: ["AppHeader"], attrs: kind ? { "data-reskin-css-kind": kind } : {} }));
  return { html, body, header };
}

// Minimal PNG with a real IHDR and IEND, for byte/header admission without pixel data.
function pngHeader(width, height) {
  const chunk = (type, data) => {
    const body = Buffer.concat([Buffer.from(type, "ascii"), data]);
    const length = Buffer.alloc(4);
    length.writeUInt32BE(data.length);
    const crc = Buffer.from(crc32(body), "hex");
    return Buffer.concat([length, body, crc]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk("IHDR", ihdr), chunk("IEND", Buffer.alloc(0))]);
}
const imageLayer = (width, height) => ({ image: { data: `data:image/png;base64,${pngHeader(width, height).toString("base64")}`, width, height } });

const slotRule = (slot, declarations = "opacity:1") => `[data-reskin-slot="${slot}"]{${declarations}}`;

// The generated-budget inputs: exactly at each bound, and one past it.
function budgetCase(measure, value, registry) {
  switch (measure) {
    case "rules":
      return pipeline(Array.from({ length: value }, () => slotRule("profile.tag")).join(""), registry);
    case "selectors": {
      const rules = Array.from({ length: 256 }, () => '[data-reskin-slot="profile.tag"],[data-reskin-slot="error.notFound.caption"]');
      if (value > 512) rules[255] += ',[data-reskin-slot="contributions.caption"]';
      return pipeline(rules.map((r) => `${r}{opacity:1}`).join(""), registry);
    }
    case "declarations": {
      const rules = Array.from({ length: 256 }, () => Array(8).fill("opacity:1"));
      if (value > 2048) rules[255].push("opacity:1");
      return pipeline(rules.map((d) => slotRule("profile.tag", d.join(";"))).join(""), registry);
    }
    case "ast-nodes": {
      // No valid theme within 32 KiB reaches 20,000 syntax nodes, so the exact boundary is shown
      // on a lowered budget (budgets may only lower limits) and the production cap on token soup.
      const css = Array.from({ length: 12 }, () => slotRule("profile.tag", "opacity:1;transform:rotate(-6deg)")).join("");
      const count = countNodes(css);
      if (value <= POLICY.limits.astNodes) return pipeline(css, registry, { budgets: { astNodes: count } });
      const soup = sanitizeCss(`.AppHeader{--theme-x:${"1,".repeat(16000)}1}`);
      const lowered = sanitizeCss(css, { budgets: { astNodes: count - 1 } });
      const ok = !soup.ok && /syntax nodes/.test(soup.issues[0].message) && !lowered.ok;
      return ok ? { ok: false, issues: soup.issues } : { ok: true };
    }
    case "selector-components": {
      // k ancestors and k combinators before the subject; an even count adds ::before to it.
      const even = value % 2 === 0;
      const ancestors = (value - (even ? 2 : 1)) / 2;
      const selector = `${Array.from({ length: ancestors }, () => ".Layout ").join("")}[data-reskin-slot="profile.tag"]${even ? "::before" : ""}`;
      return pipeline(`${selector}{opacity:1}`, registry);
    }
    case "nesting": {
      let selector = ".AppHeader";
      for (let i = 0; i < value; i++) selector = `:is(${selector})`;
      return pipeline(`${selector}{border-color:var(--reskin-accent)}`, registry);
    }
    case "expanded-utf8-output": {
      // Rules of sixteen declarations stay inside the rule and declaration caps; the last number
      // takes trailing zeros to land on the exact byte count. A gradientCss value shares the
      // budget, so the input itself is at the cap.
      const rule = slotRule("profile.tag", Array(16).fill("letter-spacing:.1em").join(";"));
      let css = rule.repeat(Math.floor(value / rule.length) - 1);
      const tail = slotRule("profile.tag", "letter-spacing:.1em");
      css += slotRule("profile.tag", `letter-spacing:.1${"0".repeat(value - css.length - tail.length)}em`);
      if (Buffer.byteLength(css) !== value) throw new Error(`expanded-output generator made ${Buffer.byteLength(css)} bytes, not ${value}`);
      return pipeline(css, registry);
    }
    default:
      throw new Error(`unknown budget measure ${measure}`);
  }
}

// The smallest node budget that admits the CSS, which is its node count: double, then bisect.
function countNodes(css) {
  const fits = (n) => sanitizeCss(css, { budgets: { astNodes: n } }).ok;
  let hi = 1;
  while (!fits(hi)) hi *= 2;
  let lo = hi / 2;
  while (lo + 1 < hi) {
    const mid = (lo + hi) >> 1;
    if (fits(mid)) hi = mid;
    else lo = mid;
  }
  return hi;
}

// Stage handlers. Each returns the case's outcome: true when the input is accepted.
function outcome(testCase, ctx) {
  const { stage, setup = {}, id } = testCase;
  const registry = registryFor(ctx.registry, testCase);
  if (stage === "generated-budget") return budgetCase(setup.measure, setup.value, registry).ok;

  if (stage === "runtime-transition") {
    const result = pipeline(testCase.css, registry);
    if (!result.ok) return false;
    const before = page();
    const initially = matchedElements(result.compiled.css, before.html).includes(before.header);
    ctx.check(initially, `${id}: the admitted header should be styled before the transition`);
    // The lifetime contract: the host revokes the native gate before the next styled render, or
    // marks the inserted subtree protected and strips the subject's kind marker.
    const revoked = page({ gate: false });
    const protectedChild = page();
    const child = append(protectedChild.header, element("div", { classes: ["AppHeader"], attrs: { "data-reskin-protected": "", "data-reskin-css-kind": "header-chrome" } }));
    delete protectedChild.header.attrs["data-reskin-css-kind"];
    const still = matchedElements(result.compiled.css, revoked.html).length + matchedElements(result.compiled.css, protectedChild.html).filter((n) => n === child || n === protectedChild.header).length;
    return still > 0;
  }

  if (stage === "generated-style-application") {
    const result = pipeline(testCase.css, registry);
    if (!result.ok) return false;
    const html = element("html", { attrs: { "data-reskin-css": "active", "data-reskin-css-native": "active" } });
    const island = append(html, element("div", { attrs: { "data-reskin-native": "" } }));
    const inIsland = append(island, element("header", { classes: ["AppHeader"], attrs: { "data-reskin-css-kind": "header-chrome" } }));
    const guarded = append(html, element("div", { attrs: { "data-reskin-protected": "" } }));
    const inProtected = append(guarded, element("header", { classes: ["AppHeader"], attrs: { "data-reskin-css-kind": "header-chrome" } }));
    const shell = element("html");
    const outside = append(shell, element("header", { classes: ["AppHeader"], attrs: { "data-reskin-css-kind": "header-chrome" } }));
    const hits = [...matchedElements(result.compiled.css, html), ...matchedElements(result.compiled.css, shell)];
    return [inIsland, inProtected, outside].some((n) => hits.includes(n));
  }

  if (stage === "effective-output") {
    const sanitized = sanitizeCss(testCase.css);
    if (!sanitized.ok) return false;
    const compile = (preferences, policy = "themed", cssAllowed = true) => compileCss(sanitized.value, { registry, cssAllowed, preferences, policy });
    const full = compile(FULL);
    if (!full.ok) return false;
    const state = setup.state;
    const expectations = {
      "Full with consent": () => full.css.includes("font-family") && full.css.includes("text-shadow") && compile(FULL, "themed", false).css === "",
      Calm: () => compile({ ...FULL, appearance: "calm" }).css === "" && compile({ ...FULL, appearance: undefined, extras: false }).css === "",
      "Effects off": () => compile({ ...FULL, effects: false }).css === "",
      "Text off": () => !compile({ ...FULL, text: false }).css.includes("data-reskin-slot") && compile({ ...FULL, text: false }).css.includes("font-family"),
      "Fonts off": () => !compile({ ...FULL, fonts: false }).css.includes("font-family") && compile({ ...FULL, fonts: false }).css.includes("text-shadow"),
      "forced colors": () => compile(FULL, "forced-colors").css === "",
      "nested native mode": () => compile(FULL, "native-high-contrast").css === "" && compile(FULL, "native-unknown").css === "",
      navigation: () => compile(FULL).css === full.css,
      "media/state condition": () => sanitizeCss(`@media (hover:hover){${testCase.css}}`).ok && !full.css.includes("url("),
    };
    const expect = expectations[state];
    if (!expect) throw new Error(`${id}: unknown state ${state}`);
    return expect() && !/url\(|@import/.test(full.css);
  }

  if (stage === "safe-transport") {
    const result = pipeline(testCase.css, registry);
    if (!result.ok) return false;
    const live = result.compiled.css;
    const escaped = escapeCssForHtml(live);
    const document = `<!doctype html><html><head><meta http-equiv="Content-Security-Policy" content="default-src 'none'">${styleElementHtml(live)}</head><body></body></html>`;
    const firstClose = document.toLowerCase().indexOf("</style");
    const expected = document.lastIndexOf("</style>");
    const hash = createHash("sha256").update(result.sanitized.css).digest("hex");
    const fine = !unsafeForStyleElement(escaped) && transportEquivalent(live, escaped) && firstClose === expected && hash === result.sanitized.hash && !/<(?:img|form|input|link|script)\b|<meta id/i.test(document);
    return fine;
  }

  if (stage === "text-transport-defense") {
    const probe = setup.boundaryProbe.split(" = ")[1];
    const field = setup.boundaryProbe.startsWith("name") ? { ...MINIMAL, name: probe } : { ...MINIMAL, flavor: { slots: { "profile.tag": probe } } };
    return !validateTheme(field).ok && !escapeHtmlText(probe).includes("<");
  }

  if (stage === "structured-gradient-admission") {
    if (setup.gradientCss) return sanitizeGradientCss(setup.gradientCss, "/backgrounds/page/layers/0/gradientCss").ok;
    if (setup.generator) {
      const bytes = /to (\d+) bytes/.exec(setup.generator)[1];
      const value = `linear-gradient(red,blue)${" ".repeat(Number(bytes) - "linear-gradient(red,blue)".length)}`;
      return validateTheme({ ...MINIMAL, backgrounds: { page: { layers: [{ gradientCss: { value } }] } } }).ok;
    }
    if (setup.sourceBytes) {
      const filler = slotRule("profile.tag").repeat(Math.ceil(setup.sourceBytes / slotRule("profile.tag").length));
      const value = "linear-gradient(red,blue)";
      const css = filler.slice(0, setup.sourceBytes - value.length);
      return validateTheme({ ...MINIMAL, css, backgrounds: { page: { layers: [{ gradientCss: { value } }] } } }).ok;
    }
    // A raster motif and three gradientCss layers compose in source order.
    const theme = { ...MINIMAL, backgrounds: { page: { layers: [imageLayer(4, 4), ...["linear-gradient(red,blue)", "radial-gradient(red,blue)", "linear-gradient(90deg,red,blue)"].map((value) => ({ gradientCss: { value } }))] } } };
    if (!validateTheme(theme).ok) return false;
    return ctx.resolveLayers(theme).join(",") === "image,gradientCss,gradientCss,gradientCss";
  }

  if (testCase.css !== null && testCase.css !== undefined) {
    const result = pipeline(testCase.css, registry);
    if (id === "accept-css-gradients-replace-structured-layer" && result.ok) {
      // An admitted background-image rule replaces the structured header list: four painted
      // layers in CSS order, the structured one not painted.
      const rule = result.sanitized.rules[0].declarations.find((d) => d.property === "background-image");
      ctx.check(rule?.layers === 4 && result.compiled.css.indexOf("background-image:") === result.compiled.css.lastIndexOf("background-image:"), `${id}: CSS must carry exactly the four replacing layers`);
    }
    return result.ok;
  }

  // Cases with a setup and no CSS.
  switch (id) {
    case "accept-structured-raster-path": {
      const theme = readJson(join(ctx.root, "tests/fixtures/schema/valid/embedded-images.reskin.json"));
      const images = ["page", "profileBanner", "header"].flatMap((t) => (theme.backgrounds?.[t]?.layers ?? []).filter((l) => l.image).map((l) => l.image));
      return validateTheme(theme).ok && images.length > 0 && images.every((image) => rasterInfo(image.data).ok) && !sanitizeCss('.AppHeader{background-image:url("data:image/png;base64,AAAA")}').ok;
    }
    case "reject-repeated-expansion-output": {
      let value = "#fcee0a";
      for (let i = 0; i < 7; i++) value = `color-mix(in srgb,${value} 50%,#00f0ff)`;
      const uses = Array.from({ length: 1000 }, () => "border-color:var(--theme-a)").join(";");
      const started = performance.now();
      const result = sanitizeCss(`.AppHeader{--theme-a:${value};${uses}}`);
      ctx.check(performance.now() - started < 2000, `${id}: expansion budget did not stop early`);
      ctx.check(!result.ok && /expands to more than/.test(result.issues.map((i) => i.message).join(" ")), `${id}: rejection should name the expanded-output budget`);
      return result.ok;
    }
    case "reject-unsafe-serialization": {
      // A serializer that kept a literal closing delimiter is refused before any insertion.
      const raw = '.AppHeader:not([data-testid="</StYlE><img id=breakout>"]){box-shadow:0 1px 0 var(--reskin-accent)}';
      return !unsafeForStyleElement(raw);
    }
    case "accept-escaped-fixture-name":
    case "accept-escaped-fixture-flavor":
      return outcome({ ...testCase, stage: "text-transport-defense" }, ctx);
    case "accept-aggregate-pixels-6291456":
    case "reject-aggregate-pixels-6291457": {
      const layers = [imageLayer(2048, 1024), imageLayer(2048, 1024), imageLayer(2048, 1024)];
      const theme = { ...MINIMAL, backgrounds: { page: { layers } } };
      if (setup.pixels > LIMITS.documentImageDecodedPixels) theme.backgrounds.header = { layers: [imageLayer(1, 1)] };
      return validateTheme(theme).ok;
    }
    case "accept-resource-recovery-canceled-imports":
    case "accept-resource-recovery-replaced-frames":
    case "accept-resource-recovery-disable-restart": {
      // The format side: repeated imports of admitted and rejected CSS stay independent, rejected
      // CSS never yields sanitized output, and Off or Calm omit admitted CSS entirely.
      let fine = true;
      for (let i = 0; i < 50; i++) {
        const css = i % 2 ? `.AppHeader{background-image:url(https://leak.invalid/${i})}` : `[data-reskin-slot="profile.tag"]{letter-spacing:.0${i % 10}em}`;
        const result = parseImport(JSON.stringify({ ...MINIMAL, css }), "text");
        if (result.ok !== !(i % 2)) fine = false;
        if (result.ok) {
          const sanitized = sanitizeCss(result.normalized.css).value;
          if (compileCss(sanitized, { registry, cssAllowed: true, preferences: { ...FULL, enabled: false } }).css !== "") fine = false;
          if (compileCss(sanitized, { registry, cssAllowed: true, preferences: { ...FULL, appearance: "calm" } }).css !== "") fine = false;
        }
      }
      return fine;
    }
    default:
      throw new Error(`check:css has no handler for ${id}`);
  }
}

/** Runs every case; returns {exitCode, testCount} through the shared tally. */
export async function runCssChecks(root, { check, done }) {
  const { resolveTheme } = await import("../../engine/index.js");
  const seed = readJson(join(root, "tests/fixtures/seeds/standard-dark.json"));
  const registry = readJson(join(root, "tests/fixtures/css-registry-synthetic.json")).registry;
  const ctx = {
    root,
    registry,
    check,
    resolveLayers: (theme) => resolveTheme(theme, { seed, policy: "themed", reducedMotion: false, forcedColors: false }).appearance.paints.page.layers.map((l) => l.kind),
  };
  const review = readJson(join(root, "tests/fixtures/css-review-r41-cases.json"));
  const groups = new Set();
  let accepted = 0;
  for (const testCase of review.cases) {
    groups.add(testCase.group);
    let got;
    try {
      got = outcome(testCase, ctx);
    } catch (error) {
      check(false, `${testCase.id}: ${error.message}`);
      continue;
    }
    if (check(got === testCase.accept, `${testCase.id} should be ${testCase.accept ? "accepted" : "rejected"} (${testCase.reason})`) && got) accepted++;
  }
  check(groups.size === review.groups.length && review.groups.every((g) => groups.has(g)), "every review group has cases");
  console.log(`  css-review-r41: ${review.cases.length} named cases, ${accepted} accepted, ${review.cases.length - accepted} rejected`);

  const policyCases = readJson(join(root, "tests/fixtures/css-policy-cases.json")).cases;
  for (const testCase of policyCases) check(pipeline(testCase.css, registry).ok === testCase.accept, `policy case ${testCase.id} should be ${testCase.accept ? "accepted" : "rejected"} (${testCase.reason})`);
  console.log(`  css-policy: ${policyCases.length} cases`);

  // Rejections are located and the whole input is refused.
  for (const css of [".AppHeader{display:none}", "body{display:none}", ".AppHeader{border-color:red}\n@import url(x);"]) {
    const result = sanitizeCss(css);
    check(!result.ok && result.issues.every((i) => i.path === "/css" && /line \d+, column \d+/.test(i.message)), `${JSON.stringify(css)} should be rejected with a located reason`);
  }

  // The faithful Choom CSS: admitted, canonical, a fixed point, owned rules compile without a
  // registry, and its native header rule fails closed until C3's registry arrives.
  const choom = readJson(join(root, "tests/fixtures/choom/choom-circuit-faithful.reskin.json"));
  const sanitized = sanitizeCss(choom.css);
  check(sanitized.ok, `faithful Choom CSS should be admitted: ${sanitized.issues?.map((i) => i.message).join(" ")}`);
  if (sanitized.ok) {
    const again = sanitizeCss(sanitized.value.css);
    check(again.ok && again.value.css === sanitized.value.css && again.value.hash === sanitized.value.hash, "Choom canonical CSS is not a fixed point");
    const closed = compileCss(sanitized.value, { registry: null, cssAllowed: true, preferences: FULL });
    check(!closed.ok && closed.issues.some((i) => /registry/.test(i.message)), "Choom's native header rule must fail closed without a registry");
    const owned = sanitizeCss(sanitized.value.css.replace(/^[^}]+\}/, ""));
    const ownedOnly = owned.ok && compileCss(owned.value, { registry: null, cssAllowed: true, preferences: FULL });
    check(ownedOnly?.ok && ownedOnly.ownedRules === 2 && ownedOnly.nativeRules === 0, "Choom's owned decorations should compile without a registry");
    const withRegistry = compileCss(sanitized.value, { registry, cssAllowed: true, preferences: FULL });
    check(withRegistry.ok && withRegistry.nativeRules === 1 && withRegistry.ownedRules === 2, "Choom should compile against a registry that admits its header");
    check(sanitized.value.policyHash === POLICY_HASH && sanitized.value.sanitizerVersion === 1, "Choom CSS proof carries the policy hash and sanitizer version");
  }
  return done();
}
