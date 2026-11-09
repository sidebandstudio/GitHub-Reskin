// mountPreview: views, Before/After, preferences, every effect, owned-node limits, cleanup and
// layout stability, in Chromium and Firefox.
import { PREFS, classic, decorated, effectThemes, expect, expected, inFrame, mount, nativeBoxes, painted, rgb, test, update } from "./helpers.mjs";

const CHOOM_LIKE = decorated("dracula", { rail: { shape: "notch" }, scanlines: {}, echo: {} });

test("every view renders the inert fixture with real content and no controls", async ({ page, fixtureApp }) => {
  await mount(page, fixtureApp, { theme: classic("dracula") });
  for (const view of ["profile", "repo", "diff", "empty", "404"]) {
    await page.evaluate((v) => window.reskinPreview.setView(v), view);
    await painted(page);
    const facts = await inFrame(page, (doc) => ({
      view: doc.querySelector("main").dataset.view,
      text: doc.body.textContent.length,
      controls: doc.querySelectorAll("button,input,select,textarea,a[href],[tabindex],form").length,
    }));
    expect(facts.view).toBe(view);
    expect(facts.text).toBeGreaterThan(40);
    expect(facts.controls).toBe(0);
    expect(await page.locator("#preview iframe:not([aria-hidden])").getAttribute("title")).toMatch(/^Interactive preview: GitHub /);
  }
});

test("the profile keeps whoisaldo's captured identity, counts and README in Before and After", async ({ page, fixtureApp }) => {
  await mount(page, fixtureApp, { theme: CHOOM_LIKE });
  const authored = (doc) => ({
    name: doc.querySelector(".vcard-names").textContent,
    readme: doc.querySelector(".markdown-body").textContent,
    pins: [...doc.querySelectorAll(".pinned-item-list-item")].map((n) => n.textContent),
    heading: doc.querySelector(".js-yearly-contributions h2").textContent,
    cells: [...doc.querySelectorAll(".ContributionCalendar-grid .ContributionCalendar-day")].map((c) => `${c.dataset.date}:${c.dataset.level}:${c.dataset.count}`).join(","),
  });
  const after = await inFrame(page, authored);
  await page.evaluate(() => window.reskinPreview.setBefore(true));
  await painted(page);
  const before = await inFrame(page, authored);
  expect(after).toEqual(before);
  expect(after.name).toBe("Ali Youneswhoisaldo");
  expect(after.heading).toBe("5,216 contributions in the last year");
  expect(after.cells.split(",")).toHaveLength(365);
  expect(after.pins).toHaveLength(6);
});

// Canvas, text, link and every graph level, as the fixture paints them.
const paints = (page) =>
  inFrame(page, (doc) => {
    const style = (node) => doc.defaultView.getComputedStyle(node);
    const cell = (level) => style(doc.querySelector(`.ContributionCalendar-grid .ContributionCalendar-day[data-level="${level}"]`)).backgroundColor;
    return {
      canvas: style(doc.body).backgroundColor,
      text: style(doc.body).color,
      card: style(doc.querySelector(".pinned-item-list-item")).borderTopColor,
      graph: [0, 1, 2, 3, 4].map(cell),
      rules: [...doc.styleSheets].reduce((n, sheet) => n + sheet.cssRules.length, 0),
    };
  });
const expectedPaints = (values) => ({
  canvas: rgb(values["--bgColor-default"]),
  text: rgb(values["--fgColor-default"]),
  card: rgb(values["--borderColor-default"]),
  graph: [0, 1, 2, 3, 4].map((level) => rgb(values[`--contribution-default-bgColor-${level}`])),
});

for (const id of ["dracula", "solarized-light"]) {
  test(`After paints the resolved ${id}, Before and disabled paint GitHub's exact native colors`, async ({ page, fixtureApp }) => {
    const theme = classic(id);
    await mount(page, fixtureApp, { theme });
    const { rules: _, ...themed } = await paints(page);
    expect(themed).toEqual(expectedPaints(await expected(page, theme)));
    expect(await page.locator("[data-reskin-preview]").getAttribute("data-policy")).toBe("themed");
    const native = expectedPaints(await expected(page, theme, true));
    expect(native.canvas).not.toBe(themed.canvas);
    await page.evaluate(() => window.reskinPreview.setBefore(true));
    await painted(page);
    const before = await paints(page);
    expect(before.rules).toBeGreaterThan(100);
    expect({ ...before, rules: undefined }).toEqual({ ...native, rules: undefined });
    await page.evaluate(() => window.reskinPreview.setBefore(false));
    await update(page, theme, { ...PREFS, enabled: false });
    const disabled = await paints(page);
    expect({ ...disabled, rules: undefined }).toEqual({ ...native, rules: undefined });
    const states = await page.evaluate(() => window.reskinPreview.states);
    // One state per resolution: the mount and the preference change. Before/After does not re-resolve.
    expect(states.length).toBe(2);
    expect(states.every((s) => s.policy === "themed")).toBe(true);
  });

  test(`every syntax role in the diff paints its emitted ${id} color on its line background`, async ({ page, fixtureApp }) => {
    const theme = classic(id);
    await mount(page, fixtureApp, { theme, view: "diff" });
    const values = await expected(page, theme);
    const roles = { "pl-c": "comment", "pl-k": "keyword", "pl-s": "string", "pl-en": "entity", "pl-c1": "constant", "pl-v": "variable", "pl-ent": "entityTag" };
    const seen = await inFrame(page, (doc, classes) => Object.fromEntries(classes.map((name) => {
      const node = doc.querySelector(`.diff-table .${name}`);
      const row = doc.defaultView.getComputedStyle(node.closest("td"));
      return [name, { color: doc.defaultView.getComputedStyle(node).color, line: row.color }];
    })), Object.keys(roles));
    for (const [name, role] of Object.entries(roles)) {
      expect(seen[name].color, name).toBe(rgb(values[`--prettylights-syntax-${role}`]));
    }
    // The type annotation sits on an added line and must not inherit the line's text color.
    expect(seen["pl-ent"].color).not.toBe(seen["pl-ent"].line);
  });
}

test("an invalid theme throws and leaves the last valid preview", async ({ page, fixtureApp }) => {
  await mount(page, fixtureApp, { theme: classic("nord") });
  const hash = await page.locator("[data-reskin-preview]").getAttribute("data-source-hash");
  const error = await page.evaluate((prefs) => {
    try {
      window.reskinPreview.update({ theme: { schemaVersion: 1, name: "Broken", base: "dark", colors: { background: "red" } }, preferences: prefs });
      return null;
    } catch (e) {
      return e.message;
    }
  }, PREFS);
  expect(error).toMatch(/valid theme/);
  expect(await page.locator("[data-reskin-preview]").getAttribute("data-source-hash")).toBe(hash);
});

for (const { effect, label, theme } of effectThemes()) {
  test(`effect ${label} draws inside its owned boxes and disappears when turned off`, async ({ page, fixtureApp }) => {
    await mount(page, fixtureApp, { theme }, { slots: true });
    const facts = await inFrame(page, (doc, id) => {
      const nodes = [...doc.querySelectorAll(`.rs-fx-${id}`)];
      return {
        count: nodes.length,
        owned: doc.querySelectorAll("[data-reskin-owned]").length,
        nodes: nodes.map((node) => {
          const r = node.getBoundingClientRect();
          const box = node.closest(".rs-box").getBoundingClientRect();
          const style = node.ownerDocument.defaultView.getComputedStyle(node);
          return {
            w: r.width,
            h: r.height,
            boxW: box.width,
            boxH: box.height,
            pointer: style.pointerEvents,
            hidden: node.closest("[data-reskin-owned]")?.getAttribute("aria-hidden"),
            painted: [style, ...["::before", "::after"].map((p) => node.ownerDocument.defaultView.getComputedStyle(node, p))].some(
              (s) => s.backgroundImage !== "none" || s.borderTopStyle !== "none" || s.borderLeftStyle !== "none" || s.boxShadow !== "none" || s.backgroundColor !== "rgba(0, 0, 0, 0)",
            ),
          };
        }),
        allNodes: doc.querySelectorAll("[data-reskin-owned], [data-reskin-owned] *").length,
        animated: doc.getAnimations().length,
      };
    }, effect);
    expect(facts.count).toBeGreaterThan(0);
    expect(facts.allNodes).toBeLessThanOrEqual(24);
    expect(facts.animated).toBe(0);
    for (const node of facts.nodes) {
      expect(node.w).toBeGreaterThan(0);
      expect(node.h).toBeGreaterThan(0);
      expect(node.boxW).toBeLessThanOrEqual(360);
      expect(node.boxH).toBeLessThanOrEqual(96);
      expect(node.pointer).toBe("none");
      expect(node.hidden).toBe("true");
      expect(node.painted).toBe(true);
    }
    for (const prefs of [{ ...PREFS, effects: false }, { ...PREFS, extras: false }, { ...PREFS, enabled: false }]) {
      await page.evaluate(([t, p]) => window.reskinPreview.update({ theme: t, preferences: p }), [theme, prefs]);
      await painted(page);
      expect(await inFrame(page, (doc, id) => doc.querySelectorAll(`.rs-fx, .rs-fx-${id}`).length, effect)).toBe(0);
    }
    expect(await inFrame(page, (doc) => doc.querySelectorAll("[data-reskin-owned]").length)).toBe(0);
  });
}

test("Text off removes every copy node and keeps decoration; Flavor extras off removes everything", async ({ page, fixtureApp }) => {
  await mount(page, fixtureApp, { theme: CHOOM_LIKE }, { slots: true });
  const count = () => inFrame(page, (doc) => ({ copy: doc.querySelectorAll(".rs-copy").length, fx: doc.querySelectorAll(".rs-fx").length, owned: doc.querySelectorAll("[data-reskin-owned]").length }));
  const on = await count();
  expect(on.copy).toBeGreaterThan(0);
  await page.evaluate(([t, p]) => window.reskinPreview.update({ theme: t, preferences: { ...p, text: false } }), [CHOOM_LIKE, PREFS]);
  await painted(page);
  const textOff = await count();
  expect(textOff.copy).toBe(0);
  expect(textOff.fx).toBeGreaterThan(0);
  await page.evaluate(([t, p]) => window.reskinPreview.update({ theme: t, preferences: { ...p, extras: false } }), [CHOOM_LIKE, PREFS]);
  await painted(page);
  expect(await count()).toEqual({ copy: 0, fx: 0, owned: 0 });
});

test("dormant slots stay dormant in the default preview", async ({ page, fixtureApp }) => {
  await mount(page, fixtureApp, { theme: CHOOM_LIKE });
  const slots = await inFrame(page, (doc) => [...doc.querySelectorAll("[data-reskin-owned]")].map((n) => n.dataset.reskinOwned).sort());
  // C3's evidence leaves only the issue-list caption dormant; the capture has no activity section.
  expect(slots).toEqual(["contributions.caption", "profile.organizations.heading", "profile.pinned.heading", "profile.tag"]);
});

for (const width of [390, 1440]) {
  test(`decoration never moves fixture content at ${width}px`, async ({ page, fixtureApp }) => {
    await page.setViewportSize({ width, height: 900 });
    const theme = decorated("dracula", { rail: { shape: "notch" }, seal: { shape: "rosette", size: 32 }, drift: { count: 4 } });
    for (const view of ["profile", "empty", "404"]) {
      await mount(page, fixtureApp, { view, theme, preferences: { ...PREFS, extras: false } }, { slots: true });
      const bare = await inFrame(page, nativeBoxes);
      // Effects and the overlay tag/heading strips: nothing native may move at all.
      await page.evaluate(([t, p]) => window.reskinPreview.update({ theme: t, preferences: { ...p, text: false } }), [theme, PREFS]);
      await painted(page);
      // The 404 view has only a caption slot, which Text off removes.
      if (view !== "404") expect(await inFrame(page, (doc) => doc.querySelectorAll(".rs-fx").length)).toBeGreaterThan(0);
      expect(await inFrame(page, nativeBoxes)).toEqual(bare);
      // With Text held on, turning Effects on or off moves nothing native either: a caption's
      // edge hangs out of flow.
      await update(page, theme, { ...PREFS, effects: false });
      const textOnly = await inFrame(page, nativeBoxes);
      await update(page, theme, PREFS);
      // The profile caption is left-aligned, so its edge has a blank end to hang in. A centered
      // caption may have none, and then drops its edge rather than cover its copy.
      if (view === "profile") expect(await inFrame(page, (doc) => doc.querySelectorAll(".rs-slot--caption .rs-box--edge").length)).toBe(1);
      expect(await inFrame(page, nativeBoxes)).toEqual(textOnly);
      // With text, only content after an in-flow caption may shift, by the caption's height.
      await page.evaluate(([t, p]) => window.reskinPreview.update({ theme: t, preferences: p }), [theme, PREFS]);
      await painted(page);
      const withText = await inFrame(page, (doc) => {
        const caption = doc.querySelector(".rs-slot--caption");
        const limit = caption ? caption.getBoundingClientRect().top : Infinity;
        return { limit, ids: [...doc.body.querySelectorAll("*")].filter((n) => !n.closest("[data-reskin-owned]")).map((n) => n.getBoundingClientRect().bottom <= limit) };
      });
      const boxes = await inFrame(page, nativeBoxes);
      boxes.forEach((box, i) => {
        if (withText.ids[i]) expect(box).toEqual(bare[i]);
      });
    }
  });
}

test("destroy removes the preview, its frame and every owned node", async ({ page, fixtureApp }) => {
  await mount(page, fixtureApp, { theme: CHOOM_LIKE });
  await page.evaluate(() => window.reskinPreview.destroy());
  expect(await page.locator("#preview *").count()).toBe(0);
});

test("the preview and the GitHub adapter path agree on hashes and effect geometry", async ({ page, fixtureApp }) => {
  const theme = decorated("dracula", { rail: { shape: "notch" }, scanlines: {}, glow: {} });
  await mount(page, fixtureApp, { theme });
  const preview = {
    hash: await page.locator("[data-reskin-preview]").getAttribute("data-source-hash"),
    seed: await page.locator("[data-reskin-preview]").getAttribute("data-seed-hash"),
    styles: await inFrame(page, (doc) => ["rail", "scanlines", "glow"].map((id) => {
      const s = doc.defaultView.getComputedStyle(doc.querySelector(`.rs-box--strip .rs-fx-${id}`));
      return [s.backgroundImage, s.backgroundSize, s.height, s.boxShadow, s.borderTopColor];
    })),
  };
  await page.goto(fixtureApp.url("adversarial.html"));
  await page.waitForFunction(() => document.documentElement.dataset.ready === "true");
  const native = await page.evaluate(([t, p]) => window.reskinNative.apply(t, p), [theme, PREFS]);
  const nativeStyles = await page.evaluate(() => ["rail", "scanlines", "glow"].map((id) => {
    const s = getComputedStyle(document.querySelector(`.rs-box--strip .rs-fx-${id}`));
    return [s.backgroundImage, s.backgroundSize, s.height, s.boxShadow, s.borderTopColor];
  }));
  expect(native.sourceHash).toBe(preview.hash);
  expect(native.seedHash).toBe(preview.seed);
  expect(nativeStyles).toEqual(preview.styles);
});

for (const width of [390, 768, 1440]) {
  test(`overlay decoration never covers native text or neighbors at ${width}px`, async ({ page, fixtureApp }) => {
    await page.setViewportSize({ width, height: 900 });
    for (const tag of ["// tag", "// a long decorative tag"]) {
      const theme = decorated("dracula", { seal: { size: 32 }, echo: {}, glow: {} });
      theme.flavor.slots["profile.tag"] = tag;
      await mount(page, fixtureApp, { theme }, { slots: true });
      const hits = await inFrame(page, (doc) => {
        const hit = (a, b) => a.width && a.height && b.width && b.height && a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom;
        const out = [];
        const page = doc.body.getBoundingClientRect();
        for (const box of doc.querySelectorAll(".rs-slot--overlay > .rs-box")) {
          const r = box.getBoundingClientRect();
          if (r.top < page.top || r.left < page.left || r.right > page.right) out.push("outside the page");
          // Native heading and name text, by its line boxes. Owned copy appended inside a heading
          // is the decoration's own text, not native text.
          for (const heading of doc.querySelectorAll(".vcard-names, h2")) {
            const walker = doc.createTreeWalker(heading, 4);
            for (let text = walker.nextNode(); text; text = walker.nextNode()) {
              if (text.parentElement.closest("[data-reskin-owned]")) continue;
              const range = doc.createRange();
              range.selectNodeContents(text);
              for (const line of range.getClientRects()) if (hit(r, line)) out.push(`text ${text.data}`);
            }
          }
          // Neighboring native blocks, by their boxes.
          for (const near of doc.querySelectorAll(".h-card > .avatar, .pinned-items-list")) if (hit(r, near.getBoundingClientRect())) out.push(near.className);
        }
        return out;
      });
      expect(hits, tag).toEqual([]);
    }
  });
}

test("the default profile keeps its tag visible beside the name at 390px", async ({ page, fixtureApp }) => {
  await page.setViewportSize({ width: 390, height: 900 });
  const theme = decorated("dracula", { echo: {} });
  theme.flavor.slots["profile.tag"] = "// choom view";
  await mount(page, fixtureApp, { theme });
  const tag = await inFrame(page, (doc) => {
    const box = doc.querySelector('[data-reskin-owned="profile.tag"] .rs-box')?.getBoundingClientRect();
    return box && { top: box.top, bottom: box.bottom, height: doc.documentElement.getBoundingClientRect().height };
  });
  expect(tag).toBeTruthy();
  expect(tag.top).toBeGreaterThanOrEqual(0);
});
