// Where validation finds CSS admission. The authoring entry installs the css-tree sanitizer here.
// The viewer entry instead registers build-time proofs: the packaged sanitizer's results for the
// exact css and gradientCss text of bundled themes, keyed by that text and checked against this
// policy hash, so built-in previews need no parser. Anything else fails closed: without the
// sanitizer or a proof for its exact text, CSS is not admitted and the theme does not validate.
import { ISSUE_CODES, SANITIZER_VERSION } from "../../contracts/index.js";
import { sha256 } from "../../engine/sha256.js";
import { POLICY_HASH } from "./policy.js";

let sanitizer = null;
const proofs = new Map();
// Validation runs several times per import and repair; admission results are pure, so recent
// ones are kept by exact input.
const cache = new Map();
const CACHE_SIZE = 64;

const remember = (key, result) => {
  if (cache.size >= CACHE_SIZE) cache.delete(cache.keys().next().value);
  cache.set(key, result);
  return result;
};
const unavailable = (path) => ({
  ok: false,
  issues: [{ code: ISSUE_CODES.cssUnavailable, path, message: "Advanced CSS needs Reskin's CSS checker, which has not loaded here. Open the theme in the importer to check it.", severity: "error" }],
});

/** Installs the sanitizer: {sanitizeCss(source, {path}), admitGradientCss(layer, path)}. */
export function installCssSanitizer(implementation) {
  if (!implementation || typeof implementation.sanitizeCss !== "function" || typeof implementation.admitGradientCss !== "function") throw new TypeError("installCssSanitizer needs sanitizeCss and admitGradientCss");
  sanitizer = implementation;
  cache.clear();
}

export const cssSanitizerInstalled = () => sanitizer !== null;

/**
 * Registers build-time proofs from cssProofs(). A proof made under another sanitizer version or
 * policy, or whose canonical text does not match its hash, is refused and reported.
 * @returns {number} proofs registered
 */
export function registerCssProofs(list) {
  if (!Array.isArray(list)) throw new TypeError("registerCssProofs takes an array");
  let count = 0;
  for (const proof of list) {
    if (proof?.kind === "css") {
      const v = proof.value;
      if (typeof proof.source !== "string" || v?.sanitizerVersion !== SANITIZER_VERSION || v.policyHash !== POLICY_HASH || sha256(new TextEncoder().encode(v.css)) !== v.hash) {
        throw new Error("A CSS proof was made by another sanitizer version or does not match its hash.");
      }
      proofs.set(`css\u0000${proof.source}`, { ok: true, value: v });
    } else if (proof?.kind === "gradientCss") {
      if (proof.sanitizerVersion !== SANITIZER_VERSION || proof.policyHash !== POLICY_HASH || typeof proof.value !== "string" || typeof proof.result?.value !== "string") {
        throw new Error("A gradientCss proof was made by another sanitizer version.");
      }
      proofs.set(`g\u0000${proof.value}\u0000${proof.size ?? ""}`, { ok: true, value: proof.result.value, size: proof.result.size ?? null });
    } else throw new Error("Unknown CSS proof");
    count++;
  }
  cache.clear();
  return count;
}

/** @returns {import("../../contracts/index.js").CssAdmission} */
export function admitCss(source, path = "/css") {
  const key = `css\u0000${path}\u0000${source}`;
  if (cache.has(key)) return cache.get(key);
  if (sanitizer) return remember(key, sanitizer.sanitizeCss(source, { path }));
  const proof = proofs.get(`css\u0000${source}`);
  return proof ?? unavailable(path);
}

/** @returns {import("../../contracts/index.js").GradientCssAdmission} */
export function admitGradientCss(layer, path) {
  const key = `g\u0000${path}\u0000${layer?.value}\u0000${layer?.size ?? ""}`;
  if (cache.has(key)) return cache.get(key);
  if (sanitizer) return remember(key, sanitizer.admitGradientCss(layer, path));
  const proof = proofs.get(`g\u0000${layer?.value}\u0000${layer?.size ?? ""}`);
  return proof ?? unavailable(`${path}/value`);
}
