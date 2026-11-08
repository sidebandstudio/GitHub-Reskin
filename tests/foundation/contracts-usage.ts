// Type-checked by contracts.test.mjs: the declarations compile under strict settings and accept
// the schema's own examples. Not run.
import {
  DEFAULT_THEME_ID,
  LIMITS,
  type CommitAction,
  type EditorAction,
  type ImportResult,
  type SettingsReply,
  type SettingsV2,
  type ThemeV1,
  type UiHost,
} from "../../packages/contracts/index.js";

export const minimal: ThemeV1 = {
  schemaVersion: 1,
  name: "Moss and parchment",
  base: "light",
  colors: { background: "#f6f2e8", text: "#27372d", accent: "#446851" },
};

export const rich: ThemeV1 = {
  $schema: "https://sidebandstudio.github.io/GitHub-Reskin/schemas/theme-v1.schema.json",
  schemaVersion: 1,
  name: "Choom Circuit",
  inspiredBy: "Cyberpunk: Edgerunners",
  author: "sidebandstudio",
  version: "1.0.0",
  description: "Acid lime, cold signal blue and a quiet afterimage. Original geometry.",
  tags: ["anime", "neon", "dark"],
  base: "dark",
  colors: { background: "#091312", text: "#f0f7ed", accent: "#d5ff35", contribution: "#d5ff35" },
  overrides: {
    surface: "#142622",
    inset: "#060d0c",
    mutedText: "#aac2b7",
    link: "#7de9f5",
    controlBorder: "#6b8179",
    primaryBackground: "#d5ff35",
    primaryText: "#10170a",
    syntax: { comment: "#aac2b7" },
  },
  fonts: { accent: "rajdhani" },
  effects: {
    rail: { shape: "notch", opacity: 0.18, thickness: 2 },
    scanlines: { opacity: 0.015, spacing: 6 },
    echo: { offset: 3, durationMs: 160, opacity: 0.12 },
  },
  flavor: {
    enabled: true,
    locale: "en",
    slots: {
      "profile.pinned.heading": "Preem picks",
      "profile.tag": "//choom",
      "error.notFound.caption": "This route went dark. Try a familiar path.",
      "contributions.caption": "A year of gigs, one contribution at a time.",
    },
  },
  contributions: { levels: ["#24372f", "#4e8c60", "#78b94d", "#a9dc3b", "#d5ff35"] },
};

export const settings: SettingsV2 = {
  settingsVersion: 2,
  revision: 0,
  enabled: true,
  selectedThemeId: DEFAULT_THEME_ID,
  preferences: { extras: true, text: true, motion: true, fonts: true, effects: true },
  customThemes: [{ id: "local:00000000-0000-4000-8000-000000000000", document: minimal, basedOn: "editing-suite" }],
  favorites: [],
  onboardingCompleted: false,
  migration: { from: "1.1.0", notices: [] },
};

export const actions: CommitAction[] = [
  { type: "selectTheme", id: "nord" },
  { type: "setPreference", key: "motion", value: false },
  { type: "saveCustom", document: rich, select: true },
  { type: "resetAll" },
];
export const edits: EditorAction[] = [{ type: "setColor", role: "accent", value: "#ff0000" }, { type: "undo" }];

export async function commitWith(host: UiHost): Promise<string> {
  const reply: SettingsReply = await host.commit({ type: "setEnabled", enabled: false }, 3);
  return reply.ok ? reply.settings.selectedThemeId : reply.code;
}

export function describe(result: ImportResult): string {
  return result.ok ? result.normalized.name : result.issues.map((issue) => issue.code).join(",");
}

export const cap: number = LIMITS.fileUtf8Bytes;

// @ts-expect-error schemaVersion is exactly 1.
export const wrongVersion: ThemeV1 = { ...minimal, schemaVersion: 2 };
// @ts-expect-error unknown fonts are not font IDs.
export const wrongFont: ThemeV1 = { ...minimal, fonts: { accent: "comic-sans" } };
