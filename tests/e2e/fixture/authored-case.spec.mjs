// Names and titles people wrote keep how they read. With uppercase headings, and with each
// heading face that has no lowercase forms (Bungee, Bebas Neue, Cinzel), a mixed-case display name,
// username, organization, repository name, pull request title, file name and README heading keep
// their case and lowercase letterforms, while GitHub's own headings and tabs take the treatment.
// The GitHub-like page carries GitHub's markup for each name as captured logged out on
// github.com on 2026-11-09, including issue and pull request list titles, pinned discussion
// titles, discussion authors, a project's name, columns and cards, wiki titles, milestones,
// search results, a discussion category, comparison branches, a comment's editor and a profile's
// repository list;
// the preview draws the same rules on its own fixture.
import { PREFS, classic, expect, inFrame, mount, test } from "./helpers.mjs";

// GitHub's markup for the names the adversarial page lacks.
const NAMES = `
<div class="orghead"><h1 class="h2 lh-condensed">Sideband Studio</h1></div>
<div id="repo-title-component"><div itemprop="name" data-testid="repo-name-wrapper"><strong><a data-testid="repo-name-link" href="#repo">GitHub-Reskin</a></strong></div></div>
<nav class="UnderlineNav-body" aria-label="User profile"><a class="UnderlineNav-item" aria-current="page" href="#overview">Overview</a></nav>
<h1 class="prc-PageHeader-Title" data-component="PH_Title"><bdi class="markdown-title" data-testid="issue-title">Keep colorPicker names in mixedCase</bdi> <span class="fgColor-muted">#19</span></h1>
<div data-testid="breadcrumbs-filename"><span aria-hidden="true">/</span><h1 class="prc-Heading-Heading" data-component="Heading" id="file-name-id">color.js</h1></div>
<article class="markdown-body"><h2 class="heading-element" dir="auto">Getting started with iOS</h2></article>
<ul role="list"><li><div><h3><a data-testid="issue-listitem-title-link" href="#issue"><span><span data-component="Text">Folder sessions show session changes rather than branch changes</span></span></a></h3></div></li></ul>
<ul role="list"><li><div><h3><a data-testid="listitem-title-link" data-hovercard-type="pull_request" href="#pull"><span><span data-component="Text">sessions: preserve remote connection for folderless chats</span></span></a></h3></div></li></ul>
<discussion-spotlight-container><div class="discussion-spotlight-container"><h3 class="mb-2"><a data-target="discussion-spotlight-container.mainLink" class="lh-condensed discussion-title Link--primary Link" href="#pinned">Companies / Sites using Next.js</a></h3></div></discussion-spotlight-container>
<div class="timeline-comment"><h3 class="timeline-comment-header-text text-normal f5"><div class="d-flex flex-items-center Truncate"><a data-hovercard-type="user" data-hovercard-url="/users/Janpot/hovercard" href="#Janpot" class="Truncate Link--primary Link d-flex flex-items-center text-bold"><div class="d-flex flex-column Truncate"><span class="Truncate-text text-bold">Janpot</span></div></a> <a href="#reply" class="Link--secondary js-timestamp">Feb 22, 2020</a> <span class="Label">Maintainer</span></div></h3></div>
<projects-v2 id="memex-root"><div role="navigation" aria-label="Project"><div><div><h1 data-component="Text">Agent Host Protocol</h1></div></div></div><div data-board-column="Up Next"><h2><span data-component="Text">Up Next</span></h2><h3 id="board-card-title-94967103" class="d-inline f5 text-normal"><span data-component="Text">Cross-repository milestones [GA]</span></h3></div></projects-v2>
<h1 data-component="Text" class="own-react-title">Projects</h1>
<div id="wiki-wrapper"><div class="gh-header"><h1 class="gh-header-title">Native Crash Issues</h1></div><h2 id="wiki-pages-box-heading">Pages</h2></div>
<ul><li role="listitem"><div><h3><a href="/microsoft/vscode/milestone/470"><span>Backlog Candidates</span></a></h3></div></li></ul>
<div data-testid="results-list"><div><h3><div><a data-component="Link" href="#repo" data-hovercard-type="repository"><span>hydy100/R3nzSkin</span></a></div><div><a data-component="Link" href="#result"><span data-component="Text">Hydy100 pls update reskin</span></a></div></h3></div></div>
<div class="Subhead"><div class="flex-1"><h2 class="Subhead-heading h4" id="discussions-list"><span aria-hidden="true">🎓</span>Help <span>Discussions</span></h2></div></div>
<details class="details-overlay select-menu"><summary class="branch Button--secondary Button--small Button"><span class="Button-content"><span class="Button-label"><span class="fgColor-muted text-bold">base:</span> <span class="css-truncate css-truncate-target" data-menu-button="">release/1.95</span></span></span></summary></details>
<div><h3 class="wb-break-all"><a href="#codeRepository" itemprop="name codeRepository">dotfiles</a> <span class="Label Label--secondary">Public</span></h3></div>
<span class="js-comment-edit-history"><edit-history><button role="button" data-target="edit-history.menuTrigger" type="button" class="Button--invisible Button--small Button"><span class="Button-content"><span class="Button-label">edited by ijjk</span></span></button></edit-history></span>
<h2 class="f4"><a class="no-underline" data-hovercard-type="organization" href="#gitpod-io"><span class="f4 d-inline-block">gitpod-io</span></a></h2>`;

// Each probe: its own text, the text as shown, and whether its face draws lowercase forms.
const PROBE = (doc, selectors) =>
  Promise.all(
    Object.entries(selectors).map(async ([name, selector]) => {
      const el = doc.querySelector(selector);
      const style = doc.defaultView.getComputedStyle(el);
      const ctx = doc.createElement("canvas").getContext("2d");
      ctx.font = `${style.fontWeight} 100px ${style.fontFamily}`;
      await doc.fonts.load(ctx.font, "hxp");
      const m = (c) => ctx.measureText(c);
      // An ascender above the x-height and a descender below the baseline, each over 5% of the em.
      const lowercase = m("h").actualBoundingBoxAscent - m("x").actualBoundingBoxAscent > 5 && m("p").actualBoundingBoxDescent > 5;
      return [name, { text: el.textContent.trim(), shown: el.innerText.trim(), transform: style.textTransform, family: style.fontFamily.split(",")[0], lowercase }];
    }),
  ).then(Object.fromEntries);

const AUTHORED = {
  name: ".vcard-names .p-name",
  username: ".vcard-names .p-nickname",
  header: ".AppHeader-context-item",
  organization: ".orghead h1",
  repository: "a[data-testid='repo-name-link']",
  title: "bdi.markdown-title",
  file: "#file-name-id",
  readme: "article.markdown-body h2.heading-element",
  issueList: "a[data-testid='issue-listitem-title-link'] span[data-component='Text']",
  pullList: "a[data-testid='listitem-title-link'] span[data-component='Text']",
  pinnedDiscussion: "a.discussion-title",
  discussionAuthor: ".timeline-comment-header-text .Truncate-text",
  project: "projects-v2 h1[data-component='Text']",
  projectColumn: "[data-board-column] h2 span",
  projectCard: "[id^='board-card-title-'] span",
  wiki: "#wiki-wrapper .gh-header-title",
  milestone: "a[href*='/milestone/'] span",
  searchRepository: "[data-testid='results-list'] [data-hovercard-type='repository'] span",
  searchTitle: "[data-testid='results-list'] span[data-component='Text']",
  category: ".Subhead #discussions-list",
  branch: "summary.branch [data-menu-button]",
  repositoryList: "a[itemprop='name codeRepository']",
  organizationLink: "h2.f4 a[data-hovercard-type='organization'] span",
  editor: "[data-target='edit-history.menuTrigger'] .Button-label",
};
const GITHUB = {
  pinned: ".js-pinned-items-reorder-container > h2.f4",
  contributions: ".js-yearly-contributions > h2",
  organizations: ".h-card h2.h4",
  // GitHub's own words beside names: a role badge, a visibility label, a React page title outside
  // the project app, and the wiki's page list.
  badge: ".timeline-comment-header-text .Label",
  visibility: "h3.wb-break-all > .Label",
  reactTitle: "h1.own-react-title",
  wikiPages: "#wiki-pages-box-heading",
};

const CASES = [
  { label: "uppercase headings", fonts: { heading: "barlow-condensed" }, typography: { uppercaseHeadings: true } },
  ...["bungee", "bebas-neue", "cinzel"].map((heading) => ({ label: heading, fonts: { heading }, typography: { uppercaseHeadings: false } })),
  { label: "bungee with uppercase headings", fonts: { heading: "bungee", body: "ibm-plex-sans" }, typography: { uppercaseHeadings: true } },
];
const themeFor = ({ fonts, typography }) => ({ ...classic("gruvbox"), fonts, typography });
const capsOnly = ({ fonts }) => ["bungee", "bebas-neue", "cinzel"].includes(fonts.heading);

for (const c of CASES) {
  test(`on the GitHub-like page, ${c.label} leave names and titles people wrote as written`, async ({ page, fixtureApp }) => {
    await page.goto(fixtureApp.url("adversarial.html"));
    await page.waitForFunction(() => document.documentElement.dataset.ready === "true");
    await page.evaluate((html) => document.querySelector("main .main").insertAdjacentHTML("afterbegin", html), NAMES);
    await page.evaluate(([t, p]) => window.reskinNative.apply(t, p), [themeFor(c), PREFS]);
    await page.evaluate(() => document.fonts.ready);
    const authored = await page.evaluate(`(${PROBE})(document, ${JSON.stringify(AUTHORED)})`);
    for (const [name, probe] of Object.entries(authored)) {
      expect(probe.shown, name).toBe(probe.text);
      expect(probe.text, name).toMatch(/[a-z]/);
      expect(probe.transform, name).toBe("none");
      expect(probe.lowercase, `${name} in ${probe.family}`).toBe(true);
    }
    const own = await page.evaluate(`(${PROBE})(document, ${JSON.stringify({ ...GITHUB, tab: ".UnderlineNav-item", number: "h1[data-component='PH_Title']" })})`);
    for (const name of Object.keys(GITHUB)) {
      if (c.typography.uppercaseHeadings) expect(own[name].shown, name).toBe(own[name].text.toUpperCase());
      expect(own[name].family, name).toMatch(/^"Reskin /);
      // A capitals-only face reaches GitHub's own headings, and it loaded.
      expect(own[name].lowercase, name).toBe(!capsOnly(c));
    }
    // Tabs take the heading face, never its case; the title heading keeps the face around its number.
    expect(own.tab.shown).toBe("Overview");
    expect(own.tab.family).toMatch(/^"Reskin /);
    expect(own.number.family).toMatch(/^"Reskin /);
  });
}

test("the preview leaves names and titles people wrote as written, as on github.com", async ({ page, fixtureApp }) => {
  // Bungee with uppercase headings: names stay in the body face and their case, while GitHub's
  // headings take both and its tabs take the face.
  const theme = themeFor({ fonts: { heading: "bungee" }, typography: { uppercaseHeadings: true } });
  await mount(page, fixtureApp, { view: "profile", theme });
  const profile = await inFrame(page, PROBE, { name: ".vcard-names .p-name", username: ".vcard-names .p-nickname", header: ".AppHeader-context-item", readme: ".markdown-body h3", pinned: ".js-pinned-items-reorder-container > h2", contributions: ".js-yearly-contributions > h2", organizations: ".h-card h2.h4" });
  for (const name of ["name", "username", "header", "readme"]) {
    expect(profile[name].shown, name).toBe(profile[name].text);
    expect(profile[name].text, name).toMatch(/[a-z]/);
    expect(profile[name].lowercase, `${name} in ${profile[name].family}`).toBe(true);
  }
  for (const name of ["pinned", "contributions", "organizations"]) {
    expect(profile[name].shown, name).toBe(profile[name].text.toUpperCase());
    expect(profile[name].family, name).toBe('"Reskin Bungee"');
    expect(profile[name].lowercase, name).toBe(false);
  }
  await mount(page, fixtureApp, { view: "repo", theme });
  const repo = await inFrame(page, PROBE, { owner: ".AppHeader-context-item", repository: ".repo-head .name", file: ".file-row span:last-child", readme: ".markdown-body h2", tab: ".UnderlineNav-item", about: ".about h2.h4" });
  for (const name of ["owner", "repository", "file", "readme"]) {
    expect(repo[name].shown, name).toBe(repo[name].text);
    expect(repo[name].lowercase, `${name} in ${repo[name].family}`).toBe(true);
  }
  expect(repo.tab.family).toBe('"Reskin Bungee"');
  expect(repo.tab.shown).toBe(repo.tab.text);
  expect(repo.about.shown).toBe("ABOUT");
  expect(repo.about.lowercase).toBe(false);
});
