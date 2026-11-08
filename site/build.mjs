// The site build hook (SiteBuild in packages/contracts): build({ outDir, config }) writes the
// static Pages site into outDir, which scripts/build.mjs has emptied. Offline: Astro telemetry is
// off and the site reads only checked-in sources.
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

export const SITE_ROOT = fileURLToPath(new URL(".", import.meta.url));

export async function build({ outDir, config }) {
  if (!outDir) throw new Error("site build needs outDir");
  process.env.ASTRO_TELEMETRY_DISABLED = "1";
  const { build: astroBuild } = await import("astro");
  await astroBuild({
    root: SITE_ROOT,
    outDir,
    site: config?.site?.origin,
    base: config?.site?.base ? `${config.site.base.replace(/\/+$/, "")}/` : undefined,
    logLevel: "warn",
  });
  // GitHub Pages must serve _assets as-is.
  await writeFile(join(outDir, ".nojekyll"), "");
  return { outDir };
}
