// Static checks of a generated userscript, shared by check:userscript and the unit tests. Each
// returns a list of problems; empty means the script passes.
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { FONTS } from "../packages/appearance/registry.js";
import { GRANTS, MATCHES, MAX_BYTES, updateUrl } from "./build.mjs";

// Anything that could reach the network, run generated code or keep data in the page.
const FORBIDDEN = [
  [/\bfetch\s*\(/, "fetch"],
  [/\bXMLHttpRequest\b/, "XMLHttpRequest"],
  [/\bWebSocket\b/, "WebSocket"],
  [/\bEventSource\b/, "EventSource"],
  [/\bsendBeacon\b/, "sendBeacon"],
  [/\bxmlHttpRequest\b|GM_xmlhttpRequest|GM_download|GM_getResource/, "manager network or resource API"],
  [/\bimportScripts\b|\bnew\s+(Shared)?Worker\b/, "a worker"],
  [/\bimport\s*\(/, "dynamic import"],
  [/\beval\s*\(|\bnew\s+Function\b/, "code from strings"],
  [/\bsessionStorage\b|\bindexedDB\b|\bdocument\.cookie\b/, "page storage"],
  [/url\(\s*["']?(https?:)?\/\//, "a remote CSS resource"],
  [/\bsrc\s*=\s*\\?["'](https?:)?\/\//, "a remote src"],
];

// C5's preview (packages/preview/mount.js) reads a resource adapter's font or image URL to embed it
// in its scriptless frame, unless the URL is already data. Every URL the userscript's adapter
// gives is data (embeddedResources over the build's own bytes), so this exact call never runs here;
// it is removed before the scan, so any other call, or this one changed, still fails. (\u0028 is
// "(", spelled out so this file's own source never contains a call.)
export const REVIEWED_PREVIEW_READ = 'win.fetch\u0028url, { credentials: "omit" })';

/** The metadata block's entries, in order, as [key, value]. */
export function metadataEntries(script) {
  const block = /^\/\/ ==UserScript==\n([\s\S]*?)\/\/ ==\/UserScript==\n/.exec(script)?.[1];
  if (!block) return null;
  return block
    .split("\n")
    .filter(Boolean)
    .map((line) => /^\/\/ @(\S+)\s*(.*)$/.exec(line))
    .map((match) => (match ? [match[1], match[2].trim()] : ["", ""]));
}

/**
 * @param {string} script the generated userscript
 * @param {{config:object, root:string}} options release.config.json and the repository root
 * @returns {Promise<string[]>} problems
 */
export async function scriptProblems(script, { config, root }) {
  const problems = [];
  const fail = (ok, message) => ok || problems.push(message);
  const bytes = Buffer.byteLength(script);
  fail(bytes > 0, "the userscript is empty");
  fail(bytes <= MAX_BYTES, `the userscript is ${bytes} bytes, over the ${MAX_BYTES}-byte budget`);
  const entries = metadataEntries(script);
  if (!fail(entries, "no metadata block")) return problems;
  const all = (key) => entries.filter(([k]) => k === key).map(([, value]) => value);
  const one = (key) => (all(key).length === 1 ? all(key)[0] : null);
  fail(entries.every(([key]) => key), "a metadata line that is not // @key value");
  fail(one("name") === config.displayName, "@name");
  fail(one("namespace") === config.support.source, "@namespace must stay the 1.1.0 namespace, so managers update the installed script");
  fail(one("version") === config.version, `@version is not ${config.version}`);
  fail(JSON.stringify(all("match")) === JSON.stringify(MATCHES), "@match must be exactly github.com and gist.github.com over HTTPS");
  fail(!all("include").length && !all("exclude-match").length, "@include/@exclude-match widen or narrow the matches");
  fail(one("run-at") === "document-start", "@run-at document-start");
  fail(all("noframes").length === 1, "@noframes");
  // Isolated from page scripts: Violentmonkey's content mode and Tampermonkey's DOM sandbox.
  fail(one("inject-into") === "content", "@inject-into content keeps the script out of the page's own context");
  fail(one("sandbox") === "DOM", "@sandbox DOM keeps the script out of the page's own context");
  fail(JSON.stringify(all("grant")) === JSON.stringify(GRANTS), "@grant must be exactly the storage and menu grants");
  fail(!all("grant").some((grant) => /xmlhttp|download|resource|unsafeWindow|cookie/i.test(grant)), "a network, resource or page grant");
  fail(!all("require").length, "@require loads remote code");
  fail(!all("resource").length, "@resource loads remote files");
  fail(!all("connect").length, "@connect allows requests");
  fail(/^data:image\/png;base64,[A-Za-z0-9+/]+={0,2}$/.test(one("icon") ?? ""), "@icon must be embedded data, not a remote request");
  fail(!all("iconURL").length && !all("icon64").length && !all("icon64URL").length && !all("defaulticon").length, "another remote icon key");
  fail(one("downloadURL") === updateUrl(config) && one("updateURL") === updateUrl(config), "@downloadURL/@updateURL must be the Pages copy");
  const code = script.slice(script.indexOf("// ==/UserScript==\n") + 19);
  const scanned = code.replace(REVIEWED_PREVIEW_READ, "");
  fail(!scanned.includes(REVIEWED_PREVIEW_READ), "the preview's reviewed read appears more than once");
  for (const [pattern, what] of FORBIDDEN) fail(!pattern.test(scanned), `the script uses ${what}`);
  // The only page-storage call removes 1.1.0's cached CSS key without reading it.
  const local = code.match(/\blocalStorage\b[.\w]*/g) ?? [];
  fail(local.every((use) => use === "localStorage.removeItem"), `page localStorage use: ${[...new Set(local)].join(", ")}`);
  for (const font of FONTS) {
    for (const file of font.files) fail(code.includes((await readFile(join(root, file.path))).toString("base64")), `${file.path} is not embedded`);
    fail(code.includes(await readFile(join(root, `assets/fonts/${font.id}/OFL.txt`), "utf8")), `the ${font.id} OFL notice is missing`);
  }
  fail(code.includes(await readFile(join(root, "licenses/primer-primitives.txt"), "utf8")), "the Primer notice is missing");
  return problems;
}
