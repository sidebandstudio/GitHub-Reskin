// Compiles sanitized advanced CSS (its rule IR) against C3's finite native target registry into
// scoped CSS for a style node's textContent. No parser: the viewer can compile build-time proofs.
//
// Every rewritten selector requires [data-reskin-css="active"] on the host scope and excludes
// [data-reskin-native] and [data-reskin-protected] and their descendants at the subject. Native
// subjects also require the revocable [data-reskin-css-native="active"] gate on the scope and
// [data-reskin-css-kind="<kind>"] on the subject itself. Owned decorations require the host's
// [data-reskin-owned] node with its exact slot. A rule that can reach several kinds gets the
// intersection of their policies, or the whole input fails. Without a valid registry every
// native rule fails closed and only owned decorations compile.
import { CSS_MARKERS, CSS_REGISTRY_VERSION, CSS_TARGET_KINDS, FLAVOR_SLOT_IDS, ISSUE_CODES, SANITIZER_VERSION } from "../../contracts/index.js";
import { POLICY, POLICY_HASH, has } from "./policy.js";

const isObject = (value) => value !== null && typeof value === "object" && !Array.isArray(value);
const ASCII_IDENT = /^-?[a-zA-Z_][a-zA-Z0-9_-]*$/;
const HASH = /^[0-9a-f]{64}$/;
const M = CSS_MARKERS;
const SCOPE = `[${M.scope}="active"]`;
const NATIVE_GATE = `[${M.nativeGate}="active"]`;
const EXCLUDE = `:not([${M.native}],[${M.native}] *,[${M.protected}],[${M.protected}] *)`;
// The sanitizer refuses CSS-wide keywords; the compiler refuses them again on GitHub's elements.
const CSS_WIDE = /(?:^|[\s,(])(?:inherit|initial|unset|revert|revert-layer)(?=$|[\s,)])/i;

const issue = (message) => ({ code: ISSUE_CODES.cssRegistry, path: "/css", message, severity: "error" });

/** Problems with a CssTargetRegistry, as readable strings. Empty means it can be used. */
export function registryProblems(registry) {
  const problems = [];
  if (!isObject(registry)) return ["the registry must be an object"];
  if (registry.registryVersion !== CSS_REGISTRY_VERSION) problems.push(`registryVersion must be ${CSS_REGISTRY_VERSION}`);
  const kinds = isObject(registry.kinds) ? registry.kinds : (problems.push("kinds must be an object"), {});
  for (const [kind, policy] of Object.entries(kinds)) {
    const at = `kind ${kind}`;
    if (!CSS_TARGET_KINDS.includes(kind)) problems.push(`${at} is not a registered target kind`);
    if (!isObject(policy)) {
      problems.push(`${at} needs a policy object`);
      continue;
    }
    const strings = (value) => Array.isArray(value) && value.every((v) => typeof v === "string");
    if (!strings(policy.properties) || !policy.properties.every((p) => has(POLICY.nativeProperties, p))) problems.push(`${at} properties must come from the native allowlist`);
    if (!isObject(policy.colors)) problems.push(`${at} colors must map properties to audited variables`);
    else
      for (const [property, variables] of Object.entries(policy.colors)) {
        if (!has(POLICY.colorProperties, property) && property !== "background-image") problems.push(`${at} colors names ${property}, which takes no color`);
        if (!strings(variables) || !variables.every((v) => POLICY.variables[v] === "color")) problems.push(`${at} colors for ${property} must be audited --reskin-* color variables`);
      }
    if (!strings(policy.literalColors) || !policy.literalColors.every((p) => (policy.properties ?? []).includes(p))) problems.push(`${at} literalColors must be among its properties`);
    for (const flag of ["blur", "textShadow", "inheritable"]) if (typeof policy[flag] !== "boolean") problems.push(`${at} ${flag} must be a boolean`);
    if (!Number.isInteger(policy.maxTargets) || policy.maxTargets < 1) problems.push(`${at} maxTargets must be a positive integer`);
  }
  if (!Array.isArray(registry.subjects)) problems.push("subjects must be an array");
  else
    for (const [index, subject] of registry.subjects.entries()) {
      const at = `subject ${index}`;
      if (!isObject(subject) || !Object.hasOwn(kinds, subject.kind)) {
        problems.push(`${at} needs a kind defined in kinds`);
        continue;
      }
      if (!Array.isArray(subject.classes) || !subject.classes.every((c) => typeof c === "string" && ASCII_IDENT.test(c))) problems.push(`${at} classes must be plain class names`);
      if (subject.element !== undefined && !(typeof subject.element === "string" && ASCII_IDENT.test(subject.element))) problems.push(`${at} element must be a plain element name`);
      if (subject.id !== undefined && !(typeof subject.id === "string" && ASCII_IDENT.test(subject.id))) problems.push(`${at} id must be a plain name`);
      if (!subject.classes?.length && subject.element === undefined && subject.id === undefined) problems.push(`${at} must name classes, an element or an id`);
      if (subject.predicates !== undefined && !(Array.isArray(subject.predicates) && subject.predicates.every((p) => isObject(p) && has(POLICY.attributes, p.name) && p.name !== M.slot && typeof p.value === "string"))) {
        problems.push(`${at} predicates must be exact data-testid, data-component or aria-current values`);
      }
      if (!Array.isArray(subject.routes) || !subject.routes.length || !subject.routes.every((r) => typeof r === "string" && r)) problems.push(`${at} needs its reviewed routes`);
    }
  if (registry.rootKind !== null && !(registry.rootKind === "page-backing" && Object.hasOwn(kinds, "page-backing"))) problems.push("rootKind must be null or page-backing, defined in kinds");
  if (!isObject(registry.invalidation) || !Array.isArray(registry.invalidation.attributes) || !Array.isArray(registry.invalidation.events) || !registry.invalidation.attributes.length || !registry.invalidation.events.length) {
    problems.push("invalidation must list the attributes and events that revoke admission");
  }
  if (!isObject(registry.fixtures) || !Object.keys(registry.fixtures).length || !Object.values(registry.fixtures).every((h) => typeof h === "string" && HASH.test(h))) problems.push("fixtures must map reviewed fixture paths to SHA-256 hashes");
  return problems;
}

// A CSS string. Control characters become hex escapes, so no value can end the string early.
const quote = (value) =>
  `"${String(value)
    .replace(/\\/g, "\\\\")
    .replace(/"/g, '\\"')
    .replace(/[\u0000-\u001f\u007f]/g, (c) => `\\${c.charCodeAt(0).toString(16)} `)}"`;

function renderCompound(compound) {
  let out = compound.element ?? "";
  if (compound.id) out += `#${compound.id}`;
  for (const name of compound.classes) out += `.${name}`;
  for (const { name, value } of compound.attributes) out += `[${name}=${quote(value)}]`;
  for (const pseudo of compound.pseudoClasses) out += pseudo.selectors ? `:${pseudo.name}(${pseudo.selectors.map(renderSelector).join(",")})` : `:${pseudo.name}`;
  return out;
}
function renderSelector(selector) {
  return selector.compounds.map((c, i) => (i ? (selector.combinators[i - 1] === ">" ? ">" : " ") : "") + renderCompound(c)).join("");
}

const isRoot = (compound) => compound.pseudoClasses.some((p) => p.name === "root") || has(POLICY.rootSelectors, compound.element);
const slotOf = (compound) => compound.attributes.find((a) => a.name === M.slot)?.value ?? null;

// The concrete subjects of a selector: :is()/:where() standing alone as the subject expand into
// one selector per alternative, with the outer ancestors kept in front.
function alternatives(selector, fail) {
  const subject = selector.compounds.at(-1);
  const functional = subject.pseudoClasses.filter((p) => p.name === "is" || p.name === "where");
  if (!functional.length) return [selector];
  const alone = functional.length === 1 && subject.pseudoClasses.length === 1 && !subject.element && !subject.id && !subject.classes.length && !subject.attributes.length;
  if (!alone) return fail(`${renderSelector(selector)}: use :is() or :where() alone as the subject so each alternative gets its own target check`), [];
  const out = [];
  for (const inner of functional[0].selectors) {
    const joined = {
      compounds: [...selector.compounds.slice(0, -1), ...inner.compounds],
      combinators: [...selector.combinators, ...inner.combinators],
    };
    out.push(...alternatives(joined, fail));
  }
  return out;
}

// Registry signatures an exact subject compound can be. Predicates, including those inside
// :not(), must be registered on the signature.
function signaturesFor(compound, registry) {
  const classes = [...compound.classes].sort().join(" ");
  const negated = compound.pseudoClasses.filter((p) => p.name === "not").flatMap((p) => p.selectors.flatMap((s) => s.compounds));
  const predicates = [...compound.attributes, ...negated.flatMap((c) => c.attributes)];
  return registry.subjects.filter((sig) => {
    if ([...sig.classes].sort().join(" ") !== classes) return false;
    if (compound.element && compound.element !== sig.element) return false;
    if (compound.id && compound.id !== sig.id) return false;
    return predicates.every((p) => (sig.predicates ?? []).some((r) => r.name === p.name && r.value === p.value));
  });
}

function checkAncestors(selector, fail) {
  for (const compound of selector.compounds.slice(0, -1)) {
    if (compound.attributes.length) return fail(`${renderSelector(selector)}: attribute predicates belong on the subject, where the registry checks them`), false;
    if (compound.pseudoClasses.some((p) => p.selectors)) return fail(`${renderSelector(selector)}: :is(), :where() and :not() belong on the subject`), false;
  }
  return true;
}

// The policy check for one declaration on one native kind.
function kindProblem(decl, kind, policy) {
  const { property } = decl;
  if (!policy.properties.includes(property)) return `${property} is not allowed on ${kind} targets`;
  if (has(POLICY.inheritable, property) && !policy.inheritable) return `${property} is inherited, and ${kind} targets can have unadmitted descendants`;
  if (property === "box-shadow" && decl.blur && !policy.blur) return `blurred shadows are not allowed on ${kind} targets`;
  if (property === "text-shadow" && !policy.textShadow) return `text shadows are not allowed on ${kind} targets`;
  if (CSS_WIDE.test(decl.value)) return `${property} on ${kind} targets cannot hand its value back to the cascade`;
  if (has(POLICY.colorProperties, property) || property === "background-image") {
    if (policy.literalColors.includes(property)) return null;
    if (decl.literalColor) return `${property} on ${kind} targets uses its audited pair variables, not literal colors`;
    const allowed = policy.colors[property] ?? [];
    const audited = decl.variables.filter((v) => POLICY.variables[v] === "color");
    const wrong = audited.filter((v) => !allowed.includes(v));
    if (wrong.length) return `${property} on ${kind} targets must use ${allowed.length ? allowed.join(" or ") : "no color variable"}, not ${wrong.join(", ")}`;
    // Positive proof: a value with no audited color, a keyword or none, would leave the pair.
    if (!audited.length) return `${property} on ${kind} targets must use ${allowed.length ? allowed.join(" or ") : "a reviewed literal color"}`;
  }
  return null;
}

function effectiveMode(preferences) {
  if (!preferences) return "full";
  return preferences.appearance ?? (preferences.extras === false ? "calm" : "full");
}

/**
 * Compiles sanitized CSS for live insertion or the preview frame.
 *
 * `cssAllowed` is true only for packaged built-in CSS in Full or for an import whose consent names
 * this canonical hash and sanitizer version. Calm, Effects off, a disabled extension, native or
 * forced-color policy and missing consent omit the CSS entirely; Fonts off removes font
 * declarations and Text off removes decorations of text slots. The rules are validated the same
 * way whatever the preferences, so a rejected input is rejected in every state.
 *
 * @param {import("../../contracts/index.js").SanitizedCss} sanitized
 * @param {{registry?: import("../../contracts/index.js").CssTargetRegistry | null, cssAllowed: boolean, preferences?: import("../../contracts/index.js").EffectivePreferences, policy?: string}} options
 * @returns {import("../../contracts/index.js").CssCompileResult}
 */
export function compileCss(sanitized, { registry = null, cssAllowed, preferences, policy = "themed" } = {}) {
  if (!isObject(sanitized) || !Array.isArray(sanitized.rules)) return { ok: false, issues: [issue("compileCss takes sanitized CSS.")] };
  if (sanitized.sanitizerVersion !== SANITIZER_VERSION || sanitized.policyHash !== POLICY_HASH) {
    return { ok: false, issues: [issue("This CSS was checked by another sanitizer version and must be checked again.")] };
  }
  const registryIssues = registry === null || registry === undefined ? null : registryProblems(registry);
  const usable = registryIssues !== null && registryIssues.length === 0 ? registry : null;
  const issues = [];
  const fail = (message) => issues.length < 24 && issues.push(issue(message));
  const compiled = [];

  for (const rule of sanitized.rules) {
    const selectors = [];
    const kinds = new Set();
    let owned = 0;
    let textSlot = false;
    for (const selector of rule.selectors) {
      for (const concrete of alternatives(selector, fail)) {
        if (!checkAncestors(concrete, fail)) continue;
        const subject = concrete.compounds.at(-1);
        const ancestors = concrete.compounds.slice(0, -1).map((c, i) => renderCompound(c) + (concrete.combinators[i] === ">" ? ">" : " ")).join("");
        const slot = slotOf(subject);
        if (slot) {
          owned++;
          if (FLAVOR_SLOT_IDS.includes(slot)) textSlot = true;
          selectors.push(`:where(${SCOPE}) ${ancestors}[${M.owned}][${M.slot}=${quote(slot)}]${EXCLUDE}${subject.pseudoElement ? `::${subject.pseudoElement}` : ""}`);
          continue;
        }
        if (!usable) {
          fail(
            registryIssues?.length
              ? `The GitHub target registry is unusable (${registryIssues[0]}), so CSS for GitHub's own elements is rejected.`
              : `${renderSelector(concrete)} styles GitHub's own elements, which needs the reviewed target registry. This version rejects it.`,
          );
          continue;
        }
        if (isRoot(subject)) {
          if (!usable.rootKind) {
            fail(`${renderSelector(concrete)} needs a reviewed page backing, which this registry does not provide.`);
            continue;
          }
          kinds.add(usable.rootKind);
          selectors.push(`:where(${SCOPE}${NATIVE_GATE}) [${M.kind}=${quote(usable.rootKind)}]${EXCLUDE}`);
          continue;
        }
        const matches = signaturesFor(subject, usable);
        if (!matches.length) {
          fail(`${renderSelector(concrete)} is not a reviewed GitHub target, so no imported CSS can reach it.`);
          continue;
        }
        for (const kind of new Set(matches.map((m) => m.kind))) {
          kinds.add(kind);
          selectors.push(`:where(${SCOPE}${NATIVE_GATE}) ${ancestors}${renderCompound(subject)}[${M.kind}=${quote(kind)}]${EXCLUDE}`);
        }
      }
    }
    for (const decl of rule.declarations) {
      for (const kind of kinds) {
        const problem = kindProblem(decl, kind, usable.kinds[kind]);
        if (problem) fail(`${rule.selectors.map(renderSelector).join(",")}: ${problem}.`);
      }
    }
    compiled.push({ conditions: rule.conditions, selectors, declarations: rule.declarations, native: kinds.size > 0, owned: owned > 0, textSlot });
  }
  if (issues.length) return { ok: false, issues };

  const mode = effectiveMode(preferences);
  const omitted = !cssAllowed || policy !== "themed" || preferences?.enabled === false || mode === "calm" || preferences?.effects === false;
  let css = "";
  let nativeRules = 0;
  let ownedRules = 0;
  if (!omitted) {
    for (const rule of compiled) {
      if (preferences?.text === false && rule.textSlot) continue;
      const declarations = rule.declarations.filter((d) => !(preferences?.fonts === false && has(POLICY.fontProperties, d.property)));
      if (!declarations.length || !rule.selectors.length) continue;
      let text = `${rule.selectors.join(",")}{${declarations.map((d) => `${d.property}:${d.value}`).join(";")}}`;
      for (const condition of [...rule.conditions].reverse()) text = `${condition}{${text}}`;
      css += text;
      if (rule.native) nativeRules++;
      if (rule.owned) ownedRules++;
    }
  }
  return { ok: true, css, nativeRules, ownedRules };
}
