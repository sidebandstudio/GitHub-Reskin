// Street slang for some of GitHub's own labels. Part of Cyberpunk's effects, added by themes.js.
(function () {
  "use strict";

  // [element that holds only GitHub's label, the slang, the label's font size, any extra CSS for the label]
  // The label shrinks to font-size 0 and the slang is drawn at its size in a ::before. GitHub's
  // words stay in the page for screen readers, and the slang's empty alternative text keeps them
  // from hearing both. Only GitHub's labels change, never names, numbers or anything users wrote.
  // Each selector starts at the part of GitHub's page the label is always in, a class, id or
  // data attribute that GitHub's Markdown never keeps as written.
  const SWAPS = [
    // Profiles. Pinned (or Popular repositories), Achievements, Organizations, the Pro badge,
    // Edit profile, Sponsor, the graph legend's Less and More, Contribution activity, Show more activity.
    [".Layout-main .js-pinned-items-reorder-container > h2", "Preem picks", "16px"],
    [".h-card h2 > a[href$='?tab=achievements']", "Street cred", "16px"],
    [".h-card h2:has(+ a[itemprop='follows'])", "Crews", "16px"],
    [".h-card .Label[title='Label: Pro']", "Preem", "12px"],
    [".h-card .js-profile-editable-edit-button", "Visit the ripperdoc", "14px"],
    // An inline-block, so Firefox centers the slang beside the heart as it does GitHub's word.
    [".h-card #sponsor-profile-button .Button-label > span", "Send eddies", "14px", "display:inline-block;"],
    [".js-calendar-graph span:has(+ #contribution-graph-legend-level-0)", "Zeroed", "12px"],
    [".js-calendar-graph #contribution-graph-legend-level-4 + span", "Preem", "12px"],
    [".Layout-main #js-contribution-activity > h2", "Gig log", "16px"],
    ["#js-contribution-activity .contribution-activity-show-more:not(:disabled)", "Show more gigs", "12px"],
    // Repositories. The Code button, Sponsor, Releases and Contributors. The counts sit beside
    // the Releases and Contributors links, and a counter inside one is never taken for the label.
    ["#repo-content-pjax-container button[data-variant='primary']:has(.octicon-code) [data-component='text']", "Jack in", "14px"],
    ["[data-testid='repo-header-actions'] [data-testid='sponsor-button'] [data-component='text']", "Send eddies", "12px"],
    ["#repo-content-pjax-container [data-component='SplitPageLayout.Pane'] h2 a[href$='/releases'] > span:not(.Counter,[data-component='CounterLabel'])", "Drops", "16px"],
    ["#repo-content-pjax-container [data-component='SplitPageLayout.Pane'] h2 a[href$='/graphs/contributors'] > span:not(.Counter,[data-component='CounterLabel'])", "Netrunners", "16px"],
  ];

  // Where people's own words are shown: READMEs and other rendered Markdown, comments, issue and
  // pull request titles, and files, gists' included. Markdown keeps headings, links, titles and
  // itemprop, so what someone wrote can look like one of GitHub's labels. No rule applies inside.
  const USER_CONTENT = ".markdown-body,.comment-body,.js-comment-body,.markdown-title,.file,.blob-wrapper,.react-code-file-contents";
  const OWN = `:not(:is(${USER_CONTENT}) *)`;

  // The same type as themes.js uses for Cyberpunk.
  const FONT_DISPLAY = `"Bahnschrift","DIN Alternate","Roboto Condensed","Arial Narrow",ui-monospace,monospace`;
  const FONT_MONO = `ui-monospace,"SF Mono",SFMono-Regular,"Cascadia Mono","JetBrains Mono",Menlo,Consolas,"Liberation Mono",monospace`;

  const alpha = (color, percent) => `color-mix(in srgb,${color} ${percent}%,transparent)`;

  // Cyberpunk sets --fgColor-accent to its neon mixed until it reads, so tags use that for text
  // and the raw neon only for glows.
  function slang(p) {
    const swaps = SWAPS.map(
      ([selector, word, size, extra = ""]) => `${selector}${OWN}{${extra}font-size:0 !important}\n${selector}${OWN}::before{content:"${word}" / "";font-size:${size}}`,
    ).join("\n");
    // Pinned's heading also holds GitHub's spinner and its "Order updated." note, which keep
    // their size. Then tags added next to GitHub's text: "choom" over every profile's name,
    // a sign-off in the footer, and a stamp on the 404 picture. Where corner-shape doesn't draw,
    // Gecko included, the tag and stamp get square corners, as in themes.js, but no clip-path,
    // which would cut off their glow.
    const choom = `.h-card .vcard-names${OWN}::before`;
    const stamp = `.application-main div:has(> img[data-static-error-asset='404-illustration'])${OWN}::after`;
    return `/* reskin-slang */
${swaps}
.Layout-main .js-pinned-items-reorder-container > h2 > *${OWN}{font-size:12px}
${choom}{content:"// choom" / "";display:block;width:fit-content;margin-bottom:8px;padding:3px 8px 2px;font:600 11px/16px ${FONT_MONO};letter-spacing:.2em;text-transform:uppercase;color:var(--fgColor-accent);border:1px solid var(--fgColor-accent);border-radius:6px 0;corner-shape:bevel;box-shadow:0 0 10px ${alpha(p.accent, 35)},inset 0 0 8px ${alpha(p.accent, 15)};text-shadow:0 0 6px ${alpha(p.accent, 60)}}
footer.footer .footer-octicon + span${OWN}::after{content:"// stay preem, choom" / "";margin-left:8px;font-family:${FONT_MONO};letter-spacing:.08em;text-transform:uppercase;color:var(--fgColor-accent);text-shadow:0 0 6px ${alpha(p.accent, 50)}}
${stamp}{content:"Flatlined" / "";position:absolute;z-index:3;right:6%;bottom:10%;padding:4px 16px;font:700 clamp(22px,4vw,44px)/1.1 ${FONT_DISPLAY};letter-spacing:.14em;text-transform:uppercase;color:var(--fgColor-accent);background:${alpha(p.bg, 88)};border:2px solid var(--fgColor-accent);border-radius:14px 0;corner-shape:bevel;transform:rotate(-6deg);box-shadow:0 0 18px ${alpha(p.accent, 55)};text-shadow:-2px 0 ${alpha(p.graph, 70)},2px 0 ${alpha(p.accent, 50)},0 0 12px ${alpha(p.accent, 60)}}
@supports (not (corner-shape:bevel)) or (-moz-appearance:none){
${choom}{border-radius:0}
${stamp}{border-radius:0}
}
`;
  }

  globalThis.GitHubReskin.slang = slang;
})();
