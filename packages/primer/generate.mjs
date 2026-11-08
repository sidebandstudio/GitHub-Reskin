// Regenerates vendor/primer/modes.json and provenance.json from the frozen stylesheets in
// vendor/primer/source, offline. Node only; never part of a browser bundle.
//   node packages/primer/generate.mjs           rewrite modes.json and provenance.json
//   node packages/primer/generate.mjs --check   exit 1 if either differs from a fresh conversion
import { createHash } from "node:crypto";
import { readFile, readdir, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { convertModes, GENERATOR_VERSION } from "./convert.js";

const ROOT = resolve(fileURLToPath(new URL("../..", import.meta.url)));
export const sha256 = (data) => createHash("sha256").update(data).digest("hex");

/** Reads the reviewed policy and mapping table from packages/primer. */
export async function readPolicy(root = ROOT) {
  const read = async (name) => {
    const text = await readFile(join(root, "packages/primer", name), "utf8");
    return { json: JSON.parse(text), sha256: sha256(text) };
  };
  const policy = await read("mode-policy.json");
  const mappings = await read("mappings.json");
  return { ...policy.json, mappings: mappings.json, policySha256: policy.sha256, mappingsSha256: mappings.sha256 };
}

/**
 * Reads a source directory laid out like vendor/primer/source and checks every file against the
 * hashes recorded in its SOURCES.json. Nothing unrecorded is accepted.
 */
export async function readVendor(dir, { sourcesFile = join(dir, "SOURCES.json") } = {}) {
  const sources = JSON.parse(await readFile(sourcesFile, "utf8"));
  const files = {};
  const present = (await readdir(dir)).filter((n) => n.endsWith(".css")).sort();
  const recorded = Object.keys(sources.files).sort();
  if (JSON.stringify(present) !== JSON.stringify(recorded)) throw new Error(`${dir}: stylesheets ${present.join(", ")} do not match SOURCES.json ${recorded.join(", ")}`);
  for (const name of recorded) {
    const bytes = await readFile(join(dir, name));
    const hash = sha256(bytes);
    if (hash !== sources.files[name].sha256) throw new Error(`${name}: SHA-256 ${hash} differs from SOURCES.json ${sources.files[name].sha256}`);
    files[name] = { text: bytes.toString("utf8"), sha256: hash };
  }
  const license = await readFile(join(dir, sources.license.file));
  if (sha256(license) !== sources.license.sha256) throw new Error(`${sources.license.file}: SHA-256 differs from SOURCES.json`);
  if (!/MIT License/.test(license.toString("utf8"))) throw new Error(`${sources.license.file} is not the MIT license`);
  return { dir, sources, files };
}

// JSON with every object or array of plain values on one line, so diffs show changed colors.
export function formatJson(value, indent = "") {
  const inner = `${indent}  `;
  const flat = (v) => v === null || typeof v !== "object" || Object.values(v).every((x) => x === null || typeof x !== "object");
  if (flat(value)) return JSON.stringify(value);
  if (Array.isArray(value)) return `[\n${value.map((v) => inner + formatJson(v, inner)).join(",\n")}\n${indent}]`;
  return `{\n${Object.entries(value).map(([k, v]) => `${inner}${JSON.stringify(k)}: ${formatJson(v, inner)}`).join(",\n")}\n${indent}}`;
}

/** Converts a read source directory under the policy into modes.json and provenance.json text. */
export async function generate(vendor, policy, { allowUnreviewed = false } = {}) {
  const { index, discovered, inventory } = convertModes({ files: vendor.files, policy, mappings: policy.mappings, hash: sha256, allowUnreviewed });
  const provenance = {
    generator: { file: "packages/primer/generate.mjs", version: GENERATOR_VERSION, parser: "packages/primer/css.js" },
    retrieved: vendor.sources.retrieved,
    page: vendor.sources.page,
    license: vendor.sources.license,
    files: Object.fromEntries(Object.entries(vendor.sources.files).map(([name, f]) => [`source/${name}`, { mode: name.slice(0, -4), url: f.url, sha256: f.sha256 }])),
    policy: { file: "packages/primer/mode-policy.json", sha256: policy.policySha256 },
    mappings: { file: "packages/primer/mappings.json", sha256: policy.mappingsSha256 },
    modes: Object.fromEntries(Object.entries(index.modes).map(([id, seed]) => [id, { file: `source/${discovered[id]}`, base: seed.base, family: seed.family, highContrast: seed.highContrast, policy: policy.modes[id].policy, sourceHash: seed.sourceHash }])),
    tokenInventory: inventory,
  };
  return {
    index,
    discovered,
    policy,
    provenance,
    modesJson: `${formatJson(index)}\n`,
    provenanceJson: `${formatJson(provenance)}\n`,
  };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  const vendorDir = join(ROOT, "vendor/primer");
  const result = await generate(await readVendor(join(vendorDir, "source")), await readPolicy(ROOT));
  const outputs = [["modes.json", result.modesJson], ["provenance.json", result.provenanceJson]];
  if (process.argv.includes("--check")) {
    const stale = [];
    for (const [name, text] of outputs) if ((await readFile(join(vendorDir, name), "utf8").catch(() => "")) !== text) stale.push(name);
    if (stale.length) {
      console.error(`vendor/primer/${stale.join(", ")} differ from a fresh offline conversion. Run node packages/primer/generate.mjs.`);
      process.exitCode = 1;
    }
  } else {
    for (const [name, text] of outputs) await writeFile(join(vendorDir, name), text);
    console.log(`Wrote vendor/primer/modes.json (${result.modesJson.length} bytes) and provenance.json for ${Object.keys(result.index.modes).length} modes`);
  }
}
