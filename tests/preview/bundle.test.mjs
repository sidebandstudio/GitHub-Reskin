// The preview build scope bundles appearance and preview for browsers with their font inputs.
// Until C3's packages/primer and vendor/primer/modes.json merge, this builds in a temporary root
// with a stand-in primer package; the real scope then needs no change here.
import assert from "node:assert/strict";
import { cp, mkdir, symlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { test } from "node:test";
import { pathToFileURL } from "node:url";
import { buildSharedFrom } from "../../scripts/build.mjs";
import { withTempDir } from "../helpers/tmp.mjs";

const ROOT = new URL("../../", import.meta.url).pathname;

test("the preview scope bundles appearance and preview with every font and notice", async () => {
  await withTempDir(async (dir) => {
    for (const path of ["packages", "assets/fonts", "licenses", "tests/fixtures/seeds"]) await cp(join(ROOT, path), join(dir, path), { recursive: true });
    await symlink(join(ROOT, "node_modules"), join(dir, "node_modules"), "dir");
    await mkdir(join(dir, "packages/primer"), { recursive: true });
    await writeFile(join(dir, "packages/primer/package.json"), JSON.stringify({ name: "stand-in", type: "module", exports: { ".": "./index.js" } }));
    await writeFile(join(dir, "packages/primer/index.js"), "export const selectMode = () => null;\n");
    await mkdir(join(dir, "vendor/primer"), { recursive: true });
    await writeFile(join(dir, "vendor/primer/modes.json"), JSON.stringify({ contractVersion: 1 }));
    const result = await buildSharedFrom(dir, { outDir: join(dir, "dist"), scope: "preview" });
    for (const name of ["appearance.js", "preview.js", "assets/fonts/bungee/bungee.woff2", "assets/fonts/josefin-sans/OFL.txt"]) assert.ok(result.files[name], name);
    const { readFile } = await import("node:fs/promises");
    for (const name of ["appearance.js", "preview.js"]) {
      const text = await readFile(join(result.dir, name), "utf8");
      assert.doesNotMatch(text, /\brequire\(|\beval\(|new Function|from "node:|innerHTML|insertAdjacentHTML|document\.write/, name);
    }
    const appearance = await import(pathToFileURL(join(result.dir, "appearance.js")).href);
    assert.equal(typeof appearance.mountAppearance, "function");
    const preview = await import(pathToFileURL(join(result.dir, "preview.js")).href);
    assert.equal(typeof preview.mountPreview, "function");
  });
});
