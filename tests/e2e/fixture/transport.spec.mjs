// The preview transport: a trusted controller writes one complete, safely serialized srcdoc into a
// frame sandboxed without scripts or same-origin access, and replaces that frame per coalesced
// update. Completion, cancellation, cleanup, blocked navigation, safe insertion and the 50 ms p95
// completed-preview budget, in Chromium and Firefox.
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
  // The layout document is same-origin but never shown and never styled by the compiled theme.
  const layout = await page.evaluate(() => {
    const frame = document.querySelector("#preview iframe[aria-hidden]");
    const doc = frame.contentDocument;
    return { sandbox: frame.getAttribute("sandbox"), inert: frame.hasAttribute("inert"), visibility: getComputedStyle(frame).visibility, theme: doc.querySelector('style[data-layer="theme"]').textContent, scripts: doc.scripts.length };
  });
  expect(layout).toEqual({ sandbox: "allow-same-origin", inert: true, visibility: "hidden", theme: "", scripts: 0 });
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

test("completed previews stay within 50 ms at the 95th percentile across 50 edits of each kind", async ({ page, fixtureApp }, info) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await mount(page, fixtureApp, { theme: THEME });
  // Accent edits, as a color picker makes them, 100 ms apart: the body is kept, the styles change.
  const accents = Array.from({ length: 50 }, (_, i) => ({ theme: { ...THEME, colors: { ...THEME.colors, accent: `#${(0x40 + ((i * 37) % 0xa0)).toString(16)}${(0x60 + ((i * 53) % 0x90)).toString(16)}ff` } }, preferences: PREFS }));
  // Theme selections, Text changes and Before/After: the whole fixture is laid out again.
  const ids = ["dracula", "nord", "gruvbox", "tokyo-night", "solarized-light", "catppuccin-latte", "one-dark", "rose-pine"];
  const switches = Array.from({ length: 50 }, (_, i) => (i % 5 === 4 ? { before: i % 10 === 4 } : { theme: decorated(ids[i % ids.length], { rail: {}, echo: {} }), preferences: { ...PREFS, motion: false, text: i % 3 !== 0 } }));
  for (const [label, edits] of [["color edits", accents], ["theme, preference and Before/After changes", switches]]) {
    const { p50, p95, max } = percentiles(await timeEdits(page, edits));
    const summary = `${label}: completed preview p50 ${p50.toFixed(1)} ms, p95 ${p95.toFixed(1)} ms, max ${max.toFixed(1)} ms over ${edits.length}`;
    info.annotations.push({ type: "latency", description: summary });
    console.log(`[${info.project.name}] ${summary}`);
    expect(p95, label).toBeLessThanOrEqual(50);
  }
});
