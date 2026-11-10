// Page scripts get nothing from the panel, in Chromium and Firefox. The manager shim gives the page
// exactly what a real manager does (hooks off: no globals, the panel's root stays closed, values
// in the script's closure), and a script in the page's own context tries each of the round-1
// review's reproductions: open the picker with #reskin, find its frame and read it, counterfeit
// it, operate a theme button, and read what a person types in it. It also tries the routes a
// closed shadow root alone leaves open in Firefox (window.find selects text inside one), which the
// frame inside it closes. Every attempt finds nothing and changes
// nothing, and the person still operates the panel with the keyboard. In Chromium the userscript
// also runs in an isolated world, as Tampermonkey's DOM sandbox and Violentmonkey's content mode
// run it, where a page that replaced DOM prototypes before the panel opened still catches nothing.
import { CHOOM_CANVAS, FRIEREN, HOST, PROFILE_HTML, PROFILE_URL, expect, painted, test, waitSettled } from "./helpers.mjs";

// The page's probe: every way a page script could reach into the panel. Returns what it reached.
function probe(selector) {
  const host = document.querySelector(selector);
  const reached = [];
  // A node in a shadow tree: connected, but not in the document tree.
  const inside = (node) => Boolean(node && node !== host && node.isConnected && !document.contains(node));
  if (!host) return ["no host"];
  if (window.length || window[0] || window.frames[0] || document.querySelector("iframe")) reached.push("a frame");
  if (host.shadowRoot) reached.push("host.shadowRoot");
  if (host.childNodes.length || host.textContent || host.innerText) reached.push("host content");
  if (document.querySelector("[data-rs], [data-us], [data-theme]")) reached.push("controls in the page tree");
  if (inside(document.activeElement)) reached.push("activeElement");
  const box = host.getBoundingClientRect();
  for (let x = box.left + 8; x < box.right; x += 24) {
    for (let y = box.top + 8; y < box.bottom; y += 24) {
      if (document.elementsFromPoint(x, y).some(inside)) reached.push("elementsFromPoint");
      if (inside(document.caretPositionFromPoint?.(x, y)?.offsetNode)) reached.push("caretPositionFromPoint");
      if (inside(document.caretRangeFromPoint?.(x, y)?.startContainer)) reached.push("caretRangeFromPoint");
    }
  }
  const selection = window.getSelection();
  selection.selectAllChildren(document.documentElement);
  if (/Export theme file|Longroad Petals/.test(selection.toString())) reached.push("selection text");
  if (inside(selection.anchorNode) || inside(selection.focusNode)) reached.push("selection nodes");
  selection.removeAllRanges();
  if (typeof window.find === "function" && window.find("Export theme file")) {
    const found = window.getSelection();
    if (inside(found.anchorNode) || inside(found.focusNode) || inside(found.rangeCount ? found.getRangeAt(0).commonAncestorContainer : null)) reached.push("window.find");
    found.removeAllRanges();
  }
  for (const animation of [...document.getAnimations(), ...(host.getAnimations?.({ subtree: true }) ?? [])]) if (inside(animation.effect?.target)) reached.push("getAnimations");
  for (const event of window.__pageEvents ?? []) reached.push(`event ${event}`);
  return [...new Set(reached)];
}

// Page listeners for everything a person does in the panel: none may see a node inside it, a key,
// or typed text.
function listenAll() {
  window.__pageEvents = [];
  const inside = (node) => Boolean(node && node.isConnected && node instanceof Node && !document.contains(node));
  const types = ["keydown", "keyup", "keypress", "beforeinput", "input", "textInput", "compositionend", "paste", "click", "pointerdown", "focusin", "change"];
  for (const target of [window, document, document.documentElement])
    for (const type of types)
      for (const capture of [true, false])
        target.addEventListener(
          type,
          (event) => {
            if (event.composedPath().some(inside) || inside(event.target) || inside(event.relatedTarget)) window.__pageEvents.push(`${type} reached a panel node`);
            if (/^key|input|composition|paste/.test(type) && event.target?.matches?.("[data-reskin-userscript-panel]")) window.__pageEvents.push(`${type} ${event.key ?? event.data ?? ""}`.trim());
          },
          capture,
        );
}

// Everything a page can do to the panel without a reference into it.
function tamper(selector) {
  const host = document.querySelector(selector);
  host.innerHTML = "<p>Fake picker: everything is fine</p>";
  try {
    host.attachShadow({ mode: "open" }).innerHTML = "<p>Fake picker</p>";
  } catch {
    // It already has the closed root.
  }
  host.style.cssText = "opacity: 0 !important; display: none !important; transform: translateX(-9999px) !important";
  const style = document.createElement("style");
  style.textContent = `${selector} { visibility: hidden !important; filter: blur(8px) !important; clip-path: inset(50%) !important; }`;
  document.head.append(style);
  host.click();
  host.focus();
  for (const key of [" ", "Enter", "ArrowDown", "Escape"]) host.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true, composed: true }));
  document.activeElement?.click?.();
  const box = host.getBoundingClientRect();
  for (let x = box.left + 8; x < box.right; x += 24) {
    for (let y = box.top + 8; y < box.bottom; y += 24) {
      const node = document.elementFromPoint(x, y);
      node?.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, composed: true, clientX: x, clientY: y }));
      node?.dispatchEvent(new MouseEvent("click", { bubbles: true, composed: true, clientX: x, clientY: y }));
    }
  }
  // The round-1 reproduction against the old frame, and every other way to its document.
  for (const frame of [document.querySelector("iframe[data-reskin-userscript-panel]"), host.shadowRoot?.querySelector("iframe"), window.frames[0]?.frameElement]) {
    const doc = frame?.contentDocument;
    if (!doc) continue;
    doc.querySelector("[data-rs=summary-show]").textContent = "Counterfeit";
    doc.querySelector(`[data-theme="anime.frieren"]`)?.click();
  }
  // What the page did itself is not what it learned: its own light children and synthetic events.
  host.textContent = "";
  window.__pageEvents = [];
}

const screenshot = (page) => page.locator(HOST).screenshot({ animations: "disabled" });

test("a page script cannot open, read, counterfeit or operate the panel, or read what is typed in it", async ({ manager, browserName }) => {
  const gm = await manager({ kind: "sync", hooks: false, backing: "memory" });
  const page = await gm.open();
  await expect.poll(() => painted(page)).toMatchObject({ boot: "ready", canvas: CHOOM_CANVAS });
  // No manager grant, test hook or settings record is a page global.
  expect(await page.evaluate(() => ["GM", "GM_getValue", "GM_setValue", "GM_registerMenuCommand", "__gmLog"].filter((name) => name in window))).toEqual([]);

  // #reskin from a page script opens nothing.
  await page.evaluate(async () => {
    location.hash = "#reskin";
    window.dispatchEvent(new HashChangeEvent("hashchange"));
    history.pushState(null, "", "#reskin");
    await window.navigation?.navigate("#reskin").finished.catch(() => {});
    document.dispatchEvent(new Event("visibilitychange"));
  });
  await page.waitForTimeout(300);
  await expect(page.locator(HOST)).toHaveCount(0);

  // The person opens it from an address ending in #reskin (a new load: the page is already there).
  await page.goto("about:blank");
  await page.goto(`${PROFILE_URL}#reskin`);
  await waitSettled(page);
  await expect(page.locator(HOST)).toHaveCount(1);
  await page.evaluate(listenAll);
  await page.waitForTimeout(300);
  const before = await screenshot(page);

  expect(await page.evaluate(probe, HOST)).toEqual([]);
  await page.evaluate(tamper, HOST);
  await page.waitForTimeout(500);
  // Unchanged: still open, the same pixels, the same theme.
  await expect(page.locator(HOST)).toHaveCount(1);
  expect((await screenshot(page)).equals(before), "the panel looks the same after the page tampered with it").toBe(true);
  expect(await painted(page)).toMatchObject({ boot: "ready", canvas: CHOOM_CANVAS });

  // The person types into the search box and switches Reskin off with the keyboard; the page hears
  // none of it.
  await page.keyboard.press("Tab");
  await page.keyboard.type("frieren");
  await page.keyboard.press("Shift+Tab");
  await page.keyboard.press("Space");
  await expect.poll(() => painted(page)).toMatchObject({ boot: "native", styled: false });
  expect(await page.evaluate(probe, HOST), browserName).toEqual([]);
});

test("typing and choosing stay private, and in an isolated world page scripts that replaced DOM prototypes first catch nothing", async ({ manager, browserName }) => {
  // The page's own script, before anything else in the page: it wraps every DOM entry point the
  // panel's code could pass through and keeps whatever passes.
  const before = () => {
    if (window.top !== window) return;
    const caught = (window.__caught = []);
    const keep = (value) => value instanceof Node && caught.push(value);
    const wrap = (proto, name) => {
      const original = proto[name];
      if (typeof original !== "function") return;
      proto[name] = function (...args) {
        keep(this);
        args.forEach(keep);
        const result = original.apply(this, args);
        keep(result);
        return result;
      };
    };
    for (const name of ["appendChild", "insertBefore", "replaceChild"]) wrap(Node.prototype, name);
    for (const name of ["append", "prepend", "attachShadow", "querySelector", "querySelectorAll", "setAttribute", "focus", "closest"]) wrap(Element.prototype, name);
    for (const name of ["querySelector", "append"]) wrap(DocumentFragment.prototype, name);
    wrap(Document.prototype, "createElement");
    wrap(EventTarget.prototype, "addEventListener");
    wrap(EventTarget.prototype, "dispatchEvent");
    wrap(HTMLElement.prototype, "focus");
  };
  const world = browserName === "chromium" ? "isolated" : "main";
  const gm = await manager({ kind: "sync", hooks: false, backing: "memory", world, before: world === "isolated" ? before : null, pages: { "/octo-sample": PROFILE_HTML } });
  const page = await gm.open(`${PROFILE_URL}#reskin`);
  await expect(page.locator(HOST)).toHaveCount(1);
  await page.keyboard.press("Tab");
  await page.keyboard.type(FRIEREN.slice(6));
  await page.keyboard.press("Shift+Tab");
  await page.keyboard.press("Space");
  await expect.poll(() => painted(page)).toMatchObject({ boot: "native" });
  expect(await page.evaluate(probe, HOST)).toEqual([]);
  if (world === "isolated") {
    // The wrappers ran (the page's own code used them), yet caught no node of the panel.
    const caught = await page.evaluate(() => ({ total: window.__caught.length, panel: window.__caught.filter((node) => node.isConnected && !document.contains(node)).length + window.__caught.filter((node) => node instanceof ShadowRoot).length }));
    expect(caught.panel).toBe(0);
  }
});
