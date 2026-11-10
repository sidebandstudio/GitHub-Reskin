// Site budgets from spec ARCHITECTURE.md, measured on the built site in Chromium at 390x844:
// initial custom JS <=65 KiB gzip, initial transfer <=500 KiB excluding requested video, no fetch
// of all theme fonts, and no third-party request. GitHub Pages compresses text responses, so text
// bytes count gzipped and binary bytes count raw; the report keeps both. It writes measured values,
// never a hardcoded pass.
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { gzipSync } from "node:zlib";

export const SITE_BUDGETS = Object.freeze({ initialJsGzip: 65 * 1024, initialTransfer: 500 * 1024, maxFontFiles: 1 });
const TEXT = /^(text\/|application\/(javascript|json)|image\/svg)/;
const PAGES = ["", "themes/choom-circuit/"];

export async function measureSiteBudgets({ root, siteDir }) {
  const { chromium } = await import("@playwright/test");
  const { serve } = await import("../scripts/serve.mjs");
  const server = await serve({ root: siteDir, host: "127.0.0.1", base: "/GitHub-Reskin" });
  const browser = await chromium.launch();
  const report = { measuredAt: "390x844 Chromium, cold cache", budgets: SITE_BUDGETS, pages: [] };
  const failures = [];
  let assertions = 0;
  const check = (ok, message) => {
    assertions++;
    if (!ok) failures.push(message);
  };
  try {
    for (const path of PAGES) {
      const page = await browser.newPage({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 3 });
      const responses = [];
      page.on("response", async (response) => {
        const body = await response.body().catch(() => Buffer.alloc(0));
        const type = response.headers()["content-type"] || "";
        responses.push({ url: response.url(), type, raw: body.length, sent: TEXT.test(type) ? gzipSync(body, { level: 9 }).length : body.length });
      });
      await page.goto(`${server.url}${path}`, { waitUntil: "networkidle" });
      await page.evaluate(() => document.fonts.ready);
      await page.waitForTimeout(300);
      await page.close();
      const origin = new URL(server.url).origin;
      const thirdParty = responses.filter((r) => new URL(r.url).origin !== origin).map((r) => r.url);
      const js = responses.filter((r) => /javascript/.test(r.type));
      const fonts = responses.filter((r) => /font\/|woff2?$/.test(r.type) || /\.woff2?$/.test(r.url));
      const video = responses.filter((r) => /^video\//.test(r.type));
      const inlineJs = await inlineScriptBytes(join(siteDir, path, "index.html"));
      const result = {
        path: `/GitHub-Reskin/${path}`,
        requests: responses.length,
        transferBytes: responses.filter((r) => !video.includes(r)).reduce((n, r) => n + r.sent, 0),
        rawBytes: responses.reduce((n, r) => n + r.raw, 0),
        customJsGzipBytes: js.reduce((n, r) => n + r.sent, 0) + inlineJs,
        fontFiles: fonts.map((r) => new URL(r.url).pathname),
        thirdParty,
        files: responses.map(({ url, type, raw, sent }) => ({ path: new URL(url).pathname, type, raw, sent })),
      };
      report.pages.push(result);
      check(result.customJsGzipBytes <= SITE_BUDGETS.initialJsGzip, `${result.path}: initial JS ${result.customJsGzipBytes} B gzip exceeds ${SITE_BUDGETS.initialJsGzip}`);
      check(result.transferBytes <= SITE_BUDGETS.initialTransfer, `${result.path}: initial transfer ${result.transferBytes} B exceeds ${SITE_BUDGETS.initialTransfer}`);
      check(result.fontFiles.length <= SITE_BUDGETS.maxFontFiles, `${result.path}: fetched ${result.fontFiles.length} font files`);
      check(thirdParty.length === 0, `${result.path}: third-party requests ${thirdParty.join(", ")}`);
      check(video.length === 0, `${result.path}: video loaded before the visitor asked`);
    }
  } finally {
    await browser.close();
    await server.close();
  }
  const dir = join(root, "artifacts/reports");
  await mkdir(dir, { recursive: true });
  report.failures = failures;
  await writeFile(join(dir, "site-budgets.json"), `${JSON.stringify(report, null, 2)}\n`);
  for (const page of report.pages) {
    console.log(`${page.path}: ${(page.transferBytes / 1024).toFixed(1)} KiB transfer (${(page.rawBytes / 1024).toFixed(1)} KiB raw), ${(page.customJsGzipBytes / 1024).toFixed(1)} KiB JS gzip, ${page.requests} requests, fonts ${page.fontFiles.length}, third-party ${page.thirdParty.length}`);
  }
  console.log(`Report: artifacts/reports/site-budgets.json`);
  if (failures.length) console.error(`Site budgets failed:\n  ${failures.join("\n  ")}`);
  return { exitCode: failures.length ? 1 : 0, testCount: assertions };
}

// Gzip size of inline <script> bodies, excluding JSON data blocks.
async function inlineScriptBytes(file) {
  const { readFile } = await import("node:fs/promises");
  const html = await readFile(file, "utf8");
  let total = 0;
  for (const [, attrs, body] of html.matchAll(/<script([^>]*)>([\s\S]*?)<\/script>/g)) {
    if (/\bsrc=/.test(attrs) || /application\/json/.test(attrs) || !body.trim()) continue;
    total += gzipSync(body, { level: 9 }).length;
  }
  return total;
}
