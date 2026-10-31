#!/usr/bin/env node
// Draws a GitHub contribution graph as an SVG in any color.
import { realpathSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";

const QUERY = `query($login: String!) {
  user(login: $login) {
    contributionsCollection {
      contributionCalendar {
        totalContributions
        weeks { contributionDays { date weekday contributionLevel } }
      }
    }
  }
}`;

const LEVELS = ["NONE", "FIRST_QUARTILE", "SECOND_QUARTILE", "THIRD_QUARTILE", "FOURTH_QUARTILE"];
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const FONT = `Geist, 'Geist Sans', ui-sans-serif, system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif`;
const MONO = `'JetBrains Mono', 'SF Mono', ui-monospace, Menlo, Consolas, 'Liberation Mono', monospace`;
const CELL = 12;
const GAP = 3;
const PAD = 24;

export async function fetchCalendar(username, token) {
  const res = await fetch(process.env.GITHUB_GRAPHQL_URL || "https://api.github.com/graphql", {
    method: "POST",
    headers: {
      authorization: `bearer ${token}`,
      "content-type": "application/json",
      "user-agent": "github-reskin",
    },
    body: JSON.stringify({ query: QUERY, variables: { login: username } }),
  });
  const body = await res.json();
  if (!res.ok || body.errors) {
    throw new Error(`GitHub API ${res.status}: ${JSON.stringify(body.errors ?? body.message)}`);
  }
  if (!body.data.user) throw new Error(`No GitHub user named ${username}`);
  return body.data.user.contributionsCollection.contributionCalendar;
}

function rgb(color) {
  const match = /^#?([0-9a-f]{6})$/i.exec(color.trim());
  if (!match) throw new Error(`Colors must be 6-digit hex, like #f2a93b. Got: ${color}`);
  const n = parseInt(match[1], 16);
  return [n >> 16, (n >> 8) & 255, n & 255];
}

// "F2A93B" or "#f2a93b" -> "#f2a93b"
function hex(color) {
  return "#" + rgb(color).map((v) => v.toString(16).padStart(2, "0")).join("");
}

// Moves color a toward color b. t = 0 gives a, t = 1 gives b.
export function mix(a, b, t) {
  const [x, y] = [rgb(a), rgb(b)];
  return "#" + x.map((v, i) => Math.round(v + (y[i] - v) * t).toString(16).padStart(2, "0")).join("");
}

// Colors each style uses for any the caller leaves unset.
const STYLES = {
  flat: { color: "#f2a93b", background: "#0a0a0b", text: "#ededea" },
  cyberpunk: { color: "#fcee0a", background: "#0b0a17", text: "#00f0ff" },
};

export function styleDefaults(style) {
  if (!Object.hasOwn(STYLES, style)) throw new Error(`Style must be ${Object.keys(STYLES).join(" or ")}. Got: ${style}`);
  return STYLES[style];
}

export function render(calendar, { style = "flat", ...colors } = {}) {
  const defaults = styleDefaults(style);
  const [color, background, text] = ["color", "background", "text"].map((name) => hex(colors[name] ?? defaults[name]));
  const draw = style === "cyberpunk" ? cyberpunk : flat;
  return draw(layout(calendar), { color, background, text, ramp: colors.color == null });
}

// Positions shared by every style.
function layout({ weeks, totalContributions }) {
  const step = CELL + GAP;
  const left = PAD + 32;
  const top = 72;
  const gridRight = left + weeks.length * step - GAP;
  const gridBottom = top + 7 * step - GAP;

  const days = weeks.flatMap((week, col) =>
    week.contributionDays.map((day) => ({
      x: left + col * step,
      y: top + day.weekday * step,
      level: Math.max(0, LEVELS.indexOf(day.contributionLevel)),
    })),
  );

  // Label each column where a new month starts. Drop a label that would crowd the next one.
  const starts = [];
  weeks.forEach((week, col) => {
    const month = Number(week.contributionDays[0].date.slice(5, 7)) - 1;
    if (starts.at(-1)?.month !== month) starts.push({ col, month });
  });
  const months = starts
    .filter((start, i) => !starts[i + 1] || starts[i + 1].col - start.col >= 3)
    .map(({ col, month }) => `<text x="${left + col * step}" y="${top - 10}">${MONTHS[month]}</text>`);

  const weekdays = [
    [1, "Mon"],
    [3, "Wed"],
    [5, "Fri"],
  ].map(([row, name]) => `<text x="${PAD}" y="${top + row * step + CELL - 2}">${name}</text>`);

  const legendY = gridBottom + 18;
  const legendX = gridRight - 30 - 5 * step;
  const legend = LEVELS.map((_, level) => ({ x: legendX + level * step, y: legendY, level }));
  const key = [
    `<text x="${legendX - 6}" y="${legendY + CELL - 2}" text-anchor="end">Less</text>`,
    `<text x="${gridRight}" y="${legendY + CELL - 2}" text-anchor="end">More</text>`,
  ];

  const total = totalContributions.toLocaleString("en-US");
  const summary = `${total} contribution${totalContributions === 1 ? "" : "s"} in the last year`;

  return { width: gridRight + PAD, height: gridBottom + 48, left, top, days, months, weekdays, legend, key, summary };
}

function flat({ width, height, days, months, weekdays, legend, key, summary }, { color, background, text }) {
  const shades = [mix(background, text, 0.08), ...[0.35, 0.55, 0.78, 1].map((t) => mix(background, color, t))];
  const muted = mix(background, text, 0.55);
  const cell = ({ x, y, level }) =>
    `<rect class="day" x="${x}" y="${y}" width="${CELL}" height="${CELL}" rx="2.5" fill="${shades[level]}"/>`;

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" role="img" aria-labelledby="title">
<title id="title">${summary}</title>
<rect x=".5" y=".5" width="${width - 1}" height="${height - 1}" rx="12" fill="${background}" stroke="${mix(background, color, 0.22)}"/>
<text x="${PAD}" y="${PAD + 14}" fill="${text}" font-family="${FONT}" font-size="14" font-weight="500">${summary}</text>
<g fill="${muted}" font-family="${FONT}" font-size="11">
${months.join("\n")}
${weekdays.join("\n")}
${key.join("\n")}
</g>
${days.map(cell).join("\n")}
${legend.map(cell).join("\n")}
</svg>
`;
}

// Dark panel with a faint grid, a cut-corner neon edge and glowing cells.
// Without a chosen color, busier days brighten through cyan and the busiest turn yellow.
function cyberpunk({ width, height, left, top, days, months, weekdays, legend, key, summary }, { color, background, text, ramp }) {
  const [magenta, cyan, yellow] = ["#ff2a6d", "#00f0ff", "#fcee0a"];
  const busy = ramp
    ? [mix(background, cyan, 0.3), mix(background, cyan, 0.6), cyan, yellow]
    : [0.35, 0.55, 0.78, 1].map((t) => mix(background, color, t));
  const shades = [mix(background, text, 0.06), ...busy];
  const edge = ramp ? magenta : color;
  const accent = ramp ? yellow : color;
  const muted = mix(background, text, 0.6);
  const cut = 16;
  const panel = [
    [cut + 0.5, 0.5],
    [width - 0.5, 0.5],
    [width - 0.5, height - 0.5 - cut],
    [width - 0.5 - cut, height - 0.5],
    [0.5, height - 0.5],
    [0.5, cut + 0.5],
  ].join(" ");
  // One glow per busy level, wider for busier days, and doubled for the top two. Empty days don't glow.
  const filters = [1, 1.8, 2.6, 3.4].map(
    (blur, i) => `<filter id="glow-${i + 1}" filterUnits="userSpaceOnUse" x="0" y="0" width="${width}" height="${height}">
<feGaussianBlur stdDeviation="${blur}"/>
<feMerge><feMergeNode/>${i > 1 ? "<feMergeNode/>" : ""}<feMergeNode in="SourceGraphic"/></feMerge>
</filter>`,
  );
  const cell = ({ x, y, level }) =>
    `<rect class="day" x="${x}" y="${y}" width="${CELL}" height="${CELL}" rx="1" fill="${shades[level]}"` +
    (level ? "/>" : ` stroke="${mix(background, text, 0.16)}" stroke-width=".75"/>`);
  const cells = shades.map((_, level) => {
    const group = [...days, ...legend].filter((day) => day.level === level).map(cell);
    return `<g${level ? ` filter="url(#glow-${level})"` : ""}>\n${group.join("\n")}\n</g>`;
  });
  const sweep = 56;

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" role="img" aria-labelledby="title">
<title id="title">${summary}</title>
<defs>
<style>
@keyframes sweep { from { transform: translateY(0) } to { transform: translateY(${height + sweep}px) } }
@media (prefers-reduced-motion: no-preference) { .sweep { animation: sweep 9s linear infinite } }
</style>
<clipPath id="panel"><polygon points="${panel}"/></clipPath>
<pattern id="grid" patternUnits="userSpaceOnUse" x="${left - GAP / 2}" y="${top - GAP / 2}" width="${CELL + GAP}" height="${CELL + GAP}">
<path d="M${CELL + GAP} 0H0V${CELL + GAP}" fill="none" stroke="${mix(background, text, 0.07)}"/>
</pattern>
<pattern id="scanlines" patternUnits="userSpaceOnUse" width="4" height="3">
<rect width="4" height="1" fill="${text}" opacity=".035"/>
</pattern>
<linearGradient id="sweep" x1="0" y1="0" x2="0" y2="1">
<stop offset="0" stop-color="${text}" stop-opacity="0"/>
<stop offset=".85" stop-color="${text}" stop-opacity=".12"/>
<stop offset="1" stop-color="${text}" stop-opacity="0"/>
</linearGradient>
${filters.join("\n")}
</defs>
<polygon points="${panel}" fill="${background}"/>
<g clip-path="url(#panel)">
<rect width="${width}" height="${height}" fill="url(#grid)"/>
<rect width="${width}" height="${height}" fill="url(#scanlines)"/>
<rect class="sweep" y="${-sweep}" width="${width}" height="${sweep}" fill="url(#sweep)"/>
</g>
<polygon points="${panel}" fill="none" stroke="${edge}" stroke-width="1.5" filter="url(#glow-1)"/>
<rect x="${cut + 8}" y="0" width="72" height="3" fill="${accent}" filter="url(#glow-2)"/>
<rect x="${width - cut - 48}" y="${height - 3}" width="24" height="3" fill="${accent}" filter="url(#glow-2)"/>
<text x="${PAD}" y="${PAD + 14}" fill="${text}" font-family="${MONO}" font-size="14" font-weight="600" letter-spacing=".04em" filter="url(#glow-1)">${summary}</text>
<g fill="${muted}" font-family="${MONO}" font-size="11">
${months.join("\n")}
${weekdays.join("\n")}
${key.join("\n")}
</g>
${cells.join("\n")}
</svg>
`;
}

async function main() {
  const { values } = parseArgs({
    options: Object.fromEntries(
      ["username", "token", "style", "color", "background", "text", "output"].map((name) => [name, { type: "string" }]),
    ),
  });
  // Flags win, then GitHub Action inputs.
  const option = (name) => values[name] || process.env[`INPUT_${name.toUpperCase()}`] || undefined;
  const username = option("username");
  const token = option("token") || process.env.GITHUB_TOKEN || process.env.GH_TOKEN;
  const output = option("output") || "contributions.svg";
  const style = option("style") || "flat";
  styleDefaults(style);
  if (!username) throw new Error("Pass --username");
  if (!token) throw new Error("Set GITHUB_TOKEN or pass --token");

  const calendar = await fetchCalendar(username, token);
  const svg = render(calendar, {
    style,
    color: option("color"),
    background: option("background"),
    text: option("text"),
  });
  await mkdir(dirname(output), { recursive: true });
  await writeFile(output, svg);
  console.log(`Wrote ${output} for ${username}: ${calendar.totalContributions} contributions`);
}

// Node resolves symlinks in import.meta.url, so resolve the launch path too.
if (process.argv[1] && realpathSync(process.argv[1]) === fileURLToPath(import.meta.url)) await main();
