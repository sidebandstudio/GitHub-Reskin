// C6's routed checks (scripts/check-routes.mjs): the installed-extension browser surface for
// test:e2e and check:a11y. The specs in tests/e2e/extension build the Chrome package themselves,
// install it unpacked in a fresh Chromium profile per test and serve GitHub fixtures by routing.
// The forced-colors spec also installs the Firefox package as a temporary add-on in Firefox.
//   test:e2e   every extension spec in the chromium-extension project
//   a11y       only its @a11y tests
import { runSurface } from "../../scripts/check-a11y.mjs";

export async function run({ command, args, root }) {
  if (command === "test:e2e" || command === "a11y") return runSurface("extension", { args, root, a11y: command === "a11y" });
  console.error(`packages/ui/checks.mjs does not handle ${command}`);
  return { exitCode: 2, testCount: 0 };
}
