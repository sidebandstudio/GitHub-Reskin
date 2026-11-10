// The site build hook (SiteBuild in packages/contracts): build({ outDir, config }) writes the
// static Pages site into outDir, which scripts/build.mjs has emptied. Offline: Astro telemetry is
// off and the site reads only checked-in sources. First it captures the shared preview for every
// bundled theme (site/prerender.mjs, cached), then Astro renders the pages, then the captures and
// the files the live preview reads (bundled fonts, fixture images) are copied under the base. The
// userscript is published at downloads/, the address its @updateURL names.
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { ROOT } from "./modules.mjs";
import { build as buildUserscript } from "../userscript/build.mjs";
import { copyCaptures, copyRuntimeFiles, prerender } from "./prerender.mjs";

export const SITE_ROOT = fileURLToPath(new URL(".", import.meta.url));

export async function build({ outDir, config }) {
  if (!outDir) throw new Error("site build needs outDir");
  process.env.ASTRO_TELEMETRY_DISABLED = "1";
  process.env.RESKIN_ROOT = ROOT;
  const manifest = await prerender();
  const { build: astroBuild } = await import("astro");
  await astroBuild({
    root: SITE_ROOT,
    outDir,
    site: config?.site?.origin,
    base: config?.site?.base ? `${config.site.base.replace(/\/+$/, "")}/` : undefined,
    logLevel: "warn",
  });
  await copyCaptures(outDir, manifest);
  await copyRuntimeFiles(outDir);
  await mkdir(join(outDir, "downloads"), { recursive: true });
  await writeFile(join(outDir, "downloads", config?.userscript?.output ?? "github-reskin.user.js"), await buildUserscript());
  // GitHub Pages must serve _assets as-is.
  await writeFile(join(outDir, ".nojekyll"), "");
  return { outDir };
}
