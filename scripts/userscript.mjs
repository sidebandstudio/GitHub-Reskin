// Compatibility entry for release.config.json's `userscript.builder` and older instructions. The
// userscript is built by userscript/build.mjs from the product packages.
//   node scripts/userscript.mjs          writes userscript/github-reskin.user.js
import { realpathSync } from "node:fs";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { build, COMMITTED, ROOT } from "../userscript/build.mjs";

export { build };

if (process.argv[1] && realpathSync(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await writeFile(join(ROOT, COMMITTED), await build());
  console.log(`Wrote ${COMMITTED}`);
}
