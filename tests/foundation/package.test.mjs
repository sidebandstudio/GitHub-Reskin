import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import test from "node:test";
import { strToU8, unzipSync, zipSync } from "fflate";
import { ROOT, loadReleaseConfig, sha256 } from "../../scripts/build.mjs";
import { artifactName, packageRelease, zip } from "../../scripts/package.mjs";
import { verifyArtifacts, zipEntries } from "../../scripts/verify-artifacts.mjs";
import { withTempDir } from "../helpers/tmp.mjs";

const { version } = await loadReleaseConfig();
const sample = { "b.txt": strToU8("second\n"), "a/one.js": strToU8("first\n"), "manifest.json": strToU8("{}\n") };

test("ZIPs are byte-identical in any time zone, sorted, dated 1980-01-01 and mode 644", () => {
  const zone = process.env.TZ;
  try {
    process.env.TZ = "UTC";
    const utc = zip(sample);
    process.env.TZ = "Pacific/Kiritimati";
    const ahead = zip(sample);
    process.env.TZ = "America/Adak";
    assert.deepEqual(zip(sample), utc);
    assert.deepEqual(ahead, utc);
  } finally {
    if (zone === undefined) delete process.env.TZ;
    else process.env.TZ = zone;
  }
  const bytes = zip(sample);
  assert.deepEqual(
    zipEntries(bytes).map((e) => [e.name, e.date, e.time, e.mode.toString(8)]),
    ["a/one.js", "b.txt", "manifest.json"].map((name) => [name, 33, 0, "100644"]),
  );
  assert.deepEqual(Object.keys(unzipSync(bytes)).sort(), Object.keys(sample).sort());
  assert.equal(Buffer.from(unzipSync(bytes)["b.txt"]).toString(), "second\n");
});

// Rewrites one ZIP artifact and its checksums, so the check sees only the planted problem.
async function plant(dir, name, change) {
  const files = unzipSync(await readFile(join(dir, name)));
  change(files);
  const bytes = zip(files);
  await writeFile(join(dir, name), bytes);
  const info = JSON.parse(await readFile(join(dir, "build-info.json"), "utf8"));
  info.artifacts[name].sha256 = sha256(bytes);
  const infoBytes = Buffer.from(`${JSON.stringify(info, null, 2)}\n`);
  await writeFile(join(dir, "build-info.json"), infoBytes);
  const sums = (await readFile(join(dir, "SHA256SUMS"), "utf8"))
    .split("\n")
    .map((line) => (line.endsWith(`  ${name}`) ? `${sha256(bytes)}  ${name}` : line.endsWith("  build-info.json") ? `${sha256(infoBytes)}  build-info.json` : line))
    .join("\n");
  await writeFile(join(dir, "SHA256SUMS"), sums);
}

const editManifest = (patch) => (files) => {
  const manifest = JSON.parse(Buffer.from(files["manifest.json"]).toString());
  files["manifest.json"] = strToU8(`${JSON.stringify(patch(manifest), null, 2)}\n`);
};

test("package writes versioned ZIPs, the userscript, a source archive, checksums and build-info that pass the checks", async () => {
  await withTempDir(async (tmp) => {
    const out = join(tmp, "artifacts");
    const { info, artifacts } = await packageRelease({ outDir: out, distDir: join(tmp, "dist") });
    assert.deepEqual(artifacts, [
      "SHA256SUMS",
      "build-info.json",
      artifactName(version, "amo-source"),
      artifactName(version, "chrome"),
      artifactName(version, "firefox"),
      artifactName(version, "userscript"),
    ]);
    assert.equal(info.version, version);
    assert.equal(info.extensionEntry, "legacy-1.1.0");
    assert.deepEqual(info.manifestDifferences, ["/browser_specific_settings"]);
    assert.match(info.commit ?? "", /^[0-9a-f]{40}$/);
    const source = unzipSync(await readFile(join(out, artifactName(version, "amo-source"))));
    for (const path of ["BUILDING.md", "package-lock.json", "extension/github-modes.js", "scripts/build.mjs"]) assert.ok(source[path], path);
    assert.ok(!Object.keys(source).some((path) => /^(node_modules|dist|artifacts)\//.test(path)));
    const notice = await readFile(join(ROOT, "licenses/primer-primitives.txt"));
    assert.deepEqual(Buffer.from(source["licenses/primer-primitives.txt"]), notice);
    for (const browser of ["chrome", "firefox"]) {
      const files = unzipSync(await readFile(join(out, artifactName(version, browser))));
      assert.ok(files["manifest.json"] && files.LICENSE, browser);
      assert.deepEqual(Buffer.from(files["licenses/primer-primitives.txt"]), notice, browser);
    }
    assert.deepEqual(
      info.licenses.map((item) => [item.file, item.license, item.covers, item.in]),
      [
        ["LICENSE", "MIT", ["GitHub Reskin"], ["chrome", "firefox", "amo-source"]],
        ["licenses/primer-primitives.txt", "MIT", ["extension/github-modes.js"], ["chrome", "firefox", "amo-source"]],
      ],
    );

    // The checks pass on real output when the toolchain is the pinned one.
    const problems = await verifyArtifacts(out);
    const toolchain = problems.filter((p) => p.startsWith("built with Node"));
    assert.deepEqual(problems.filter((p) => !toolchain.includes(p)), []);
    assert.equal(toolchain.length, info.toolchain.node === info.toolchain.pinned.node && info.toolchain.npm === info.toolchain.pinned.npm ? 0 : 1);
  });
});

test("check:artifacts catches new permissions, wrong Gecko IDs, stray files, dates and tampering", async () => {
  await withTempDir(async (tmp) => {
    const out = join(tmp, "artifacts");
    await packageRelease({ outDir: out, distDir: join(tmp, "dist"), source: true });
    const chrome = artifactName(version, "chrome");
    const firefox = artifactName(version, "firefox");
    await plant(out, chrome, editManifest((m) => ({ ...m, permissions: [...m.permissions, "tabs"] })));
    await plant(out, firefox, editManifest((m) => ({ ...m, browser_specific_settings: { gecko: { ...m.browser_specific_settings.gecko, id: "x@y" } } })));
    await plant(out, chrome, (files) => (files["notes.txt"] = strToU8("hi")));
    await plant(out, firefox, (files) => (files["popup.js"] = strToU8(`fetch("https://example.com/theme.json");\n`)));
    await plant(out, firefox, (files) => delete files["licenses/primer-primitives.txt"]);
    await plant(out, artifactName(version, "amo-source"), (files) => (files["licenses/primer-primitives.txt"] = strToU8("MIT\n")));
    const problems = (await verifyArtifacts(out)).join("\n");
    assert.match(problems, /firefox\.zip: license file licenses\/primer-primitives\.txt is missing/);
    assert.match(problems, /the source archive: licenses\/primer-primitives\.txt differs from the checked-in notice/);
    assert.match(problems, /chrome\.zip: permissions/);
    assert.match(problems, /firefox\.zip: the Gecko ID/);
    assert.match(problems, /chrome\.zip: files .*notes\.txt/);
    assert.match(problems, /firefox\.zip: popup\.js has a network call/);
    assert.match(problems, /popup\.js differs between the Chrome and Firefox packages/);

    // A ZIP written with the current time instead of the fixed date.
    const userscript = artifactName(version, "userscript");
    const dated = zipSync({ "manifest.json": strToU8("{}") });
    await writeFile(join(out, chrome), dated);
    await writeFile(join(out, userscript), "// tampered\n");
    const more = (await verifyArtifacts(out)).join("\n");
    assert.match(more, /chrome\.zip does not match SHA256SUMS/);
    assert.match(more, /manifest\.json is not dated 1980-01-01/);
    assert.match(more, /userscript has no metadata block/);
  });
});
