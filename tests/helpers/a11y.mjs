// axe-core in a Playwright page. Every surface's @a11y tests use this, so they share one engine
// version and one definition of a blocking finding: serious or critical impact.
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";

const AXE = createRequire(import.meta.url).resolve("axe-core/axe.min.js");
export const BLOCKING_IMPACTS = ["serious", "critical"];

// Runs axe on the page, or on `include` (a selector), and returns its violations.
export async function axeViolations(page, { include } = {}) {
  if (!(await page.evaluate(() => "axe" in window))) await page.addScriptTag({ content: await readFile(AXE, "utf8") });
  return page.evaluate(async (scope) => {
    const result = await window.axe.run(scope ? { include: [scope] } : document, { resultTypes: ["violations"] });
    return result.violations.map(({ id, impact, help, nodes }) => ({ id, impact, help, targets: nodes.map((node) => node.target.join(" ")) }));
  }, include ?? null);
}

// Serious and critical violations, the ones that fail an accessibility check.
export const blocking = (violations) => violations.filter((violation) => BLOCKING_IMPACTS.includes(violation.impact));
