// A small selector matcher over plain element objects, for check:css and tests only. It covers the
// selector forms compileCss emits (type, class, ID, exact and presence attributes, descendant and
// child combinators, :is/:where/:not, structural and state pseudo-classes) so runtime-transition
// and scope cases can show whether compiled CSS still applies after the host revokes admission.
// Browser behavior is still proven by C5/C6's Chromium and Firefox tests. Node only.
import * as csstree from "css-tree/dist/csstree.esm";

/** An element: {tag, attrs:{}, classes:[], state:Set, parent, children:[]}. */
export function element(tag, { attrs = {}, classes = [], state = [] } = {}, children = []) {
  const node = { tag, attrs: { ...attrs }, classes: [...classes], state: new Set(state), parent: null, children: [] };
  for (const child of children) append(node, child);
  return node;
}
export function append(parent, child) {
  child.parent = parent;
  parent.children.push(child);
  return child;
}
export function* descendants(node) {
  for (const child of node.children) {
    yield child;
    yield* descendants(child);
  }
}

const list = (node) => (node?.children ? node.children.toArray() : []);

function matchCompound(parts, el) {
  for (const part of parts) {
    switch (part.type) {
      case "TypeSelector":
        if (part.name !== "*" && part.name.toLowerCase() !== el.tag) return false;
        break;
      case "ClassSelector":
        if (!el.classes.includes(part.name)) return false;
        break;
      case "IdSelector":
        if (el.attrs.id !== part.name) return false;
        break;
      case "AttributeSelector": {
        const name = part.name.name;
        if (!Object.hasOwn(el.attrs, name)) return false;
        if (part.matcher) {
          const want = part.value.type === "String" ? part.value.value : part.value.name;
          if (part.matcher !== "=" || el.attrs[name] !== want) return false;
        }
        break;
      }
      case "PseudoClassSelector": {
        const name = part.name;
        if (name === "is" || name === "where") {
          if (!list(list(part)[0]).some((s) => matchSelector(s, el))) return false;
        } else if (name === "not") {
          if (list(list(part)[0]).some((s) => matchSelector(s, el))) return false;
        } else if (name === "first-child") {
          if (!el.parent || el.parent.children[0] !== el) return false;
        } else if (name === "last-child") {
          if (!el.parent || el.parent.children.at(-1) !== el) return false;
        } else if (name === "root") {
          if (el.parent) return false;
        } else if (!el.state.has(name)) return false;
        break;
      }
      case "PseudoElementSelector":
        break;
      default:
        throw new Error(`selector-model does not handle ${part.type}`);
    }
  }
  return true;
}

function matchSelector(selector, el) {
  const parts = list(selector);
  const compounds = [[]];
  const combinators = [];
  for (const part of parts) {
    if (part.type === "Combinator") {
      combinators.push(part.name);
      compounds.push([]);
    } else compounds.at(-1).push(part);
  }
  const at = (index, node) => {
    if (!matchCompound(compounds[index], node)) return false;
    if (index === 0) return true;
    const combinator = combinators[index - 1];
    if (combinator === ">") return node.parent ? at(index - 1, node.parent) : false;
    for (let up = node.parent; up; up = up.parent) if (at(index - 1, up)) return true;
    return false;
  };
  return at(compounds.length - 1, el);
}

/** The elements under root (inclusive) that any rule's selector in the CSS matches. */
export function matchedElements(css, root) {
  const ast = csstree.parse(css);
  const selectors = [];
  csstree.walk(ast, { visit: "Rule", enter: (rule) => selectors.push(...list(rule.prelude)) });
  return [root, ...descendants(root)].filter((el) => selectors.some((s) => matchSelector(s, el)));
}
