// Settings values that Revision 4.1 adds but packages/contracts does not declare yet. Each one is
// defined here once, marked for C2b, and imported from contracts once C2b's coordinated edit lands.
// Everything else comes from packages/contracts.

const freeze = (value) => {
  if (value && typeof value === "object") {
    Object.values(value).forEach(freeze);
    Object.freeze(value);
  }
  return value;
};

// TODO(C2b): move to packages/contracts with the expanded resolver. A boot record without these
// two versions, or with other values, is invalid and is re-resolved.
export const EXPANSION_VERSION = 1;
export const SANITIZER_VERSION = 1;

// TODO(C2b): preferences.appearance and its default. `extras` remains as the compatibility alias:
// extras false means Calm, and writes keep the two consistent.
export const APPEARANCE_MODES = freeze(["full", "calm"]);
export const DEFAULT_PREFERENCES = freeze({ appearance: "full", extras: true, text: true, motion: true, fonts: true, effects: true });
export const BOOLEAN_PREFERENCE_KEYS = freeze(["extras", "text", "motion", "fonts", "effects"]);

// TODO(C2b): the Revision 4 storage limits from THEME-EXPANSION.md. contracts LIMITS still holds
// the Revision 3 values (1 MiB custom sources, 128 KiB draft).
export const STORAGE_LIMITS = freeze({
  maxCustomThemes: 50,
  maxCustomSourceBytes: 4 * 1024 * 1024,
  maxDraftBytes: 1.25 * 1024 * 1024,
  maxRecordsBytes: 8 * 1024 * 1024,
  maxRecoveryBytes: 1024 * 1024,
  maxNotices: 16,
  maxApprovals: 32,
});

// TODO(C2b): add to contracts STORAGE_KEYS. One bounded copy of unusable 1.x or corrupt v2 data,
// kept until the person dismisses or exports it.
export const RECOVERY_KEY = "reskin.recovery";
// Pending Enable advanced CSS approvals not yet redeemed by a save, as digests (consent.js). Only
// the background writes it; Reset all clears it.
export const APPROVALS_KEY = "reskin.cssApprovals";

// TODO(C2b): commit actions beyond the frozen union. approveCss issues a single-use ticket for the
// explicit Enable advanced CSS choice and withdrawCss drops an editor's tickets (neither changes
// settings or their revision); setCssConsent revokes, or grants by redeeming a ticket;
// completeOnboarding records first-run completion and dismissMigration clears migration notices and
// the recovery copy. saveCustom also takes the saving editor and an optional approval (a ticket to
// redeem, or null to revoke), so the builder writes a theme and its approval in one commit.
export const EXTRA_COMMIT_ACTION_TYPES = freeze(["setCssConsent", "approveCss", "withdrawCss", "completeOnboarding", "dismissMigration"]);
// Approval requests: not settings commits, so they skip the revision check and leave settings alone.
export const APPROVAL_ACTION_TYPES = freeze(["approveCss", "withdrawCss"]);
// TODO(C2b): the recovery request reads or dismisses reskin.recovery from an extension page.
export const EXTRA_REQUEST_TYPES = freeze(["recovery"]);

// Stable notice codes. The UI owns the wording; MIGRATION_NOTICE_TEXT is the reviewed English.
export const NOTICES = freeze({
  cyberpunkAlias: "cyberpunk-alias",
  customColors: "custom-colors",
  customRepaired: "custom-repaired",
  customRecovered: "custom-recovered",
  unknownTheme: "unknown-theme",
  invalidEnabled: "invalid-enabled",
  controlSwapsRemoved: "control-swaps-removed",
  settingsRecovered: "settings-recovered",
  recoveryTruncated: "recovery-truncated",
  undoCleared: "undo-cleared",
});
export const MIGRATION_NOTICE_TEXT = freeze({
  [NOTICES.cyberpunkAlias]: "Cyberpunk is now Choom Circuit. Your colors are here. Find Cyberpunk: Edgerunners, Choom Circuit, in Anime.",
  [NOTICES.customColors]: "Your edited colors are saved as a theme in My themes.",
  [NOTICES.customRepaired]: "We adjusted some of your colors so text stays readable. Your original colors are kept in recovery.",
  [NOTICES.customRecovered]: "Some saved colors could not be used. A copy is kept so you can export it.",
  [NOTICES.unknownTheme]: "Your saved theme is no longer available, so a known theme is selected. A copy of the old setting is kept.",
  [NOTICES.invalidEnabled]: "Your on/off setting could not be read, so Reskin is on.",
  [NOTICES.controlSwapsRemoved]: "Theme extras no longer rename GitHub's buttons. Real labels stay as GitHub wrote them.",
  [NOTICES.settingsRecovered]: "Some settings could not be read. Usable parts were kept and a copy of the rest is in recovery.",
  [NOTICES.recoveryTruncated]: "The recovery copy was too large to keep in full.",
  [NOTICES.undoCleared]: "Undo is no longer available because that theme was deleted.",
});

// Internal pages the background may open. C6 owns the page files and can move them here.
export const PAGE_PATHS = freeze({ onboarding: "pages/onboarding.html", settings: "pages/settings.html" });
export const SAFE_QUERY_KEYS = freeze(["theme", "view", "from"]);
export const SAFE_QUERY_VALUE = /^[A-Za-z0-9._:-]{1,64}$/;

// The root attribute the boot gate reads. Unset means pending; any value ends the gate.
export const BOOT_ATTRIBUTE = "data-reskin-boot";
export const BOOT_STATES = freeze(["ready", "native", "timeout", "off"]);
export const STYLE_ID = "reskin-style";
