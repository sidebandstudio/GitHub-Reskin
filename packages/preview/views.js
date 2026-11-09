// The five inert fixture views, built with DOM calls and textContent only. Links keep their
// destinations as data-href and never navigate; there are no buttons, inputs, Star/Fork controls
// or sign-in prompts. Each view returns its slot anchors, located by construction rather than by
// searching, so authored README text is never a candidate. Every anchor has the host and insert
// mode C3's locator reports for the same slot on github.com, so decoration lands the same way.
import FIXTURE from "./fixture/whoisaldo.json" with { type: "json" };
import { LANGUAGE_COLORS } from "./styles.js";

export const ASSET_DIR = "packages/preview/fixture/assets/";
const SVG = "http://www.w3.org/2000/svg";
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
export const NARROW_WEEKS = 16;

// Original line icons, 16px. Each is a list of [element, attributes].
const ICONS = {
  repo: [["path", { d: "M3 3.5A1.5 1.5 0 0 1 4.5 2H13v10H4.5A1.5 1.5 0 0 0 3 13.5zM3 13.5A1.5 1.5 0 0 0 4.5 15H13v-3" }]],
  star: [["path", { d: "M8 1.8l1.9 3.9 4.3.6-3.1 3 .7 4.3L8 11.6l-3.8 2 .7-4.3-3.1-3 4.3-.6z" }]],
  fork: [["circle", { cx: 4.5, cy: 3.5, r: 1.5 }], ["circle", { cx: 11.5, cy: 3.5, r: 1.5 }], ["circle", { cx: 8, cy: 12.5, r: 1.5 }], ["path", { d: "M4.5 5v1a2 2 0 0 0 2 2h3a2 2 0 0 0 2-2V5M8 8v3" }]],
  folder: [["path", { d: "M1.5 3.5h4.2l1.5 1.5h7.3v8h-13z" }]],
  file: [["path", { d: "M3.5 1.5h6l3 3v10h-9zM9.5 1.5v3h3" }]],
  location: [["path", { d: "M8 14.5s4.5-4.2 4.5-8a4.5 4.5 0 0 0-9 0c0 3.8 4.5 8 4.5 8z" }], ["circle", { cx: 8, cy: 6.5, r: 1.5 }]],
  building: [["path", { d: "M2.5 14.5v-12h7v12M9.5 6.5h4v8M1 14.5h14M5 5h2M5 8h2M5 11h2" }]],
  link: [["path", { d: "M6.5 9.5l3-3M7 4.5l1-1a2.8 2.8 0 0 1 4 4l-1 1M9 11.5l-1 1a2.8 2.8 0 0 1-4-4l1-1" }]],
  people: [["circle", { cx: 6, cy: 5, r: 2.5 }], ["path", { d: "M1.5 14a4.5 4.5 0 0 1 9 0M11 3a2 2 0 0 1 0 4M12.5 9.6A4 4 0 0 1 14.8 14" }]],
  issue: [["circle", { cx: 8, cy: 8, r: 6.5 }], ["circle", { cx: 8, cy: 8, r: 1 }]],
  code: [["path", { d: "M5.5 4L1.5 8l4 4M10.5 4l4 4-4 4" }]],
  pull: [["circle", { cx: 4, cy: 3.5, r: 1.5 }], ["circle", { cx: 4, cy: 12.5, r: 1.5 }], ["circle", { cx: 12, cy: 12.5, r: 1.5 }], ["path", { d: "M4 5v6M12 11V6a2 2 0 0 0-2-2H7" }]],
  law: [["path", { d: "M8 2v12M4 14h8M2.5 4h11M4 4l-2 5a2 2 0 0 0 4 0zM12 4l-2 5a2 2 0 0 0 4 0z" }]],
  eye: [["path", { d: "M1 8s2.5-5 7-5 7 5 7 5-2.5 5-7 5-7-5-7-5z" }], ["circle", { cx: 8, cy: 8, r: 2 }]],
  branch: [["circle", { cx: 4.5, cy: 3.5, r: 1.5 }], ["circle", { cx: 4.5, cy: 12.5, r: 1.5 }], ["circle", { cx: 11.5, cy: 5, r: 1.5 }], ["path", { d: "M4.5 5v6M11.5 6.5c0 3-7 2-7 4.5" }]],
};

/** A small DOM builder bound to one document. */
export function builder(doc, resources, base) {
  const el = (tag, attrs, ...children) => {
    const node = doc.createElement(tag);
    for (const [key, value] of Object.entries(attrs || {})) {
      if (value === null || value === undefined || value === false) continue;
      if (key === "class") node.className = value;
      else node.setAttribute(key, value === true ? "" : String(value));
    }
    for (const child of children.flat()) if (child !== null && child !== undefined && child !== false) node.append(typeof child === "string" || typeof child === "number" ? String(child) : child);
    return node;
  };
  const icon = (name, size = 16) => {
    const svg = doc.createElementNS(SVG, "svg");
    for (const [k, v] of Object.entries({ class: "octicon", width: size, height: size, viewBox: "0 0 16 16", "aria-hidden": "true", fill: "none", stroke: "currentColor", "stroke-width": 1.3, "stroke-linejoin": "round", "stroke-linecap": "round" })) svg.setAttribute(k, String(v));
    for (const [tag, attrs] of ICONS[name]) {
      const part = doc.createElementNS(SVG, tag);
      for (const [k, v] of Object.entries(attrs)) part.setAttribute(k, String(v));
      svg.append(part);
    }
    return svg;
  };
  // A fixture image through the runtime's resource adapter, or a same-size blank when the runtime
  // has no copy. Dark variants follow the theme base, as GitHub's picture alternatives would.
  const image = ({ asset, dark, width, height, alt }, attrs = {}) => {
    const url = resources.assetUrl(ASSET_DIR + (base === "dark" && dark ? dark : asset));
    if (!url) return el("span", { class: `${attrs.class || ""} image-missing`.trim(), role: "img", "aria-label": alt, style: `display:inline-block;width:${attrs.width ?? width}px;max-width:100%;aspect-ratio:${width}/${height}` });
    return el("img", { src: url, alt, width, height, loading: "lazy", decoding: "async", ...attrs });
  };
  const link = (href, ...children) => el("a", { "data-href": href }, ...children);
  return { el, icon, image, link };
}

// README and repository markdown from the generated node tree.
function markdown(b, nodes) {
  const render = (node) => {
    if (typeof node === "string") return node;
    const [tag, attrs, ...children] = node;
    if (tag === "img") return b.image(attrs);
    if (tag === "a") return b.link(attrs.href, ...children.map(render));
    return b.el(tag, null, ...children.map(render));
  };
  return nodes.map(render);
}

const number = (n) => (n >= 1000 ? `${(n / 1000).toFixed(1).replace(/\.0$/, "")}k` : String(n));
const utcDay = (iso, offset) => new Date(Date.parse(`${iso}T00:00:00Z`) + offset * 86400000);

function calendar(b, data) {
  const { counts, levels, start, heading } = data;
  const weeks = [];
  for (let i = 0; i < levels.length; i += 7) weeks.push(levels.slice(i, i + 7).map((level, d) => ({ level, date: utcDay(start, i + d) })));
  const hiddenBefore = weeks.length - NARROW_WEEKS;
  const months = b.el("div", { class: "ContributionCalendar-months", "aria-hidden": "true" });
  let last = -1;
  weeks.forEach((week, i) => {
    const month = week[0].date.getUTCMonth();
    if (month !== last && i < weeks.length - 2) months.append(b.el("span", { style: `grid-column:${i + 1}/span 3` }, MONTHS[month]));
    last = month;
  });
  const grid = b.el(
    "div",
    { class: "ContributionCalendar-grid", role: "img", "aria-label": `Contribution graph: ${heading}` },
    weeks.map((week, i) =>
      b.el(
        "span",
        { class: i < hiddenBefore ? "week week-hidden-narrow" : "week" },
        week.map(({ level, date }, d) => b.el("span", { class: "ContributionCalendar-day", "data-level": level, "data-date": date.toISOString().slice(0, 10), "data-count": counts[i * 7 + d] })),
      ),
    ),
  );
  const labels = b.el("div", { class: "ContributionCalendar-labels", "aria-hidden": "true" }, ["", "Mon", "", "Wed", "", "Fri", ""].map((label) => b.el("span", null, label)));
  const legend = b.el("div", { class: "ContributionCalendar-legend" }, b.el("span", null, "Less"), [0, 1, 2, 3, 4].map((level) => b.el("span", { class: "ContributionCalendar-day", "data-level": level, "aria-hidden": "true" })), b.el("span", null, "More"));
  const graph = b.el(
    "div",
    { class: "js-calendar-graph" },
    months,
    b.el("div", { class: "ContributionCalendar-body" }, labels, grid),
    b.el("div", { class: "ContributionCalendar-footer" }, b.el("span", { class: "calendar-crop" }, `Showing the latest ${NARROW_WEEKS} weeks`), b.el("span", null, "Learn how we count contributions"), legend),
  );
  const heading2 = b.el("h2", { class: "f4 text-normal mb-2" }, heading);
  // GitHub's graph wrapper, which C3's contribution caption follows.
  const wrapper = b.el("div", { class: "Box ContributionCalendar graph-before-activity-overview" }, graph);
  const section = b.el("div", { class: "js-yearly-contributions" }, heading2, wrapper);
  return { section, wrapper };
}

function pinnedCard(b, pin) {
  const meta = [];
  if (pin.language) meta.push(b.el("span", null, b.el("span", { class: "lang-dot", style: `background:${LANGUAGE_COLORS[pin.language] ?? "#8b949e"}` }), pin.language));
  if (pin.stars) meta.push(b.el("span", { "aria-label": `${pin.stars} stars` }, b.icon("star"), " ", number(pin.stars)));
  if (pin.forks) meta.push(b.el("span", { "aria-label": `${pin.forks} forks` }, b.icon("fork"), " ", number(pin.forks)));
  return b.el(
    "li",
    { class: "Box pinned-item-list-item" },
    b.el("div", { class: "pinned-item-title" }, b.icon("repo"), b.link(`https://github.com/${pin.owner}/${pin.name}`, b.el("span", { class: "repo" }, pin.owner === FIXTURE.profile.login ? pin.name : `${pin.owner}/${pin.name}`)), b.el("span", { class: "Label" }, pin.visibility)),
    b.el("p", { class: "pinned-item-desc" }, pin.description ?? ""),
    b.el("div", { class: "pinned-item-meta" }, meta),
  );
}

function profile(b) {
  const p = FIXTURE.profile;
  const names = b.el("div", { class: "vcard-names-container" }, b.el("h1", { class: "vcard-names" }, b.el("span", { class: "vcard-fullname p-name" }, p.displayName), b.el("span", { class: "vcard-username p-nickname" }, p.login)));
  const orgHeading = b.el("h2", { class: "h4" }, "Organizations");
  const card = b.el(
    "div",
    { class: "h-card" },
    b.image(p.avatar, { class: "avatar", width: 128, height: 128 }),
    names,
    b.el(
      "div",
      { class: "after-names" },
      b.el("div", { class: "user-profile-bio" }, p.bio),
      b.el("div", { class: "follow-line" }, b.icon("people"), " ", b.el("strong", null, p.followers), " followers · ", b.el("strong", null, p.following), " following"),
      b.el(
        "ul",
        { class: "vcard-details" },
        p.company && b.el("li", { class: "vcard-detail" }, b.icon("building"), p.company),
        p.location && b.el("li", { class: "vcard-detail" }, b.icon("location"), p.location),
        p.links.map((l) => b.el("li", { class: "vcard-detail" }, b.icon("link"), b.link(l.href, l.label))),
      ),
      p.organizationsHeadingVisible && b.el("div", { class: "border-top" }, orgHeading, b.el("div", { class: "org-list" }, p.organizations.map((org) => b.image(org.avatar, { class: "avatar", width: 32, height: 32 })))),
    ),
  );
  const pinnedHeading = b.el("h2", { class: "f4 mb-2 text-normal" }, p.pinnedHeading);
  const pinned = b.el("div", { class: "js-pinned-items-reorder-container" }, pinnedHeading, b.el("ol", { class: "pinned-items-list" }, p.pinned.map((pin) => pinnedCard(b, pin))));
  const readme = b.el("div", { class: "Box profile-readme" }, b.el("div", { class: "profile-readme-title" }, `${p.login} / README.md`), b.el("article", { class: "markdown-body" }, markdown(b, p.readme)));
  const { section, wrapper } = calendar(b, FIXTURE.contributions);
  const root = b.el("main", { class: "page", "data-view": "profile" }, b.el("div", { class: "layout" }, card, b.el("div", { class: "main" }, readme, pinned, section)));
  return {
    root,
    anchors: [
      { slot: "profile.tag", host: names, insert: "append", nativeSignature: "preview:vcard-names" },
      { slot: "profile.organizations.heading", host: orgHeading, insert: "append", nativeSignature: "preview:organizations" },
      { slot: "profile.pinned.heading", host: pinnedHeading, insert: "append", nativeSignature: "preview:pinned" },
      { slot: "contributions.caption", host: wrapper, insert: "after", nativeSignature: "preview:calendar" },
    ],
  };
}

function repoMasthead(b, owner, name, visibility) {
  return b.el("div", { class: "repo-head" }, b.icon("repo"), b.link(`https://github.com/${owner}`, b.el("span", { class: "owner" }, owner)), b.el("span", { class: "color-fg-muted" }, "/"), b.link(`https://github.com/${owner}/${name}`, b.el("strong", { class: "name" }, name)), b.el("span", { class: "Label" }, visibility));
}

function repoNav(b, current, issues) {
  const tab = (name, icon, label, count) => b.el("span", { class: "UnderlineNav-item", "aria-current": current === name ? "page" : null }, b.icon(icon), label, count !== undefined ? b.el("span", { class: "Counter" }, count) : null);
  return b.el("nav", { class: "UnderlineNav", "aria-label": "Repository" }, tab("code", "code", "Code"), tab("issues", "issue", "Issues", issues), tab("pulls", "pull", "Pull requests", 0));
}

function repository(b) {
  const r = FIXTURE.repository;
  const files = b.el(
    "div",
    { class: "Box file-list" },
    b.el("div", { class: "Box-header" }, b.icon("branch"), b.el("strong", null, r.defaultBranch), b.el("span", { class: "color-fg-muted" }, `${r.files.length} top-level entries`)),
    r.files.map((file) => b.el("div", { class: "Box-row file-row" }, b.el("span", { class: file.type === "dir" ? "dir" : "file" }, b.icon(file.type === "dir" ? "folder" : "file")), b.el("span", null, file.name))),
  );
  const readme = b.el("div", { class: "Box repo-readme" }, b.el("div", { class: "Box-header" }, "README"), b.el("article", { class: "markdown-body" }, markdown(b, r.readme)));
  const about = b.el(
    "aside",
    { class: "about" },
    b.el("h2", { class: "h4" }, "About"),
    b.el("p", null, r.about),
    b.el(
      "ul",
      { class: "about-meta" },
      r.license && b.el("li", null, b.icon("law"), " ", r.license),
      b.el("li", null, b.icon("star"), " ", b.el("strong", null, r.counts.stars), " stars"),
      b.el("li", null, b.icon("eye"), " ", b.el("strong", null, r.counts.watchers), " watching"),
      b.el("li", null, b.icon("fork"), " ", b.el("strong", null, r.counts.forks), r.counts.forks === 1 ? " fork" : " forks"),
    ),
    b.el("div", { class: "border-top" }, b.el("h2", { class: "h4" }, "Contributors ", b.el("span", { class: "Counter" }, r.counts.contributors))),
    b.el(
      "div",
      { class: "border-top" },
      b.el("h2", { class: "h4" }, "Languages"),
      b.el("div", { class: "lang-bar", "aria-hidden": "true" }, r.languages.map((l) => b.el("span", { style: `width:${l.percentage}%;background:${LANGUAGE_COLORS[l.name] ?? "#8b949e"}` }))),
      b.el("ul", { class: "lang-list" }, r.languages.map((l) => b.el("li", null, b.el("span", { class: "lang-dot", style: `background:${LANGUAGE_COLORS[l.name] ?? "#8b949e"}` }), b.el("strong", null, l.name), " ", b.el("span", { class: "pct" }, `${l.percentage}%`)))),
    ),
  );
  const root = b.el("main", { class: "page", "data-view": "repo" }, repoMasthead(b, r.owner, r.name, r.visibility), repoNav(b, "code", 0), b.el("div", { class: "repo-layout" }, b.el("div", null, files, readme), about));
  return { root, anchors: [] };
}

// A fictional change, so every syntax role and diff pair appears on its real backgrounds.
const DIFF = [
  ["hunk", null, null, "@@ -1,9 +1,12 @@"],
  ["ctx", 1, 1, [["pl-c", "// Pick a greeting for the profile header."]]],
  ["del", 2, null, [["pl-k", "const"], " ", ["pl-v", "greeting"], " = ", ["pl-s", '"Hello"'], ";"]],
  ["add", null, 2, [["pl-k", "const"], " ", ["pl-v", "greeting"], " = ", ["x", ["pl-s", '"Welcome back"']], ";"]],
  ["ctx", 3, 3, [["pl-k", "const"], " ", ["pl-v", "maxLength"], " = ", ["pl-c1", "40"], ";"]],
  ["ctx", 4, 4, ""],
  ["del", 5, null, [["pl-k", "function"], " ", ["pl-en", "label"], "(", ["pl-v", "name"], ") {"]],
  ["add", null, 5, [["pl-k", "export function"], " ", ["pl-en", "label"], "(", ["pl-v", "name"], ": ", ["pl-ent", "string"], ") {"]],
  ["ctx", 6, 6, ["  ", ["pl-k", "const"], " ", ["pl-v", "text"], " = ", ["pl-s", "`${greeting}, ${name}`"], ";"]],
  ["del", 7, null, ["  ", ["pl-k", "return"], " ", ["pl-v", "text"], ";"]],
  // GitHub's JavaScript highlighting leaves a plain reference uncolored, so the highlighted word
  // takes the word highlight's own text color.
  ["add", null, 7, ["  ", ["pl-k", "return"], " ", ["pl-v", "text"], ".", ["pl-en", "slice"], "(", ["pl-c1", "0"], ", ", ["x", "maxLength"], ");"]],
  ["add", null, 8, ""],
  ["add", null, 9, [["pl-c", "// Short names stay readable in narrow cards."]]],
  ["ctx", 8, 10, "}"],
];

function diff(b) {
  const code = (parts) => (typeof parts === "string" ? [parts] : parts.map((part) => (typeof part === "string" ? part : b.el("span", { class: part[0] }, ...(typeof part[1] === "string" ? [part[1]] : [code([part[1]])])))));
  const marker = { add: "+", del: "-", ctx: " ", hunk: "" };
  const rows = DIFF.map(([kind, before, after, parts]) =>
    b.el("tr", { class: kind }, b.el("td", { class: "num" }, before ?? ""), b.el("td", { class: "num" }, after ?? ""), b.el("td", { class: "code" }, kind === "hunk" ? parts : [marker[kind], ...code(parts)])),
  );
  const added = DIFF.filter(([k]) => k === "add").length;
  const removed = DIFF.filter(([k]) => k === "del").length;
  const file = b.el(
    "div",
    { class: "Box" },
    b.el("div", { class: "Box-header file-header" }, b.el("strong", null, "src/greeting.js"), b.el("span", { class: "text-success" }, `+${added}`), b.el("span", { class: "text-danger" }, `-${removed}`), b.el("span", { class: "diffstat", "aria-hidden": "true" }, b.el("i", { class: "add" }), b.el("i", { class: "add" }), b.el("i", { class: "add" }), b.el("i", { class: "del" }), b.el("i", { class: "del" }))),
    b.el("table", { class: "diff-table", "aria-label": "Changes to src/greeting.js" }, b.el("colgroup", null, b.el("col", { style: "width:44px" }), b.el("col", { style: "width:44px" }), b.el("col")), b.el("tbody", null, rows)),
  );
  const root = b.el("main", { class: "page", "data-view": "diff" }, b.el("h1", { class: "diff-title" }, "Files changed ", b.el("span", { class: "Counter" }, 1)), file);
  return { root, anchors: [] };
}

function empty(b) {
  const pinnedHeading = b.el("h2", { class: "f4 mb-2 text-normal" }, "Pinned");
  const pinnedSlateHeading = b.el("h3", { class: "blankslate-heading" }, "Nothing pinned yet");
  const issuesSlateHeading = b.el("h3", { class: "blankslate-heading" }, "No issues yet");
  const pinnedSlate = b.el("div", { class: "Box blankslate" }, b.icon("repo", 24), pinnedSlateHeading, b.el("p", null, "Pinned repositories will appear here."));
  const issuesSlate = b.el("div", { class: "Box blankslate" }, b.icon("issue", 24), issuesSlateHeading, b.el("p", null, "Issues track ideas, bugs and tasks for this repository."));
  const root = b.el(
    "main",
    { class: "page", "data-view": "empty" },
    repoMasthead(b, "reskin-sample", "first-project", "Public"),
    repoNav(b, "issues", 0),
    b.el("div", { class: "js-pinned-items-reorder-container" }, pinnedHeading, pinnedSlate),
    b.el("div", { class: "issues-head" }, b.el("h2", { class: "h4" }, "Issues"), b.el("span", { class: "color-fg-muted" }, "0 open · 0 closed")),
    issuesSlate,
  );
  return {
    root,
    anchors: [
      { slot: "profile.pinned.heading", host: pinnedHeading, insert: "append", nativeSignature: "preview:pinned" },
      { slot: "empty.pinned.caption", host: pinnedSlateHeading, insert: "after", nativeSignature: "preview:pinned-empty" },
      { slot: "empty.issues.caption", host: issuesSlateHeading, insert: "after", nativeSignature: "preview:issues-empty" },
    ],
  };
}

function notFound(b) {
  const art = b.el("div", { class: "error-illustration", "aria-hidden": "true" }, [120, 170].map((size) => b.el("span", { class: "ring", style: `width:${size}px;height:${size}px;margin:-${size / 2}px 0 0 -${size / 2}px` })), b.el("span", { class: "code" }, "404"));
  const root = b.el(
    "main",
    { class: "page", "data-view": "404" },
    b.el(
      "div",
      { class: "error-page" },
      art,
      b.el("h1", null, "Page not found"),
      b.el("p", null, "The page you asked for doesn't exist here, or it has moved."),
      b.el("div", { class: "error-links" }, b.link("https://github.com/", "Home"), b.link("https://docs.github.com/", "Documentation"), b.link("https://www.githubstatus.com/", "Status")),
    ),
  );
  return { root, anchors: [{ slot: "error.notFound.caption", host: art, insert: "after", nativeSignature: "preview:404" }] };
}

export const VIEWS = Object.freeze({ profile, repo: repository, diff, empty, 404: notFound });
export { FIXTURE };
