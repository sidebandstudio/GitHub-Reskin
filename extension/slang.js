// Street slang for some of GitHub's own labels. Part of Cyberpunk's effects, added by themes.js.
(function () {
  "use strict";

  // [element that holds only GitHub's label, the slang, the label's font size, any extra CSS for the label]
  // The label shrinks to font-size 0 and the slang is drawn at its size in a ::before. GitHub's
  // words stay in the page for screen readers, and the slang's empty alternative text keeps them
  // from hearing both. Only GitHub's labels change, never names, numbers or anything users wrote.
  const SWAPS = [
    // Profiles. Pinned (or Popular repositories), Achievements, Organizations, the Pro badge,
    // Edit profile, Sponsor, the graph legend's Less and More, Contribution activity, Show more activity.
    [".js-pinned-items-reorder-container > h2", "Preem picks", "16px"],
    ["h2 > a[href$='?tab=achievements']", "Street cred", "16px"],
    ["h2:has(+ a[itemprop='follows'])", "Crews", "16px"],
    [".Label[title='Label: Pro']", "Preem", "12px"],
    [".js-profile-editable-edit-button", "Visit the ripperdoc", "14px"],
    // An inline-block, so Firefox centers the slang beside the heart as it does GitHub's word.
    ["#sponsor-profile-button .Button-label > span", "Send eddies", "14px", "display:inline-block;"],
    ["span:has(+ #contribution-graph-legend-level-0)", "Zeroed", "12px"],
    ["#contribution-graph-legend-level-4 + span", "Preem", "12px"],
    ["#js-contribution-activity > h2", "Gig log", "16px"],
    [".contribution-activity-show-more:not(:disabled)", "Show more gigs", "12px"],
    // Repositories. The Code button, Sponsor, Releases and Contributors.
    ["button[data-variant='primary']:has(.octicon-code) [data-component='text']", "Jack in", "14px"],
    ["[data-testid='sponsor-button'] [data-component='text']", "Send eddies", "12px"],
    ["h2 a[href$='/releases'] > span", "Drops", "16px"],
    ["h2 a[href$='/graphs/contributors'] > span", "Netrunners", "16px"],
  ];

  // The same type as themes.js uses for Cyberpunk.
  const FONT_DISPLAY = `"Bahnschrift","DIN Alternate","Roboto Condensed","Arial Narrow",ui-monospace,monospace`;
  const FONT_MONO = `ui-monospace,"SF Mono",SFMono-Regular,"Cascadia Mono","JetBrains Mono",Menlo,Consolas,"Liberation Mono",monospace`;

  const alpha = (color, percent) => `color-mix(in srgb,${color} ${percent}%,transparent)`;

  // Cyberpunk sets --fgColor-accent to its neon mixed until it reads, so tags use that for text
  // and the raw neon only for glows.
  function slang(p) {
    const swaps = SWAPS.map(
      ([selector, word, size, extra = ""]) => `${selector}{${extra}font-size:0 !important}\n${selector}::before{content:"${word}" / "";font-size:${size}}`,
    ).join("\n");
    // Tags added next to GitHub's text: "choom" over every profile's name, a sign-off in the
    // footer, and a stamp on the 404 picture.
    return `/* reskin-slang */
${swaps}
.vcard-names::before{content:"// choom" / "";display:block;width:fit-content;margin-bottom:8px;padding:3px 8px 2px;font:600 11px/16px ${FONT_MONO};letter-spacing:.2em;text-transform:uppercase;color:var(--fgColor-accent);border:1px solid var(--fgColor-accent);border-radius:6px 0;corner-shape:bevel;box-shadow:0 0 10px ${alpha(p.accent, 35)},inset 0 0 8px ${alpha(p.accent, 15)};text-shadow:0 0 6px ${alpha(p.accent, 60)}}
footer.footer .footer-octicon + span::after{content:"// stay preem, choom" / "";margin-left:8px;font-family:${FONT_MONO};letter-spacing:.08em;text-transform:uppercase;color:var(--fgColor-accent);text-shadow:0 0 6px ${alpha(p.accent, 50)}}
div:has(> img[data-static-error-asset='404-illustration'])::after{content:"Flatlined" / "";position:absolute;z-index:3;right:6%;bottom:10%;padding:4px 16px;font:700 clamp(22px,4vw,44px)/1.1 ${FONT_DISPLAY};letter-spacing:.14em;text-transform:uppercase;color:var(--fgColor-accent);background:${alpha(p.bg, 88)};border:2px solid var(--fgColor-accent);border-radius:14px 0;corner-shape:bevel;transform:rotate(-6deg);box-shadow:0 0 18px ${alpha(p.accent, 55)};text-shadow:-2px 0 ${alpha(p.graph, 70)},2px 0 ${alpha(p.accent, 50)},0 0 12px ${alpha(p.accent, 60)}}
`;
  }

  globalThis.GitHubReskin.slang = slang;
})();
