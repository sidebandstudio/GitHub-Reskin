// The finite native target registry, registryVersion 1: which of GitHub's own elements advanced
// theme CSS may style, with what, and when that admission ends. C2b's compileCss reads
// CSS_TARGET_REGISTRY; the content adapter's admission runtime reads HOST_SUBJECTS and the
// protected, blocking and activator lists. Imported metadata never extends any of it. Every
// subject was captured logged out on github.com on 2026-11-08 (tests/primer/registry-evidence.json),
// except AppHeader, the signed-in header, which carries no live capture: see its note.
//
// No class alone establishes a kind. A subject is admitted only when the host finds it at its
// structural signature on a reviewed route, inside plan islands only, with no protected, authored
// or unclassified content in or around it. Pure data.

const freeze = (value) => {
  if (value && typeof value === "object") {
    Object.values(value).forEach(freeze);
    Object.freeze(value);
  }
  return value;
};

/** Route classes from classifyRoute where the host issues native admission markers. */
export const ROUTE_CLASSES = freeze(["profile", "repository", "pull-files", "commit", "not-found", "marketing", "gist"]);

const RADII = ["border-radius", "border-top-left-radius", "border-top-right-radius", "border-bottom-left-radius", "border-bottom-right-radius", "corner-shape"];
const TYPE = ["font-family", "font-weight", "letter-spacing", "text-transform"];

/**
 * Kind policies. Rules that reach several kinds get the intersection. Inheritable kinds admit only
 * leaves or subjects whose every descendant the host has checked against `descendants`.
 */
const KINDS = {
  // The body behind GitHub's own text, which is not blank: only the audited canvas.
  "page-backing": {
    properties: ["background-color"],
    colors: { "background-color": ["--reskin-canvas"] },
    literalColors: [],
    blur: false,
    textShadow: false,
    inheritable: false,
    maxTargets: 1,
  },
  // Header containers. Nothing inherited reaches the account menus and search inside: only the
  // audited header backing, decorative boundaries and a bounded small-chrome shadow.
  "header-chrome": {
    properties: ["background-color", "border-color", "border-bottom-color", "box-shadow"],
    colors: { "background-color": ["--reskin-header-background"] },
    literalColors: ["border-color", "border-bottom-color"],
    blur: true,
    textShadow: false,
    inheritable: false,
    maxTargets: 3,
  },
  // Selected tabs and primary buttons: shape, boundary, shadow and reviewed typography. Their
  // colors stay the structured theme's audited pairs.
  "control-chrome": {
    properties: ["border-color", "border-bottom-color", ...RADII, "box-shadow", ...TYPE],
    colors: { "border-color": ["--reskin-control-border", "--reskin-accent", "--reskin-primary-background"], "border-bottom-color": ["--reskin-accent"] },
    literalColors: [],
    blur: true,
    textShadow: false,
    inheritable: true,
    maxTargets: 48,
  },
  // GitHub-owned headings and the repository title: their audited ink, a text glow and type.
  "heading-chrome": {
    properties: ["color", "text-shadow", ...TYPE],
    colors: { color: ["--reskin-text", "--reskin-link", "--reskin-muted-text"] },
    literalColors: [],
    blur: false,
    textShadow: true,
    inheritable: true,
    maxTargets: 16,
  },
  // Calendar days and legend swatches: static geometry and glow only. No color, so a rule can
  // never paint every level alike or change what a cell means.
  "graph-cell": {
    properties: ["border-radius", "corner-shape", "box-shadow"],
    colors: {},
    literalColors: [],
    blur: true,
    textShadow: false,
    inheritable: false,
    maxTargets: 400,
  },
  // The activity overview's shape and markers, SVG leaves: the audited ramp ends only.
  "graph-decoration": {
    properties: ["fill", "stroke", "stroke-width"],
    colors: { fill: ["--reskin-graph-0", "--reskin-graph-4"], stroke: ["--reskin-graph-4"] },
    literalColors: [],
    blur: false,
    textShadow: false,
    inheritable: true,
    maxTargets: 6,
  },
};

/**
 * Host signatures. `key` is the cheap lookup that yields candidates (a class, a tag, or the
 * subtree of the first element with a class or of the element with an ID), `select` the exact structure a candidate must
 * match, `descendants` the only elements an inheritable subject may contain, at most
 * `maxDescendants`. `signature` is the exact compound theme CSS uses, which compileCss matches.
 */
export const HOST_SUBJECTS = freeze([
  {
    id: "page",
    key: { tag: "body" },
    kind: "page-backing",
    select: "body",
    routes: ROUTE_CLASSES,
    signature: { element: "body", classes: [] },
  },
  {
    id: "header.marketing",
    key: { className: "HeaderMktg" },
    kind: "header-chrome",
    select: 'header.HeaderMktg[role="banner"]',
    routes: ROUTE_CLASSES,
    signature: { classes: ["HeaderMktg"] },
  },
  {
    id: "header.global-nav",
    key: { className: "GlobalNav" },
    kind: "header-chrome",
    select: "header.GlobalNav",
    routes: ["repository", "pull-files", "commit"],
    signature: { classes: ["GlobalNav"] },
  },
  {
    id: "header.gist",
    key: { className: "Header" },
    kind: "header-chrome",
    select: 'div.Header[role="banner"]',
    routes: ["gist"],
    signature: { classes: ["Header"] },
  },
  {
    // The signed-in header, as the owner's 1.1.0 Cyberpunk release targeted it. No logged-out page
    // renders it, so there is no live capture; its policy inherits nothing, and an absent or
    // different element simply receives no marker.
    id: "header.app",
    key: { className: "AppHeader" },
    kind: "header-chrome",
    select: "header.AppHeader",
    routes: ROUTE_CLASSES,
    signature: { classes: ["AppHeader"] },
    evidence: "owner-1.1.0",
  },
  {
    // Dormant. A primary button is the main action of whatever surrounds it: sign-in, sign-up,
    // review, billing, invitation or transfer as often as anything else, so no class or route
    // makes one safe. The one captured on a reviewed route (pull request files, 2026-11-08) opened
    // the review submission, and on 2026-11-09 the only one left on the captured pages was a
    // sign-up link in a warning. Until a primary button is captured at a structure that is
    // neither, theme CSS may name .btn-primary but the host admits none.
    id: "button.primary",
    key: { className: "btn-primary" },
    kind: "control-chrome",
    select: ":is(a,button,summary).btn.btn-primary",
    routes: ["pull-files"],
    dormant: "no reviewed primary-button structure outside account, review and form flows",
    signature: { classes: ["btn-primary"] },
    descendants: "span,svg,path,strong",
    maxDescendants: 8,
  },
  {
    id: "tab.profile",
    key: { className: "UnderlineNav-item" },
    kind: "control-chrome",
    select: 'nav.UnderlineNav-body[aria-label="User profile"] > a.UnderlineNav-item[aria-current="page"]',
    routes: ["profile"],
    signature: { classes: ["UnderlineNav-item"], predicates: [{ name: "aria-current", value: "page" }] },
    descendants: "span,svg,path",
    maxDescendants: 8,
  },
  {
    id: "tab.pull",
    key: { className: "tabnav-tab" },
    kind: "control-chrome",
    select: 'nav.tabnav-tabs[aria-label="Pull request tabs"] > a.tabnav-tab[aria-current="page"]',
    routes: ["pull-files"],
    signature: { classes: ["tabnav-tab"], predicates: [{ name: "aria-current", value: "page" }] },
    descendants: "span,svg,path",
    maxDescendants: 8,
  },
  {
    id: "tab.repository",
    key: { within: "GlobalNav" },
    kind: "control-chrome",
    select: 'nav[aria-label="Repository"] li > a[aria-current="page"][data-tab-item]',
    routes: ["repository", "pull-files", "commit"],
    signature: { element: "a", classes: [], predicates: [{ name: "aria-current", value: "page" }] },
    descendants: "span,svg,path",
    maxDescendants: 8,
  },
  {
    // The repository name above the file list, outside the global navigation. The name is the
    // owner's, so theme CSS may give it ink, glow and type but never change its case.
    id: "title.repository",
    key: { withinId: "repo-title-component" },
    kind: "heading-chrome",
    select: '#repo-title-component [itemprop="name"][data-testid="repo-name-wrapper"] > strong > a[data-testid="repo-name-link"]',
    routes: ["repository", "pull-files", "commit"],
    signature: { element: "a", classes: [], predicates: [{ name: "data-testid", value: "repo-name-link" }] },
    authored: true,
    descendants: "",
    maxDescendants: 0,
  },
  {
    id: "heading.profile-sidebar",
    key: { className: "h4" },
    kind: "heading-chrome",
    select: "main .Layout-sidebar h2.h4.mb-2",
    routes: ["profile"],
    signature: { element: "h2", classes: ["h4", "mb-2"] },
    descendants: "a.Link--primary",
    maxDescendants: 1,
  },
  {
    id: "heading.repository-sidebar",
    key: { tag: "h2" },
    kind: "heading-chrome",
    select: 'main h2[data-component="Heading"]:not(.sr-only)',
    routes: ["repository"],
    signature: { element: "h2", classes: [], predicates: [{ name: "data-component", value: "Heading" }] },
    descendants: "span",
    maxDescendants: 2,
  },
  {
    id: "graph.day",
    key: { className: "ContributionCalendar-day" },
    kind: "graph-cell",
    select: "main .js-yearly-contributions :is(table.ContributionCalendar-grid td, div[id^='contribution-graph-legend-level-']).ContributionCalendar-day",
    routes: ["profile"],
    signature: { classes: ["ContributionCalendar-day"] },
    descendants: "span.sr-only",
    maxDescendants: 1,
  },
  {
    id: "graph.blob",
    key: { className: "js-highlight-blob" },
    kind: "graph-decoration",
    select: "main svg.js-activity-overview-graph path.js-highlight-blob",
    routes: ["profile"],
    signature: { element: "path", classes: ["js-highlight-blob"] },
    descendants: "",
    maxDescendants: 0,
  },
  {
    id: "graph.point",
    key: { className: "activity-overview-point" },
    kind: "graph-decoration",
    select: "main svg.js-activity-overview-graph ellipse.activity-overview-point",
    routes: ["profile"],
    signature: { element: "ellipse", classes: ["activity-overview-point"] },
    descendants: "",
    maxDescendants: 0,
  },
]);

/**
 * Protected UI the host marks data-reskin-protected: account, authentication, permission,
 * billing, verification, merge and warning UI on otherwise reviewed routes. Every form is one: a
 * form's action is the account's own, no action list can tell which are safe, and no form
 * structure has been reviewed. Admission refuses any subject inside or around one; structured
 * component rules and themed islands skip it and everything in it, and it keeps its nearest
 * island's native colors. Not a universal detector: admission rests on the positive signatures
 * above, and routes outside ROUTE_CLASSES get no native admission at all.
 */
export const PROTECTED = [
  "form",
  'a[href^="/login"]',
  'a[href^="/signup"]',
  'a[href^="/join"]',
  'a[href*="//github.com/login"]',
  'a[href*="//github.com/signup"]',
  'a[href*="//github.com/join"]',
  '[data-testid="repo-visibility-label"]',
  ".signed-commit-badge",
  '[data-testid="commit-signature"]',
  ".merge-pr",
  ".branch-action",
  '[data-testid="mergebox-partial"]',
  ".merge-status-list",
  ".flash",
  ".flash-messages",
  '[data-component="Banner"]',
  '[role="alert"]',
  '[role="alertdialog"]',
  "dialog",
  '[role="dialog"]',
  '[aria-modal="true"]',
  "[popover]",
  "details-dialog",
  "modal-dialog",
].join(",");

/**
 * Open layers and alerts that revoke native CSS for the whole document while shown: dialogs,
 * modal and alert roles, popovers other than tooltips, and warning banners. GitHub's marketing
 * banner, a reviewed promotion with role=alert on Brand pages, and visually hidden screen-reader
 * announcements stay protected but do not block.
 */
export const BLOCKING = [
  "dialog",
  '[role="dialog"]',
  '[role="alertdialog"]',
  '[aria-modal="true"]',
  '[popover]:not([role="tooltip"],tool-tip)',
  "details-dialog",
  "modal-dialog",
  '[role="alert"]:not(.sr-only,react-partial[partial-name="marketing-global-banner"] global-banner)',
  ".flash-error",
  ".flash-warn",
].join(",");

/** Controls whose activation may open a layer; the host revokes before the activation lands. */
export const ACTIVATORS = [
  "[aria-haspopup]",
  "[aria-controls]",
  "[aria-expanded]",
  "[popovertarget]",
  "[commandfor]",
  "[data-show-dialog-id]",
  "summary",
  "dialog *",
  "[popover] *",
].join(",");

/** Authored content: no admitted subject sits inside it. */
export const AUTHORED = [".markdown-body", ".comment-body", ".js-comment-body", ".blob-wrapper", ".react-code-lines", ".diff-table", "[data-testid='diff-view']", ".user-profile-bio", "pre", "code", "textarea", "[contenteditable]"].join(",");

/**
 * The attributes and events whose change revokes admission before the next styled render: every
 * attribute a subject signature, the protected, blocking, authored and live-region lists, a
 * layer's shown state or the route meta reads (tests/primer/registry.test.mjs checks the
 * inventory), and the state attributes beside them.
 */
export const INVALIDATION = freeze({
  attributes: ["class", "id", "role", "style", "hidden", "open", "inert", "aria-hidden", "aria-modal", "aria-current", "aria-expanded", "aria-label", "aria-live", "contenteditable", "popover", "data-state", "data-testid", "data-component", "data-tab-item", "data-color-mode", "data-light-theme", "data-dark-theme", "data-static-error-asset", "itemprop", "itemtype", "href", "partial-name", "name", "content"],
  events: ["turbo:before-render", "turbo:before-cache", "turbo:render", "turbo:load", "pjax:beforeReplace", "popstate", "pagehide", "pageshow", "beforetoggle", "toggle", "click", "keydown", "focusin", "change:prefers-color-scheme", "change:forced-colors"],
});

// Reviewed structural evidence, path to SHA-256. tests/primer/registry.test.mjs checks them.
const FIXTURES = {
  "tests/primer/registry-evidence.json": "d7bac46cac4dee655f4e0f87ba8e28cf65f3f19b6afefdd69b3b52011f85e76a",
  "tests/primer/fixtures/registry.html": "1ac2ca3b621bd7d93c83eff1a9f6d0496c2aa4e9768776170a42867dd9f1909c",
};

/** registryVersion 1, the CssTargetRegistry C2b's compileCss consumes. */
export const CSS_TARGET_REGISTRY = freeze({
  registryVersion: 1,
  kinds: KINDS,
  subjects: HOST_SUBJECTS.map((s) => ({
    kind: s.kind,
    ...(s.signature.element ? { element: s.signature.element } : {}),
    classes: [...s.signature.classes],
    ...(s.signature.predicates ? { predicates: s.signature.predicates.map((p) => ({ ...p })) } : {}),
    routes: [...s.routes],
    ...(s.authored ? { authored: true } : {}),
  })),
  rootKind: "page-backing",
  invalidation: { attributes: [...INVALIDATION.attributes], events: [...INVALIDATION.events] },
  fixtures: FIXTURES,
});

/** The route classes a kind is admitted on. */
export const registryRoutes = (kind) => [...new Set(HOST_SUBJECTS.filter((s) => s.kind === kind).flatMap((s) => s.routes))];
