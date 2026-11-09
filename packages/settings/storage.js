// StorageAdapter over the extension's storage.local, for both browsers' promise APIs
// (chrome.storage in Chromium MV3, browser.storage in Firefox). Only "local" changes reach
// subscribers. No other storage area and no page storage is ever used.

/**
 * @param {{storage:{local:{get, set, remove}, onChanged:{addListener, removeListener}}}} api
 *   the chrome or browser namespace
 * @returns {import("../contracts/index.js").StorageAdapter}
 */
export function createExtensionStorage(api) {
  const area = api.storage.local;
  return {
    get: (keys) => area.get(keys),
    set: (record) => area.set(record),
    remove: (keys) => area.remove(keys),
    subscribe(listener) {
      const handler = (changes, areaName) => {
        if (areaName === "local") listener(changes);
      };
      api.storage.onChanged.addListener(handler);
      return () => api.storage.onChanged.removeListener(handler);
    },
  };
}
