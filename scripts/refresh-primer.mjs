// Maintenance only: refetches GitHub's mode stylesheets for vendor/primer. No build, package or
// check runs this command, and nothing it fetches reaches the repository until a person has read
// the delta it prints and accepts that exact download.
//
//   node scripts/refresh-primer.mjs                 fetch into a new temporary directory, convert it
//                                                   offline and print the delta against vendor/primer
//   node scripts/refresh-primer.mjs --accept <dir>  copy that reviewed download into
//                                                   vendor/primer/source and regenerate modes.json
//
// github.com links one stylesheet per mode (light, dark, dimmed, high contrast, colorblind,
// tritanopia and their combinations). Primer Primitives publishes those tokens under the MIT
// license, which is fetched beside them. A mode that packages/primer/mode-policy.json has not
// reviewed blocks --accept until someone adds it there with an explicit policy.
import { createHash } from "node:crypto";
import { copyFile, mkdir, mkdtemp, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { generate, readPolicy, readVendor } from "../packages/primer/generate.mjs";

const ROOT = resolve(fileURLToPath(new URL("..", import.meta.url)));
const VENDOR = join(ROOT, "vendor/primer");
const HOME = "https://github.com/";
const ASSET = /https:\/\/github\.githubassets\.com\/assets\/((?:light|dark)[a-z_]*)-[0-9a-f]+\.css/g;
const LICENSE_URL = "https://raw.githubusercontent.com/primer/primitives/main/LICENSE";
const LICENSE_FILE = "LICENSE.primer-primitives.txt";

const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");

async function get(url) {
  const res = await fetch(url, { headers: { "user-agent": "github-reskin-maintenance" } });
  if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`);
  return Buffer.from(await res.arrayBuffer());
}

// Downloads every linked mode stylesheet and the upstream license into a new temporary directory,
// laid out like vendor/primer/source with its SOURCES.json.
async function fetchInputs() {
  const dir = await mkdtemp(join(tmpdir(), "reskin-primer-"));
  const html = (await get(HOME)).toString("utf8");
  const links = new Map([...html.matchAll(ASSET)].map((m) => [m[1], m[0]]));
  if (!links.has("light") || !links.has("dark")) throw new Error("github.com no longer links its light and dark mode stylesheets");
  const files = {};
  for (const [mode, url] of [...links].sort(([a], [b]) => (a < b ? -1 : 1))) {
    const bytes = await get(url);
    await writeFile(join(dir, `${mode}.css`), bytes);
    files[`${mode}.css`] = { url, sha256: sha256(bytes) };
  }
  const license = await get(LICENSE_URL);
  await writeFile(join(dir, LICENSE_FILE), license);
  const sources = {
    retrieved: new Date().toISOString().slice(0, 10),
    page: HOME,
    files,
    license: { file: LICENSE_FILE, url: LICENSE_URL, sha256: sha256(license) },
  };
  await writeFile(join(dir, "SOURCES.json"), `${JSON.stringify(sources, null, 2)}\n`);
  return dir;
}

// What changes between the frozen dataset and a candidate one, as readable lines.
function delta(before, after, policy) {
  const lines = [];
  const reviewed = new Set(Object.keys(policy.modes));
  const old = new Set(Object.keys(before?.index.modes ?? {}));
  for (const id of Object.keys(after.discovered)) {
    if (!reviewed.has(id)) lines.push(`UNREVIEWED mode ${id}: add it to packages/primer/mode-policy.json with an explicit policy`);
    else if (!old.has(id)) lines.push(`new mode ${id}`);
  }
  for (const id of old) if (!after.index.modes[id]) lines.push(`removed mode ${id}`);
  for (const [id, seed] of Object.entries(after.index.modes)) {
    const prior = before?.index.modes[id];
    if (!prior) continue;
    const changed = Object.keys(seed.origins).filter((path) => JSON.stringify(leaf(seed, path)) !== JSON.stringify(leaf(prior, path)));
    if (changed.length) lines.push(`${id}: ${changed.length} seed colors changed (${changed.slice(0, 6).join(", ")}${changed.length > 6 ? ", ..." : ""})`);
  }
  const oldVars = new Set(before?.provenance.tokenInventory.declared ?? []);
  const newVars = new Set(after.provenance.tokenInventory.declared);
  const added = [...newVars].filter((v) => !oldVars.has(v));
  const removed = [...oldVars].filter((v) => !newVars.has(v));
  if (added.length) lines.push(`${added.length} variables added: ${added.slice(0, 12).join(" ")}${added.length > 12 ? " ..." : ""}`);
  if (removed.length) lines.push(`${removed.length} variables removed: ${removed.slice(0, 12).join(" ")}${removed.length > 12 ? " ..." : ""}`);
  return lines;
}

const leaf = (seed, path) => path.split("/").slice(1).reduce((v, k) => v?.[k], seed.colors);

async function accept(dir) {
  const candidate = await generate(await readVendor(dir, { sourcesFile: join(dir, "SOURCES.json") }), await readPolicy(ROOT));
  const unreviewed = Object.keys(candidate.discovered).filter((id) => !candidate.policy.modes[id]);
  if (unreviewed.length) throw new Error(`Refusing to accept unreviewed modes: ${unreviewed.join(", ")}`);
  const source = join(VENDOR, "source");
  await rm(source, { recursive: true, force: true });
  await mkdir(source, { recursive: true });
  const inputs = (await readdir(dir)).filter((name) => name.endsWith(".css") || name === "SOURCES.json" || name === LICENSE_FILE);
  for (const name of inputs.sort()) await copyFile(join(dir, name), join(source, name));
  const frozen = await generate(await readVendor(source), await readPolicy(ROOT));
  await writeFile(join(VENDOR, "modes.json"), frozen.modesJson);
  await writeFile(join(VENDOR, "provenance.json"), frozen.provenanceJson);
  console.log(`Accepted ${Object.keys(frozen.index.modes).length} modes into vendor/primer. Review and commit the change.`);
}

const { values } = parseArgs({ options: { accept: { type: "string" } } });
if (values.accept) {
  await accept(resolve(values.accept));
} else {
  const dir = await fetchInputs();
  const policy = await readPolicy(ROOT);
  let before = null;
  try {
    before = await generate(await readVendor(join(VENDOR, "source")), policy);
  } catch (error) {
    console.log(`No usable frozen dataset yet (${error.message}).`);
  }
  const after = await generate(await readVendor(dir, { sourcesFile: join(dir, "SOURCES.json") }), policy, { allowUnreviewed: true });
  const lines = delta(before, after, policy);
  console.log(`Fetched ${Object.keys(after.discovered).length} mode stylesheets into ${dir}`);
  for (const line of lines.length ? lines : ["no change to any reviewed mode or the variable inventory"]) console.log(`  ${line}`);
  console.log(`Read the delta, then accept with: node scripts/refresh-primer.mjs --accept ${dir}`);
  // A copy of the candidate output stays beside the download for review; --accept ignores it.
  await writeFile(join(dir, "candidate-modes.json"), after.modesJson);
}
