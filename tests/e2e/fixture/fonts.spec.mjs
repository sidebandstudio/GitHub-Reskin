// Fonts: only the selected heading and body families load, every reviewed weight read once by the
// controller from the runtime adapter's packaged paths and embedded in the scriptless frame; a
// blocked or missing file falls back natively; code keeps its native family. On the GitHub-like
// page, a theme's bundled body face loads beside its heading face. Outside the blocked-file test,
// any font file the server lacks, and any text whose face is missing or failed, fails the test.
import { PREFS, classic, decorated, expect, inFrame, mount, test } from "./helpers.mjs";

const theme = (font) => decorated("gruvbox", { rules: { style: "ticks" } }, { font });

/** Every font file the page requests, and every one that fails or answers with an error. */
function fontFiles(page) {
  const files = { requested: [], failed: [] };
  const path = (url) => new URL(url).pathname;
  page.on("request", (request) => request.url().endsWith(".woff2") && files.requested.push(path(request.url())));
  page.on("requestfailed", (request) => request.url().endsWith(".woff2") && files.failed.push(`failed ${path(request.url())}`));
  page.on("response", (response) => response.url().endsWith(".woff2") && !response.ok() && files.failed.push(`${response.status()} ${path(response.url())}`));
  return files;
}

/**
 * Each Reskin family and weight the document's text uses, with the status of the face CSS font
 * matching picks for it, or "none" when the family has no face.
 */
async function usedFaces(doc) {
  await doc.fonts.ready;
  const used = new Set();
  for (const el of doc.body.querySelectorAll("*")) {
    if (![...el.childNodes].some((node) => node.nodeType === 3 && node.textContent.trim())) continue;
    const style = doc.defaultView.getComputedStyle(el);
    const family = /^"(Reskin [^"]+)"/.exec(style.fontFamily)?.[1];
    if (family) used.add(`${family}|${style.fontWeight}`);
  }
  // CSS Fonts 4 weight matching among one family's faces.
  const match = (weights, w) => {
    if (weights.includes(w)) return w;
    const below = weights.filter((x) => x < w).sort((a, b) => b - a);
    const above = weights.filter((x) => x > w).sort((a, b) => a - b);
    if (w >= 400 && w <= 500) return above.find((x) => x <= 500) ?? below[0] ?? above[0];
    return w < 400 ? (below[0] ?? above[0]) : (above[0] ?? below[0]);
  };
  return Object.fromEntries([...used].sort().map((key) => {
    const [family, weight] = key.split("|");
    const faces = [...doc.fonts].filter((face) => face.family.replace(/"/g, "") === family);
    const picked = match(faces.map((face) => Number(face.weight)), Number(weight));
    return [`${family} ${weight}`, faces.find((face) => Number(face.weight) === picked)?.status ?? "none"];
  }));
}
const allLoaded = (used) => Object.fromEntries(Object.keys(used).map((key) => [key, "loaded"]));

test("only the selected family loads, at every reviewed weight, and nothing loads with Fonts off", async ({ page, fixtureApp }) => {
  const files = fontFiles(page);
  const fonts = files.requested;
  await mount(page, fixtureApp, { theme: theme("fraunces") });
  await inFrame(page, (doc) => doc.fonts.ready.then(() => null));
  await expect.poll(() => [...fonts].sort()).toEqual(["/assets/fonts/fraunces/fraunces-700.woff2", "/assets/fonts/fraunces/fraunces.woff2"]);
  expect(await inFrame(page, (doc) => [...doc.fonts].map((f) => `${f.family.replace(/"/g, "")} ${f.weight}`).sort())).toEqual(["Reskin Fraunces 600", "Reskin Fraunces 700"]);
  const used = await inFrame(page, usedFaces);
  expect(used).toHaveProperty(["Reskin Fraunces 600"]);
  expect(used).toEqual(allLoaded(used));
  expect(files.failed).toEqual([]);
  const families = await inFrame(page, (doc) => {
    const style = (selector) => doc.defaultView.getComputedStyle(doc.querySelector(selector)).fontFamily;
    return { body: style("body"), readme: style(".markdown-body"), copy: style(".rs-copy--heading"), size: doc.defaultView.getComputedStyle(doc.querySelector(".rs-copy--heading")).fontSize };
  });
  expect(families.body).not.toMatch(/Reskin/);
  expect(families.readme).not.toMatch(/Reskin/);
  expect(families.copy).toMatch(/^"Reskin Fraunces", Georgia/);
  expect(families.size).toBe("20px");

  fonts.length = 0;
  await mount(page, fixtureApp, { theme: theme("bungee"), preferences: { ...PREFS, fonts: false } });
  await page.waitForTimeout(300);
  expect(fonts).toEqual([]);
  expect(await inFrame(page, (doc) => doc.defaultView.getComputedStyle(doc.querySelector(".rs-copy--heading")).fontFamily)).not.toMatch(/Reskin/);
});

test("the preview loads the selected heading and body families at every weight their text uses, as on github.com", async ({ page, fixtureApp }) => {
  const files = fontFiles(page);
  await mount(page, fixtureApp, { view: "repo", theme: { ...classic("gruvbox"), fonts: { heading: "cinzel", body: "ibm-plex-sans" } } });
  const used = await inFrame(page, usedFaces);
  const state = await inFrame(page, (doc) => {
    const family = (selector) => doc.defaultView.getComputedStyle(doc.querySelector(selector)).fontFamily;
    return { faces: [...doc.fonts].map((f) => `${f.family.replace(/"/g, "")} ${f.weight}`).sort(), body: family(".markdown-body p"), code: family("pre, code") };
  });
  expect(state.faces).toEqual(["Reskin Cinzel 600", "Reskin Industrial Sans 400", "Reskin Industrial Sans 500", "Reskin Industrial Sans 600", "Reskin Industrial Sans 700"]);
  expect(state.body).toMatch(/^"Reskin Industrial Sans", /);
  expect(state.code).not.toMatch(/Reskin/);
  // Readable prose and its bold, and the heading role, each in a loaded face.
  expect(Object.keys(used)).toEqual(expect.arrayContaining(["Reskin Industrial Sans 400", "Reskin Cinzel 600"]));
  expect(Object.keys(used).some((key) => /^Reskin Industrial Sans (600|700)$/.test(key))).toBe(true);
  expect(used).toEqual(allLoaded(used));
  expect(new Set(files.requested).size).toBe(files.requested.length);
  expect([...files.requested].sort()).toEqual(["/assets/fonts/cinzel/cinzel.woff2", ...[500, 600, 700].map((w) => `/assets/fonts/ibm-plex-sans/ibm-plex-sans-${w}.woff2`), "/assets/fonts/ibm-plex-sans/ibm-plex-sans.woff2"].sort());
  expect(files.failed).toEqual([]);
});

test("a body font alone loads in the preview with GitHub's heading font kept", async ({ page, fixtureApp }) => {
  const files = fontFiles(page);
  await mount(page, fixtureApp, { theme: { ...classic("gruvbox"), fonts: { body: "barlow" } } });
  const used = await inFrame(page, usedFaces);
  expect(Object.keys(used)).toContain("Reskin Barlow 400");
  expect(Object.keys(used).every((key) => key.startsWith("Reskin Barlow "))).toBe(true);
  expect(used).toEqual(allLoaded(used));
  expect(files.requested.every((path) => path.startsWith("/assets/fonts/barlow/"))).toBe(true);
  expect(files.failed).toEqual([]);
});

test("a blocked font file falls back to the native stack and the preview stays complete", async ({ page, fixtureApp }) => {
  await page.route("**/*.woff2", (route) => route.fulfill({ status: 404, body: "" }));
  await mount(page, fixtureApp, { theme: theme("rajdhani") });
  await inFrame(page, (doc) => doc.fonts.ready.then(() => null));
  const state = await inFrame(page, (doc) => {
    const copy = doc.querySelector('[data-reskin-owned="profile.pinned.heading"] .rs-copy--heading');
    return { status: [...doc.fonts].map((f) => f.status), text: copy.textContent, width: copy.getBoundingClientRect().width, loaded: [...doc.fonts].some((f) => f.status === "loaded"), family: doc.defaultView.getComputedStyle(copy).fontFamily };
  });
  // Without an embedded copy the frame gets no face at all, so it never tries the network.
  expect(state.status).toEqual([]);
  expect(state.loaded).toBe(false);
  expect(state.family).toMatch(/^"Reskin Rajdhani", /);
  expect(state.text).toBe("Pinned sentinel copy");
  expect(state.width).toBeGreaterThan(0);
});

test("on the GitHub-like page the body face loads beside the heading face, at the weights its text uses, and code stays native", async ({ page, fixtureApp }) => {
  const files = fontFiles(page);
  const fonts = files.requested;
  await page.goto(fixtureApp.url("adversarial.html"));
  await page.waitForFunction(() => document.documentElement.dataset.ready === "true");
  // Ordinary bold prose, so the readable body weight 700 is exercised too.
  await page.evaluate(() => {
    const p = document.createElement("p");
    p.innerHTML = "Readable prose with <strong>bold words</strong> in it.";
    document.querySelector(".markdown-body").append(p);
  });
  const theme = { ...classic("gruvbox"), fonts: { heading: "cinzel", body: "ibm-plex-sans" } };
  await page.evaluate(([t, p]) => window.reskinNative.apply(t, p), [theme, PREFS]);
  await page.evaluate(() => document.fonts.ready);
  const state = await page.evaluate(() => {
    const family = (selector) => getComputedStyle(document.querySelector(selector)).fontFamily;
    return {
      readme: family(".markdown-body p"),
      heading: family(".markdown-body h2, h2"),
      code: family("pre"),
      loaded: [...document.fonts].filter((f) => f.status === "loaded").map((f) => `${f.family.replace(/"/g, "")} ${f.weight}`),
    };
  });
  expect(state.readme).toMatch(/^"Reskin Industrial Sans", /);
  expect(state.heading).toMatch(/^"Reskin Cinzel", /);
  expect(state.code).not.toMatch(/Reskin/);
  expect(state.loaded).toEqual(expect.arrayContaining(["Reskin Industrial Sans 400", "Reskin Industrial Sans 700", "Reskin Cinzel 600"]));
  const used = await page.evaluate(`(${usedFaces})(document)`);
  expect(Object.keys(used)).toContain("Reskin Industrial Sans 700");
  expect(used).toEqual(allLoaded(used));
  expect(files.failed).toEqual([]);
  // Only the two selected families load, and only weights the page's text uses.
  expect(fonts.length).toBeGreaterThanOrEqual(2);
  expect(fonts.every((path) => /^\/assets\/fonts\/(ibm-plex-sans|cinzel)\//.test(path))).toBe(true);
  expect(fonts).toContain("/assets/fonts/ibm-plex-sans/ibm-plex-sans.woff2");
  expect(new Set(fonts).size).toBe(fonts.length);
});
