// The built Pages site: routes, base-path links and assets, static no-JS theme states, honest store
// states, legal copy, the offline preview fixture, no external requests, and the adapter gate.
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { after, before, describe, test } from "node:test";
import { CATALOG } from "../../site/src/catalog.mjs";
import { BASE, ROOT, links, listFiles, read, siteDir } from "./helpers.mjs";

const release = JSON.parse(await readFile(join(ROOT, "release.config.json"), "utf8"));
const CANONICAL = `${release.site.origin}${BASE}`;
const ROUTES = ["", "make/", "share/", "install/", "privacy/", "credits/", "changelog/", ...CATALOG.map((t) => `themes/${t.slug}/`)];
const DISCLAIMER = "GitHub Reskin is an independent project by Sideband Studio. Not affiliated with or endorsed by GitHub. Series names identify inspiration; all trademarks belong to their owners.";
const ADAPTER_MARK = "reskin-dev-adapter";
const DEV_CATALOG_MARK = 'data-catalog-source="site/dev"';
const STORE_HOSTS = /chromewebstore\.google\.com|chrome\.google\.com\/webstore|addons\.mozilla\.org|microsoftedge\.microsoft\.com/;

let dir;
let cleanup;
let files;
const pages = new Map();
before(async () => {
  ({ dir, cleanup } = await siteDir());
  files = await listFiles(dir);
  for (const file of files.filter((f) => f.endsWith(".html"))) pages.set(file, await read(dir, file));
});
after(() => cleanup?.());

const page = (route) => pages.get(`${route}index.html`);
const textOf = (html) => html.replace(/<script[\s\S]*?<\/script>/g, "").replace(/<[^>]+>/g, " ").replace(/&#39;/g, "'").replace(/&amp;/g, "&").replace(/\s+/g, " ");

describe("routes and paths", () => {
  test("every static route exists with a nonempty page", () => {
    for (const route of ROUTES) assert.ok(page(route)?.includes("<h1"), `${BASE}${route} is missing or has no h1`);
  });

  test("the catalog has thirteen Anime themes in frozen order, then twelve Classics", () => {
    assert.deepEqual(CATALOG.filter((t) => t.group === "anime").map((t) => t.slug), [
      "choom-circuit", "violet-synchrony", "occult-orbit", "gatewake-protocol", "wisteria-emberline", "sunward-voyage",
      "fifth-leaf-forge", "cursed-aperture", "peanut-dossier", "wallward-scout", "longroad-petals", "ripcord-bureau", "shinigami-margins",
    ]);
    assert.deepEqual(CATALOG.filter((t) => t.group === "classics").map((t) => t.slug), [
      "editing-suite", "dracula", "nord", "catppuccin-mocha", "gruvbox", "tokyo-night", "rose-pine", "one-dark",
      "solarized-dark", "catppuccin-latte", "rose-pine-dawn", "solarized-light",
    ]);
  });

  test("every internal link and asset is under the base path and resolves, including fragments", () => {
    const problems = [];
    for (const [file, html] of pages) {
      for (const link of links(html)) {
        if (link.startsWith("#")) {
          if (link.length > 1 && !html.includes(`id="${link.slice(1)}"`)) problems.push(`${file}: ${link} has no target`);
          continue;
        }
        if (/^https:\/\//.test(link) || link.startsWith("mailto:")) continue;
        if (!link.startsWith(BASE)) {
          problems.push(`${file}: ${link} is not under ${BASE}`);
          continue;
        }
        const [path, hash] = link.slice(BASE.length).split("#");
        const target = path === "" || path.endsWith("/") ? `${path}index.html` : path;
        if (!files.includes(target)) problems.push(`${file}: ${link} does not resolve`);
        else if (hash && pages.has(target) && !pages.get(target).includes(`id="${hash}"`)) problems.push(`${file}: ${link} has no #${hash}`);
      }
    }
    assert.deepEqual(problems, []);
  });

  test("theme pages carry their canonical URL", () => {
    for (const theme of CATALOG) assert.ok(page(`themes/${theme.slug}/`).includes(`<link rel="canonical" href="${CANONICAL}themes/${theme.slug}/">`), theme.slug);
  });

  test("Pages serves _assets unprocessed and no source maps ship", () => {
    assert.ok(files.includes(".nojekyll"));
    assert.deepEqual(files.filter((f) => f.endsWith(".map")), []);
  });
});

describe("static theme states", () => {
  test("the home page pre-renders Choom Circuit", () => {
    const html = page("");
    const choom = CATALOG.find((t) => t.slug === "choom-circuit").doc;
    assert.match(html, /id="hero-preview"[^>]*data-state="themed"/);
    assert.ok(html.includes(`--pv-canvas:${choom.colors.background}`));
    assert.match(html, /data-selected="name">Choom Circuit</);
    assert.ok(textOf(html).includes("Inspired by Cyberpunk: Edgerunners"));
  });

  test("each theme page pre-renders its own theme, name, credit and selected state without JavaScript", () => {
    for (const theme of CATALOG) {
      const html = page(`themes/${theme.slug}/`);
      const hero = html.slice(html.indexOf('id="hero-preview"') - 200, html.indexOf('id="hero-preview"') + 4000);
      assert.ok(hero.includes(`--pv-canvas:${theme.doc.colors.background}`), `${theme.slug} hero is not pre-rendered in its colors`);
      assert.ok(html.includes(`data-selected="name">${theme.doc.name}<`), `${theme.slug} name`);
      if (theme.doc.inspiredBy) assert.ok(textOf(html).includes(`Inspired by ${theme.doc.inspiredBy}`), `${theme.slug} credit`);
      assert.match(html, new RegExp(`data-theme="${theme.slug}" aria-pressed="true"`), `${theme.slug} selected state`);
      assert.ok(html.includes("Switching themes needs JavaScript"), `${theme.slug} no-JS note`);
    }
  });

  test("flavor lines render as hidden-from-assistive-technology decoration", () => {
    const html = page("");
    assert.match(html, /data-slot="profile.tag" aria-hidden="true"[^>]*>\/\/ choom view</);
    assert.match(html, /data-slot="profile.pinned.heading" aria-hidden="true"[^>]*>Signal picks</);
  });
});

describe("content and honesty", () => {
  test("every page has the independence disclaimer", () => {
    for (const [file, html] of pages) assert.ok(textOf(html).includes(DISCLAIMER), file);
  });

  test("null store listings show coming soon and no store link", () => {
    for (const [id, listing] of Object.entries(release.stores)) {
      if (listing !== null) continue;
      for (const route of ["", "install/"]) {
        assert.ok(textOf(page(route)).includes("Store listing coming soon"), `${route} ${id}`);
        assert.ok(!links(page(route)).some((link) => STORE_HOSTS.test(link)), `${route} links a store`);
      }
    }
    for (const [file, html] of pages) assert.ok(!/available (now )?(on|in) the (Chrome Web Store|Firefox Add-ons)/i.test(textOf(html)), `${file} claims availability`);
  });

  test("store listings are null or real HTTPS store URLs, and live ones are required when asked", () => {
    for (const [id, listing] of Object.entries(release.stores)) assert.ok(listing === null || (/^https:\/\//.test(listing) && STORE_HOSTS.test(listing)), `${id}: ${listing}`);
    if (process.env.RESKIN_REQUIRE_LIVE_STORES === "1") assert.ok(release.stores.chrome && release.stores.firefox, "release.config.json has no live store listings");
  });

  test("privacy and credits pages carry the reviewed policy and licenses", () => {
    assert.ok(textOf(page("privacy/")).includes("The extension and userscript do not collect or send data to Sideband Studio."));
    assert.ok(textOf(page("privacy/")).includes("Last updated November 8, 2026."));
    const credits = textOf(page("credits/"));
    assert.ok(credits.includes("SIL Open Font License"));
    assert.ok(credits.includes("captured offline on November 8, 2026"));
    for (const theme of CATALOG.filter((t) => t.group === "anime")) assert.ok(page("credits/").includes(`<b>${theme.doc.name}</b>, inspired by ${theme.doc.inspiredBy}`), theme.slug);
    assert.ok(files.includes("licenses/manrope-OFL.txt") && files.includes("licenses/LICENSE-GitHub-Reskin.txt"));
  });

  test("the phone handoff never promises sync or automatic configuration", () => {
    const text = textOf(page(""));
    assert.ok(text.includes("Keep this theme for desktop"));
    assert.ok(text.includes("Pick Choom Circuit in Reskin after installing"));
    assert.ok(!/sync(s|ed|hronizes)? (to|with|across)/i.test(text));
  });
});

describe("offline preview and requests", () => {
  test("the preview uses the local whoisaldo fixture and keeps its links inert", () => {
    const html = page("");
    assert.ok(html.includes(`src="${BASE}site-fixture/assets/avatar-whoisaldo.webp"`));
    assert.ok(textOf(html).includes("Ali Younes") && textOf(html).includes("5,216 contributions in the last year"));
    assert.match(html, /data-href="https:\/\/aliyounes\.dev"/);
    for (const link of links(html)) assert.ok(!/aliyounes\.dev|linkedin\.com|github\.com\/(sidebandstudio\/(EternalMonitor|gpubridge)|pingdotgg)/.test(link), `live preview link ${link}`);
  });

  test("no external scripts, styles, fonts, images or frames", () => {
    for (const [file, html] of pages) {
      assert.ok(!/<iframe/i.test(html), `${file} has a frame`);
      assert.ok(!/<(script|img|source|video|audio)[^>]+src="(https?:)?\/\//i.test(html), `${file} loads an external resource`);
      assert.ok(!/<link[^>]+href="(https?:)?\/\/[^"]*"[^>]*rel="(stylesheet|preload|modulepreload|preconnect|dns-prefetch)"/i.test(html) && !/<link[^>]+rel="(stylesheet|preload|modulepreload|preconnect|dns-prefetch)"[^>]+href="(https?:)?\/\//i.test(html), `${file} links an external resource`);
    }
  });

  test("scripts and styles make no network or tracking calls", async () => {
    for (const file of files.filter((f) => /\.(js|css)$/.test(f))) {
      const code = await read(dir, file);
      if (file.endsWith(".js")) assert.ok(!/\bfetch\(|XMLHttpRequest|sendBeacon|WebSocket|EventSource|importScripts/.test(code), `${file} can make requests`);
      assert.ok(!/https?:\/\//.test(code.replace(/http:\/\/www\.w3\.org\/2000\/svg/g, "")), `${file} references a URL`);
      assert.ok(!/gtag|google-analytics|googletagmanager|plausible|umami|segment\.io|hotjar/i.test(code), `${file} has a tracker`);
    }
  });
});

describe("temporary adapter gate", () => {
  const offenders = () => [...pages].filter(([, html]) => html.includes(ADAPTER_MARK) || html.includes(DEV_CATALOG_MARK)).map(([file]) => file);

  if (process.env.RESKIN_SITE_PRODUCTION === "1") {
    test("production output contains no site/dev adapter or development catalog", async () => {
      const scripts = [];
      for (const file of files.filter((f) => f.endsWith(".js"))) if ((await read(dir, file)).includes(ADAPTER_MARK)) scripts.push(file);
      assert.deepEqual([...offenders(), ...scripts], [], "site/dev is still in the build; phase 2 must swap in C5's preview, C2's importer and the real catalog");
    });
  } else {
    test("development output carries the markers the production gate rejects", async () => {
      assert.ok(offenders().includes("index.html"), "the adapter marker is missing, so --production could not detect the adapter");
      let marked = false;
      for (const file of files.filter((f) => f.endsWith(".js"))) marked ||= (await read(dir, file)).includes(ADAPTER_MARK);
      assert.ok(marked, "the client bundle lost the adapter marker");
      assert.ok(existsSync(join(ROOT, "site/dev/README.md")));
    });
  }
});
