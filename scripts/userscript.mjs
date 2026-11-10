// Compatibility entry for release.config.json's `userscript.builder` and older instructions. The
// userscript is built by userscript/build.mjs from the product packages.
//   node scripts/userscript.mjs          writes dist/userscript/github-reskin.user.js
import { realpathSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { build, OUTPUT, ROOT } from "../userscript/build.mjs";

export { build };

if (process.argv[1] && realpathSync(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await mkdir(join(ROOT, "dist/userscript"), { recursive: true });
  await writeFile(join(ROOT, OUTPUT), await build());
  console.log(`Wrote ${OUTPUT}`);
}
