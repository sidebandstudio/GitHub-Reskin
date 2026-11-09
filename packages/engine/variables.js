// The audited scalar --reskin-* variables advanced CSS may read, from repaired output. Values are
// finite colors, native font lists and a radius; nothing exposes page content, attributes, asset
// URLs or settings. A compiler that bundles a face puts its own @font-face family first.
import { CSS_VARIABLES, THEME_SYNTAX_ROLES } from "../contracts/index.js";

const kebab = (role) => role.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`);
const NATIVE_FONT = 'system-ui, -apple-system, "Segoe UI", "Noto Sans", Helvetica, Arial, sans-serif';

/**
 * @param {import("../contracts/index.js").ThemedResolved} resolved
 * @param {{headingFamily?: string, bodyFamily?: string}} [faces] CSS family names of loaded bundled faces
 * @returns {Record<string, string>}
 */
export function cssVariables(resolved, faces = {}) {
  if (!resolved || resolved.policy !== "themed") throw new TypeError("cssVariables takes a themed ResolvedTheme; native policies set no variables");
  const t = resolved.tokens;
  const a = resolved.appearance;
  const font = (role, face) => {
    const r = a.fonts[role];
    const list = r.fallback ?? NATIVE_FONT;
    return r.source === "bundled" && face ? `${JSON.stringify(face)}, ${list}` : list;
  };
  const syntax = (role) => resolved.syntax[role] ?? a.colors.syntax[role];
  const values = {
    "--reskin-canvas": t.canvas,
    "--reskin-surface": t.surface,
    "--reskin-inset": t.inset,
    "--reskin-raised": t.raised,
    "--reskin-text": t.text,
    "--reskin-muted-text": t.mutedText,
    "--reskin-link": t.link,
    "--reskin-border": t.border,
    "--reskin-control-border": t.controlBorder,
    "--reskin-accent": t.accent,
    "--reskin-accent-emphasis": t.accentEmphasis,
    "--reskin-accent-emphasis-text": t.emphasisText,
    "--reskin-primary-background": t.primaryBackground,
    "--reskin-primary-text": t.primaryText,
    "--reskin-header-background": a.colors.header.background,
    "--reskin-header-text": a.colors.header.text,
    "--reskin-selection-background": t.selectionBackground,
    "--reskin-selection-text": t.selectionText,
    "--reskin-code-background": t.codeBackground,
    "--reskin-code-text": t.codeText,
    "--reskin-diff-added-background": t.diffAddedBackground,
    "--reskin-diff-added-text": t.diffAddedText,
    "--reskin-diff-removed-background": t.diffRemovedBackground,
    "--reskin-diff-removed-text": t.diffRemovedText,
    "--reskin-diff-word-added-background": t.diffWordAddedBackground,
    "--reskin-diff-word-added-text": t.diffWordAddedText,
    "--reskin-diff-word-removed-background": t.diffWordRemovedBackground,
    "--reskin-diff-word-removed-text": t.diffWordRemovedText,
    ...Object.fromEntries(THEME_SYNTAX_ROLES.map((role) => [`--reskin-syntax-${kebab(role)}`, syntax(role)])),
    ...Object.fromEntries(resolved.graph.map((color, level) => [`--reskin-graph-${level}`, color])),
    "--reskin-font-heading": font("heading", faces.headingFamily),
    "--reskin-font-body": font("body", faces.bodyFamily),
    "--reskin-radius": `${a.shape.corners?.radius ?? 6}px`,
  };
  const names = Object.keys(CSS_VARIABLES);
  if (names.length !== Object.keys(values).length || !names.every((name) => Object.hasOwn(values, name))) throw new Error("cssVariables is out of step with CSS_VARIABLES");
  return values;
}
