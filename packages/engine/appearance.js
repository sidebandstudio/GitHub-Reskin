// The non-color half of the resolved appearance record: paints, shape, role fonts, typography,
// graph style, details and the identity of admitted CSS. Groups a theme omits resolve to null, so
// a v1 theme keeps GitHub's native shape, type and paints; omitted members of a supplied group
// take the schema defaults. Images resolve to the hash of their decoded bytes and the pointer of
// their data, never base64; CSS resolves to its canonical hash, never its text.
import { APPEARANCE_DEFAULTS as D, FONT_ROLES, admitCss, admitGradientCss, rasterInfo } from "../format/viewer.js";
import { sha256 } from "./sha256.js";

const TARGETS = ["page", "profileBanner", "header"];
const lower = (hex) => (typeof hex === "string" ? hex.toLowerCase() : hex);

function paint(theme, target) {
  const background = theme.backgrounds?.[target];
  if (!background) return null;
  const layers = (background.layers ?? []).map((layer, index) => {
    const at = `/backgrounds/${target}/layers/${index}`;
    if (layer.gradient) {
      const g = layer.gradient;
      return {
        kind: "gradient",
        type: g.type,
        angle: g.angle ?? D.gradient.angle,
        position: g.position ?? D.gradient.position,
        stops: g.stops.map((stop) => ({ color: lower(stop.color), position: stop.position })),
        opacity: g.opacity ?? D.gradient.opacity,
      };
    }
    if (layer.pattern) {
      const p = layer.pattern;
      return { kind: "pattern", pattern: p.kind, color: lower(p.color), opacity: p.opacity ?? D.pattern.opacity, size: p.size ?? D.pattern.size };
    }
    if (layer.image) {
      const image = layer.image;
      const info = rasterInfo(image.data);
      if (!info.ok) throw new TypeError(`resolveTheme needs admitted images: ${at}/image/data ${info.code}`);
      return {
        kind: "image",
        asset: sha256(info.bytes),
        source: `${at}/image/data`,
        mime: info.mime,
        width: info.width,
        height: info.height,
        fit: image.fit ?? D.raster.fit,
        position: image.position ?? D.raster.position,
        opacity: image.opacity ?? D.raster.opacity,
      };
    }
    const admitted = admitGradientCss(layer.gradientCss, `${at}/gradientCss`);
    if (!admitted.ok) throw new TypeError(`resolveTheme needs admitted gradientCss at ${at}`);
    return { kind: "gradientCss", value: admitted.value, size: admitted.size };
  });
  return { color: lower(background.color) ?? null, layers };
}

function shape(theme, tokens) {
  const s = theme.shape ?? {};
  const frame = s.avatar?.frame;
  return {
    corners: s.corners ? { style: s.corners.style ?? "rounded", radius: s.corners.radius ?? D.corners.radius } : null,
    borders: s.borders ? { width: s.borders.width ?? D.borders.width, style: s.borders.style ?? D.borders.style, color: lower(s.borders.color) ?? tokens.border } : null,
    shadows: s.shadows
      ? { style: s.shadows.style ?? D.shadows.style, color: lower(s.shadows.color) ?? tokens.accent, opacity: s.shadows.opacity ?? D.shadows.opacity, blur: s.shadows.blur ?? D.shadows.blur, offset: s.shadows.offset ?? D.shadows.offset }
      : null,
    buttons: s.buttons ? { style: s.buttons.style ?? "filled", radius: s.buttons.radius ?? D.buttons.radius } : null,
    avatar: s.avatar
      ? { shape: s.avatar.shape ?? "circle", frame: frame ? { style: frame.style ?? D.avatarFrame.style, width: frame.width ?? D.avatarFrame.width, color: lower(frame.color) ?? tokens.border } : null }
      : null,
  };
}

// A deferred family has no file in this increment: it resolves to GitHub's font and is noted.
function fontRole(requested, role, notes) {
  const entry = FONT_ROLES.find((font) => font.id === requested);
  if (entry.source === "deferred") {
    notes.push({ code: "deferred-capability", path: `/fonts/${role}`, message: `${requested} arrives in a later version; GitHub's own font is used.` });
    return { id: "system", requested, source: "system", family: null, fallback: null, weights: [] };
  }
  return { id: entry.id, requested, source: entry.source, family: entry.family, fallback: entry.fallback, weights: [...entry.weights] };
}

/** The appearance record minus its paired colors, which deriveColors resolves with the rest. */
export function resolveAppearance(theme, tokens) {
  const notes = [];
  const headingId = theme.fonts?.heading ?? theme.fonts?.accent ?? "system";
  const fonts = { heading: fontRole(headingId, theme.fonts?.heading ? "heading" : "accent", notes), body: fontRole(theme.fonts?.body ?? "system", "body", notes) };
  const c = theme.contributions;
  const cellStyle = c?.cellStyle ?? D.graph.cellStyle;
  const glow = cellStyle === "glow" ? { radius: c.glow?.radius ?? D.glow.radius, opacity: c.glow?.opacity ?? D.glow.opacity, levels: [...new Set(c.glow?.levels ?? D.glow.levels)].sort(), color: lower(c.glow?.color) ?? null } : null;
  const pill = (p) => (p ? { style: p.style ?? null, fill: p.fill ?? "tinted" } : null);
  const t = theme.typography;
  let css = null;
  if (typeof theme.css === "string" && theme.css !== "") {
    const admitted = admitCss(theme.css, "/css");
    if (!admitted.ok) throw new TypeError("resolveTheme needs admitted CSS");
    const { hash, bytes, sanitizerVersion, policyHash } = admitted.value;
    css = { hash, bytes, sanitizerVersion, policyHash };
  }
  return {
    paints: Object.fromEntries(TARGETS.map((target) => [target, paint(theme, target)])),
    shape: shape(theme, tokens),
    fonts,
    typography: t ? { uppercaseHeadings: t.uppercaseHeadings ?? D.typography.uppercaseHeadings, headingLetterSpacing: t.headingLetterSpacing ?? D.typography.headingLetterSpacing, bodyLetterSpacing: t.bodyLetterSpacing ?? D.typography.bodyLetterSpacing } : null,
    graph: { cellStyle, cellRadius: c?.cellRadius ?? null, glow },
    details: { scrollbarWidth: theme.details?.scrollbar?.width ?? "auto", labels: pill(theme.details?.labels), topics: pill(theme.details?.topics) },
    css,
    notes,
  };
}
