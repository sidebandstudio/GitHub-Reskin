// The built Pages site: routes, base-path links and assets, static no-JS theme states with the anime
// title first, honest store states, legal copy, the shared preview's files, no external requests,
// the initial script budget's shape, and the production gate.
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
const manifest = JSON.parse(await readFile(join(ROOT, "site/.cache/previews/manifest.json"), "utf8").catch(() => "{}"));
const DISCLAIMER = "GitHub Reskin is an independent project by Sideband Studio. Not affiliated with or endorsed by GitHub. Series names identify inspiration; all trademarks belong to their owners.";
const DEV_MARKS = ["reskin-dev-adapter", "site/dev", 'data-catalog-source="site/dev"'];
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

  test("a branded, base-aware 404 page offers a way back to the themes", () => {
    const html = pages.get("404.html");
    assert.ok(html, "404.html is missing");
    assert.match(textOf(html), /This theme link isn't here\./);
    assert.ok(html.includes(`href="${BASE}#preview"`), "no Try the themes link");
    for (const theme of CATALOG.filter((t) => t.group === "anime")) assert.ok(html.includes(`href="${BASE}themes/${theme.slug}/#preview"`), theme.slug);
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
        if (file === "404.html" && !path && !hash) continue;
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
  test("the home page leads with the owner's Cyberpunk port as the shared preview captured it", () => {
    const html = page("");
    const choom = manifest.themes["choom-circuit"];
    assert.ok(html.includes(`src="${BASE}previews/${choom.phone.file}"`) && html.includes(`srcset="${BASE}previews/${choom.desk.file}"`));
    assert.ok(html.includes(`data-source-hash="${choom.sourceHash}"`));
    assert.match(html, /data-selected="title">Cyberpunk: Edgerunners</);
    assert.match(html, /aria-current="true"[^>]*>|data-select="choom-circuit" aria-current="true"/);
  });

  test("each theme page pre-renders its capture, says which anime it is from first, and marks its selection without JavaScript", () => {
    for (const theme of CATALOG) {
      const html = page(`themes/${theme.slug}/`);
      const entry = manifest.themes[theme.slug];
      assert.ok(html.includes(`src="${BASE}previews/${entry.phone.file}"`), `${theme.slug} first paint`);
      assert.ok(html.includes(`data-source-hash="${entry.sourceHash}"`), `${theme.slug} hash`);
      const primary = theme.doc.inspiredBy || theme.doc.name;
      assert.ok(html.includes(`data-selected="title">${primary.replace(/'/g, "&#39;")}<`), `${theme.slug} primary label`);
      if (theme.doc.inspiredBy) {
        assert.ok(textOf(html).includes(`${theme.doc.inspiredBy} theme for GitHub`), `${theme.slug} "<anime> theme for GitHub"`);
        assert.match(html, new RegExp(`<h1[^>]*>${theme.doc.inspiredBy.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/'/g, "&#39;")} theme for GitHub</h1>`), `${theme.slug} h1`);
      }
      assert.ok(html.includes(`data-select="${theme.slug}" aria-current="true"`), `${theme.slug} selected option`);
      assert.match(html, new RegExp(`data-theme="${theme.slug}" aria-pressed="true"`), `${theme.slug} selected card`);
      assert.ok(html.includes("Switching themes in place needs JavaScript"), `${theme.slug} no-JS note`);
    }
  });

  test("anime titles are the primary label on every chooser option and card", () => {
    const html = page("");
    for (const theme of CATALOG.filter((t) => t.group === "anime")) {
      const title = theme.doc.inspiredBy.replace(/'/g, "&#39;");
      assert.ok(html.includes(`<span class="pick-title">${title}</span><span class="pick-sub">${theme.doc.name}</span>`), `${theme.slug} chooser`);
      assert.ok(html.includes(`<h3 class="card-title">${title}</h3>`), `${theme.slug} card`);
    }
    assert.match(textOf(html), /13 anime\. Pick yours\./);
    assert.match(textOf(html), /13 anime themes/);
  });

  test("Advanced CSS is badged on bundled themes that carry it", () => {
    const html = page("");
    const withCss = CATALOG.filter((t) => typeof t.doc.css === "string" && t.doc.css);
    assert.ok(withCss.length >= 1);
    const card = (slug) => html.slice(html.indexOf(`data-card="${slug}"`), html.indexOf("</li>", html.indexOf(`data-card="${slug}"`)));
    for (const theme of CATALOG) assert.equal(card(theme.slug).includes("Advanced CSS · Bundled and reviewed"), withCss.includes(theme), theme.slug);
  });

  test("every capture in the manifest ships, and the Full/Calm comparison uses the selected theme's pair", () => {
    for (const entry of Object.values(manifest.themes)) for (const kind of ["phone", "desk", "card", "calm"]) assert.ok(files.includes(`previews/${entry[kind].file}`), entry[kind].file);
    const html = page("themes/longroad-petals/");
    const entry = manifest.themes["longroad-petals"];
    assert.match(html, new RegExp(`src="${BASE}previews/${entry.calm.file}"[^>]*data-compare="calm"`));
  });

  test("the Full/Calm comparison lists the lines Full adds to a profile, from the theme's own slots", () => {
    const slots = CATALOG.find((t) => t.slug === "choom-circuit").doc.flavor.slots;
    const lines = page("").match(/<div class="lines"[^>]*>([\s\S]*?)<\/dl>/)[1];
    const rows = [...lines.matchAll(/<dt>(.*?)<\/dt><dd>(.*?)<\/dd>/g)].map(([, label, text]) => [label, text]);
    assert.deepEqual(rows, [
      ["Name", slots["profile.tag"]],
      ["Pinned", slots["profile.pinned.heading"]],
      ["Contribution activity", slots["profile.activity.heading"]],
      ["Achievements", slots["profile.achievements.heading"]],
      ["Organizations", slots["profile.organizations.heading"]],
      ["Footer", slots["footer.signoff"]],
    ]);
    assert.equal(lines.includes(slots["error.notFound.caption"]), false, "the 404 caption belongs to another page");
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
    for (const theme of CATALOG.filter((t) => t.group === "anime")) assert.ok(page("credits/").includes(`<b>${theme.doc.inspiredBy.replace(/'/g, "&#39;")}</b>: ${theme.doc.name}`), theme.slug);
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
  test("the live preview's packaged fonts and fixture images ship at the paths the site resource adapter resolves", () => {
    for (const font of ["rajdhani", "barlow-condensed", "bungee", "fraunces", "alegreya", "cormorant-garamond", "josefin-sans", "space-grotesk"]) {
      assert.ok(files.includes(`assets/fonts/${font}/${font}.woff2`) && files.includes(`assets/fonts/${font}/OFL.txt`), font);
    }
    assert.ok(files.includes("packages/preview/fixture/assets/avatar-whoisaldo.webp"));
    assert.ok(files.includes("licenses/OFL-Chakra-Petch.txt") && files.includes("licenses/OFL-JetBrains-Mono.txt"));
  });

  test("no external scripts, styles, fonts, images or frames", () => {
    for (const [file, html] of pages) {
      assert.ok(!/<iframe/i.test(html), `${file} has a frame`);
      assert.ok(!/<(script|img|source|video|audio)[^>]+src="(https?:)?\/\//i.test(html), `${file} loads an external resource`);
      assert.ok(!/<link[^>]+href="(https?:)?\/\/[^"]*"[^>]*rel="(stylesheet|preload|modulepreload|preconnect|dns-prefetch)"/i.test(html) && !/<link[^>]+rel="(stylesheet|preload|modulepreload|preconnect|dns-prefetch)"[^>]+href="(https?:)?\/\//i.test(html), `${file} links an external resource`);
    }
  });

  test("scripts and styles make no network or tracking calls", async () => {
    for (const file of files.filter((f) => /^_assets\/.*\.(js|css)$/.test(f))) {
      const code = await read(dir, file);
      // The shared preview reads its own packaged font and image files (credentials omitted) to
      // embed them in the scriptless frame; that is the only fetch, and e2e proves it stays local.
      const preview = code.includes("Call configurePreview before mountPreview");
      if (file.endsWith(".js")) {
        assert.ok(!/XMLHttpRequest|sendBeacon|WebSocket|EventSource|importScripts/.test(code), `${file} can make requests`);
        if (!preview) assert.ok(!/\bfetch\(/.test(code), `${file} can fetch`);
        else assert.equal(code.match(/\bfetch\(/g)?.length, 1, `${file} fetches outside the packaged-file reader`);
      }
      // The preview chunk holds the fixture's inert data-href links and the parser chunk css-tree's
      // own strings; neither requests them. Page scripts and styles name no URL at all.
      const parser = /Matching for a tree with var/.test(code);
      if (!preview && !parser) assert.ok(!/https?:\/\//.test(code.replace(/http:\/\/www\.w3\.org\/2000\/svg/g, "")), `${file} references a URL`);
      assert.ok(!/\bgtag\b|google-analytics|googletagmanager|plausible|umami|segment\.io|hotjar/i.test(code), `${file} has a tracker`);
    }
  });
});

describe("production gate", () => {
  // Without --production these still run: phase 2 has no development adapter left to allow.
  test("no development adapter, stand-in theme or development catalog is in the output", async () => {
    const offenders = [];
    for (const file of files.filter((f) => /\.(html|js)$/.test(f))) {
      const text = file.endsWith(".html") ? pages.get(file) : await read(dir, file);
      for (const mark of DEV_MARKS) if (text.includes(mark)) offenders.push(`${file}: ${mark}`);
    }
    assert.deepEqual(offenders, []);
    assert.ok(page("").includes('data-catalog-source="themes/catalog.json"'));
  });

  test("the live preview is C5's mountPreview with C3's Primer adapter, and the parser ships only in the authoring chunk", async () => {
    const scripts = await Promise.all(files.filter((f) => /^_assets\/.*\.js$/.test(f)).map(async (f) => [f, await read(dir, f)]));
    const engine = scripts.filter(([, code]) => code.includes("Call configurePreview before mountPreview"));
    assert.equal(engine.length, 1, "exactly one chunk carries the shared preview");
    assert.match(engine[0][1], /The preview target needs the list of Primer variables/, "the preview chunk carries C3b's preview target");
    const parser = scripts.filter(([, code]) => /Matching for a tree with var|csstree/i.test(code)).map(([f]) => f);
    assert.equal(parser.length, 1, `the CSS parser is in ${parser.join(", ")}`);
    assert.notEqual(parser[0], engine[0][0]);
  });

  test("pages load only the small page script at first; the preview and parser chunks are imported on demand", () => {
    for (const route of ["", "themes/choom-circuit/", "make/", "share/"]) {
      const html = page(route);
      const initial = [...html.matchAll(/<script[^>]+src="([^"]+)"/g)].map((m) => m[1]);
      for (const src of initial) {
        const name = src.split("/").pop();
        assert.ok(!/^(engine|authoring)\./.test(name), `${route} loads ${name} at first`);
      }
      assert.ok(!/rel="modulepreload"[^>]*(engine|authoring)\./.test(html), `${route} preloads the engine`);
    }
  });
});
