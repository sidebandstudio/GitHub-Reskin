// A small CSS parser for the frozen GitHub mode stylesheets, following the CSS Syntax tokenizing
// rules that matter there: comments, quoted strings, escapes and nested (), [] and {} blocks.
// It returns qualified rules and at-rules with their blocks; declarations keep their raw values.
// A style rule nested in another, as the compiler writes for Gecko, follows its parent with `&`
// resolved to :is(parent). Pure: no DOM, no browser parser. Used only by the offline generator
// and checks.

/**
 * @typedef {{name:string, value:string, important:boolean}} Declaration
 * @typedef {{type:'rule', prelude:string, selectors:string[], declarations:Declaration[]}
 *   | {type:'at', name:string, prelude:string, rules:Rule[]|null}} Rule
 */

/** Removes comments outside strings and returns the remaining text. */
function stripComments(css) {
  let out = "";
  for (let i = 0; i < css.length; ) {
    const c = css[i];
    if (c === "/" && css[i + 1] === "*") {
      const end = css.indexOf("*/", i + 2);
      if (end < 0) throw new SyntaxError(`Unterminated comment at ${i}`);
      out += " ";
      i = end + 2;
    } else if (c === '"' || c === "'") {
      const end = skipString(css, i);
      out += css.slice(i, end);
      i = end;
    } else {
      out += c;
      i++;
    }
  }
  return out;
}

// The index just after the string starting at i.
function skipString(css, i) {
  const quote = css[i];
  for (let j = i + 1; j < css.length; j++) {
    if (css[j] === "\\") j++;
    else if (css[j] === quote) return j + 1;
    else if (css[j] === "\n") throw new SyntaxError(`Unterminated string at ${i}`);
  }
  throw new SyntaxError(`Unterminated string at ${i}`);
}

// The index of the first of `stops` at nesting depth zero from i, or text length.
function scan(css, i, stops) {
  const closers = [];
  for (let j = i; j < css.length; j++) {
    const c = css[j];
    if (c === "\\") {
      j++;
    } else if (c === '"' || c === "'") {
      j = skipString(css, j) - 1;
    } else if (!closers.length && stops.includes(c)) {
      return j;
    } else if (c === "(" || c === "[" || c === "{") {
      closers.push(c === "(" ? ")" : c === "[" ? "]" : "}");
    } else if (c === ")" || c === "]" || c === "}") {
      if (closers.pop() !== c) throw new SyntaxError(`Unbalanced ${c} at ${j}`);
    }
  }
  if (closers.length) throw new SyntaxError(`Unclosed block, expected ${closers.at(-1)}`);
  return css.length;
}

/** Splits text at top-level commas, outside strings and brackets. */
export function splitTopLevel(text, separator = ",") {
  const parts = [];
  let start = 0;
  for (;;) {
    const end = scan(text, start, [separator]);
    parts.push(text.slice(start, end).trim());
    if (end >= text.length) return parts;
    start = end + 1;
  }
}

/** Parses a declaration list body into declarations. */
export function parseDeclarations(body) {
  const declarations = [];
  for (const part of splitTopLevel(body, ";")) {
    if (!part) continue;
    const colon = scan(part, 0, [":"]);
    if (colon >= part.length) throw new SyntaxError(`Declaration without a colon: ${part.slice(0, 60)}`);
    const name = part.slice(0, colon).trim();
    let value = part.slice(colon + 1).trim();
    const important = /!\s*important$/i.test(value);
    if (important) value = value.replace(/!\s*important$/i, "").trim();
    if (!/^-?-?[A-Za-z_][\w-]*$/.test(name)) throw new SyntaxError(`Invalid property name ${JSON.stringify(name)}`);
    declarations.push({ name, value, important });
  }
  return declarations;
}

function parseRules(css, start, end) {
  /** @type {Rule[]} */
  const rules = [];
  let i = start;
  while (i < end) {
    while (i < end && /\s/.test(css[i])) i++;
    if (i >= end) break;
    if (css[i] === "@") {
      const stop = scan(css, i, ["{", ";"]);
      const head = css.slice(i + 1, stop).trim();
      const name = /^[\w-]+/.exec(head)?.[0];
      if (!name) throw new SyntaxError(`At-rule without a name at ${i}`);
      const prelude = head.slice(name.length).trim();
      if (css[stop] === ";" || stop >= end) {
        rules.push({ type: "at", name, prelude, rules: null });
        i = stop + 1;
        continue;
      }
      const close = scan(css, stop + 1, ["}"]);
      if (css[close] !== "}") throw new SyntaxError(`Unclosed @${name} block at ${i}`);
      rules.push({ type: "at", name, prelude, rules: parseRules(css, stop + 1, close) });
      i = close + 1;
    } else {
      const open = scan(css, i, ["{"]);
      if (open >= end) throw new SyntaxError(`Qualified rule without a block at ${i}`);
      const close = scan(css, open + 1, ["}"]);
      if (css[close] !== "}") throw new SyntaxError(`Unclosed rule block at ${i}`);
      const prelude = css.slice(i, open).trim();
      rules.push(...styleRule(prelude, css.slice(open + 1, close)));
      i = close + 1;
    }
  }
  return rules;
}

// A style rule and the style rules nested in its block, flattened after it.
function styleRule(prelude, body) {
  const declarations = [];
  const nested = [];
  for (let i = 0; i < body.length; ) {
    const stop = scan(body, i, [";", "{"]);
    if (body[stop] === "{") {
      const close = scan(body, stop + 1, ["}"]);
      const inner = body.slice(i, stop).trim();
      if (!inner.includes("&")) throw new SyntaxError(`Nested rule without &: ${inner.slice(0, 60)}`);
      const parent = `:is(${prelude})`;
      nested.push(...styleRule(splitTopLevel(inner).map((s) => s.replaceAll("&", parent)).join(","), body.slice(stop + 1, close)));
      i = close + 1;
    } else {
      declarations.push(body.slice(i, stop));
      i = stop + 1;
    }
  }
  return [{ type: "rule", prelude, selectors: splitTopLevel(prelude), declarations: parseDeclarations(declarations.join(";")) }, ...nested];
}

/** Parses a stylesheet into rules. Throws SyntaxError on malformed input. */
export function parseStylesheet(css) {
  const text = stripComments(css);
  return parseRules(text, 0, text.length);
}
