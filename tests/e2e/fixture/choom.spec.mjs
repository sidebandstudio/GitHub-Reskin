// Choom Circuit's owned flavor on markup modeled on live github.com (tests/e2e/fixture/live): the
// `// CHOOM` tag above the profile name at desktop and phone widths, and the FLATLINED stamp on the
// 404 illustration, through C3's real anchors with the theme's own CSS. GitHub's layout never
// moves, and what the theme draws must be what paints on top.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { APP, PREFS, expect, test } from "./helpers.mjs";

const ROOT = fileURLToPath(new URL("../../../", import.meta.url));
const CHOOM = JSON.parse(readFileSync(join(ROOT, "tests/appearance/fixtures/choom-circuit.reskin.json"), "utf8"));
// Fonts stay off: the routed page serves no font files.
const FULL = { ...PREFS, fonts: false };

async function open(page, name, url) {
  const html = readFileSync(new URL(`./live/${name}.html`, import.meta.url), "utf8").replace("</head>", '<script type="module" src="/__reskin/app.js"></script></head>');
  const app = readFileSync(join(APP, "app.js"), "utf8");
  await page.route("https://github.com/**", (route) => {
    if (new URL(route.request().url()).pathname === "/__reskin/app.js") return route.fulfill({ contentType: "text/javascript", body: app });
    if (route.request().resourceType() === "document") return route.fulfill({ status: name === "not-found" ? 404 : 200, contentType: "text/html", body: html });
    return route.abort();
  });
  await page.goto(url);
  await page.waitForFunction(() => window.reskinGithub?.available);
}

const apply = (page) => page.evaluate(([t, p]) => window.reskinGithub.apply(t, p, { cssAllowed: true, layout: false }), [CHOOM, FULL]);

const nativeBoxes = (page) =>
  page.evaluate(() => [...document.body.querySelectorAll("*")].filter((n) => !n.closest("[data-reskin-owned]")).map((n) => {
    const r = n.getBoundingClientRect();
    return [n.tagName, n.className, Math.round(r.x * 100) / 100, Math.round(r.y * 100) / 100, Math.round(r.width * 100) / 100, Math.round(r.height * 100) / 100];
  }));

// GitHub's own text in <main>, leaving out owned copy.
const nativeText = (page) =>
  page.evaluate(() => {
    let text = "";
    const walker = document.createTreeWalker(document.querySelector("main"), 4);
    for (let node = walker.nextNode(); node; node = walker.nextNode()) if (!node.parentElement.closest("[data-reskin-owned]")) text += node.data;
    return text;
  });

const overlaps = (a, b) => a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom;
// Whether rect reaches inside the ellipse inscribed in box (the avatar circle).
function insideEllipse(rect, box) {
  const cx = box.left + box.width / 2;
  const cy = box.top + box.height / 2;
  const x = Math.max(rect.left, Math.min(cx, rect.right)) - cx;
  const y = Math.max(rect.top, Math.min(cy, rect.bottom)) - cy;
  return (x / (box.width / 2)) ** 2 + (y / (box.height / 2)) ** 2 < 1;
}

for (const viewport of [{ width: 1440, height: 900 }, { width: 390, height: 844 }]) {
  test(`the // CHOOM tag sits just above the profile name at ${viewport.width}px, covering nothing and moving nothing`, async ({ page }) => {
    await page.setViewportSize(viewport);
    await open(page, "profile", "https://github.com/octo-sample");
    const before = await nativeBoxes(page);
    const applied = await apply(page);
    expect(applied.policy).toBe("themed");
    expect(applied.slots).toContain("profile.tag");
    expect(await nativeBoxes(page)).toEqual(before);
    const g = await page.evaluate(() => {
      const box = (r) => ({ left: r.left, top: r.top, right: r.right, bottom: r.bottom, width: r.width, height: r.height });
      const range = document.createRange();
      const lines = [...document.querySelectorAll(".vcard-fullname, .vcard-username")].flatMap((n) => {
        range.selectNodeContents(n);
        return [...range.getClientRects()].filter((r) => r.width > 0).map(box);
      });
      const tag = document.querySelector('[data-reskin-slot="profile.tag"]');
      return {
        tag: tag && box(tag.getBoundingClientRect()),
        copy: tag?.textContent,
        lines,
        avatar: box(document.querySelector(".h-card img.avatar").getBoundingClientRect()),
        follow: box(document.querySelector(".btn-block").getBoundingClientRect()),
        header: box(document.querySelector("header").getBoundingClientRect()),
        width: document.documentElement.clientWidth,
      };
    });
    expect(g.tag, "the tag is placed").toBeTruthy();
    expect(g.copy).toBe("// choom");
    const [name] = g.lines;
    // As in 1.1.0: a label over the name, starting where the name starts.
    expect(g.tag.bottom).toBeLessThanOrEqual(name.top);
    expect(name.top - g.tag.bottom).toBeLessThanOrEqual(4);
    expect(Math.abs(g.tag.left - name.left)).toBeLessThan(1);
    expect(g.tag.right).toBeLessThanOrEqual(g.width);
    for (const line of g.lines) expect(overlaps(g.tag, line), "GitHub's name text").toBe(false);
    expect(overlaps(g.tag, g.follow), "the Follow button").toBe(false);
    expect(overlaps(g.tag, g.header), "the header").toBe(false);
    expect(insideEllipse(g.tag, g.avatar), "the avatar").toBe(false);
  });
}

for (const [width, place] of [[1440, "corner"], [390, "flow"]]) {
  test(`the FLATLINED stamp paints on GitHub's 404 page at ${width}px, in its ${place} place`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    await open(page, "not-found", "https://github.com/octo-sample/this-page-does-not-exist");
    const before = await nativeBoxes(page);
    const message = await nativeText(page);
    const applied = await apply(page);
    expect(applied.slots).toContain("error.notFound.caption");
    const stamp = await page.evaluate(() => {
      const copy = document.querySelector('[data-reskin-slot="error.notFound.caption"]');
      const wrapper = copy.closest("p[data-reskin-owned]");
      // Owned nodes take no pointer input. For this probe they do, so hit testing reports what
      // paints on top at the stamp's center.
      const probe = document.createElement("style");
      probe.textContent = "html [data-reskin-owned]{pointer-events:auto!important}";
      document.head.append(probe);
      const r = copy.getBoundingClientRect();
      const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
      probe.remove();
      const art = document.querySelector("img[data-static-error-asset='404-illustration']").parentElement.getBoundingClientRect();
      return {
        place: wrapper.hasAttribute("data-rs-corner") ? "corner" : wrapper.hasAttribute("data-rs-flow") ? "flow" : "none",
        onTop: Boolean(hit?.closest('[data-reskin-owned="error.notFound.caption"]')),
        hit: hit && `${hit.tagName}.${hit.className}`,
        copy: { left: r.left, top: r.top, right: r.right, bottom: r.bottom, width: r.width },
        art: { left: art.left, top: art.top, right: art.right, bottom: art.bottom },
        text: copy.textContent,
      };
    });
    expect(stamp.text).toBe("Flatlined");
    expect(stamp.place).toBe(place);
    expect(stamp.copy.width).toBeGreaterThan(0);
    expect(stamp.onTop, `on top, not under ${stamp.hit}`).toBe(true);
    if (place === "corner") {
      // In the illustration's blank lower right corner, as in 1.1.0, with nothing native moved.
      expect(stamp.copy.left).toBeGreaterThan((stamp.art.left + stamp.art.right) / 2);
      expect(stamp.copy.right).toBeLessThanOrEqual(stamp.art.right);
      expect(stamp.copy.bottom).toBeLessThanOrEqual(stamp.art.bottom);
      expect(await nativeBoxes(page)).toEqual(before);
    }
    // GitHub's own message and recovery links are untouched.
    expect(await nativeText(page)).toBe(message);
    await expect(page.getByRole("link", { name: "Contact Support" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Search" })).toBeVisible();
  });
}
