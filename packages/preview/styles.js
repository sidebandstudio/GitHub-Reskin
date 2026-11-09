// Layout of the inert GitHub-like fixture. Colors come only from the Primer variables in
// variables.js; language dots use GitHub's fixed linguist colors, which themes never change.
// Body and code keep native system families. The frame's own width drives the narrow layout.
export const LANGUAGE_COLORS = Object.freeze({
  Rust: "#dea584",
  Python: "#3572a5",
  TypeScript: "#3178c6",
  Swift: "#f05138",
  JavaScript: "#f1e05a",
  CSS: "#663399",
  HTML: "#e34c26",
});

export const FIXTURE_CSS = `
*,*::before,*::after{box-sizing:border-box}
html{color-scheme:light dark;-webkit-text-size-adjust:100%}
html,body{margin:0;padding:0}
body{background:var(--bgColor-default);color:var(--fgColor-default);font:14px/1.5 -apple-system,BlinkMacSystemFont,"Segoe UI","Noto Sans",Helvetica,Arial,sans-serif;overflow-wrap:break-word}
code,pre,.mono{font-family:ui-monospace,SFMono-Regular,"SF Mono",Menlo,Consolas,"Liberation Mono",monospace}
h1,h2,h3,h4,p,ol,ul{margin:0}
a{color:var(--fgColor-accent);text-decoration:none}
img{max-width:100%;height:auto}
svg.octicon{fill:currentColor;vertical-align:text-bottom;flex:none}
.color-fg-muted{color:var(--fgColor-muted)}
.f4{font-size:16px}.text-normal{font-weight:400}.text-bold{font-weight:600}.mb-2{margin-bottom:8px}
.page{max-width:1280px;margin:0 auto;padding:24px 32px 40px}
.Box{border:1px solid var(--borderColor-default);border-radius:6px;background:var(--bgColor-default)}
.Box-header{padding:12px 16px;border-bottom:1px solid var(--borderColor-default);background:var(--bgColor-muted);border-radius:6px 6px 0 0}
.Box-row{padding:8px 16px;border-top:1px solid var(--borderColor-muted);display:flex;gap:10px;align-items:center}
.Box-row:first-child{border-top:0}
.Label{display:inline-block;padding:0 7px;font-size:12px;font-weight:500;line-height:18px;border:1px solid var(--control-borderColor-rest);border-radius:2em;color:var(--fgColor-muted)}
.Counter{display:inline-block;min-width:20px;padding:0 6px;font-size:12px;font-weight:500;line-height:18px;text-align:center;border-radius:2em;background:var(--bgColor-neutral-muted);color:var(--fgColor-default)}
.avatar{border-radius:50%;display:block;background:var(--bgColor-muted);box-shadow:0 0 0 1px var(--borderColor-default)}
.avatar-frame{position:relative}

/* Profile */
.layout{display:grid;grid-template-columns:256px minmax(0,1fr);gap:24px;align-items:start}
.h-card{position:relative}
.h-card .avatar{width:128px;height:128px;margin-bottom:16px}
.vcard-names{line-height:1.25;margin:0 0 16px}
.vcard-fullname{display:block;font-size:24px;font-weight:600}
.vcard-username{display:block;font-size:20px;font-weight:300;color:var(--fgColor-muted)}
.user-profile-bio{white-space:pre-line;font-size:16px;margin-bottom:16px}
.vcard-details{list-style:none;padding:0;margin:0 0 16px;display:grid;gap:6px}
.vcard-detail{display:flex;gap:8px;align-items:center;color:var(--fgColor-default)}
.vcard-detail .octicon{color:var(--fgColor-muted)}
.follow-line{color:var(--fgColor-muted);margin-bottom:16px}
.follow-line strong{color:var(--fgColor-default)}
.border-top{border-top:1px solid var(--borderColor-muted);padding-top:16px;margin-top:16px}
.h4{font-size:16px;font-weight:600;margin-bottom:8px}
.org-list{display:flex;gap:4px}
.org-list .avatar{width:32px;height:32px;border-radius:6px}
.profile-readme{padding:24px;margin-bottom:24px}
.profile-readme-title{font-size:12px;color:var(--fgColor-muted);font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;margin-bottom:12px}
.markdown-body{font-size:16px;line-height:1.5}
.markdown-body>*+*{margin-top:16px}
.markdown-body h1{font-size:2em;font-weight:600;padding-bottom:.3em;border-bottom:1px solid var(--borderColor-muted)}
.markdown-body h2{font-size:1.5em;font-weight:600;padding-bottom:.3em;border-bottom:1px solid var(--borderColor-muted)}
.markdown-body h3{font-size:1.25em;font-weight:600}
.markdown-body ul,.markdown-body ol{padding-left:2em}
.markdown-body li+li{margin-top:4px}
.markdown-body li img{height:20px;width:auto;vertical-align:middle}
.markdown-body code{padding:.2em .4em;font-size:85%;background:var(--bgColor-neutral-muted);border-radius:6px}
.markdown-body a{color:var(--fgColor-accent)}
.js-pinned-items-reorder-container{position:relative;margin-bottom:24px}
.pinned-items-list{list-style:none;padding:0;margin:0;display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:16px}
.pinned-item-list-item{padding:16px;display:flex;flex-direction:column;gap:8px;min-height:120px}
.pinned-item-title{display:flex;gap:8px;align-items:center;min-width:0}
.pinned-item-title .repo{font-weight:600;color:var(--fgColor-accent);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.pinned-item-desc{font-size:12px;color:var(--fgColor-muted);flex:1}
.pinned-item-meta{display:flex;gap:16px;font-size:12px;color:var(--fgColor-muted);align-items:center}
.lang-dot{display:inline-block;width:12px;height:12px;border-radius:50%;vertical-align:-1px;margin-right:4px;border:1px solid rgb(128 128 128 / .2)}
.js-yearly-contributions{position:relative}
.ContributionCalendar{padding:16px;overflow:hidden}
.ContributionCalendar-months{display:grid;grid-auto-flow:column;grid-auto-columns:13px;font-size:12px;color:var(--fgColor-default);margin:0 0 4px 32px;height:15px}
.ContributionCalendar-body{display:flex;gap:6px;overflow:hidden}
.ContributionCalendar-labels{display:grid;grid-template-rows:repeat(7,10px);row-gap:3px;font-size:12px;line-height:10px;color:var(--fgColor-default);width:26px}
.ContributionCalendar-grid{display:grid;grid-auto-flow:column;grid-template-rows:repeat(7,10px);grid-auto-columns:10px;gap:3px;justify-content:start}
.ContributionCalendar-day{width:10px;height:10px;border-radius:2px;outline:1px solid transparent;outline-offset:-1px}
.ContributionCalendar-day[data-level="0"]{background:var(--contribution-default-bgColor-0);outline-color:var(--contribution-default-borderColor-0)}
.ContributionCalendar-day[data-level="1"]{background:var(--contribution-default-bgColor-1)}
.ContributionCalendar-day[data-level="2"]{background:var(--contribution-default-bgColor-2)}
.ContributionCalendar-day[data-level="3"]{background:var(--contribution-default-bgColor-3)}
.ContributionCalendar-day[data-level="4"]{background:var(--contribution-default-bgColor-4)}
.ContributionCalendar-footer{display:flex;justify-content:space-between;align-items:center;gap:8px;margin-top:8px;font-size:12px;color:var(--fgColor-muted);flex-wrap:wrap}
.ContributionCalendar-legend{display:flex;gap:3px;align-items:center}
.ContributionCalendar-legend .ContributionCalendar-day{display:inline-block}
.calendar-crop{display:none}
.week{display:contents}

/* Repository */
.repo-head{display:flex;gap:8px;align-items:center;font-size:20px;flex-wrap:wrap;margin-bottom:16px}
.repo-head .owner{color:var(--fgColor-accent)}
.repo-head .name{color:var(--fgColor-accent);font-weight:600}
.UnderlineNav{display:flex;gap:8px;border-bottom:1px solid var(--borderColor-muted);margin:0 -32px 24px;padding:0 32px;overflow:hidden}
.UnderlineNav-item{display:flex;gap:8px;align-items:center;padding:8px;color:var(--fgColor-default);border-bottom:2px solid transparent;white-space:nowrap}
.UnderlineNav-item[aria-current]{border-bottom-color:var(--underlineNav-borderColor-active);font-weight:600}
.repo-layout{display:grid;grid-template-columns:minmax(0,1fr) 296px;gap:24px;align-items:start}
.file-list .Box-header{display:flex;gap:8px;align-items:center}
.file-row .octicon{color:var(--fgColor-muted)}
.file-row .dir .octicon{color:var(--fgColor-accent)}
.repo-readme{margin-top:24px}
.repo-readme .Box-header{font-weight:600}
.repo-readme .markdown-body{padding:24px}
.about p{font-size:16px;margin-bottom:16px}
.about-meta{list-style:none;margin:0;padding:0;display:grid;gap:8px;color:var(--fgColor-muted)}
.about-meta strong{color:var(--fgColor-default)}
.lang-bar{display:flex;height:8px;border-radius:6px;overflow:hidden;margin:8px 0;gap:2px}
.lang-list{list-style:none;margin:0;padding:0;display:flex;flex-wrap:wrap;gap:4px 16px;font-size:12px}
.lang-list .pct{color:var(--fgColor-muted)}

/* Diff */
.diff-title{font-size:20px;margin-bottom:16px}
.file-header{display:flex;gap:8px;align-items:center;font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;font-size:12px;flex-wrap:wrap}
.diffstat{display:inline-flex;gap:1px;margin-left:4px}
.diffstat i{display:inline-block;width:8px;height:8px;border-radius:1px;background:var(--bgColor-neutral-muted)}
.diffstat i.add{background:var(--bgColor-success-emphasis)}
.diffstat i.del{background:var(--bgColor-danger-emphasis)}
.text-success{color:var(--fgColor-success)}.text-danger{color:var(--fgColor-danger)}
.diff-table{width:100%;border-collapse:collapse;font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;font-size:12px;line-height:20px;table-layout:fixed}
.diff-table td{padding:0 8px;vertical-align:top}
.diff-table .num{width:44px;text-align:right;color:var(--fgColor-muted);user-select:none}
.diff-table .code{white-space:pre-wrap;word-break:break-word;background:var(--codeMirror-bgColor);color:var(--codeMirror-fgColor)}
.diff-table .num{background:var(--codeMirror-bgColor)}
.diff-table tr.hunk td{background:var(--diffBlob-hunkLine-bgColor);color:var(--diffBlob-hunkLine-fgColor)}
.diff-table tr.add td{background:var(--diffBlob-additionLine-bgColor);color:var(--diffBlob-additionLine-fgColor)}
.diff-table tr.del td{background:var(--diffBlob-deletionLine-bgColor);color:var(--diffBlob-deletionLine-fgColor)}
.diff-table tr.add .x{background:var(--diffBlob-additionWord-bgColor);color:var(--diffBlob-additionWord-fgColor);border-radius:3px}
.diff-table tr.del .x{background:var(--diffBlob-deletionWord-bgColor);color:var(--diffBlob-deletionWord-fgColor);border-radius:3px}
.pl-c{color:var(--prettylights-syntax-comment)}.pl-k{color:var(--prettylights-syntax-keyword)}.pl-s{color:var(--prettylights-syntax-string)}
.pl-en{color:var(--prettylights-syntax-entity)}.pl-c1{color:var(--prettylights-syntax-constant)}.pl-v{color:var(--prettylights-syntax-variable)}.pl-ent{color:var(--prettylights-syntax-entityTag)}

/* Empty states and 404 */
.blankslate{padding:32px;text-align:center}
.blankslate .octicon{color:var(--fgColor-muted);margin-bottom:8px}
.blankslate h3{font-size:20px;font-weight:600;margin-bottom:4px}
.blankslate p{color:var(--fgColor-muted)}
.issues-head{display:flex;gap:16px;align-items:center;margin:24px 0 16px;flex-wrap:wrap}
.error-page{max-width:640px;margin:24px auto;text-align:center}
.error-illustration{position:relative;height:180px;margin-bottom:24px}
.error-illustration .ring{position:absolute;left:50%;top:50%;border:2px solid var(--borderColor-default);border-radius:50%}
.error-illustration .code{position:absolute;inset:0;display:flex;align-items:center;justify-content:center;font-size:72px;font-weight:700;color:var(--fgColor-muted);letter-spacing:4px}
.error-page h1{font-size:28px;font-weight:600;margin-bottom:8px}
.error-page p{color:var(--fgColor-muted);font-size:16px;margin-bottom:16px}
.error-links{display:flex;gap:16px;justify-content:center;flex-wrap:wrap}

@media (max-width:767px){
  .page{padding:16px 16px 24px}
  .layout,.repo-layout{grid-template-columns:minmax(0,1fr);gap:16px}
  .h-card{display:grid;grid-template-columns:64px minmax(0,1fr);column-gap:16px;align-items:center}
  .h-card .avatar{width:64px;height:64px;margin:0}
  .h-card .vcard-names{margin:0}
  .vcard-fullname{font-size:20px}.vcard-username{font-size:16px}
  .h-card>.after-names{grid-column:1/-1;margin-top:16px}
  .profile-readme,.repo-readme,.h-card .border-top{display:none}
  .user-profile-bio{font-size:14px}
  .pinned-items-list{grid-template-columns:minmax(0,1fr)}
  .pinned-item-list-item:nth-child(n+2){display:none}
  .week-hidden-narrow{display:none}
  .ContributionCalendar-months{display:none}
  .calendar-crop{display:block}
  .UnderlineNav{margin:0 -16px 16px;padding:0 16px}
  .error-illustration{height:140px}
  .error-illustration .code{font-size:56px}
}
`;
