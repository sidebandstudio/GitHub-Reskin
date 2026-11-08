// The offline whoisaldo preview fixture (content/site-fixture, captured 2026-11-08) as the preview
// markup uses it. Production content: assets resolve under the base path, external links stay data.
import profile from "../fixture/profile-whoisaldo.json" with { type: "json" };
import { href } from "./site.mjs";

export { profile };

export const asset = (path) => href(`site-fixture/${path}`);

const number = new Intl.NumberFormat("en-US");
export const formatCount = (n) => (n >= 1000 ? `${(n / 1000).toFixed(1).replace(/\.0$/, "")}k` : number.format(n));

const DATE = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });
export const formatDate = (iso) => DATE.format(new Date(`${iso}T00:00:00Z`));

/**
 * The contribution calendar as weeks of seven slots (Sunday first). Slots before the first date
 * are null, as on GitHub. Every captured day is kept.
 */
export function calendarWeeks(days = profile.contributions.days) {
  const first = new Date(`${days[0].date}T00:00:00Z`).getUTCDay();
  const slots = [...Array(first).fill(null), ...days];
  const weeks = [];
  for (let i = 0; i < slots.length; i += 7) weeks.push(slots.slice(i, i + 7));
  return weeks;
}

// GitHub's standard language colors for the languages this fixture shows.
export const LANGUAGE_COLORS = {
  Rust: "#dea584", Python: "#3572A5", TypeScript: "#3178c6", JavaScript: "#f1e05a", CSS: "#663399", HTML: "#e34c26", Swift: "#F05138", Shell: "#89e051",
};

// The diff view's fixed, fictional change, shown in the GitHub Reskin repository.
export const DIFF = {
  file: "extension/themes.js",
  additions: 3,
  deletions: 1,
  lines: [
    { kind: "hunk", text: "@@ -8,7 +8,9 @@ const THEMES = [" },
    { kind: "ctx", old: 8, new: 8, code: [["kw", "const"], ["", " DEFAULT_THEME = "], ["str", '"choom-circuit"'], ["", ";"]] },
    { kind: "ctx", old: 9, new: 9, code: [] },
    { kind: "del", old: 10, code: [["kw", "function"], ["", " "], ["fn", "applyTheme"], ["", "(theme) {"]] },
    { kind: "add", new: 10, code: [["kw", "function"], ["", " "], ["fn", "applyTheme"], ["", "(theme, { motion = "], ["kw", "true"], ["", " } = {}) {"]] },
    { kind: "add", new: 11, code: [["com", "  // Respect the visitor's reduced-motion setting."]] },
    { kind: "add", new: 12, code: [["", "  "], ["kw", "const"], ["", " still = !motion || "], ["fn", "matchMedia"], ["", "("], ["str", '"(prefers-reduced-motion: reduce)"'], ["", ").matches;"]] },
    { kind: "ctx", old: 11, new: 13, code: [["", "  root."], ["fn", "setAttribute"], ["", "("], ["str", '"data-reskin"'], ["", ", theme.id);"]] },
    { kind: "ctx", old: 12, new: 14, code: [["", "  "], ["kw", "return"], ["", " root.style.length > "], ["num", "0"], ["", ";"]] },
    { kind: "ctx", old: 13, new: 15, code: [["", "}"]] },
  ],
};
