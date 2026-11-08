// Type-checked by module-types.test.mjs under strict settings, without allowJs: the format's
// declarations satisfy the frozen FormatModule and keep the contract types. Not run.
import * as format from "../../packages/format/index.js";
import type { FormatModule, ImportCandidate, ImportResult, Issue, ThemeV1 } from "../../packages/contracts/index.js";

const module: FormatModule = format;

function preview(result: ImportResult): ThemeV1 | ImportCandidate[] | Issue[] {
  if (result.ok) {
    const source: string = result.source;
    void source;
    return result.normalized;
  }
  // @ts-expect-error A failed import has no normalized theme.
  void result.normalized;
  return result.candidates ?? result.issues;
}
preview(format.parseImport("{}", "text"));
preview(format.decodeShare("RS1.x.00000000"));

const validated = format.validateTheme({});
if (validated.ok) format.encodeShare(validated.theme);
const bytes: Uint8Array = format.exportTheme({ schemaVersion: 1, name: "Moss", base: "light", colors: { background: "#f6f2e8", text: "#27372d", accent: "#446851" } }).bytes;
const choice = format.colorsOnly({});
const omitted: string[] = choice.ok ? choice.omitted : choice.issues.map((issue) => issue.path);
const code: "jsonc" = format.NOTE_CODES.jsonc;
const firstAnime: "anime" | undefined = format.ANIME_CATALOG[0]?.group;

void module, bytes, omitted, code, firstAnime;
