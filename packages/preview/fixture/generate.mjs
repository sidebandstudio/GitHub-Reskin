// Authoring-time projection of the offline whoisaldo capture into the preview fixture. Builds and
// tests never run this; the output is reviewed and committed.
// Run: node packages/preview/fixture/generate.mjs <content/site-fixture directory>
// Writes packages/preview/fixture/whoisaldo.json and copies the images and notices the preview
// uses into packages/preview/fixture/assets. The README HTML, already reduced by the capture to
// h1-h6, p, ul, ol, li, a, img, strong, em, code and br, becomes a node tree here, so the runtime
// never parses HTML or assigns innerHTML.
import { createHash } from "node:crypto";
import { copyFile, mkdir, readFile, writeFile } from "node:fs/promises";
import { basename, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const OUT = dirname(fileURLToPath(import.meta.url));
const ASSETS = join(OUT, "assets");
const ALLOWED = new Set(["h1", "h2", "h3", "h4", "h5", "h6", "p", "ul", "ol", "li", "a", "img", "strong", "em", "code", "br"]);
const VOID = new Set(["img", "br"]);
const ENTITIES = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " " };

const decode = (text) =>
  text.replace(/&(#x[0-9a-f]+|#[0-9]+|[a-z]+);/gi, (whole, name) => {
    if (name[0] === "#") return String.fromCodePoint(name[1].toLowerCase() === "x" ? parseInt(name.slice(2), 16) : parseInt(name.slice(1), 10));
    if (!Object.hasOwn(ENTITIES, name)) throw new Error(`Unknown entity ${whole}`);
    return ENTITIES[name];
  });

// A node is a text string or [tag, attributes, ...children]. Whitespace-only text between block
// elements is dropped; runs of whitespace collapse as HTML would render them.
function parse(html, image) {
  const root = ["root", {}];
  const stack = [root];
  const pattern = /<\/?([a-z0-9]+)((?:\s+[a-z-]+="[^"]*")*)\s*\/?>|([^<]+)/gi;
  let match;
  let consumed = 0;
  while ((match = pattern.exec(html))) {
    if (match.index !== consumed) throw new Error(`Unparsed README markup at ${consumed}`);
    consumed = pattern.lastIndex;
    const [whole, rawTag, rawAttrs, text] = match;
    const parent = stack.at(-1);
    if (text !== undefined) {
      const value = decode(text).replace(/\s+/g, " ");
      if (value.trim() || (parent[0] !== "root" && !["ul", "ol"].includes(parent[0]))) parent.push(value);
      continue;
    }
    const tag = rawTag.toLowerCase();
    if (!ALLOWED.has(tag)) throw new Error(`README tag ${tag} is outside the allowlist`);
    if (whole.startsWith("</")) {
      if (stack.pop()[0] !== tag) throw new Error(`Mismatched </${tag}>`);
      continue;
    }
    const attrs = Object.fromEntries([...rawAttrs.matchAll(/([a-z-]+)="([^"]*)"/g)].map(([, k, v]) => [k, decode(v)]));
    let kept = null;
    if (tag === "a") kept = { href: attrs.href };
    if (tag === "img") kept = image(attrs);
    const node = [tag, kept];
    parent.push(node);
    if (!VOID.has(tag)) stack.push(node);
  }
  if (consumed !== html.length || stack.length !== 1) throw new Error("README markup is incomplete");
  return root.slice(2);
}

async function main() {
  const source = process.argv[2];
  if (!source) throw new Error("Usage: node packages/preview/fixture/generate.mjs <content/site-fixture directory>");
  const profileBytes = await readFile(join(source, "profile-whoisaldo.json"));
  const manifestBytes = await readFile(join(source, "capture-manifest.json"));
  const data = JSON.parse(profileBytes);
  const manifest = JSON.parse(manifestBytes);
  const sizes = Object.fromEntries(manifest.assets.map((asset) => [asset.path, asset]));
  const copied = new Set();
  const asset = (path, alt) => {
    const record = sizes[path];
    if (!record) throw new Error(`No manifest record for ${path}`);
    copied.add(path);
    return { asset: basename(path), width: record.width, height: record.height, alt };
  };
  // Each README image, with its authored dark alternative where the capture has one.
  const readmeImage = ({ src, alt }) => {
    const image = asset(src, alt);
    const dark = src.replace(/\.webp$/, "-dark.webp");
    if (sizes[dark]) image.dark = asset(dark, alt).asset;
    return image;
  };

  const h = data.header;
  const days = data.contributions.days;
  for (let i = 1; i < days.length; i++) if (Date.parse(days[i].date) - Date.parse(days[i - 1].date) !== 86400000) throw new Error("Contribution days are not contiguous");
  const repo = data.repository;
  const fixture = {
    source: {
      capture: "content/site-fixture",
      capturedAt: data.capturedAt,
      profileUrl: data.profileUrl,
      profileSha256: createHash("sha256").update(profileBytes).digest("hex"),
      manifestSha256: createHash("sha256").update(manifestBytes).digest("hex"),
    },
    profile: {
      displayName: h.displayName,
      login: h.login,
      bio: h.bio.replace(/\r\n/g, "\n"),
      company: h.company,
      location: h.location,
      followers: h.followers,
      following: h.following,
      links: h.links.map((link) => ({ label: link.label, href: link.url })),
      avatar: asset(h.avatar.path, h.avatar.alt),
      organizationsHeadingVisible: data.organizationsHeadingVisible,
      organizations: data.organizations.map((org) => ({ login: org.login, avatar: asset(org.avatarPath, `@${org.login}`) })),
      pinnedHeading: data.pinnedHeading,
      pinned: data.pinnedRepositories.map((pin) => ({
        owner: pin.fullName.split("/")[0],
        name: pin.name,
        description: pin.description,
        language: pin.language,
        stars: pin.stars,
        forks: pin.forks,
        visibility: pin.visibility,
      })),
      readme: parse(data.readme.html, readmeImage),
    },
    contributions: {
      heading: data.contributions.nativeHeading,
      start: days[0].date,
      weekStartsOn: data.contributions.weekStartsOn,
      counts: days.map((day) => day.count),
      levels: days.map((day) => day.level),
    },
    repository: {
      owner: repo.owner,
      name: repo.name,
      visibility: repo.visibility,
      defaultBranch: repo.defaultBranch,
      about: repo.about.description,
      license: repo.about.license?.name ?? null,
      counts: repo.counts,
      files: repo.files.map((file) => ({ name: file.name, type: file.type })),
      languages: repo.languages.map((language) => ({ name: language.name, percentage: language.percentage })),
      readme: parse(repo.readme.html, () => {
        throw new Error("The repository README excerpt has no images");
      }),
    },
  };

  await mkdir(ASSETS, { recursive: true });
  for (const path of [...copied].sort()) await copyFile(join(source, path), join(ASSETS, basename(path)));
  for (const notice of ["LICENSE-GitHub-Reskin.txt", "OFL-Chakra-Petch.txt", "OFL-JetBrains-Mono.txt"]) await copyFile(join(source, notice), join(OUT, notice));
  await writeFile(join(OUT, "whoisaldo.json"), `${JSON.stringify(fixture, null, 1)}\n`);
  console.log(`whoisaldo.json written; ${copied.size} assets copied`);
}

await main();
