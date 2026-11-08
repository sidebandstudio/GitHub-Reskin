// Smaller fixtures for the other evidenced routes, modeled on slot-evidence.json (2026-11-08).
export const EMPTY_PROFILE = `<!doctype html>
<html lang="en" data-color-mode="auto" data-light-theme="light" data-dark-theme="dark"><head>
<title>empty-sample · GitHub</title><meta name="route-controller" content="profiles"><meta name="route-action" content="show"></head>
<body><main><div class="Layout">
  <div class="Layout-sidebar"><div class="h-card" itemtype="http://schema.org/Person"><div class="vcard-names-container"><h1 class="vcard-names"><span class="p-name">Empty Sample</span></h1></div></div></div>
  <div class="Layout-main"><turbo-frame id="user-profile-frame"><div class="mt-4">
    <div class="js-pinned-items-reorder-container">
      <h2 class="f4 mb-2 text-normal"> Popular repositories <span><svg aria-hidden="true" class="spinner"></svg><span class="sr-only">Loading</span></span></h2>
      <div class="blankslate-container"><div class="mb-4 blankslate"><h2 class="blankslate-heading"> empty-sample doesn't have any public repositories yet. </h2></div></div>
    </div>
  </div></turbo-frame></div>
</div></main></body></html>`;

export const NOT_FOUND = `<!doctype html>
<html lang="en" data-color-mode="auto" data-light-theme="light" data-dark-theme="dark"><head>
<title>Page not found · GitHub · GitHub</title><meta name="route-controller" content="files"><meta name="route-action" content="disambiguate"></head>
<body><div class="application-main"><main class="font-mktg"><div class="position-relative">
  <div class="position-absolute overflow-hidden width-full top-0"><img data-static-error-asset="404-background" alt="" src="data:,"></div>
  <div class="position-relative width-full mx-auto overflow-hidden"><img data-static-error-asset="404-illustration" alt="404 “This is not the web page you are looking for”" src="data:,"></div>
</div></main></div>
<div data-color-mode="light"><footer role="contentinfo"><h2 class="visually-hidden">Site-wide Links</h2></footer></div>
</body></html>`;

export const ISSUES = (focusable = true) => `<!doctype html>
<html lang="en" data-color-mode="auto" data-light-theme="light" data-dark-theme="dark"><head>
<title>Issues · sample/repo · GitHub</title><meta name="route-controller" content="issues"><meta name="route-action" content="index"></head>
<body><main id="js-repo-pjax-container"><div data-testid="issues-list-surface"><div>
  <div ${focusable ? 'tabindex="-1" data-listview-component="items-list"' : ""}><div ${focusable ? 'role="status"' : ""}><div>
    <div data-component="Blankslate"><span data-component="Blankslate.Visual"></span><h2 data-component="Blankslate.Heading">No results matched your search</h2><p data-component="Blankslate.Description">Try a different search query.</p></div>
  </div></div></div>
</div></div></main></body></html>`;

export const REPOSITORY = `<!doctype html>
<html lang="en" data-color-mode="auto" data-light-theme="light" data-dark-theme="dark"><head>
<title>sample/repo · GitHub</title><meta name="route-controller" content="files"><meta name="route-action" content="disambiguate"></head>
<body><div itemscope itemtype="http://schema.org/SoftwareSourceCode"><main id="js-repo-pjax-container">
  <h2>About</h2><h2>Releases</h2><h2>Contributors</h2>
  <article class="markdown-body"><h2>Pinned</h2><h2>Contribution activity</h2></article>
</main></div></body></html>`;
