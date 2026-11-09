// Every GitHub selector the content adapter uses, in one place. Each slot names a structural
// scope GitHub renders itself, the English words GitHub prints there and where an owned node may
// go. Words are a guard inside that scope, never a page-wide search. Nothing here matches by class
// substring, and nothing is a fallback for a missing anchor.

/** Roots of text people wrote: READMEs and rendered Markdown, comments, issue and PR titles, files, code and diffs. */
export const AUTHORED_ROOTS = [
  ".markdown-body",
  ".comment-body",
  ".js-comment-body",
  ".markdown-title",
  ".js-issue-title",
  "[data-testid='issue-title']",
  "[data-testid='issue-body']",
  ".file",
  ".gist-file",
  ".blob-wrapper",
  ".blob-code",
  ".react-code-file-contents",
  ".react-code-lines",
  ".diff-table",
  ".js-diff-table",
  "[data-testid='diff-view']",
  "pre",
  "code",
  "textarea",
  "#readme",
  ".readme",
  ".user-profile-bio",
  ".p-note",
  ".vcard-names",
].join(",");

/** Elements that are, or behave as, controls. An owned node never goes inside one. */
export const INTERACTIVE = [
  "a",
  "button",
  "summary",
  "label",
  "input",
  "select",
  "textarea",
  "option",
  "[role='button']",
  "[role='link']",
  "[role='tab']",
  "[role='tablist']",
  "[role='menu']",
  "[role='menuitem']",
  "[role='menuitemcheckbox']",
  "[role='menuitemradio']",
  "[role='option']",
  "[role='switch']",
  "[role='checkbox']",
  "[role='radio']",
  "[role='textbox']",
  "[tabindex]",
  "[contenteditable]:not([contenteditable='false'])",
  "[onclick]",
].join(",");

/** Live regions. An owned node never goes inside one, where a change could be announced. */
export const LIVE_REGIONS = "[aria-live]:not([aria-live='off']),[role='status'],[role='alert'],[role='log']";

/** Route signals GitHub renders in the document head. */
export const ROUTE_META = {
  controller: "meta[name='route-controller']",
  action: "meta[name='route-action']",
};
export const NOT_FOUND_ILLUSTRATION = "main img[data-static-error-asset='404-illustration']";
export const PROFILE_CARD = "main .h-card[itemtype='http://schema.org/Person']";
export const SOURCE_CODE = "[itemtype='http://schema.org/SoftwareSourceCode']";
export const MARKETING_MAIN = "main.font-mktg";

/**
 * The ten flavor slots. `scope` finds candidate guard elements; `text` is the exact English
 * GitHub prints in the guard's own text nodes (a RegExp where GitHub interpolates a name or
 * number); `host` picks the anchor from the guard; `insert` is where C5 places its node.
 * `status` is `enabled` only with dated live DOM evidence in tests/primer/slot-evidence.json.
 */
export const SLOTS = [
  {
    slot: "profile.pinned.heading",
    status: "enabled",
    route: "profile",
    scope: "main .Layout-main .js-pinned-items-reorder-container > h2:not(.blankslate-heading)",
    text: ["Pinned", "Popular repositories"],
    host: "guard",
    insert: "append",
  },
  {
    slot: "profile.activity.heading",
    status: "enabled",
    route: "profile",
    scope: "main .Layout-main #js-contribution-activity > h2",
    text: ["Contribution activity"],
    host: "guard",
    insert: "append",
  },
  {
    slot: "profile.organizations.heading",
    status: "enabled",
    route: "profile",
    scope: "main .Layout-sidebar .h-card h2",
    text: ["Organizations"],
    // The heading GitHub puts directly above organization avatar links.
    next: "a.avatar-group-item[data-hovercard-type='organization']",
    host: "guard",
    insert: "append",
  },
  {
    slot: "profile.tag",
    status: "enabled",
    route: "profile",
    scope: "main .Layout-sidebar .h-card .vcard-names-container",
    // The tag follows the name heading inside GitHub's names container. It never goes inside the
    // heading and never reads the names.
    child: "h1.vcard-names",
    text: null,
    host: "guard",
    insert: "append",
  },
  {
    slot: "error.notFound.caption",
    status: "enabled",
    route: "not-found",
    scope: NOT_FOUND_ILLUSTRATION,
    text: null,
    host: "parent",
    insert: "after",
  },
  {
    slot: "empty.pinned.caption",
    status: "enabled",
    route: "profile",
    scope: "main .Layout-main .js-pinned-items-reorder-container .blankslate > h2.blankslate-heading",
    text: [/^\S+ doesn't have any public repositories yet\.$/],
    host: "guard",
    insert: "after",
  },
  {
    slot: "empty.issues.caption",
    // Dormant: on 2026-11-08 the issue-list blankslate sat inside the list's focusable
    // items-list container (tabindex=-1) and a role=status live region. No safe location exists.
    status: "dormant",
    dormant: "The issue-list blankslate is inside a focusable list container (tabindex=-1) and a role=status live region.",
    route: "issues",
    scope: "main [data-testid='issues-list-surface'] [data-component='Blankslate'] > [data-component='Blankslate.Heading']",
    text: ["No results matched your search"],
    host: "guard",
    insert: "after",
  },
  {
    slot: "contributions.caption",
    status: "enabled",
    route: "profile",
    scope: "main .Layout-main .js-yearly-contributions h2#js-contribution-activity-description",
    text: [/^\d[\d,]* contributions? in (?:the last year|\d{4})$/],
    // The caption follows the calendar graph, outside the graph and its keyboard cells.
    host: "graph",
    graph: ".graph-before-activity-overview",
    insert: "after",
  },
  {
    slot: "footer.signoff",
    status: "enabled",
    route: "profile",
    // GitHub's own footer line, outside <main>: the copyright span beside the footer logo link.
    region: "footer",
    scope: "body footer.footer[role='contentinfo'] > div > div.flex-shrink-0 > span",
    text: [/^© \d{4} GitHub, Inc\.$/],
    host: "guard",
    insert: "after",
  },
  {
    slot: "profile.achievements.heading",
    status: "enabled",
    route: "profile",
    // The desktop copy of the sidebar's Achievements heading; GitHub also renders a mobile copy,
    // hidden at desktop widths, without d-md-block. The heading's whole text is a link, so the
    // guard is that link and the owned node goes after the heading, never inside it.
    scope: "main .Layout-sidebar .border-top.d-md-block > h2.h4.mb-2 > a.Link--primary:only-child",
    text: ["Achievements"],
    host: "parent",
    insert: "after",
  },
];

/**
 * Slot candidates outside the ten. locateSlots never yields them until a schema revision adds
 * their IDs and they move into SLOTS. `proposed` passed every guard on the dated capture in
 * tests/primer/registry-evidence.json; `dormant` explains why no safe location exists. A heading
 * whose text is a link, button or tab is decorated only after the heading, never inside it.
 */
export const CANDIDATE_SLOTS = [
  {
    slot: "repository.releases.heading",
    status: "dormant",
    dormant: "The repository sidebar's Releases heading (h2[data-component=Heading] > span) is inside GitHub's React sidebar, which renders a loading skeleton and then replaces the section's children, so an owned node there would be removed or would disturb React's own updates.",
    route: "repository",
    scope: "main h2[data-component='Heading'] > span",
    text: ["Releases"],
    host: "parent",
    insert: "after",
  },
  {
    slot: "profile.followers.heading",
    status: "dormant",
    dormant: "GitHub renders no Followers or following heading: the profile sidebar shows the counts as links (a.Link--secondary to ?tab=followers and ?tab=following), and the followers tab lists people without a heading.",
    route: "profile",
    scope: "main .Layout-sidebar .js-profile-editable-area a.Link--secondary",
    text: null,
    host: "guard",
    insert: "after",
  },
];
