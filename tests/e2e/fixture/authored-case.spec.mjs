// Names and titles people wrote keep how they read. With uppercase headings, and with each
// heading face that has no lowercase forms (Bungee, Bebas Neue, Cinzel), a mixed-case display name,
// username, organization, repository name, pull request title, file name and README heading keep
// their case and lowercase letterforms, while GitHub's own headings and tabs take the treatment.
// The GitHub-like page carries GitHub's markup for each name as captured logged out on
// github.com on 2026-11-09; the preview draws the same rules on its own fixture.
import { PREFS, classic, expect, inFrame, mount, test } from "./helpers.mjs";

// GitHub's markup for the names the adversarial page lacks.
const NAMES = `
<div class="orghead"><h1 class="h2 lh-condensed">Sideband Studio</h1></div>
<div id="repo-title-component"><div itemprop="name" data-testid="repo-name-wrapper"><strong><a data-testid="repo-name-link" href="#repo">GitHub-Reskin</a></strong></div></div>
<nav class="UnderlineNav-body" aria-label="User profile"><a class="UnderlineNav-item" aria-current="page" href="#overview">Overview</a></nav>
<h1 class="prc-PageHeader-Title" data-component="PH_Title"><bdi class="markdown-title" data-testid="issue-title">Keep colorPicker names in mixedCase</bdi> <span class="fgColor-muted">#19</span></h1>
<div data-testid="breadcrumbs-filename"><span aria-hidden="true">/</span><h1 class="prc-Heading-Heading" data-component="Heading" id="file-name-id">color.js</h1></div>
<article class="markdown-body"><h2 class="heading-element" dir="auto">Getting started with iOS</h2></article>`;

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
};
const GITHUB = {
  pinned: ".js-pinned-items-reorder-container > h2.f4",
  contributions: ".js-yearly-contributions > h2",
  organizations: ".h-card h2.h4",
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
