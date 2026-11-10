import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import test from "node:test";
import { strToU8, unzipSync, zipSync } from "fflate";
import { ROOT, loadEntry, loadReleaseConfig, sha256 } from "../../scripts/build.mjs";
import { artifactName, packageRelease, zip } from "../../scripts/package.mjs";
import { packageBudgetProblems, remoteResourceProblems, verifyArtifacts, zipEntries } from "../../scripts/verify-artifacts.mjs";
import { BUDGETS } from "../../packages/contracts/index.js";
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
    assert.equal(info.extensionEntry, "reskin-2");
    assert.deepEqual(info.manifestDifferences, ["/background/scripts", "/background/service_worker", "/browser_specific_settings"]);
    assert.match(info.commit ?? "", /^[0-9a-f]{40}$/);
    const source = unzipSync(await readFile(join(out, artifactName(version, "amo-source"))));
    for (const path of ["BUILDING.md", "package-lock.json", "userscript/build.mjs", "scripts/build.mjs"]) assert.ok(source[path], path);
    assert.ok(!Object.keys(source).some((path) => /^(node_modules|dist|artifacts)\//.test(path)));
    const notice = await readFile(join(ROOT, "licenses/primer-primitives.txt"));
    assert.deepEqual(Buffer.from(source["licenses/primer-primitives.txt"]), notice);
    for (const browser of ["chrome", "firefox"]) {
      const files = unzipSync(await readFile(join(out, artifactName(version, browser))));
      assert.ok(files["manifest.json"] && files.LICENSE, browser);
      assert.deepEqual(Buffer.from(files["licenses/primer-primitives.txt"]), notice, browser);
    }
    // The single-file userscript embeds the same notice, byte for byte, in a comment.
    const userscript = await readFile(join(out, artifactName(version, "userscript")), "utf8");
    assert.ok(userscript.includes(`/* licenses/primer-primitives.txt\n\n${notice.toString("utf8")}*/\n`));
    // The Primer notice covers every bundle that embeds the mode data and travels in the
    // userscript too, as do the font notices, since the userscript embeds the fonts; the preview
    // images' notices ship only in the browser packages.
    const entry = await loadEntry(await loadReleaseConfig());
    assert.deepEqual(
      info.licenses.map((item) => [item.file, item.license, item.covers, item.in]),
      [
        ["LICENSE", "MIT", ["GitHub Reskin"], ["chrome", "firefox", "amo-source"]],
        ["licenses/primer-primitives.txt", "MIT", ["extension/background.js", "extension/content.js", "extension/pages/pages.js"], ["chrome", "firefox", "userscript", "amo-source"]],
        ...entry.notices.slice(1).map((n) => [n.file, "OFL-1.1", n.covers.map((path) => `extension/${path}`), n.file.startsWith("assets/fonts/") ? ["chrome", "firefox", "userscript", "amo-source"] : ["chrome", "firefox", "amo-source"]]),
      ],
    );
    // Primer's, one OFL notice for each of the eighteen font families and the preview images' two.
    assert.equal(entry.notices.length, 21);

    // The checks pass on real output when the toolchain is the pinned one.
    const { problems, checks } = await verifyArtifacts(out);
    assert.ok(checks > 100, `${checks} checks`);
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
    const problems = (await verifyArtifacts(out)).problems.join("\n");
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
    const more = (await verifyArtifacts(out)).problems.join("\n");
    assert.match(more, /chrome\.zip does not match SHA256SUMS/);
    assert.match(more, /manifest\.json is not dated 1980-01-01/);
    assert.match(more, /userscript has no metadata block/);
    assert.match(more, /the userscript lacks the licenses\/primer-primitives\.txt notice/);
  });
});

test("check:artifacts fails a zero-byte userscript even when its checksums agree", async () => {
  await withTempDir(async (tmp) => {
    const out = join(tmp, "artifacts");
    await packageRelease({ outDir: out, distDir: join(tmp, "dist"), source: true });
    const name = artifactName(version, "userscript");
    const empty = Buffer.alloc(0);
    await writeFile(join(out, name), empty);
    const info = JSON.parse(await readFile(join(out, "build-info.json"), "utf8"));
    info.artifacts[name].sha256 = sha256(empty);
    const infoBytes = Buffer.from(`${JSON.stringify(info, null, 2)}\n`);
    await writeFile(join(out, "build-info.json"), infoBytes);
    const sums = (await readFile(join(out, "SHA256SUMS"), "utf8"))
      .split("\n")
      .map((line) => (line.endsWith(`  ${name}`) ? `${sha256(empty)}  ${name}` : line.endsWith("  build-info.json") ? `${sha256(infoBytes)}  build-info.json` : line))
      .join("\n");
    await writeFile(join(out, "SHA256SUMS"), sums);
    const problems = (await verifyArtifacts(out)).problems.join("\n");
    assert.doesNotMatch(problems, /does not match SHA256SUMS/);
    assert.match(problems, new RegExp(`${name.replaceAll(".", "\\.")} is empty`));
    assert.match(problems, /the userscript has no metadata block/);
  });
});

test("check:artifacts enforces the unpacked and ZIP budgets and admits the reviewed read in its minified form", () => {
  const files = { "a.js": new Uint8Array(BUDGETS.unpackedRuntimeBytes - 10), "b.js": new Uint8Array(10) };
  assert.deepEqual(packageBudgetProblems("x.zip", files, BUDGETS.runtimeZipBytes), []);
  const over = packageBudgetProblems("x.zip", { ...files, "c.js": new Uint8Array(1) }, BUDGETS.runtimeZipBytes + 1);
  assert.equal(over.length, 2);
  assert.match(over[0], /over the 5242880-byte budget by 1$/);
  const read = (text) => ({ "pages/pages.js": Buffer.from(text) });
  assert.deepEqual(remoteResourceProblems(read('const r=win.fetch(url,{credentials:"omit"});')), []);
  assert.equal(remoteResourceProblems(read('const r=win.fetch(other,{credentials:"omit"});')).length, 1);
});
