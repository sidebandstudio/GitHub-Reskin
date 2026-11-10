# @github-reskin/settings

Settings format 2 for the extension: validation, migration from 1.1.0 storage, the commit reducer,
storage admission, the boot snapshot rule, the serialized repository and the message boundary. Pure
ESM with no DOM. The only browser API is `storage.js`, a `StorageAdapter` over `storage.local`.

The background host is `extension/background/host.js`, and the content lifecycle with its boot gate
is `extension/content/lifecycle/`. Neither renders anything. Both take renderer callbacks built from
the engine, C3's adapter and C5's appearance, so no second color engine exists.

## Records

All records live in `storage.local`. Nothing goes to page storage. The content script's only
page-storage call removes 1.1.0's `github-reskin-css` key, without reading it, after first paint.

| Key | Contents |
| --- | --- |
| `reskin.settings` | `SettingsV2`: `settingsVersion: 2`, `revision`, `enabled`, `selectedThemeId`, `preferences {appearance, extras, text, motion, fonts, effects}`, `cssConsent {[localId]: {hash, sanitizerVersion}}`, `customThemes`, `onboardingCompleted`, `migration {from?, notices}` |
| `reskin.boot` | `BootRecord`, or `null` when disabled or no snapshot could be made. Written in the same `storage.set` as settings. |
| `reskin.lastGood` | `{themeId, sourceHash, revision}` of the previous selection, for Undo. Cleared, with an `undo-cleared` notice, when its local theme is deleted, including when that theme was the selection being replaced. |
| `reskin.draft` | One editor draft, up to 1.25 MiB. It carries no CSS approval. |
| `reskin.cssApprovals` | Up to 32 pending Enable advanced CSS approvals not yet redeemed: SHA-256 digests of the ticket and editor secrets, the target (`new` or a local ID), the sanitized CSS hash and sanitizer version. Written with the settings it belongs to; Reset all clears it. |
| `reskin.recovery` | One bounded copy (1 MiB) of 1.x or damaged v2 data that could not be used. It is kept until `dismissMigration` or `resetAll`. A later salvage never replaces it: its copy is appended to `salvaged` within the room left, and what does not fit is marked truncated. |

A commit clears `reskin.lastGood`, `reskin.draft` or `reskin.recovery` by writing `null` in the same
`storage.set` as settings and boot, never by a separate removal, and readers treat `null` as absent.

The limits: 50 saved themes, 4 MiB of canonical custom source and 8 MiB across every record. The
8 MiB is measured, keys included, before each write. A write that would exceed it is refused, and
the committed state stays.

## API

| Export | Behavior |
| --- | --- |
| `createCatalogSource(entries)` | `{hash, ids, has, document, sourceHash}` from validated bundled documents. C6 builds it from `themes/catalog.json`. |
| `validateSettings(value, catalog)` | `{ok:true, settings, upgraded}` or `{ok:false, newer, issues}`. It is strict, except that a Revision 3 record without `appearance`/`cssConsent` is upgraded, and there extras false becomes Calm. |
| `salvageSettings(value, catalog)` | Rebuilds a damaged record from defaults, keeping every field that validates on its own. Every value it drops or replaces, down to a single preference, goes to recovery. |
| `effectivePreferences(settings)` | `{enabled, appearance, extras, text, motion, fonts, effects}`, with extras false under Calm. |
| `migrateLegacy(raw, {catalog, newId, repair?})` | The 1.1.0 migration table below. Pure. |
| `reduceAction(settings, action, {catalog, newId, css?, images?})` | Applies one commit action, or throws `ActionError`. `reduceState` also takes and returns the pending approvals. |
| `settleConsent`, `mintApproval`, `withdrawApprovals`, `readApprovals` | The CSS approval rule (`consent.js`). |
| `buildBootRecord`, `bootRecordProblems`, `snapshotProblems`, `bootMismatches`, `usableSnapshot` | The boot record and its full validity rule. |
| `readSettings(storage, context)` | A read that never writes. It previews a migration as `migrated: true`. |
| `createRepository(storage, context)` | `initialize`, `read`, `commit`, `loadDraft`/`saveDraft`/`discardDraft`, `loadRecovery`, `lastGood`, `subscribe`. Only the background creates one. |
| `requestIssues(request)` | Validates a `SettingsRequest`. |
| `createExtensionStorage(api)` | A `StorageAdapter` over `chrome.storage`/`browser.storage`. |

Commit actions are the frozen union: `selectTheme`, `setEnabled`, `setPreference`, `saveCustom`,
`deleteCustom`, `resetPreferences` and `resetAll`. This package adds five more:
`setCssConsent {id, granted, editor?, approval?}`, `approveCss {editor, target, css}`,
`withdrawCss {editor}`, `completeOnboarding` and `dismissMigration`. `saveCustom` also takes the
saving `editor` and an optional `approval`: a ticket to redeem, or `null` to revoke.

CSS approval is decided in one place, `consent.js`, which every commit and the initialization pass
run. `settings.cssConsent[id]` exists only for the canonical sanitized hash and current sanitizer
version of the stored theme `id`. It is created only by redeeming a ticket that `approveCss` (the
explicit Enable advanced CSS choice) issued to that editor for that target and exactly that CSS.
An editor is its token bound to the builder document the browser names as the sender:
`commit(action, expectedRevision, {document})` takes that identity from the background, which
gives it only for the settings page (Chrome's `documentId`, otherwise Firefox's tab, frame and
page) and null for the popup, the first-run page, content scripts and every other sender. Without
it a ticket is neither issued nor redeemed, so the same token and ticket from another document
redeem nothing. `approveCss` needs the current `expectedRevision`.
`approveCss` and `withdrawCss` change neither settings nor their revision; the reply to
`approveCss` carries `approval {ticket, target, hash, sanitizerVersion}`. A ticket is used once,
and is dropped when its editor withdraws or saves, when its target is removed, revoked or given
other CSS, on Reset all and when the sanitizer changes. An approval otherwise survives only while its
theme keeps exactly that CSS and nothing revokes it, so no copy, re-add, Undo, Reset, resume,
import, rename, second window, retried write or migration can create, restore, widen or move one.
At startup a stored approval stays only when it names a saved local theme, the canonical hash of
that theme's stored CSS and the current sanitizer version. The extension's own storage is the
trust root for these records ([SECURITY.md](../../SECURITY.md)).
A refused ticket gets `code:'invalid'` with an issue whose `reason` is `approval`. The request types are `get`, `commit`, `draft`, `open-page` and `recovery`
(`load` or `lastGood`). `setPreference` accepts `appearance: 'full'|'calm'` and sets extras with it.
Setting `extras` sets appearance with it, and the child switches never change.

A commit runs inside the background's queue. It re-reads storage and checks `expectedRevision`,
then reduces the action onto the latest state. It writes settings, boot and lastGood in one set,
waits for that write, and replies `{ok:true, settings}`. A stale revision gets
`{ok:false, code:'conflict', current}`. A failed or over-capacity write gets `code:'storage'` with
the committed state. A newer settings record is never overwritten, so commits are refused while one
exists.

## Migration from 1.1.0

Only `enabled`, `theme` and `custom` are read. The background runs the migration once and re-reads
just before saving, so an existing v2 record wins. The old keys are removed only after the v2 record
reloads and validates.

| 1.1.0 storage | SettingsV2 |
| --- | --- |
| Nothing | Defaults: on, Choom Circuit, Full. First run opens once, on a genuine install only. |
| `enabled:false` | Stays off, with the other choices kept. No tab. |
| A legacy palette ID | That exact ID. |
| `theme:'cyberpunk'` | `anime.cyberpunk-edgerunners`, with the `cyberpunk-alias` and `control-swaps-removed` notices. |
| Valid four-color `custom` with a theme | A local clone of that source with the four colors (overrides and graph levels dropped, as 1.1.0 did), `basedOn` the source, and that clone selected. A contradicted base is switched. A source repair adds `custom-repaired` and keeps the original colors in recovery. |
| Valid `custom` without a theme | The same, based on Editing Suite. |
| Partial or invalid `custom`, a non-boolean `enabled`, or an unknown ID | Recovery copy, nearest known source or Editing Suite, one notice each. Truthiness is never used to read `enabled`. |

The notice codes and their reviewed English are in `constants.js` (`MIGRATION_NOTICE_TEXT`).

## Waiting on C2b

`constants.js` holds values contracts does not have yet, each marked `TODO(C2b)`:
`EXPANSION_VERSION`, `SANITIZER_VERSION`, `APPEARANCE_MODES`, the Revision 4 `DEFAULT_PREFERENCES`
and `STORAGE_LIMITS`, `RECOVERY_KEY`, and the extra action and request types. `admission.js` defines
the `CssAdmission` and `ImageAdmission` interfaces. This build ships `NO_CSS_SANITIZER` and
`NO_IMAGE_ADMISSION`, which reject any document with CSS or a data URL and never grant consent.
`boot.js` lists renderer 1's closed snapshot keys, so an expanded snapshot is re-resolved until C2b
adds its keys there.

## Checks

`checks.mjs` serves `check:migrations` and `check:boot`.

- `check:migrations` replays `tests/fixtures/settings/migrations.json` through a real background
  host, then runs the migration, repository and background tests.
- `check:boot` runs the boot and lifecycle tests, then measures the gate in real Chromium and
  Firefox. A stalled boot, CSS only or behind the JavaScript watchdog, must release GitHub within
  120 ms plus one frame. A healthy boot must end the gate in the frame its stylesheet lands. Forced
  colors must bypass the gate.
