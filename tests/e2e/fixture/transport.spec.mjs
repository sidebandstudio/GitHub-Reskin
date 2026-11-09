// The preview transport: a trusted controller writes one complete, safely serialized srcdoc into a
// frame sandboxed without scripts or same-origin access, and replaces that frame per coalesced
// update. Completion, cancellation, cleanup, blocked navigation, safe insertion and the 50 ms p95
// completed-preview budget, in Chromium and Firefox; the budget fails Chromium and is reported for
// Firefox until C3b's preview compile target lands (see LATENCY_ENFORCED).
import { loadavg } from "node:os";
import { PREFS, classic, decorated, expect, expected, inFrame, mount, painted, previewFrame, rgb, test } from "./helpers.mjs";

const THEME = decorated("dracula", { rail: { shape: "notch" }, scanlines: {}, echo: {} });
const host = "[data-reskin-preview]";
const styled = "#preview iframe:not([aria-hidden])";

// Counts observers that were created and never disconnected, so cleanup can be checked.
const COUNT_OBSERVERS = () => {
  window.liveObservers = 0;
  for (const name of ["ResizeObserver", "IntersectionObserver"]) {
    const Native = window[name];
    window[name] = class extends Native {
      constructor(callback, options) {
        super(callback, options);
        window.liveObservers += 1;
        this.live = true;
      }
      disconnect() {
        if (this.live) window.liveObservers -= 1;
        this.live = false;
        super.disconnect();
      }
    };
  }
};

test("the styled frame is scriptless, has an opaque origin and holds the complete document", async ({ page, fixtureApp }) => {
  await mount(page, fixtureApp, { theme: THEME });
  const frame = page.locator(styled);
  expect(await frame.getAttribute("sandbox")).toBe("");
  expect(await frame.getAttribute("referrerpolicy")).toBe("no-referrer");
  // The host page cannot reach into it, and nothing in it can reach the host.
  expect(await page.evaluate((s) => document.querySelector(s).contentDocument, styled)).toBeNull();
  const inside = await (await previewFrame(page)).evaluate(() => ({ origin: self.origin, scripts: document.scripts.length, layers: [...document.querySelectorAll("head style")].map((s) => s.dataset.layer), csp: document.querySelector('meta[http-equiv="Content-Security-Policy"]')?.content }));
  expect(inside.origin).toBe("null");
  expect(inside.scripts).toBe(0);
  expect(inside.layers).toEqual(["fixture", "native", "theme", "fonts", "appearance"]);
  expect(inside.csp).toBe("default-src 'none'; img-src data:; font-src data:; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'");
  // The layout document is same-origin but never shown and never styled by the compiled theme;
  // only the root's island switch stands for it, so the structured rules lay out as shown.
  const layout = await page.evaluate(() => {
    const frame = document.querySelector("#preview iframe[aria-hidden]");
    const doc = frame.contentDocument;
    return { sandbox: frame.getAttribute("sandbox"), inert: frame.hasAttribute("inert"), visibility: getComputedStyle(frame).visibility, theme: doc.querySelector('style[data-layer="theme"]').textContent, scripts: doc.scripts.length };
  });
  expect(layout).toEqual({ sandbox: "allow-same-origin", inert: true, visibility: "hidden", theme: ":root{--reskin-on:1}", scripts: 0 });
});

test("each update completes in a new frame, coalesces bursts and cancels obsolete jobs", async ({ page, fixtureApp }) => {
  await mount(page, fixtureApp, { theme: classic("nord") });
  const first = await page.locator(styled).elementHandle();
  const completions = await page.evaluate(async ([themes, prefs]) => {
    const element = document.querySelector("[data-reskin-preview]");
    const seen = [];
    element.addEventListener("reskin-preview-complete", (event) => seen.push(event.detail.generation));
    // A burst inside one task, then more across the next frames: only the newest completes.
    for (const theme of themes) window.reskinPreview.update({ theme, preferences: prefs });
    await new Promise((resolve) => requestAnimationFrame(resolve));
    window.reskinPreview.setView("repo");
    await new Promise((resolve) => setTimeout(resolve, 5));
    window.reskinPreview.setView("profile");
    await new Promise((resolve) => element.addEventListener("reskin-preview-complete", () => element.dataset.completed === element.dataset.requested && resolve(), { once: false }));
    return { seen, requested: Number(element.dataset.requested) };
  }, [["dracula", "gruvbox", "one-dark", "tokyo-night", "solarized-light"].map(classic), PREFS]);
  await painted(page);
  expect(completions.seen.at(-1)).toBe(completions.requested);
  expect(completions.seen.length).toBeLessThanOrEqual(3);
  expect(await first.evaluate((node) => node.isConnected)).toBe(false);
  expect(await page.locator(`${host} iframe`).count()).toBe(2);
  // The shown frame is the last theme's.
  const last = await expected(page, classic("solarized-light"));
  expect(await inFrame(page, (doc) => doc.defaultView.getComputedStyle(doc.body).backgroundColor)).toBe(rgb(last["--bgColor-default"]));
});

test("an identical update completes without replacing the frame", async ({ page, fixtureApp }) => {
  await mount(page, fixtureApp, { theme: classic("nord") });
  const frame = await page.locator(styled).elementHandle();
  await page.evaluate(([t, p]) => window.reskinPreview.update({ theme: t, preferences: p }), [classic("nord"), PREFS]);
  await painted(page);
  expect(await frame.evaluate((node) => node.isConnected)).toBe(true);
});

// Holds every request matching pattern until released. hit resolves at the first one.
async function stall(page, pattern) {
  const held = [];
  let hit;
  const first = new Promise((resolve) => (hit = resolve));
  await page.route(pattern, (route) => {
    held.push(route);
    hit();
  });
  return { first, release: () => Promise.all(held.map((route) => route.continue())) };
}

// The completions seen from now on, with the host's metadata and the shown document's view.
const WATCH_COMPLETIONS = () => {
  const element = document.querySelector("[data-reskin-preview]");
  window.completions = [];
  element.addEventListener("reskin-preview-complete", (event) => {
    const shown = element.querySelector("iframe:not([aria-hidden])").srcdoc;
    window.completions.push({ generation: event.detail.generation, requested: Number(element.dataset.requested), view: element.dataset.view, shownView: /<[^>]* data-view="([a-z0-9]+)"/.exec(shown)?.[1] ?? null });
  });
};

const settled = (page) => page.evaluate(() => {
  const element = document.querySelector("[data-reskin-preview]");
  return { completed: element.dataset.completed, requested: element.dataset.requested, error: element.dataset.error ?? null };
});

test("a newer update runs at once while an obsolete job waits on a font read, image read or font load", async ({ page, fixtureApp }) => {
  await mount(page, fixtureApp, { theme: classic("solarized-light") });
  await page.evaluate(WATCH_COMPLETIONS);
  const waits = {
    // A font file that never arrives.
    font: { pattern: "**/bungee.woff2", obsolete: decorated("dracula", { rail: {} }, { font: "bungee" }) },
    // The dark logo variants, read the first time a dark theme shows the profile.
    image: { pattern: "**/*-dark.webp", obsolete: classic("nord") },
  };
  for (const [kind, { pattern, obsolete }] of Object.entries(waits)) {
    const held = await stall(page, pattern);
    await page.evaluate(([t, p]) => window.reskinPreview.update({ theme: t, preferences: p }), [obsolete, PREFS]);
    await held.first;
    // Light themes, so the font step reads no dark logo before the image step.
    const newest = kind === "font" ? classic("catppuccin-latte") : classic("solarized-light");
    await page.evaluate(([t, p]) => window.reskinPreview.update({ theme: t, preferences: p }), [newest, PREFS]);
    await page.waitForFunction(() => document.querySelector("[data-reskin-preview]").dataset.completed === document.querySelector("[data-reskin-preview]").dataset.requested, null, { timeout: 2000 });
    const last = await expected(page, newest);
    expect(await inFrame(page, (doc) => doc.defaultView.getComputedStyle(doc.body).backgroundColor), kind).toBe(rgb(last["--bgColor-default"]));
    // The obsolete read finishing later changes nothing.
    const before = await page.evaluate(() => window.completions.length);
    await held.release();
    await page.unrouteAll();
    await page.waitForTimeout(200);
    expect(await page.evaluate(() => window.completions.length), kind).toBe(before);
    expect((await settled(page)).error).toBeNull();
  }
  // The layout document's font load never settling holds no newer update either.
  await page.evaluate(() => {
    document.querySelector("#preview iframe[aria-hidden]").contentDocument.fonts.load = () => new Promise(() => {});
  });
  await page.evaluate(([t, p]) => window.reskinPreview.update({ theme: t, preferences: p }), [decorated("nord", { rail: {} }, { font: "fraunces" }), PREFS]);
  await page.waitForTimeout(100);
  const stuck = await settled(page);
  expect(stuck.completed).not.toBe(stuck.requested);
  await page.evaluate(([t, p]) => window.reskinPreview.update({ theme: t, preferences: p }), [classic("dracula"), PREFS]);
  await page.waitForFunction(() => document.querySelector("[data-reskin-preview]").dataset.completed === document.querySelector("[data-reskin-preview]").dataset.requested, null, { timeout: 2000 });
  // Every completion describes the generation and view it rendered.
  for (const entry of await page.evaluate(() => window.completions)) {
    expect(entry.generation).toBe(entry.requested);
    expect(entry.shownView).toBe(entry.view);
  }
});

test("destroy during a stalled read ends the job without completing, reporting or leaving frames", async ({ page, fixtureApp }) => {
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await mount(page, fixtureApp, { theme: classic("nord") });
  await page.evaluate(() => {
    const element = document.querySelector("[data-reskin-preview]");
    window.events = 0;
    for (const type of ["reskin-preview-complete", "reskin-preview-error"]) element.addEventListener(type, () => (window.events += 1));
    window.destroyedHost = element;
  });
  const held = await stall(page, "**/bungee.woff2");
  await page.evaluate(([t, p]) => window.reskinPreview.update({ theme: t, preferences: p }), [decorated("dracula", { rail: {} }, { font: "bungee" }), PREFS]);
  await held.first;
  await page.evaluate(() => window.reskinPreview.destroy());
  await held.release();
  await page.waitForTimeout(300);
  expect(await page.evaluate(() => ({ events: window.events, children: window.destroyedHost.childElementCount, connected: window.destroyedHost.isConnected, frames: document.querySelectorAll("iframe, [data-reskin-motion]").length }))).toEqual({ events: 0, children: 0, connected: false, frames: 0 });
  expect(errors).toEqual([]);
});

test("a request during the post-paint wait cancels that completion, so metadata matches the shown document", async ({ page, fixtureApp }) => {
  await mount(page, fixtureApp, { theme: classic("dracula") });
  await page.evaluate(WATCH_COMPLETIONS);
  await page.evaluate(([t, p]) => {
    // When the profile's replacement frame has loaded, ask for the repository in the next
    // animation frame: after the swap, before the job's post-paint completion.
    let once = false;
    document.addEventListener("load", (event) => {
      if (once || !event.target.matches?.("#preview iframe:not([aria-hidden])")) return;
      once = true;
      requestAnimationFrame(() => window.reskinPreview.setView("repo"));
    }, true);
    window.reskinPreview.update({ theme: t, preferences: p });
  }, [classic("nord"), PREFS]);
  await painted(page);
  const completions = await page.evaluate(() => window.completions);
  expect(completions.at(-1)).toMatchObject({ view: "repo", shownView: "repo" });
  for (const entry of completions) {
    expect(entry.generation).toBe(entry.requested);
    expect(entry.shownView).toBe(entry.view);
  }
});

test("a destroyed handle still held by its caller keeps no frame or serialized document", async ({ page, fixtureApp }) => {
  await page.goto(fixtureApp.url("preview.html"));
  const after = await page.evaluate(async ([theme, preferences]) => {
    const box = document.createElement("div");
    document.body.append(box);
    const handle = window.reskinPreview.mountPreview(box, { view: "profile", theme, preferences });
    const host = box.firstElementChild;
    await new Promise((resolve) => host.addEventListener("reskin-preview-complete", resolve, { once: true }));
    const frames = [...host.querySelectorAll("iframe")];
    handle.destroy();
    // The destroyed handle's methods stay safe to call and do nothing.
    handle.update({ theme, preferences });
    handle.setView("repo");
    handle.setBefore(true);
    handle.destroy();
    await new Promise((resolve) => setTimeout(resolve, 100));
    return { children: host.childElementCount, connected: host.isConnected, frames: frames.map((f) => ({ connected: f.isConnected, srcdoc: f.hasAttribute("srcdoc") })), boxChildren: box.childElementCount };
  }, [THEME, PREFS]);
  expect(after).toEqual({ children: 0, connected: false, frames: [{ connected: false, srcdoc: false }, { connected: false, srcdoc: false }], boxChildren: 0 });
});

test("destroy and repeated updates release frames, observers and motion sentinels", async ({ page, fixtureApp }) => {
  await page.addInitScript(COUNT_OBSERVERS);
  await mount(page, fixtureApp, { theme: THEME });
  const live = await page.evaluate(() => window.liveObservers);
  for (const id of ["nord", "dracula", "gruvbox", "nord", "dracula", "gruvbox", "nord", "dracula"]) {
    await page.evaluate(([t, p]) => window.reskinPreview.update({ theme: t, preferences: p }), [decorated(id, { echo: {}, drift: {} }), PREFS]);
    await painted(page);
  }
  expect(await page.locator(`${host} iframe`).count()).toBe(2);
  expect(await page.evaluate(() => window.liveObservers)).toBeLessThanOrEqual(live + 1);
  await page.evaluate(() => window.reskinPreview.destroy());
  expect(await page.locator("iframe, [data-reskin-motion]").count()).toBe(0);
  expect(await page.evaluate(() => window.liveObservers)).toBe(0);
});

test("the frame cannot navigate, open windows or make any request", async ({ page, fixtureApp }) => {
  const outside = [];
  await page.route("**/*", (route) => {
    const url = new URL(route.request().url());
    if (url.hostname !== "127.0.0.1") {
      outside.push(url.href);
      return route.abort();
    }
    return route.continue();
  });
  await mount(page, fixtureApp, { theme: THEME });
  // The styled document loads nothing: images and the font travel embedded in each srcdoc.
  await page.evaluate(([t, p]) => window.reskinPreview.update({ theme: t, preferences: p }), [decorated("nord", { rail: {} }), PREFS]);
  await painted(page);
  expect(await inFrame(page, () => performance.getEntriesByType("resource").map((entry) => entry.name))).toEqual([]);
  expect(await inFrame(page, (doc) => [...doc.images].every((img) => img.complete && img.naturalWidth > 0))).toBe(true);
  const start = page.url();
  const srcdoc = await page.evaluate(() => window.reskinPreview.srcdoc());
  expect(srcdoc).not.toMatch(/\shref=|<script|<iframe|<form|<base|<link|http-equiv="refresh"|\son[a-z]+=/i);
  const sources = srcdoc.match(/\ssrc="[^"]*"/g) ?? [];
  expect(sources.length).toBeGreaterThan(5);
  for (const src of sources) expect(src).toMatch(/^ src="data:image\/(webp|svg\+xml);base64,[A-Za-z0-9+/]+={0,2}"$/);
  const frame = await previewFrame(page);
  // The fixture's own links keep destinations only as data.
  for (const link of await frame.locator("a[data-href]").all()) await link.click({ force: true });
  // Links the serializer would never write, injected by the driver: top-level and popup targets.
  await frame.evaluate(() => {
    for (const target of ["_top", "_blank"]) {
      const a = document.createElement("a");
      a.href = "https://example.com/";
      a.target = target;
      a.textContent = target;
      a.id = `try${target}`;
      document.body.prepend(a);
    }
  });
  const popups = [];
  page.on("popup", (popup) => popups.push(popup));
  for (const target of ["_top", "_blank"]) await frame.locator(`#try${target}`).click();
  await page.waitForTimeout(300);
  expect(page.url()).toBe(start);
  expect(popups).toEqual([]);
  expect(outside).toEqual([]);
  expect(frame.url()).toBe("about:srcdoc");
});

test("theme text is inserted as text and the document gains no node in transport", async ({ page, fixtureApp }) => {
  const theme = decorated("dracula", { rail: {} });
  const hostile = `Tom & "Jerry" 'R' &amp; &lt;b&gt;`;
  theme.flavor.slots["profile.pinned.heading"] = hostile;
  theme.flavor.slots["contributions.caption"] = `A&B "caption"`;
  await mount(page, fixtureApp, { theme });
  const layout = await page.evaluate(() => {
    const doc = document.querySelector("#preview iframe[aria-hidden]").contentDocument;
    const parsed = new DOMParser().parseFromString(window.reskinPreview.srcdoc(), "text/html");
    const shape = (root) => [...root.querySelectorAll("*")].map((n) => `${n.namespaceURI === "http://www.w3.org/2000/svg" ? "svg:" : ""}${n.localName}`).join(",");
    return { layout: shape(doc.body), parsed: shape(parsed.body), heads: parsed.head.children.length, text: parsed.body.textContent === doc.body.textContent };
  });
  expect(layout.parsed).toBe(layout.layout);
  expect(layout.heads).toBe(8);
  expect(layout.text).toBe(true);
  const shown = await inFrame(page, (doc) => ({ copy: [...doc.querySelectorAll(".rs-copy")].map((n) => n.textContent), elements: doc.body.querySelectorAll("*").length, scripts: doc.querySelectorAll("script,iframe,object,embed,form,base,link").length }));
  expect(shown.copy).toContain(hostile);
  expect(shown.copy).toContain(`A&B "caption"`);
  expect(shown.scripts).toBe(0);
  expect(shown.elements).toBe(layout.layout.split(",").length);
});

test("the serializer refuses scripts, handlers, foreign images and style text that could close its element", async ({ page, fixtureApp }) => {
  await page.goto(fixtureApp.url("preview.html"));
  const refusals = await page.evaluate(() => {
    const { serializeFixture } = window.reskinSerialize;
    const attempt = (build, styles = []) => {
      const doc = document.implementation.createHTMLDocument("");
      build(doc);
      try {
        return serializeFixture(doc, styles, (src) => (src.startsWith("/") ? "https://example.com/a.webp" : null));
      } catch (error) {
        return error.message;
      }
    };
    const text = (doc) => {
      const p = doc.createElement("p");
      p.textContent = '</p><script>alert(1)</script><img src=x onerror="alert(1)">';
      doc.body.append(p);
    };
    const parsed = (() => {
      const doc = document.implementation.createHTMLDocument("");
      text(doc);
      return new DOMParser().parseFromString(serializeFixture(doc, []), "text/html").body.children.length;
    })();
    return {
      parsed,
      script: attempt((doc) => doc.body.append(doc.createElement("script"))),
      style: attempt((doc) => doc.body.append(doc.createElement("style"))),
      handler: attempt((doc) => {
        const span = doc.createElement("span");
        span.setAttribute("onclick", "x");
        doc.body.append(span);
      }),
      href: attempt((doc) => {
        const a = doc.createElement("a");
        a.setAttribute("href", "https://example.com/");
        doc.body.append(a);
      }),
      // An image without an embedded copy keeps its alt text and loses its src.
      remote: attempt((doc) => {
        const img = doc.createElement("img");
        img.setAttribute("src", "https://example.com/a.webp");
        img.setAttribute("alt", "remote");
        doc.body.append(img);
      }),
      // An embedder that hands back anything but image data is refused.
      unembedded: attempt((doc) => {
        const img = doc.createElement("img");
        img.setAttribute("src", "/packages/preview/fixture/assets/a.webp");
        doc.body.append(img);
      }),
      css: attempt(() => {}, [{ name: "theme", css: "a{color:red}</style><script>" }]),
      ok: attempt(text, [{ name: "theme", css: ".a>.b{color:red}" }]),
    };
  });
  expect(refusals.parsed).toBe(1);
  expect(refusals.ok).toMatch(/<p>&lt;\/p&gt;&lt;script&gt;alert\(1\)&lt;\/script&gt;&lt;img src=x onerror="alert\(1\)"&gt;<\/p>/);
  expect(refusals.remote).toMatch(/<img alt="remote">/);
  for (const key of ["script", "style", "handler", "href", "unembedded", "css"]) expect(refusals[key], key).toMatch(/^(The preview cannot|Preview style text|A preview image)/);
});

// Completion is measured from the update call to the first paint after the replacement frame
// has loaded and been shown, not to the srcdoc assignment.
const timeEdits = (page, edits) =>
  page.evaluate(async (list) => {
    const element = document.querySelector("[data-reskin-preview]");
    const out = [];
    for (const edit of list) {
      const done = new Promise((resolve) => element.addEventListener("reskin-preview-complete", (event) => resolve(event.detail.ms), { once: true }));
      if (edit.before !== undefined) window.reskinPreview.setBefore(edit.before);
      else window.reskinPreview.update(edit);
      out.push(await done);
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    return out;
  }, edits);

function percentiles(times) {
  const sorted = [...times].sort((a, b) => a - b);
  return { p50: sorted[Math.floor(sorted.length / 2)], p95: sorted[Math.ceil(sorted.length * 0.95) - 1], max: sorted.at(-1) };
}

// TRACKED, owned by C3b: with real C3, Firefox measured 55-60 ms p95 in review round 2 on a
// heavily loaded machine, because every replacement reparses C3's full ~200 KB compiled theme.
// The fix is C3b's preview compile target, which emits only the variables and rules the fixture
// uses; C3b's acceptance includes this gate in both engines. Until C5 consumes that target, the
// Firefox run reports its p95 against 50 ms without failing. Chromium enforces the gate now.
const LATENCY_ENFORCED = { chromium: true, firefox: false };

test("completed previews stay within 50 ms at the 95th percentile across 50 edits of each kind", async ({ page, fixtureApp, browserName }, info) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await mount(page, fixtureApp, { theme: THEME });
  // Accent edits, as a color picker makes them, 100 ms apart: the body is kept, the styles change.
  const accents = Array.from({ length: 50 }, (_, i) => ({ theme: { ...THEME, colors: { ...THEME.colors, accent: `#${(0x40 + ((i * 37) % 0xa0)).toString(16)}${(0x60 + ((i * 53) % 0x90)).toString(16)}ff` } }, preferences: PREFS }));
  // Theme selections, Text changes and Before/After: the whole fixture is laid out again.
  const ids = ["dracula", "nord", "gruvbox", "tokyo-night", "solarized-light", "catppuccin-latte", "one-dark", "rose-pine"];
  const switches = Array.from({ length: 50 }, (_, i) => (i % 5 === 4 ? { before: i % 10 === 4 } : { theme: decorated(ids[i % ids.length], { rail: {}, echo: {} }), preferences: { ...PREFS, motion: false, text: i % 3 !== 0 } }));
  for (const [label, edits] of [["color edits", accents], ["theme, preference and Before/After changes", switches]]) {
    const { p50, p95, max } = percentiles(await timeEdits(page, edits));
    const enforced = LATENCY_ENFORCED[browserName];
    const verdict = p95 <= 50 ? "within" : enforced ? "over" : "over (reported only; tracked for C3b's preview compile target)";
    const summary = `${label}: completed preview p50 ${p50.toFixed(1)} ms, p95 ${p95.toFixed(1)} ms, max ${max.toFixed(1)} ms over ${edits.length}; ${verdict} the 50 ms budget; load ${loadavg().map((n) => n.toFixed(2)).join(" ")}`;
    info.annotations.push({ type: "latency", description: summary });
    console.log(`[${info.project.name}] ${summary}`);
    // A measurement that does not fail stays visible in every report as tracked work for C3b.
    if (!enforced) info.annotations.push({ type: "tracked (C3b)", description: `Firefox preview p95 ${p95.toFixed(1)} ms for ${label} against 50 ms; enforced once C5 consumes C3b's preview compile target` });
    if (enforced) expect(p95, label).toBeLessThanOrEqual(50);
  }
});
