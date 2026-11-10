# Security

## Advanced CSS approval: what it protects and where it stops

A theme may carry advanced CSS. GitHub Reskin applies a saved theme's CSS only after the person
turns on Enable advanced CSS in the theme builder for that theme and that exact text, and only while
the stored theme keeps that exact sanitized CSS under the current sanitizer. Bundled themes are
reviewed with the extension and apply their own CSS only when that bundled theme is selected.

**Untrusted.** Web pages, including github.com and anything a page script does; imported theme
files, pasted text, chatbot answers, share codes and preview links; drafts and kept drafts; copies
of themes; and every extension context except the builder's settings page: the popup, the first-run
page and content scripts. None of these can create or move an approval.

**Trusted.** The extension's own storage (`chrome.storage.local` / `browser.storage.local`) and its
own code. Storage is the trust root: it holds the stored themes, their CSS, every setting and the
approval records, and there is no authority outside it to check them against.

**What approval protects against.** CSS arriving through an import, a share link or preview link,
a copy or re-added theme, a draft, Undo or a resumed draft, another window, a stale editor, or a
message from any page other than the builder document that asked for the approval. Approval
tickets are bound to the browser-provided identity of that settings page document and to the
settings revision it saw, and each is used once.

**What it does not protect against.** Direct edits of the extension's own storage, for example by
another program with access to the browser profile, by developer tools on the extension's pages, or
by restoring an older copy of that storage. Such an actor already controls the stored theme, its
CSS and every setting. At startup the background still drops any approval that does not name a
stored local theme's exact canonical CSS hash and the current sanitizer version, and any approval
for a theme without CSS, so a damaged or outdated record cannot widen what applies.
