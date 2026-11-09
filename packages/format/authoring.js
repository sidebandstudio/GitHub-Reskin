// The authoring entry: the css-tree 3.1.0 sanitizer. Importing it installs the sanitizer, after
// which every synchronous format call (parseImport, validateTheme, normalizeTheme, decodeShare)
// admits and canonicalizes CSS exactly as the full entry does. The site loads it on import or
// edit intent so landing pages never pay for the parser; the extension loads it with the engine.
import { admitGradientCss as admitGradientValue, sanitizeCss, transportEquivalent } from "./css/sanitize.js";
import { installCssSanitizer } from "./css/admission.js";
import { POLICY_HASH } from "./css/policy.js";
import { SANITIZER_VERSION } from "../contracts/index.js";

installCssSanitizer({ sanitizeCss, admitGradientCss: admitGradientValue });

export { sanitizeCss, transportEquivalent };
export { admitGradientValue as sanitizeGradientCss };

/**
 * Build-time proofs for bundled themes: the sanitizer's result for each css and gradientCss text,
 * for the viewer's registerCssProofs. Throws if any bundled CSS fails admission.
 * @param {import("../contracts/index.js").ThemeV1[]} themes
 */
export function cssProofs(themes) {
  const proofs = [];
  for (const theme of themes) {
    if (typeof theme.css === "string") {
      const result = sanitizeCss(theme.css);
      if (!result.ok) throw new Error(`${theme.name}: ${result.issues.map((i) => i.message).join(" ")}`);
      proofs.push({ kind: "css", source: theme.css, value: result.value });
    }
    for (const target of ["page", "profileBanner", "header"]) {
      for (const [index, layer] of (theme.backgrounds?.[target]?.layers ?? []).entries()) {
        if (!layer.gradientCss) continue;
        const result = admitGradientValue(layer.gradientCss, `/backgrounds/${target}/layers/${index}/gradientCss`);
        if (!result.ok) throw new Error(`${theme.name}: ${result.issues.map((i) => i.message).join(" ")}`);
        proofs.push({ kind: "gradientCss", value: layer.gradientCss.value, size: layer.gradientCss.size ?? null, sanitizerVersion: SANITIZER_VERSION, policyHash: POLICY_HASH, result: { value: result.value, size: result.size } });
      }
    }
  }
  return proofs;
}
