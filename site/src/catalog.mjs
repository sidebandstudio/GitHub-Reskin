// The site's build-time seam to the bundled catalog and the format package: the catalog in
// themes/catalog.json with each theme document as the extension ships it, the sanitizer's proofs
// for their advanced CSS, the generated AI prompt and the sample answer. Client scripts never
// import this file; the live preview receives documents and proofs through reskin:themes
// (site/modules.mjs), and pages receive text and metadata through their HTML.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { cssProofs, makeAiPrompt, validateTheme } from "../../packages/format/index.js";

// Astro bundles this file for prerendering, so site/build.mjs passes the repository root.
const ROOT = process.env.RESKIN_ROOT || fileURLToPath(new URL("../../", import.meta.url));
const read = (path) => readFileSync(join(ROOT, path), "utf8");

export const CATALOG_SOURCE = "themes/catalog.json";

const GROUPS = ["anime", "classics"];
const entries = JSON.parse(read(CATALOG_SOURCE));

/** Catalog entries in serialization order (Anime, then Classics), each with its theme document. */
export const CATALOG = Object.freeze(
  entries
    .slice()
    .sort((a, b) => GROUPS.indexOf(a.group) - GROUPS.indexOf(b.group) || a.order - b.order)
    .map((entry) => {
      const doc = JSON.parse(read(entry.file));
      const result = validateTheme(doc);
      if (!result.ok) throw new Error(`${entry.file} is not a valid theme: ${result.issues.map((i) => i.message).join("; ")}`);
      return Object.freeze({ id: entry.id, slug: entry.slug, group: entry.group, file: entry.file, order: entry.order, doc });
    }),
);

/** Build-time proofs for every bundled CSS and gradientCss text, for the viewer's registerCssProofs. */
export const CSS_PROOFS = cssProofs(CATALOG.map((theme) => theme.doc));

/** The rich AI prompt, generated from the format's contract. */
export const AI_PROMPT = makeAiPrompt();

// The format's executable rich example, presented the way a chatbot answers: prose around a fence.
const example = read("tests/fixtures/schema/valid/ai-rich.reskin.json").trim();
export const SAMPLE_ANSWER = `Here is your theme. Paste it into GitHub Reskin's Import.\n\n\`\`\`json\n${example}\n\`\`\`\n\nIt uses an optional advanced CSS rule, which you can review before enabling.`;
