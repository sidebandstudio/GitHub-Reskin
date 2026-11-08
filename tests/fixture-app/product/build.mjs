// Builds the product fixture app into <outDir>/fixture/product: the bundled renderer (app.js), the
// three pages, the bundled fonts and the preview's fixture images, at the paths the site resource
// adapter expects under base "/". Offline: esbuild and checked-in files only.
import { copyFile, mkdir, readdir, rm } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { FONTS } from "../../../packages/appearance/registry.js";

const HERE = dirname(fileURLToPath(import.meta.url));
export const PAGES = ["preview.html", "views.html", "adversarial.html"];

export async function buildFixtureApp({ root, outDir }) {
  const { build } = await import("esbuild");
  const dir = join(outDir, "fixture", "product");
  await rm(dir, { recursive: true, force: true });
  await mkdir(dir, { recursive: true });
  await build({
    entryPoints: [join(HERE, "app.js")],
    outfile: join(dir, "app.js"),
    absWorkingDir: root,
    bundle: true,
    format: "esm",
    platform: "browser",
    target: ["chrome120", "firefox140"],
    charset: "utf8",
    logLevel: "silent",
  });
  for (const page of PAGES) await copyFile(join(HERE, page), join(dir, page));
  for (const font of FONTS) {
    await mkdir(join(dir, dirname(font.path)), { recursive: true });
    await copyFile(join(root, font.path), join(dir, font.path));
  }
  const assets = join(root, "packages/preview/fixture/assets");
  await mkdir(join(dir, "packages/preview/fixture/assets"), { recursive: true });
  for (const name of await readdir(assets)) await copyFile(join(assets, name), join(dir, "packages/preview/fixture/assets", name));
  return dir;
}
