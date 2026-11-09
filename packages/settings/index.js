// GitHub Reskin settings: SettingsV2 validation, 1.1.0 migration, the commit reducer, storage
// admission, the boot snapshot rule, the serialized repository and the message boundary. Pure ESM
// with no DOM; the only browser API is the storage adapter in storage.js. See README.md.
export { createCatalogSource, fallbackThemeId, selectedSource } from "./catalog.js";
export { defaultSettings, validateSettings, salvageSettings, effectivePreferences, appearanceOf, selectedConsent, LOCAL_ID } from "./model.js";
export { migrateLegacy, hasLegacyKeys } from "./migrate.js";
export { reduceAction, reduceState, actionIssues, ActionError, ACTION_TYPES } from "./actions.js";
export { settleConsent, mintApproval, withdrawApprovals, readApprovals, digest, APPROVAL_ISSUE, NEW_TARGET } from "./consent.js";
export { NO_CSS_SANITIZER, NO_IMAGE_ADMISSION, cssAllowed, documentAdmissionIssues, capacityIssues, recordBytes } from "./admission.js";
export { buildBootRecord, bootRecordProblems, snapshotProblems, bootMismatches, usableSnapshot, BOOT_KEYS, RUNNING_VERSIONS } from "./boot.js";
export { readSettings, createRepository } from "./repository.js";
export { createExtensionStorage } from "./storage.js";
export { requestIssues, queryIssues, REQUEST_TYPES, READ_ONLY_REQUESTS } from "./messages.js";
export * from "./constants.js";
