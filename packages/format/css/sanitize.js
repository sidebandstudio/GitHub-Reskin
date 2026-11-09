// The advanced CSS sanitizer of THEME-EXPANSION.md, on the published css-tree 3.1.0 browser
// bundle with one application-owned lexer grammar (corner-shape) added through fork(). Theme CSS
// is parsed with positions and parsed custom properties, every AST branch is walked against the
// allowlists in policy.js, theme-local variables are resolved statically, every value is checked
// by the lexer and its numeric bounds, and the result is generated as canonical CSS. The canonical
// text is parsed again and must reproduce itself and the same rule IR exactly. Anything outside
// the policy rejects the whole input with located reasons; nothing is silently dropped except
// author !important, which is removed with a note.
import * as csstree from "css-tree/dist/csstree.esm";
import { ISSUE_CODES, SANITIZER_VERSION } from "../../contracts/index.js";
import { sha256 } from "../../engine/sha256.js";
import { POLICY, POLICY_HASH, has } from "./policy.js";

const L = POLICY.limits;
const MAX_ISSUES = 24;
const CONTROL = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f-\u009f‎‏‪-‮⁦-⁩﻿]/;
const ASCII_IDENT = /^-?[a-zA-Z_][a-zA-Z0-9_-]*$/;
const THEME_VARIABLE = new RegExp(POLICY.themeVariablePattern);
const COLOR_FUNCTIONS = ["rgb", "rgba", "hsl", "hsla", "oklch", "color-mix"];
const MATH = ["calc", "min", "max", "clamp"];
// CSS-wide keywords hand the value back to the cascade: inherited ink or no backing at all.
const CSS_WIDE = ["inherit", "initial", "unset", "revert", "revert-layer"];

let syntax;
// The forked syntax is built on first use: the lexer data is large and the viewer never needs it.
const css = () => (syntax ??= csstree.fork({ properties: { ...POLICY.grammars } }));

const encoder = new TextEncoder();
export const utf8Bytes = (text) => encoder.encode(text).length;

class Problems {
  constructor(source, path) {
    this.source = source;
    this.path = path;
    this.list = [];
  }
  add(message, loc) {
    if (this.list.length >= MAX_ISSUES) return;
    const where = loc?.start ? ` (line ${loc.start.line}, column ${loc.start.column})` : "";
    this.list.push({ code: ISSUE_CODES.css, path: this.path, message: `${message}${where}.`, severity: "error" });
  }
  get full() {
    return this.list.length >= MAX_ISSUES;
  }
}

const decode = (name) => csstree.ident.decode(String(name));
const lower = (name) => decode(name).toLowerCase();
const children = (node) => (node?.children ? node.children.toArray() : []);
const split = (nodes) => {
  const groups = [[]];
  for (const node of nodes) {
    if (node.type === "Operator" && node.value.trim() === ",") groups.push([]);
    else groups.at(-1).push(node);
  }
  return groups;
};
const lineColumn = (source, offset) => {
  let line = 1;
  let column = 1;
  for (let i = 0; i < offset; i++) {
    if (source[i] === "\n") (line++, (column = 1));
    else column++;
  }
  return { start: { line, column } };
};

// ---------------------------------------------------------------------------------------------
// Token-level completeness. css-tree recovers silently from an unclosed block or string; a theme
// may not depend on recovery, so every bracket must close and no bad string or URL token appears.

function tokenProblems(source, problems) {
  const names = csstree.tokenNames;
  const T = csstree.tokenTypes;
  const stack = [];
  csstree.tokenize(source, (type, start, end) => {
    if (problems.full) return;
    const at = () => lineColumn(source, start);
    if (type === T.BadString || type === T.BadUrl) problems.add(`This ${names[type].replace("-token", "")} is not closed or not allowed`, at());
    else if (type === T.String) {
      const quote = source[start];
      let escaped = false;
      for (let i = start + 1; i < end - 1; i++) escaped = source[i] === "\\" ? !escaped : false;
      if (end - start < 2 || source[end - 1] !== quote || escaped) problems.add("This string is not closed", at());
    } else if (type === T.Comment) {
      if (!source.startsWith("*/", end - 2) || end - start < 4) problems.add("This comment is not closed", at());
    } else if (type === T.Function || type === T.LeftParenthesis) stack.push([")", start]);
    else if (type === T.LeftSquareBracket) stack.push(["]", start]);
    else if (type === T.LeftCurlyBracket) stack.push(["}", start]);
    else if (type === T.RightParenthesis || type === T.RightSquareBracket || type === T.RightCurlyBracket) {
      const close = source[start];
      if (stack.at(-1)?.[0] !== close) problems.add(`This ${close} has nothing to close`, at());
      else stack.pop();
    } else if (type === T.CDO || type === T.CDC) problems.add("HTML comment markers are not CSS", at());
  });
  for (const [close, start] of stack) problems.add(`This block is not closed with ${close}`, lineColumn(source, start));
}

// ---------------------------------------------------------------------------------------------
// Numbers. calc(), min(), max() and clamp() evaluate when their units agree, so every bound is
// checked against a finite, ordered range; anything that cannot be bounded is rejected where
// bounds apply.

function quantity(node) {
  const q = interval(node);
  return q && Number.isFinite(q.min) && Number.isFinite(q.max) && q.min <= q.max ? q : null;
}

function interval(node) {
  if (!node) return null;
  if (node.type === "Number") return { min: Number(node.value), max: Number(node.value), unit: "" };
  if (node.type === "Percentage") return { min: Number(node.value), max: Number(node.value), unit: "%" };
  if (node.type === "Dimension") return { min: Number(node.value), max: Number(node.value), unit: node.unit.toLowerCase() };
  if (node.type === "Function" && MATH.includes(lower(node.name))) {
    const name = lower(node.name);
    const args = split(children(node)).map(expression);
    if (args.some((a) => !a)) return null;
    if (name === "calc") return args.length === 1 ? args[0] : null;
    if (!args.length || args.some((a) => a.unit !== args[0].unit)) return null;
    if (name === "clamp") {
      if (args.length !== 3) return null;
      // clamp(MIN, VAL, MAX) is max(MIN, min(VAL, MAX)): MIN wins when it exceeds MAX.
      const [lo, value, hi] = args;
      return { min: Math.max(lo.min, Math.min(value.min, hi.min)), max: Math.max(lo.max, Math.min(value.max, hi.max)), unit: lo.unit };
    }
    const pick = name === "min" ? Math.min : Math.max;
    return { min: pick(...args.map((a) => a.min)), max: pick(...args.map((a) => a.max)), unit: args[0].unit };
  }
  return null;
}

// Every calc(), min(), max() and clamp() in the nodes evaluates to a finite, ordered range.
function finiteMath(nodes) {
  for (const node of nodes) {
    if (node.type === "Function" && MATH.includes(lower(node.name))) {
      if (!quantity(node)) return false;
    } else if (node.children && !finiteMath(children(node))) return false;
  }
  return true;
}

// + - * / over quantities, with parentheses. A unit mismatch or a division by zero is unbounded.
function expression(nodes) {
  const items = nodes.filter((n) => n.type !== "WhiteSpace");
  let i = 0;
  const factor = () => {
    const node = items[i++];
    if (!node) return null;
    if (node.type === "Parentheses") return expression(children(node));
    return quantity(node);
  };
  const term = () => {
    let left = factor();
    while (left && items[i]?.type === "Operator" && ["*", "/"].includes(items[i].value.trim())) {
      const op = items[i++].value.trim();
      const right = factor();
      if (!right) return null;
      if (op === "*") {
        if (left.unit && right.unit) return null;
        const values = [left.min * right.min, left.min * right.max, left.max * right.min, left.max * right.max];
        left = { min: Math.min(...values), max: Math.max(...values), unit: left.unit || right.unit };
      } else {
        if (right.unit || right.min !== right.max || right.min === 0) return null;
        left = { min: Math.min(left.min / right.min, left.max / right.min), max: Math.max(left.min / right.min, left.max / right.min), unit: left.unit };
      }
    }
    return left;
  };
  let left = term();
  while (left && items[i]?.type === "Operator" && ["+", "-"].includes(items[i].value.trim())) {
    const op = items[i++].value.trim();
    const right = term();
    if (!right || right.unit !== left.unit) return null;
    left = op === "+" ? { min: left.min + right.min, max: left.max + right.max, unit: left.unit } : { min: left.min - right.max, max: left.max - right.min, unit: left.unit };
  }
  if (!left || i !== items.length || !Number.isFinite(left.min) || !Number.isFinite(left.max)) return null;
  return left;
}

// Within [lo, hi] for one of the allowed units, where `units` maps unit to [lo, hi]. A bare 0 is
// a length of zero wherever lengths are allowed.
function inRange(node, units) {
  const q = quantity(node);
  if (!q) return false;
  const unit = q.unit === "" && q.min === 0 && q.max === 0 && !units[""] ? Object.keys(units).find((u) => u !== "%" && u !== "") : q.unit;
  const range = units[unit];
  return Boolean(range) && q.min >= range[0] && q.max <= range[1];
}

// ---------------------------------------------------------------------------------------------
// Colors. Audited variables are opaque scalars; literals carry their own alpha.

const isVariable = (node) => node?.type === "Function" && lower(node.name) === "var";
const variableName = (node) => decode(children(node)[0]?.name ?? "");

function isColor(node) {
  if (!node) return false;
  if (node.type === "Hash") return [3, 4, 6, 8].includes(node.value.length) && /^[0-9a-f]+$/i.test(node.value);
  if (node.type === "Function") {
    const name = lower(node.name);
    if (name === "var") return POLICY.variables[variableName(node)] === "color";
    return COLOR_FUNCTIONS.includes(name);
  }
  if (node.type === "Identifier") {
    const value = { type: "Value", children: new csstree.List().fromArray([{ type: "Identifier", name: lower(node.name) }]) };
    return Boolean(css().lexer.matchType("color", value).matched);
  }
  return false;
}

function alpha(node) {
  if (node.type === "Hash") {
    const v = node.value;
    if (v.length === 4) return parseInt(v[3], 16) / 15;
    if (v.length === 8) return parseInt(v.slice(6), 16) / 255;
    return 1;
  }
  if (node.type === "Identifier") return lower(node.name) === "transparent" ? 0 : 1;
  if (isVariable(node)) return 1;
  const name = lower(node.name);
  const parts = children(node);
  if (name === "color-mix") {
    const [, ...colors] = split(parts);
    if (colors.length !== 2) return null;
    const entries = colors.map((group) => ({ color: group.find(isColor), percent: group.find((n) => n.type === "Percentage") }));
    if (entries.some((e) => !e.color)) return null;
    let [p1, p2] = entries.map((e) => (e.percent ? Number(e.percent.value) : null));
    if (p1 === null && p2 === null) p1 = p2 = 50;
    else if (p1 === null) p1 = 100 - p2;
    else if (p2 === null) p2 = 100 - p1;
    const sum = p1 + p2;
    if (!(sum > 0)) return null;
    const [a1, a2] = entries.map((e) => alpha(e.color));
    if (a1 === null || a2 === null) return null;
    return ((a1 * p1 + a2 * p2) / sum) * (Math.min(sum, 100) / 100);
  }
  const slash = parts.findIndex((n) => n.type === "Operator" && n.value.trim() === "/");
  const groups = split(parts);
  const value = slash >= 0 ? parts.slice(slash + 1).find((n) => n.type !== "WhiteSpace") : groups.length === 4 ? groups[3][0] : null;
  if (!value) return 1;
  const q = quantity(value);
  if (!q || q.min !== q.max) return null;
  return q.unit === "%" ? q.min / 100 : q.min;
}

// True when a color literal (not an audited variable) appears anywhere in the nodes.
function hasLiteralColor(nodes) {
  for (const node of nodes) {
    if (isVariable(node)) continue;
    if (node.type === "Function" && POLICY.gradients.includes(lower(node.name))) return true;
    if (isColor(node) && !isVariable(node)) return true;
    if (node.children && hasLiteralColor(children(node))) return true;
  }
  return false;
}

function variablesIn(nodes, out = new Set()) {
  for (const node of nodes) {
    if (isVariable(node)) out.add(variableName(node));
    else if (node.children) variablesIn(children(node), out);
  }
  return out;
}

// ---------------------------------------------------------------------------------------------
// Selectors.

// The IR of one compound selector, from its simple selectors. Returns null after reporting.
function compoundIr(nodes, ctx, depth) {
  const ir = { element: null, id: null, classes: [], attributes: [], pseudoClasses: [], pseudoElement: null, root: false };
  for (const [index, node] of nodes.entries()) {
    switch (node.type) {
      case "TypeSelector": {
        const name = lower(node.name);
        if (name === "*" || name.includes("|") || !ASCII_IDENT.test(name)) return ctx.problems.add("Universal, namespaced and escaped element selectors are not allowed", node.loc), null;
        if (ir.element) return ctx.problems.add("A compound selector names one element", node.loc), null;
        node.name = name;
        ir.element = name;
        break;
      }
      case "ClassSelector":
      case "IdSelector": {
        const name = decode(node.name);
        if (!ASCII_IDENT.test(name)) return ctx.problems.add(`The ${node.type === "IdSelector" ? "ID" : "class"} ${JSON.stringify(name)} is not a plain name`, node.loc), null;
        node.name = name;
        if (node.type === "IdSelector") {
          if (ir.id) return ctx.problems.add("A compound selector names one ID", node.loc), null;
          ir.id = name;
        } else ir.classes.push(name);
        break;
      }
      case "AttributeSelector": {
        const name = lower(node.name.name);
        node.name.name = name;
        if (has(POLICY.markers, name) && name !== "data-reskin-slot") return ctx.problems.add(`Themes cannot use the host marker ${name}`, node.loc), null;
        if (!has(POLICY.attributes, name)) return ctx.problems.add(`Matching on the ${name} attribute is not allowed; only exact data-testid, data-component, data-reskin-slot and aria-current predicates are`, node.loc), null;
        if (node.matcher !== "=" || !node.value || node.flags) return ctx.problems.add(`Only an exact ${name}="value" predicate is allowed`, node.loc), null;
        const value = node.value.type === "String" ? node.value.value : decode(node.value.name);
        if (CONTROL.test(value) || /[\n\r\t]/.test(value)) return ctx.problems.add(`The ${name} value cannot contain control characters`, node.loc), null;
        node.value = { type: "String", value };
        ir.attributes.push({ name, value });
        break;
      }
      case "PseudoClassSelector": {
        const name = lower(node.name);
        node.name = name;
        if (name === "root" && !node.children) {
          ir.root = true;
          break;
        }
        if (has(POLICY.selectorFunctions, name)) {
          if (!node.children) return ctx.problems.add(`:${name}() needs a selector list`, node.loc), null;
          if (depth + 1 > L.nesting) return ctx.problems.add(`Selectors nest at most ${L.nesting} levels`, node.loc), null;
          const list = children(node)[0];
          if (list?.type !== "SelectorList") return ctx.problems.add(`:${name}() needs a selector list`, node.loc), null;
          const selectors = selectorListIr(list, ctx, depth + 1, { compoundOnly: name === "not" });
          if (!selectors) return null;
          ir.pseudoClasses.push({ name, selectors });
          break;
        }
        if (!has(POLICY.pseudoClasses, name) || node.children) return ctx.problems.add(`The :${name} pseudo-class is not allowed`, node.loc), null;
        if (has(POLICY.statePseudoClasses, name)) ctx.state = true;
        ir.pseudoClasses.push({ name });
        break;
      }
      case "PseudoElementSelector": {
        const name = lower(node.name);
        node.name = name;
        if (!has(POLICY.pseudoElements, name) || node.children) return ctx.problems.add(`The ::${name} pseudo-element is not allowed`, node.loc), null;
        if (index !== nodes.length - 1) return ctx.problems.add(`::${name} must end its selector`, node.loc), null;
        ir.pseudoElement = name;
        break;
      }
      case "NestingSelector":
        return ctx.problems.add("CSS nesting is not available in this version of Reskin", node.loc), null;
      default:
        return ctx.problems.add(`This selector part (${node.type}) is not allowed`, node.loc), null;
    }
  }
  return ir;
}

function selectorIr(selector, ctx, depth, { compoundOnly = false } = {}) {
  ctx.selectors++;
  if (ctx.selectors > L.selectors) return ctx.problems.add(`A theme has at most ${L.selectors} selectors, counting lists inside :is(), :where() and :not()`, selector.loc), null;
  const parts = children(selector);
  if (parts.length > L.selectorComponents) return ctx.problems.add(`A selector has at most ${L.selectorComponents} parts`, selector.loc), null;
  const compounds = [[]];
  const combinators = [];
  for (const node of parts) {
    if (node.type === "Combinator") {
      if (!has(POLICY.combinators, node.name)) return ctx.problems.add(`The ${node.name} combinator is not allowed; use descendant or > only`, node.loc), null;
      if (compoundOnly) return ctx.problems.add(":not() takes simple selectors only", node.loc), null;
      combinators.push(node.name);
      compounds.push([]);
    } else compounds.at(-1).push(node);
  }
  if (compounds.some((c) => !c.length)) return ctx.problems.add("A combinator needs a selector on both sides", selector.loc), null;
  const irs = [];
  for (const compound of compounds) {
    const ir = compoundIr(compound, ctx, depth);
    if (!ir) return null;
    irs.push(ir);
  }
  // Owned decorations and the mapped page roots are subjects only.
  for (const [index, ir] of irs.entries()) {
    const subject = index === irs.length - 1;
    const slot = ir.attributes.find((a) => a.name === "data-reskin-slot");
    if (slot && (!subject || depth > 0)) return ctx.problems.add("An owned decoration selector must be the subject of its rule", selector.loc), null;
    if (slot && !has(POLICY.ownedSlots, slot.value)) return ctx.problems.add(`${JSON.stringify(slot.value)} is not a Reskin decoration slot`, selector.loc), null;
    if (slot && (ir.element || ir.id || ir.classes.length || ir.attributes.length > 1 || ir.pseudoClasses.length || ir.root)) {
      return ctx.problems.add("An owned decoration selector names only its slot and optionally ::before or ::after", selector.loc), null;
    }
    if (ir.pseudoElement && !slot) return ctx.problems.add(`::${ir.pseudoElement} is allowed only on an exact Reskin decoration`, selector.loc), null;
    const root = ir.root || has(POLICY.rootSelectors, ir.element);
    if (root && (!subject || irs.length > 1 || depth > 0 || ir.classes.length || ir.id || ir.attributes.length || ir.pseudoClasses.length || (ir.root && ir.element))) {
      return ctx.problems.add("html, body and :root stand alone; they map to the page backing", selector.loc), null;
    }
  }
  return { compounds: irs, combinators };
}

function selectorListIr(list, ctx, depth, options) {
  const out = [];
  for (const selector of children(list)) {
    if (selector.type !== "Selector") return ctx.problems.add("This selector could not be read", selector.loc), null;
    const ir = selectorIr(selector, ctx, depth, options);
    if (!ir) return null;
    out.push(ir);
  }
  return out;
}

// The subject class of one selector: owned slot, mapped root or native.
function subjectOf(selector) {
  const subject = selector.compounds.at(-1);
  const slot = subject.attributes.find((a) => a.name === "data-reskin-slot");
  if (slot) return { type: "owned", slot: slot.value };
  if (subject.root || has(POLICY.rootSelectors, subject.element)) return { type: "root" };
  return { type: "native" };
}

// ---------------------------------------------------------------------------------------------
// Values.

// Every node of a value against the allowlists: no Url, Raw, unknown functions, strings outside
// owned empty content, escaped or vendor identifiers, unbounded nesting or non-finite numbers.
function checkNodes(nodes, ctx, loc, depth = 0, { strings = false } = {}) {
  for (const node of nodes) {
    if (ctx.problems.full) return false;
    switch (node.type) {
      case "Identifier": {
        const name = decode(node.name);
        if (!ASCII_IDENT.test(name) || name.startsWith("--")) return ctx.problems.add(`${JSON.stringify(name)} is not an allowed keyword`, node.loc ?? loc), false;
        if (/^-(?:webkit|moz|ms|o)-/i.test(name)) return ctx.problems.add(`Vendor keyword ${name} is not allowed`, node.loc ?? loc), false;
        if (CSS_WIDE.includes(name.toLowerCase())) return ctx.problems.add(`${name.toLowerCase()} is not allowed; a theme sets values, and Reskin decides the cascade`, node.loc ?? loc), false;
        node.name = name.toLowerCase();
        break;
      }
      case "Number":
      case "Percentage":
        if (!Number.isFinite(Number(node.value))) return ctx.problems.add("Numbers must be finite", node.loc ?? loc), false;
        break;
      case "Dimension": {
        const unit = node.unit.toLowerCase();
        if (!has(POLICY.units, unit) || !Number.isFinite(Number(node.value))) return ctx.problems.add(`The unit ${node.unit} is not allowed`, node.loc ?? loc), false;
        node.unit = unit;
        break;
      }
      case "Hash":
        if (![3, 4, 6, 8].includes(node.value.length) || !/^[0-9a-f]+$/i.test(node.value)) return ctx.problems.add(`#${node.value} is not a color`, node.loc ?? loc), false;
        node.value = node.value.toLowerCase();
        break;
      case "Operator":
      case "WhiteSpace":
        break;
      case "String":
        if (!strings || node.value !== "") return ctx.problems.add("Strings are not allowed here; CSS cannot add text, fonts or resources", node.loc ?? loc), false;
        break;
      case "Parentheses":
        if (!checkNodes(children(node), ctx, loc, depth + 1)) return false;
        break;
      case "Function": {
        const name = lower(node.name);
        node.name = name;
        if (has(POLICY.resourceFunctions, name)) return ctx.problems.add(`${name}() can load or reveal outside data and is not allowed`, node.loc ?? loc), false;
        if (!has(POLICY.functions, name)) return ctx.problems.add(`${name}() is not an allowed function`, node.loc ?? loc), false;
        if (depth + 1 > L.nesting) return ctx.problems.add(`Functions nest at most ${L.nesting} levels`, node.loc ?? loc), false;
        if (name === "var") {
          if (!checkVariable(node, ctx, loc, depth)) return false;
          break;
        }
        if (!checkNodes(children(node), ctx, loc, depth + 1)) return false;
        break;
      }
      case "Url":
        return ctx.problems.add("url() is not allowed: themes carry images only in structured fields", node.loc ?? loc), false;
      case "Raw":
        return ctx.problems.add("This value could not be read as CSS", node.loc ?? loc), false;
      default:
        return ctx.problems.add(`This value part (${node.type}) is not allowed`, node.loc ?? loc), false;
    }
  }
  return true;
}

// var(--reskin-*) from the audited registry, or a theme-local --theme-* declared in this CSS. A
// fallback must pass the same checks, used or not; it is removed from the output. Theme-local
// names a fallback uses are recorded in ctx.fallbackRefs, so they are checked as dependencies,
// and each use checks its fallbacks against the property (withFallbacks).
function checkVariable(node, ctx, loc, depth) {
  const parts = children(node);
  const name = decode(parts[0]?.name ?? "");
  if (parts[0]?.type !== "Identifier" || !name.startsWith("--")) return ctx.problems.add("var() needs a variable name", node.loc ?? loc), false;
  parts[0].name = name;
  if (!Object.hasOwn(POLICY.variables, name) && !THEME_VARIABLE.test(name)) {
    return ctx.problems.add(`${name} is not an audited Reskin variable or a --theme-* variable`, node.loc ?? loc), false;
  }
  const rest = parts.slice(1).filter((n) => n.type !== "WhiteSpace");
  if (rest.length) {
    if (rest[0].type !== "Operator" || rest[0].value.trim() !== ",") return ctx.problems.add("var() takes a name and an optional fallback", node.loc ?? loc), false;
    const fallback = rest.slice(1).flatMap((n) => (n.type === "Value" ? children(n) : [n]));
    if (!fallback.length || !checkNodes(fallback, ctx, loc, depth + 1)) return ctx.problems.full || ctx.problems.list.length || ctx.problems.add("This var() fallback is not an allowed value", node.loc ?? loc), false;
    for (const ref of variablesIn(fallback)) if (THEME_VARIABLE.test(ref)) ctx.fallbackRefs?.push(ref);
  }
  // The host always defines its variables, so a validated fallback never applies.
  node.children = new csstree.List().fromArray([parts[0]]);
  return true;
}

// A copy of a value with audited variables replaced by values of their declared kind, for the lexer.
function standIns(value) {
  const copy = csstree.clone(value);
  csstree.walk(copy, {
    visit: "Function",
    enter(node, item, list) {
      if (!isVariable(node) || !list) return;
      const kind = POLICY.variables[variableName(node)];
      const stand = kind === "color" ? { type: "Hash", value: "000000" } : kind === "font" ? { type: "Identifier", name: "serif" } : { type: "Dimension", value: "0", unit: "px" };
      list.replace(item, list.createItem(stand));
    },
  });
  return copy;
}

const lexerMatches = (property, value) => Boolean(css().lexer.matchProperty(property, standIns(value)).matched);

// One expanded theme-local value: an audited variable, a valid color, or a finite number, length
// or percentage, including bounded math.
function scalarValue(node) {
  if (isVariable(node)) return Object.hasOwn(POLICY.variables, variableName(node));
  if (node.type === "Number" || node.type === "Percentage" || node.type === "Dimension") return true;
  if (node.type === "Function" && MATH.includes(lower(node.name))) return quantity(node) !== null;
  if (node.type === "Function" && COLOR_FUNCTIONS.includes(lower(node.name))) {
    const value = { type: "Value", children: new csstree.List().fromArray([node]) };
    return finiteMath([node]) && Boolean(css().lexer.matchType("color", standIns(value)).matched);
  }
  return node.type !== "Function" && isColor(node);
}

const PX = (lo, hi) => ({ px: [lo, hi] });

// box-shadow and text-shadow, as complete lists after cascade-free expansion.
function checkShadows(property, nodes, ctx, loc, subjects) {
  const entries = split(nodes);
  const text = property === "text-shadow";
  if (entries.length > L.shadowEntries) return ctx.problems.add(`A shadow list has at most ${L.shadowEntries} entries`, loc), null;
  let blurSum = 0;
  let blurred = false;
  for (const entry of entries) {
    if (entry.length === 1 && entry[0].type === "Identifier" && entry[0].name === "none" && entries.length === 1) return { blur: false };
    const inset = entry.some((n) => n.type === "Identifier" && n.name === "inset");
    const color = entry.find(isColor);
    const lengths = entry.filter((n) => n !== color && !(n.type === "Identifier" && n.name === "inset"));
    if (!color) return ctx.problems.add("Each shadow names its color", loc), null;
    if (lengths.length < 2 || lengths.length > (text ? 3 : 4)) return ctx.problems.add("A shadow has two offsets, a blur and, for box shadows, a spread", loc), null;
    const [x, y, blur, spread] = lengths.map(quantity);
    const px = (q, lo, hi) => q && q.unit === "px" && q.min >= lo && q.max <= hi;
    const zero = (q) => !q || (q.min === 0 && q.max === 0 && (q.unit === "px" || q.unit === ""));
    const asPx = (q) => (q && q.unit === "" && q.min === 0 && q.max === 0 ? { ...q, unit: "px" } : q);
    const [X, Y, B, S] = [x, y, blur, spread].map(asPx);
    if (!px(X, -L.shadowOffset, L.shadowOffset) || !px(Y, -L.shadowOffset, L.shadowOffset)) return ctx.problems.add(`Shadow offsets stay within ${L.shadowOffset}px`, loc), null;
    // A supplied blur or spread must be proved in range; only an omitted one is zero. A variable
    // has no proved range here (--reskin-radius reaches 999px).
    if (lengths.length > 2 && !px(B, 0, L.shadowBlur)) return ctx.problems.add(`Shadow blur stays within 0-${L.shadowBlur}px`, loc), null;
    if (lengths.length > 3 && !px(S, L.shadowSpreadMin, L.shadowSpreadMax)) return ctx.problems.add(`Shadow spread stays within ${L.shadowSpreadMin} to ${L.shadowSpreadMax}px`, loc), null;
    const a = alpha(color);
    if (a === null) return ctx.problems.add("This shadow color's opacity cannot be checked", loc), null;
    const blurPx = B ? B.max : 0;
    blurSum += blurPx;
    if (blurPx > 0) blurred = true;
    if (text) {
      if (a > L.textShadowAlpha) return ctx.problems.add(`Text shadows stay at or below ${L.textShadowAlpha} opacity`, loc), null;
      continue;
    }
    if (subjects.native || subjects.root) {
      if (inset) return ctx.problems.add("Inset shadows are not allowed on GitHub's own elements", loc), null;
      const crisp = zero(blur) && zero(spread) && Math.max(Math.abs(X.min), Math.abs(X.max)) <= L.crispOffset && Math.max(Math.abs(Y.min), Math.abs(Y.max)) <= L.crispOffset;
      if (!crisp && a > L.nativeShadowAlpha) return ctx.problems.add(`Shadows on GitHub's own elements stay at or below ${L.nativeShadowAlpha} opacity, except a crisp rule with no blur or spread and at most ${L.crispOffset}px offset`, loc), null;
    }
  }
  if (blurSum > L.shadowBlurSum) return ctx.problems.add(`A shadow list blurs at most ${L.shadowBlurSum}px in total`, loc), null;
  return { blur: blurred };
}

// One gradient constructor: 2-8 color-stop entries, at most two positions each, no interpolation
// hints, bounded positions, angles, radial geometry and repeating periods.
function checkGradient(fn, ctx, loc) {
  const name = lower(fn.name);
  if (!POLICY.gradients.includes(name)) return ctx.problems.add(`${name}() is not a gradient`, loc), false;
  const args = split(children(fn));
  const radial = name.includes("radial");
  let first = 0;
  if (args[0] && !args[0].some(isColor)) {
    first = 1;
    const config = args[0];
    if (!radial) {
      if (config.length === 1 && config[0].type === "Dimension") {
        if (!inRange(config[0], { deg: [0, 360] })) return ctx.problems.add("Gradient angles stay within 0-360deg", loc), false;
      } else if (!(config[0]?.type === "Identifier" && config[0].name === "to" && config.slice(1).every((n) => n.type === "Identifier"))) {
        return ctx.problems.add("A linear gradient starts with an angle or to <side>", loc), false;
      }
    } else {
      const at = config.findIndex((n) => n.type === "Identifier" && n.name === "at");
      const size = at >= 0 ? config.slice(0, at) : config;
      const center = at >= 0 ? config.slice(at + 1) : [];
      for (const node of size) {
        if (node.type === "Identifier") continue;
        const q = quantity(node);
        if (!(q && q.min > 0 && inRange(node, { px: [0, L.radialSizePx], "%": [0, L.radialSizePercent] }))) return ctx.problems.add(`Radial gradient sizes are above 0 and at most ${L.radialSizePx}px or ${L.radialSizePercent}%`, loc), false;
      }
      for (const node of center) {
        if (node.type === "Identifier") continue;
        if (!inRange(node, { px: [-L.gradientPositionPx, L.gradientPositionPx], "%": [-L.gradientPositionPercent, L.gradientPositionPercent] })) return ctx.problems.add(`Radial gradient centers stay within -${L.gradientPositionPercent}..${L.gradientPositionPercent}%`, loc), false;
      }
    }
  }
  const stops = args.slice(first);
  if (stops.length < 2 || stops.length > L.stops) return ctx.problems.add(`A gradient has 2-${L.stops} color stops`, loc), false;
  const positions = [];
  for (const stop of stops) {
    const colors = stop.filter(isColor);
    const rest = stop.filter((n) => !isColor(n));
    if (colors.length !== 1) return ctx.problems.add("Each gradient stop is one color with up to two positions; interpolation hints are not allowed", loc), false;
    if (rest.length > L.positionsPerStop) return ctx.problems.add(`A color stop has at most ${L.positionsPerStop} positions`, loc), false;
    for (const node of rest) {
      if (!inRange(node, { px: [-L.gradientPositionPx, L.gradientPositionPx], "%": [-L.gradientPositionPercent, L.gradientPositionPercent] })) return ctx.problems.add(`Gradient positions stay within ±${L.gradientPositionPx}px or ±${L.gradientPositionPercent}%`, loc), false;
      positions.push(quantity(node));
    }
  }
  // Positions never go backwards. A bare 0 compares with either unit; px and % cannot be ordered
  // without the box size, so one gradient uses one of them.
  const units = new Set(positions.filter((q) => !(q.unit === "" && q.min === 0 && q.max === 0)).map((q) => q.unit));
  if (units.size > 1) return ctx.problems.add("Gradient positions use one unit, px or %, so their order can be checked", loc), false;
  if (positions.some((q, i) => i > 0 && q.min < positions[i - 1].max)) return ctx.problems.add("Gradient stop positions must not go backwards", loc), false;
  if (name.startsWith("repeating-")) {
    const lastStop = stops.at(-1).filter((n) => !isColor(n));
    const firstStop = stops[0].filter((n) => !isColor(n));
    const start = firstStop.length ? quantity(firstStop[0]) : { min: 0, max: 0, unit: "px" };
    const end = lastStop.length ? quantity(lastStop.at(-1)) : null;
    const unit = (q) => (q && q.unit === "" && q.min === 0 ? "px" : q?.unit);
    if (!end || unit(start) !== "px" || unit(end) !== "px" || positions.some((q) => unit(q) !== "px")) return ctx.problems.add("A repeating gradient sets every position in px", loc), false;
    const period = end.max - start.min;
    if (period < L.repeatingPeriodMinPx || period > L.repeatingPeriodMaxPx) return ctx.problems.add(`A repeating gradient repeats every ${L.repeatingPeriodMinPx}-${L.repeatingPeriodMaxPx}px`, loc), false;
  }
  return true;
}

// Background image lists: none, or up to four gradients. The background-* list properties share
// the same four-layer ceiling.
function checkBackground(property, nodes, ctx, loc) {
  const layers = split(nodes);
  if (layers.length > L.layers) return ctx.problems.add(`A background has at most ${L.layers} layers, structured and CSS together`, loc), null;
  if (property === "background-image") {
    if (layers.length === 1 && layers[0].length === 1 && layers[0][0].type === "Identifier" && layers[0][0].name === "none") return 0;
    for (const layer of layers) {
      if (layer.length !== 1 || layer[0].type !== "Function" || !POLICY.gradients.includes(lower(layer[0].name))) return ctx.problems.add("Background images are gradients only; images belong in the structured backgrounds", loc), null;
      if (!checkGradient(layer[0], ctx, loc)) return null;
    }
    return layers.length;
  }
  const ranges =
    property === "background-size"
      ? { px: [0, L.backgroundSizePx], "%": [0, L.backgroundSizePercent], vw: [0, L.backgroundSizePercent], vh: [0, L.backgroundSizePercent] }
      : { px: [-L.backgroundPositionPx, L.backgroundPositionPx], "%": [-L.backgroundPositionPercent, L.backgroundPositionPercent] };
  for (const layer of layers) {
    for (const node of layer) {
      if (node.type === "Identifier") continue;
      if (property === "background-repeat" || !inRange(node, ranges)) return ctx.problems.add(`${property} values are out of bounds`, loc), null;
    }
  }
  return layers.length;
}

// Numeric bounds for every other allowed property, applied to each numeric leaf.
const BOUNDS = {
  "border-width": PX(0, 4),
  "stroke-width": { px: [0, 4], "": [0, 4] },
  "letter-spacing": { em: [-0.02, 0.2] },
  padding: PX(0, 32),
  margin: PX(-32, 32),
  width: { px: [0, 360], "%": [0, 100] },
  "max-width": { px: [0, 360], "%": [0, 100] },
  height: { px: [0, 96], "%": [0, 100] },
  "max-height": { px: [0, 96], "%": [0, 100] },
  "font-size": { px: [1, 64] },
  "line-height": { "": [1.1, 3] },
  opacity: { "": [0, 1], "%": [0, 100] },
  top: { "%": [0, 100] },
  right: { "%": [0, 100] },
  bottom: { "%": [0, 100] },
  left: { "%": [0, 100] },
  border: PX(0, 4),
};
for (const corner of ["", "-top-left", "-top-right", "-bottom-left", "-bottom-right"]) BOUNDS[`border${corner}-radius`] = { px: [0, 999], "%": [0, 50] };
const KEYWORDS = {
  "border-style": ["none", "solid", "dashed", "double"],
  "border-width": ["thin", "medium"],
  border: ["none", "solid", "dashed", "double"],
  "text-transform": ["none", "uppercase"],
  "font-weight": ["normal", "bold"],
  "scrollbar-width": ["auto", "thin"],
  position: ["absolute"],
  content: ["none"],
  "line-height": ["normal"],
  "letter-spacing": ["normal"],
};

// Keywords the lexer accepts are fine unless the property lists its own; numbers must sit in range.
function checkBounded(property, nodes, ctx, loc) {
  const keywords = KEYWORDS[property];
  const bounds = BOUNDS[property];
  for (const node of nodes) {
    if (node.type === "Operator" || node.type === "WhiteSpace" || isColor(node)) continue;
    if (node.type === "Identifier") {
      if (keywords && !keywords.includes(node.name)) return ctx.problems.add(`${node.name} is not allowed for ${property}`, loc), false;
      continue;
    }
    if (property === "font-weight") {
      if (!(node.type === "Number" && [400, 500, 600, 700].includes(Number(node.value)))) return ctx.problems.add("font-weight is 400, 500, 600 or 700", loc), false;
      continue;
    }
    if (property === "transform") continue;
    if (isVariable(node) && POLICY.variables[variableName(node)] === "length" && property.includes("radius")) continue;
    if (bounds && !inRange(node, bounds)) return ctx.problems.add(`This ${property} value is outside its allowed range`, loc), false;
    if (!bounds) return ctx.problems.add(`${property} takes no numbers here`, loc), false;
  }
  return true;
}

// The bounds apply to the whole transform: at most one translation, then at most one rotation.
// Translating first keeps the movement in page axes, so each axis moves at most 8px.
function checkTransform(nodes, ctx, loc) {
  const seen = [];
  for (const node of nodes) {
    if (node.type !== "Function") return ctx.problems.add("transform takes rotate() and translate() only", loc), false;
    const args = split(children(node)).map((group) => group[0]);
    const name = node.name;
    const kind = name === "rotate" ? "rotate" : ["translate", "translatex", "translatey"].includes(name) ? "translate" : null;
    if (!kind) return ctx.problems.add(`${name}() is not an allowed transform`, loc), false;
    if (seen.includes(kind)) return ctx.problems.add(`A decoration transform has one ${kind === "rotate" ? "rotation" : "translation"}; together they would pass the 8px and 8deg limits`, loc), false;
    if (kind === "translate" && seen.includes("rotate")) return ctx.problems.add("A decoration transform translates before it rotates, so the rotation cannot turn the movement past 8px on an axis", loc), false;
    seen.push(kind);
    if (kind === "rotate") {
      if (args.length !== 1 || !inRange(args[0], { deg: [-8, 8] })) return ctx.problems.add("A decoration rotates at most 8deg", loc), false;
    } else if (args.length < 1 || args.length > (name === "translate" ? 2 : 1) || !args.every((a) => inRange(a, { px: [-8, 8] }))) return ctx.problems.add("A decoration moves at most 8px", loc), false;
  }
  return true;
}

// The origin stays at the box's center, the default for these HTML decorations, so a rotation
// turns the box in place and only the translation moves it.
function checkOrigin(nodes, ctx, loc) {
  const parts = nodes.filter((n) => n.type !== "WhiteSpace");
  const center = (n) => (n.type === "Identifier" && n.name === "center") || (n.type !== "Identifier" && inRange(n, { "%": [50, 50] }));
  const zero = (n) => n.type !== "Identifier" && inRange(n, { px: [0, 0] });
  if (!parts.length || parts.length > 3 || !parts.slice(0, 2).every(center) || (parts[2] && !zero(parts[2]))) {
    return ctx.problems.add("transform-origin stays at the center (center or 50% 50%), so a rotation cannot move a decoration", loc), false;
  }
  return true;
}

function checkFontFamily(nodes, ctx, loc) {
  for (const group of split(nodes)) {
    const [node] = group;
    const ok = group.length === 1 && ((isVariable(node) && POLICY.variables[variableName(node)] === "font") || (node.type === "Identifier" && has(POLICY.genericFamilies, node.name)));
    if (!ok) return ctx.problems.add("font-family uses --reskin-font-heading, --reskin-font-body or a generic native family; themes cannot request other fonts", loc), false;
  }
  return true;
}

// The property policy and value rules for one declaration, after theme-local substitution.
function checkDeclaration(decl, ctx, subjects) {
  const { property } = decl;
  const loc = decl.loc;
  const nodes = children(decl.value);
  const owned = subjects.owned && !subjects.native && !subjects.root;
  const allowed = has(POLICY.nativeProperties, property) || (owned && has(POLICY.ownedProperties, property)) || (owned && subjects.corner && has(POLICY.cornerProperties, property));
  if (!allowed) {
    const why = has(POLICY.ownedProperties, property) || has(POLICY.cornerProperties, property) ? `${property} is allowed only on an exact Reskin decoration` : `${property} is not an allowed property`;
    return ctx.problems.add(why, loc), null;
  }
  if (!nodes.length) return ctx.problems.add(`${property} has no value`, loc), null;
  if (!checkNodes(nodes, ctx, loc, 0, { strings: property === "content" })) return null;
  if (!lexerMatches(property, decl.value)) return ctx.problems.add(`This is not a valid ${property} value`, loc), null;
  if (!finiteMath(nodes)) return ctx.problems.add(`The math in this ${property} value cannot be checked for a finite range: use one unit and no variables inside calc(), min(), max() or clamp()`, loc), null;
  const info = { blur: false, layers: 0 };
  if (property === "box-shadow" || property === "text-shadow") {
    const shadows = checkShadows(property, nodes, ctx, loc, subjects);
    if (!shadows) return null;
    info.blur = shadows.blur;
  } else if (property.startsWith("background-") && property !== "background-color") {
    const layers = checkBackground(property, nodes, ctx, loc);
    if (layers === null) return null;
    info.layers = layers;
  } else if (property === "font-family") {
    if (!checkFontFamily(nodes, ctx, loc)) return null;
  } else if (property === "transform") {
    if (!checkTransform(nodes, ctx, loc)) return null;
  } else if (property === "transform-origin") {
    if (!checkOrigin(nodes, ctx, loc)) return null;
  } else if (property === "content") {
    if (!(nodes.length === 1 && ((nodes[0].type === "String" && nodes[0].value === "") || (nodes[0].type === "Identifier" && nodes[0].name === "none")))) {
      return ctx.problems.add('content is only "" on a decoration; CSS cannot add text', loc), null;
    }
  } else if (!has(POLICY.colorProperties, property) && property !== "corner-shape") {
    if (!checkBounded(property, nodes, ctx, loc)) return null;
  }
  return info;
}

// ---------------------------------------------------------------------------------------------
// Stylesheet walk.

function countNodes(ast, limit) {
  let count = 0;
  csstree.walk(ast, () => {
    count++;
    if (count > limit) return csstree.walk.break;
  });
  return count;
}

// Collects rules with their @media chain, validating at-rules and selectors.
function collectRules(list, ctx, media, depth) {
  for (const node of children(list)) {
    if (ctx.problems.full) return;
    if (node.type === "Rule") {
      ctx.rules++;
      if (ctx.rules > L.rules) return ctx.problems.add(`A theme has at most ${L.rules} rules`, node.loc);
      ctx.state = false;
      const selectors = selectorListIr(node.prelude, ctx, 0);
      const state = ctx.state;
      if (!selectors) continue;
      const declarations = [];
      for (const item of children(node.block)) {
        if (item.type === "Rule" || item.type === "Atrule") {
          ctx.problems.add("CSS nesting is not available in this version of Reskin", item.loc);
          continue;
        }
        if (item.type !== "Declaration") {
          ctx.problems.add("This part of the rule could not be read as a declaration", item.loc);
          continue;
        }
        ctx.declarations++;
        if (ctx.declarations > L.declarations) return ctx.problems.add(`A theme has at most ${L.declarations} declarations`, item.loc);
        declarations.push(item);
      }
      ctx.list.push({ node, media, selectors, state, declarations });
    } else if (node.type === "Atrule") {
      const name = lower(node.name);
      node.name = name;
      if (has(POLICY.deferredAtRules, name)) {
        ctx.problems.add(`@${name} is not available in this version of Reskin`, node.loc);
        continue;
      }
      if (!has(POLICY.atRules, name)) {
        ctx.problems.add(`@${name} is not allowed; themes cannot import, register fonts or properties, or change stylesheet order`, node.loc);
        continue;
      }
      if (depth + 1 > L.nesting) return ctx.problems.add(`At-rules nest at most ${L.nesting} levels`, node.loc);
      if (!node.block || !checkMedia(node, ctx)) continue;
      collectRules(node.block, ctx, [...media, css().generate(node.prelude)], depth + 1);
    } else if (node.type === "Comment") {
      continue;
    } else ctx.problems.add(`This stylesheet part (${node.type}) is not allowed`, node.loc);
  }
}

// @media over prefers-reduced-motion, hover, pointer and min/max-width, joined by "and" only.
function checkMedia(node, ctx) {
  const queries = children(node.prelude).flatMap((n) => (n.type === "MediaQueryList" ? children(n) : [n]));
  if (!queries.length) return ctx.problems.add("@media needs a condition", node.loc), false;
  for (const query of queries) {
    if (query.type !== "MediaQuery" || query.modifier) return ctx.problems.add("This media query is not allowed", node.loc), false;
    if (query.mediaType && !has(POLICY.mediaTypes, lower(query.mediaType))) return ctx.problems.add(`Media type ${query.mediaType} is not allowed`, node.loc), false;
    const parts = query.condition ? children(query.condition) : [];
    if (!query.condition && !query.mediaType) return ctx.problems.add("This media query is empty", node.loc), false;
    for (const [i, part] of parts.entries()) {
      if (i % 2 === 1) {
        if (!(part.type === "Identifier" && lower(part.name) === "and")) return ctx.problems.add("Media conditions are joined with and only", node.loc), false;
        continue;
      }
      if (part.type !== "Feature") return ctx.problems.add("Media conditions are simple (feature: value) tests", node.loc), false;
      const feature = lower(part.name);
      const rule = POLICY.mediaFeatures[feature];
      if (!rule) return ctx.problems.add(`The ${feature} media feature is not allowed`, node.loc), false;
      if (rule === "length") {
        if (!part.value || !inRange(part.value, { px: [0, L.mediaWidthPx], em: [0, L.mediaWidthPx / 16], rem: [0, L.mediaWidthPx / 16] })) return ctx.problems.add(`${feature} needs a width up to ${L.mediaWidthPx}px`, node.loc), false;
      } else if (part.value && !(part.value.type === "Identifier" && rule.includes(lower(part.value.name)))) return ctx.problems.add(`${feature} takes ${rule.join(" or ")}`, node.loc), false;
    }
  }
  return true;
}

// Theme-local variables: one declaration each, outside @media and state rules, at most eight
// dependency edges deep counting fallbacks, acyclic, defined and each a single resource-free
// scalar, used or not. Every declaration is checked and measured before any expansion is built:
// the expanded bytes and syntax nodes of each variable, and of all of them together, follow from
// the dependency graph with saturating counts, so a branching graph fails on its budget without
// allocating its output. Expansions are then built under a running allocation budget as a second
// guard. Returns the expanded value node for each name.
function resolveVariables(ctx, budgets) {
  const declared = new Map();
  for (const rule of ctx.list) {
    for (const decl of rule.declarations) {
      const name = decode(decl.property);
      decl.property = name.startsWith("--") ? name : name.toLowerCase();
      if (!decl.property.startsWith("--")) continue;
      if (Object.hasOwn(POLICY.variables, name) || /^--reskin-/i.test(name)) {
        ctx.problems.add(`Themes cannot redefine ${name}`, decl.loc);
        continue;
      }
      if (!THEME_VARIABLE.test(name)) {
        ctx.problems.add(`${name} is not a --theme-* variable; themes cannot set GitHub or Primer variables`, decl.loc);
        continue;
      }
      if (rule.media.length || rule.state) {
        ctx.problems.add(`${name} cannot change inside @media or a state selector`, decl.loc);
        continue;
      }
      if (declared.has(name)) {
        ctx.problems.add(`${name} is declared more than once`, decl.loc);
        continue;
      }
      if (decl.value.type !== "Value") {
        ctx.problems.add(`${name} could not be read as a value`, decl.loc);
        continue;
      }
      const nodes = children(decl.value).filter((n) => n.type !== "WhiteSpace");
      declared.set(name, { decl, nodes });
    }
  }
  for (const [name, entry] of declared) {
    if (ctx.problems.full) break;
    if (entry.nodes.length !== 1) {
      ctx.problems.add(`${name} holds one value: a color, length, number or audited variable`, entry.decl.loc);
      continue;
    }
    entry.variants = [];
    for (let next = withFallbacks(entry.nodes); next && entry.variants.length <= L.nesting; next = withFallbacks(next)) entry.variants.push(next);
    ctx.fallbackRefs = [];
    const checked = checkNodes(entry.nodes, ctx, entry.decl.loc);
    entry.fallbackRefs = ctx.fallbackRefs;
    ctx.fallbackRefs = undefined;
    if (!checked) continue;
    entry.refs = themeReferences(entry.nodes);
    entry.bytes = css().generate(entry.nodes[0]).length - entry.refs.reduce((sum, ref) => sum + `var(${ref})`.length, 0);
    entry.nodeCount = countNodes(entry.nodes[0], Infinity) - entry.refs.length * 2;
  }
  if (ctx.problems.list.length) return null;

  // Sizes from the graph alone. Counts saturate one past their budget.
  const measured = new Map();
  const visiting = new Set();
  const measure = (name, loc) => {
    if (measured.has(name)) return measured.get(name);
    const entry = declared.get(name);
    if (!entry) return ctx.problems.add(`${name} is used but never declared`, loc), null;
    if (visiting.has(name)) return ctx.problems.add(`${name} depends on itself`, entry.decl.loc), null;
    visiting.add(name);
    let depth = 0;
    for (const ref of [...entry.refs, ...entry.fallbackRefs]) {
      const dependency = measure(ref, entry.decl.loc);
      if (!dependency) return visiting.delete(name), null;
      depth = Math.max(depth, dependency.depth + 1);
    }
    visiting.delete(name);
    if (depth > L.variableEdges) return ctx.problems.add(`${name} depends on more than ${L.variableEdges} other --theme-* variables`, entry.decl.loc), null;
    let bytes = entry.bytes;
    let nodes = entry.nodeCount;
    for (const ref of entry.refs) {
      bytes = Math.min(budgets.sourceBytes + 1, bytes + measured.get(ref).bytes);
      nodes = Math.min(budgets.astNodes + 1, nodes + measured.get(ref).nodes);
    }
    if (bytes > budgets.sourceBytes || nodes > budgets.astNodes) return ctx.problems.add(`${name} expands to more than ${budgets.sourceBytes} UTF-8 bytes or ${budgets.astNodes} syntax nodes`, entry.decl.loc), null;
    const result = { bytes, nodes, depth };
    measured.set(name, result);
    return result;
  };
  let totalBytes = 0;
  let totalNodes = 0;
  for (const [name, entry] of declared) {
    const result = measure(name, entry.decl.loc);
    if (!result) return null;
    totalBytes += result.bytes;
    totalNodes += result.nodes;
    if (totalBytes > budgets.sourceBytes || totalNodes > budgets.astNodes) {
      return ctx.problems.add(`Theme-local variables expand to more than ${budgets.sourceBytes} UTF-8 bytes or ${budgets.astNodes} syntax nodes together`, entry.decl.loc), null;
    }
  }

  const expanded = new Map();
  const lengthOf = new Map();
  // The values a variable could take through any one of its fallbacks, its own or a dependency's,
  // so each use checks them against its property. Built once per variable under their own budget.
  const alternativesOf = new Map();
  let allocated = 0;
  let alternativeBytes = 0;
  const build = (name) => {
    if (expanded.has(name)) return expanded.get(name);
    const entry = declared.get(name);
    allocated += measured.get(name).bytes;
    if (allocated > budgets.sourceBytes) return ctx.problems.add(`Theme-local variables expand to more than ${budgets.sourceBytes} UTF-8 bytes together`, entry.decl.loc), null;
    const forms = [entry.nodes.map((n) => csstree.clone(n)), ...entry.variants.map((variant) => variant.map((n) => csstree.clone(n)))];
    const holder = [csstree.clone(entry.nodes[0])];
    if (!substitute(holder, build)) return null;
    const [node] = holder;
    if (!scalarValue(node)) return ctx.problems.add(`${name} is not a valid color, a finite length or number, or an audited variable`, entry.decl.loc), null;
    // Its fallbacks are scalars too, counted against the same allocation budget.
    for (const variant of entry.variants) {
      const substituted = substitute(variant, (ref) => {
        allocated += measured.get(ref)?.bytes ?? 0;
        return allocated > budgets.sourceBytes ? null : build(ref);
      });
      if (allocated > budgets.sourceBytes) return ctx.problems.add(`Theme-local variables expand to more than ${budgets.sourceBytes} UTF-8 bytes together`, entry.decl.loc), null;
      if (!substituted) return null;
      const values = variant.filter((n) => n.type !== "WhiteSpace");
      if (values.length !== 1 || !scalarValue(values[0])) return ctx.problems.add(`A var() fallback in ${name} is not a valid color, a finite length or number, or an audited variable`, entry.decl.loc), null;
    }
    // Each own fallback, then each form with one dependency taking one of its alternatives.
    const alternatives = [];
    const seen = new Set([css().generate(node)]);
    const admit = (candidate) => {
      const values = candidate.filter((n) => n.type !== "WhiteSpace");
      const text = values.length === 1 ? css().generate(values[0]) : "";
      alternativeBytes += text.length;
      if (alternativeBytes > budgets.sourceBytes) return ctx.problems.add(`The var() fallbacks of theme-local variables expand to more than ${budgets.sourceBytes} UTF-8 bytes`, entry.decl.loc), false;
      if (values.length !== 1 || !scalarValue(values[0])) return ctx.problems.add(`A var() fallback in ${name} is not a valid color, a finite length or number, or an audited variable`, entry.decl.loc), false;
      if (!seen.has(text)) seen.add(text), alternatives.push({ node: values[0], length: text.length });
      return true;
    };
    for (const variant of entry.variants) if (!admit(variant)) return null;
    for (const form of forms) {
      const ok = eachDeviation(form, build, (ref) => alternativesOf.get(ref), admit);
      if (!ok) return null;
    }
    expanded.set(name, node);
    lengthOf.set(name, css().generate(node).length);
    alternativesOf.set(name, alternatives);
    return node;
  };
  for (const name of declared.keys()) if (!build(name)) return null;
  const expand = (name, loc) => expanded.get(name) ?? (ctx.problems.add(`${name} is used but never declared`, loc), null);
  return { lengthOf, expand, alternatives: (name) => alternativesOf.get(name) ?? [] };
}

// Calls visit(copy) for each copy of nodes in which exactly one var(--theme-*) takes one of its
// alternatives and every other takes its expansion. Stops with false when a lookup or visit fails.
function eachDeviation(nodes, expand, alternatives, visit) {
  const refs = [];
  if (!substitute(nodes.map((n) => csstree.clone(n)), (ref) => (refs.push(ref), expand(ref)))) return false;
  for (const [index, ref] of refs.entries()) {
    for (const alternative of alternatives(ref)) {
      let at = 0;
      const copy = nodes.map((n) => csstree.clone(n));
      if (!substitute(copy, (name) => (at++ === index ? alternative.node : expand(name)))) return false;
      if (!visit(copy, alternative)) return false;
    }
  }
  return true;
}

// Every var(--theme-*) reference in the nodes, once per occurrence.
function themeReferences(nodes, out = []) {
  for (const node of nodes) {
    if (isVariable(node)) {
      if (THEME_VARIABLE.test(variableName(node))) out.push(variableName(node));
    } else if (node.children) themeReferences(children(node), out);
  }
  return out;
}

// The value with every outermost var() that has a fallback replaced by that fallback, as copies,
// or null when none has one. Applied again, it reaches each nested fallback in turn.
function withFallbacks(nodes) {
  let changed = false;
  const visit = (list) => {
    list.forEach((node, item) => {
      if (isVariable(node)) {
        const parts = children(node);
        const comma = parts.findIndex((n) => n.type === "Operator" && n.value.trim() === ",");
        if (comma < 0) return;
        changed = true;
        list.replace(item, new csstree.List().fromArray(parts.slice(comma + 1).flatMap((n) => (n.type === "Value" ? children(n) : [n]))));
      } else if (node.children) visit(node.children);
    });
  };
  const wrapper = new csstree.List().fromArray(nodes.map((node) => csstree.clone(node)));
  visit(wrapper);
  return changed ? wrapper.toArray() : null;
}

// Replaces var(--theme-*) inside nodes using lookup(name), which returns the expanded node.
function substitute(nodes, lookup) {
  let ok = true;
  const visit = (list) => {
    if (!list) return;
    list.forEach((node, item) => {
      if (!ok) return;
      if (isVariable(node) && THEME_VARIABLE.test(variableName(node))) {
        const value = lookup(variableName(node));
        if (!value) return void (ok = false);
        list.replace(item, list.createItem(csstree.clone(value)));
      } else if (node.children) visit(node.children);
    });
  };
  const wrapper = new csstree.List().fromArray(nodes);
  visit(wrapper);
  const result = wrapper.toArray();
  nodes.splice(0, nodes.length, ...result);
  return ok;
}

function validateStylesheet(source, path, budgets) {
  const problems = new Problems(source, path);
  const notes = [];
  if (typeof source !== "string") return { problems: [{ code: ISSUE_CODES.css, path, message: "Advanced CSS must be text.", severity: "error" }] };
  if (source.length > budgets.sourceBytes || utf8Bytes(source) > budgets.sourceBytes) {
    problems.add(`Advanced CSS is at most ${budgets.sourceBytes} UTF-8 bytes`);
    return { problems: problems.list };
  }
  const control = CONTROL.exec(source);
  if (control) {
    problems.add("Advanced CSS cannot contain control or text-direction characters", lineColumn(source, control.index));
    return { problems: problems.list };
  }
  tokenProblems(source, problems);
  if (problems.list.length) return { problems: problems.list };
  let ast;
  try {
    ast = css().parse(source, {
      context: "stylesheet",
      positions: true,
      parseCustomProperty: true,
      onParseError: (error) => problems.add(`This could not be read as CSS: ${error.message}`, error.line ? { start: { line: error.line, column: error.column } } : undefined),
    });
  } catch (error) {
    problems.add(`This could not be read as CSS: ${error.message}`);
    return { problems: problems.list };
  }
  if (problems.list.length) return { problems: problems.list };
  if (countNodes(ast, budgets.astNodes) > budgets.astNodes) {
    problems.add(`Advanced CSS has at most ${budgets.astNodes} syntax nodes`);
    return { problems: problems.list };
  }

  const ctx = { problems, list: [], rules: 0, selectors: 0, declarations: 0, state: false };
  collectRules(ast, ctx, [], 0);
  if (problems.list.length) return { problems: problems.list };
  const variables = resolveVariables(ctx, budgets);
  if (problems.list.length) return { problems: problems.list };

  // Substitute theme-local variables into each declaration, keeping a running size so repeated
  // references stop before the output can pass the byte budget. Fallback variants count against
  // their own budget of the same size.
  let size = 0;
  let work = 0;
  const rules = [];
  for (const rule of ctx.list) {
    const subjects = { owned: false, native: false, root: false, corner: true };
    for (const selector of rule.selectors) {
      const subject = subjectOf(selector);
      subjects[subject.type] = true;
      if (subject.type !== "owned" || !has(POLICY.cornerSlots, subject.slot)) subjects.corner = false;
    }
    const kept = [];
    const declarations = [];
    for (const decl of rule.declarations) {
      if (problems.full) break;
      if (decl.important === true) {
        notes.push({ code: "css-important", path, message: `Removed !important from ${decl.property}; Reskin decides the cascade.`, severity: "info" });
        decl.important = false;
      } else if (decl.important) {
        problems.add("This declaration has an unknown ! flag", decl.loc);
        continue;
      }
      if (decl.property.startsWith("--")) continue;
      if (decl.value.type !== "Value") {
        problems.add(`${decl.property} could not be read as a value`, decl.loc);
        continue;
      }
      const nodes = children(decl.value);
      // Each var() fallback is checked against this property too, though it never applies,
      // including those inside the theme-local variables it uses.
      const variants = [];
      for (let next = withFallbacks(nodes); next && variants.length <= L.nesting; next = withFallbacks(next)) variants.push(next);
      const forms = [nodes.map((n) => csstree.clone(n)), ...variants.map((variant) => variant.map((n) => csstree.clone(n)))];
      const ok = substitute(nodes, (name) => {
        const value = variables.expand(name, decl.loc);
        if (value) size += variables.lengthOf.get(name);
        return size > budgets.sourceBytes ? null : value;
      });
      if (size > budgets.sourceBytes) {
        problems.add(`Advanced CSS expands to more than ${budgets.sourceBytes} UTF-8 bytes`, decl.loc);
        break;
      }
      if (!ok) continue;
      decl.value.children = new csstree.List().fromArray(nodes);
      const info = checkDeclaration(decl, ctx, subjects);
      if (!info) continue;
      let fallbacksOk = true;
      for (const variant of variants) {
        const substituted = substitute(variant, (name) => {
          const value = variables.expand(name, decl.loc);
          if (value) work += variables.lengthOf.get(name);
          return work > budgets.sourceBytes ? null : value;
        });
        if (work > budgets.sourceBytes) problems.add(`The var() fallbacks in this CSS expand to more than ${budgets.sourceBytes} UTF-8 bytes`, decl.loc);
        const before = problems.list.length;
        const copy = { type: "Declaration", property: decl.property, loc: decl.loc, value: { type: "Value", children: new csstree.List().fromArray(variant) } };
        if (!substituted || !checkDeclaration(copy, ctx, subjects)) {
          for (const problem of problems.list.slice(before)) problem.message = `In a var() fallback: ${problem.message}`;
          fallbacksOk = false;
          break;
        }
      }
      for (const form of fallbacksOk ? forms : []) {
        const expand = (name) => {
          const value = variables.expand(name, decl.loc);
          if (value) work += variables.lengthOf.get(name);
          return work > budgets.sourceBytes ? null : value;
        };
        fallbacksOk = eachDeviation(form, expand, variables.alternatives, (candidate, alternative) => {
          work += alternative.length;
          if (work > budgets.sourceBytes) return false;
          const before = problems.list.length;
          const copy = { type: "Declaration", property: decl.property, loc: decl.loc, value: { type: "Value", children: new csstree.List().fromArray(candidate) } };
          if (checkDeclaration(copy, ctx, subjects)) return true;
          for (const problem of problems.list.slice(before)) problem.message = `In a var() fallback: ${problem.message}`;
          return false;
        });
        if (work > budgets.sourceBytes) problems.add(`The var() fallbacks in this CSS expand to more than ${budgets.sourceBytes} UTF-8 bytes`, decl.loc);
        if (!fallbacksOk) break;
      }
      if (!fallbacksOk) continue;
      kept.push(decl);
      const value = css().generate(decl.value);
      const vars = [...variablesIn(nodes)].sort();
      declarations.push({ property: decl.property, value, variables: vars, literalColor: hasLiteralColor(nodes), blur: info.blur, layers: info.layers });
    }
    rule.node.block.children = new csstree.List().fromArray(kept);
    rules.push({ media: rule.media, selectors: rule.selectors.map(stripRoot), declarations });
  }
  if (problems.list.length) return { problems: problems.list };
  const canonical = css().generate(ast);
  if (utf8Bytes(canonical) > budgets.sourceBytes) {
    problems.add(`Advanced CSS expands to more than ${budgets.sourceBytes} UTF-8 bytes`);
    return { problems: problems.list };
  }
  return { problems: [], canonical, rules, notes };
}

// The IR keeps the root flag only through the subject's element or :root; drop the helper field.
function stripRoot(selector) {
  return {
    compounds: selector.compounds.map(({ root, pseudoClasses, ...rest }) => ({
      ...rest,
      pseudoClasses: [...(root ? [{ name: "root" }] : []), ...pseudoClasses.map((p) => (p.selectors ? { name: p.name, selectors: p.selectors.map(stripRoot) } : p))],
    })),
    combinators: selector.combinators,
  };
}

const DEFAULT_BUDGETS = { sourceBytes: L.sourceBytes, astNodes: L.astNodes };

/**
 * Sanitizes a theme's advanced CSS. `budgets` may only lower the source-byte and AST-node limits,
 * for boundary tests; it can never raise them.
 * @param {string} source
 * @param {{path?: string, budgets?: {sourceBytes?: number, astNodes?: number}}} [options]
 * @returns {import("../../contracts/index.js").CssAdmission}
 */
export function sanitizeCss(source, { path = "/css", budgets = {} } = {}) {
  const limits = { ...DEFAULT_BUDGETS };
  for (const key of Object.keys(DEFAULT_BUDGETS)) if (Number.isInteger(budgets[key]) && budgets[key] >= 0) limits[key] = Math.min(budgets[key], DEFAULT_BUDGETS[key]);
  const first = validateStylesheet(source, path, limits);
  if (first.problems.length) return { ok: false, issues: first.problems };
  // The canonical text must parse back to itself and to the same rule IR.
  const again = validateStylesheet(first.canonical, path, DEFAULT_BUDGETS);
  if (again.problems.length || again.canonical !== first.canonical || JSON.stringify(again.rules) !== JSON.stringify(first.rules) || again.notes.length) {
    return { ok: false, issues: [{ code: ISSUE_CODES.css, path, message: "Reskin could not prove a stable canonical form for this CSS, so it is not used.", severity: "error" }] };
  }
  return {
    ok: true,
    value: {
      css: first.canonical,
      hash: sha256(encoder.encode(first.canonical)),
      bytes: utf8Bytes(first.canonical),
      sanitizerVersion: SANITIZER_VERSION,
      policyHash: POLICY_HASH,
      rules: first.rules,
      notes: first.notes,
    },
  };
}

/**
 * Admits one gradientCss layer: exactly one linear, radial or repeating gradient value and an
 * optional background-size, through the same AST, resource and gradient policy as advanced CSS.
 * @param {{value: string, size?: string}} layer
 * @param {string} path JSON pointer of the gradientCss object
 * @returns {import("../../contracts/index.js").GradientCssAdmission}
 */
export function admitGradientCss(layer, path = "") {
  const problems = new Problems("", `${path}/value`);
  const fail = () => ({ ok: false, issues: problems.list });
  const { value, size } = layer ?? {};
  if (typeof value !== "string" || !value.trim()) return problems.add("A gradientCss layer needs one gradient value"), fail();
  if (utf8Bytes(value) > L.gradientBytes) return problems.add(`A gradientCss value is at most ${L.gradientBytes} UTF-8 bytes`), fail();
  const parse = (text, at) => {
    const local = new Problems(text, at);
    if (CONTROL.test(text)) return local.add("This value cannot contain control or text-direction characters"), { local };
    tokenProblems(text, local);
    if (local.list.length) return { local };
    try {
      const ast = css().parse(text, { context: "value", positions: true, onParseError: (e) => local.add(`This could not be read as one CSS value: ${e.message}`) });
      return { ast, local };
    } catch (error) {
      local.add(`This could not be read as one CSS value: ${error.message}`);
      return { local };
    }
  };
  const ctx = { problems };
  const parsed = parse(value, `${path}/value`);
  if (parsed.local.list.length) return { ok: false, issues: parsed.local.list };
  const nodes = children(parsed.ast);
  if (nodes.length !== 1 || nodes[0].type !== "Function" || !POLICY.gradients.includes(lower(nodes[0].name))) return problems.add("A gradientCss value is exactly one linear, radial or repeating gradient"), fail();
  if (!checkNodes(nodes, ctx) || variablesIn(nodes).size) return problems.list.length || problems.add("A gradientCss value uses literal colors only, no variables"), fail();
  if (!lexerMatches("background-image", parsed.ast) || !checkGradient(nodes[0], ctx)) return problems.list.length || problems.add("This is not a valid gradient"), fail();
  const canonicalValue = css().generate(parsed.ast);
  let canonicalSize = null;
  if (size !== undefined) {
    const sizeProblems = new Problems("", `${path}/size`);
    if (typeof size !== "string" || size.length > L.gradientSizeCharacters) return sizeProblems.add(`A gradientCss size is at most ${L.gradientSizeCharacters} characters`), { ok: false, issues: sizeProblems.list };
    const s = parse(size, `${path}/size`);
    if (s.local.list.length) return { ok: false, issues: s.local.list };
    const sizeCtx = { problems: sizeProblems };
    const sizeNodes = children(s.ast);
    if (!checkNodes(sizeNodes, sizeCtx) || variablesIn(sizeNodes).size || split(sizeNodes).length !== 1 || !lexerMatches("background-size", s.ast) || checkBackground("background-size", sizeNodes, sizeCtx) === null) {
      return sizeProblems.list.length || sizeProblems.add("A gradientCss size is auto or one or two bounded lengths"), { ok: false, issues: sizeProblems.list };
    }
    if (sizeNodes.some((n) => n.type === "Identifier" && n.name !== "auto")) return sizeProblems.add("A gradientCss size is auto or one or two bounded lengths"), { ok: false, issues: sizeProblems.list };
    canonicalSize = css().generate(s.ast);
  }
  return { ok: true, value: canonicalValue, size: canonicalSize };
}

/**
 * Proves that transport-escaped CSS decodes to exactly the same allowed AST as the canonical CSS.
 * The consent hash is always taken from the canonical text before escaping.
 */
export function transportEquivalent(canonical, escaped) {
  const plain = (text) => {
    try {
      const ast = css().parse(text, { context: "stylesheet", parseCustomProperty: true });
      return JSON.stringify(csstree.toPlainObject(ast));
    } catch {
      return null;
    }
  };
  const a = plain(canonical);
  return a !== null && a === plain(escaped);
}
