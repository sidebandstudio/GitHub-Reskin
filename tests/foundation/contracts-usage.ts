// Type-checked by contracts.test.mjs: the declarations compile under strict settings, accept the
// schema's own examples and the frozen engine shapes, and reject the shapes they replaced. Not run.
import {
  DEFAULT_THEME_ID,
  EDITOR_ACTION_TYPES,
  LIMITS,
  type BootRecord,
  type CheckRunner,
  type ColorPath,
  type CommitAction,
  type EditorAction,
  type EditorState,
  type EffectRequests,
  type EngineModule,
  type Hex,
  type ImportResult,
  type ModeFamily,
  type ModeIndex,
  type ModeSeed,
  type NativeMode,
  type NativeResolved,
  type PairResult,
  type PreviewModule,
  type PrimerModule,
  type Repair,
  type ResolveContext,
  type ResolvedEffects,
  type ResolvedTheme,
  type SettingsReply,
  type SettingsV2,
  type SiteBuild,
  type ThemedResolved,
  type ThemeV1,
  type UiHost,
} from "../../packages/contracts/index.js";

type Equal<A, B> = (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2 ? true : false;
const exact = <T extends true>(): T => true as T;

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

// @ts-expect-error schemaVersion is exactly 1.
export const wrongVersion: ThemeV1 = { ...minimal, schemaVersion: 2 };
// @ts-expect-error unknown fonts are not font IDs.
export const wrongFont: ThemeV1 = { ...minimal, fonts: { accent: "comic-sans" } };
// Requested and resolved effects name the same ten effects.
export const sameEffects = exact<Equal<keyof EffectRequests, keyof ResolvedEffects>>();

// ---------------------------------------------------------------------------------------------
// Import: parsing returns normalized data; repair and resolution are separate calls.

export function describe(result: ImportResult): string {
  if (result.ok) {
    // @ts-expect-error parsing performs no repair.
    result.repairs;
    // @ts-expect-error parsing performs no resolution.
    result.preview;
    return `${result.normalized.name} ${result.notes.map((note) => note.severity).join(",")}`;
  }
  const choices = (result.candidates ?? []).map((candidate) => `${candidate.name}: ${candidate.input.length}`);
  // @ts-expect-error candidates are {name, input}, not {label, document}.
  result.candidates?.[0]?.label;
  return [...result.issues.map((issue) => issue.code), ...choices].join(",");
}

// ---------------------------------------------------------------------------------------------
// Modes, seeds and resolution

declare const seed: ModeSeed;
declare const index: ModeIndex;
declare const native: NativeMode;
declare const engine: EngineModule;
declare const primer: PrimerModule;

export const indexVersion: 1 = index.contractVersion;
export const seedVersion: 1 = seed.contractVersion;
export const counterpart: string | undefined = index.counterparts[0]?.seedMode;
export const nativeCss: string | undefined = index.nativeCss[seed.id];
export const sponsorInk: Hex = seed.colors.semantics.sponsor.onEmphasis;
export const ansi: Hex = seed.colors.ansi.brightMagenta;
export const origin: string = seed.origins["/tokens/primaryHoverBackground"].variable;
// @ts-expect-error seeds are immutable.
seed.colors.tokens.canvas = "#000000";
// @ts-expect-error dimmed is a standard-family mode ID, not a family.
export const dimmed: ModeFamily = "dimmed";
export const families = exact<Equal<ModeFamily, "standard" | "colorblind" | "tritanopia">>();

// selectMode needs the index; the selector does no lookup of its own.
export const plan = primer.selectMode(native, "dark", index);
// @ts-expect-error the index argument is required.
primer.selectMode(native, "dark");

export const context: ResolveContext = { seed, policy: plan.policy, reducedMotion: false, forcedColors: false };
export const unseeded: ResolveContext = { seed: null, policy: "native-unknown", reducedMotion: true, forcedColors: false };
// @ts-expect-error the resolver receives a seed record, not a mode ID.
export const byModeId: ResolveContext = { semanticMode: "dark", policy: "themed", reducedMotion: false, forcedColors: false };

export const repaired = engine.repairTheme(minimal, seed);
// @ts-expect-error repair needs the same-base standard seed.
engine.repairTheme(minimal);
// @ts-expect-error repairs are readonly.
repaired.repairs.push(repaired.repairs[0]);
// @ts-expect-error there is no remix.
engine.remixTheme(minimal, { seed: 1, lockedColors: [] });

export function paint(resolved: ResolvedTheme): string[] {
  if (resolved.policy !== "themed") {
    const none: null = resolved.tokens;
    const font: "system" = resolved.font;
    const motion: false = resolved.motionAllowed;
    // @ts-expect-error the native branch is never audited.
    engine.auditPairs(resolved);
    return [String(none), font, String(motion), resolved.policy];
  }
  const audit: readonly PairResult[] = engine.auditPairs(resolved);
  const failed = audit.filter((pair) => !pair.passed).map((pair) => `${pair.id} ${pair.foreground} ${pair.background} ${pair.ratio}`);
  // @ts-expect-error pair results use passed.
  audit[0]?.pass;
  // @ts-expect-error the old resolved token names are gone.
  resolved.tokens.accentEmphasisText;
  // @ts-expect-error the old resolved token names are gone.
  resolved.tokens.primaryBackgroundHover;
  // @ts-expect-error semantics are five-field records keyed by sponsor.
  resolved.semantics.sponsors;
  // @ts-expect-error the font is one ID, not {accent}.
  resolved.font.accent;
  const states: Hex[] = [resolved.tokens.primaryHoverBackground, resolved.tokens.primaryPressedBackground, resolved.tokens.emphasisText];
  return [...failed, ...states, resolved.semantics.danger.mutedBackground, resolved.ansi.cyan, resolved.graph[4], resolved.seedId, resolved.seedHash, resolved.font];
}

export function persisted(repair: Repair): string {
  if (repair.persistence === "source") return repair.path;
  const path: ColorPath = repair.path;
  return `${path} ${repair.before} -> ${repair.after}`;
}

declare const themed: ThemedResolved;
export const forced: NativeResolved = {
  rendererVersion: 1,
  sourceHash: "0".repeat(64),
  seedId: null,
  seedHash: null,
  base: "dark",
  policy: "forced-colors",
  tokens: null,
  semantics: null,
  syntax: null,
  ansi: null,
  graph: null,
  font: "system",
  effects: {},
  flavor: { enabled: false, locale: "en", slots: {} },
  motionAllowed: false,
  repairs: [],
  pairAudit: [],
};

// ---------------------------------------------------------------------------------------------
// Preview

declare const preview: PreviewModule;
declare const container: HTMLElement;
const preferences = { enabled: true, extras: true, text: true, motion: true, fonts: true, effects: true } as const;
export const handle = preview.mountPreview(container, {
  view: "diff",
  theme: rich,
  preferences,
  onState: ({ policy, repairs }) => void [policy, repairs.length],
});
handle.setView("404");
handle.setBefore(true);
handle.update({ theme: minimal, preferences });
// @ts-expect-error onState reports policy and repairs, not view and before.
preview.mountPreview(container, { view: "repo", theme: rich, preferences, onState: ({ view }) => view });
// @ts-expect-error the container is an HTMLElement.
preview.mountPreview({} as Element, { view: "repo", theme: rich, preferences });

// ---------------------------------------------------------------------------------------------
// Settings and boot

export const settings: SettingsV2 = {
  settingsVersion: 2,
  revision: 0,
  enabled: true,
  selectedThemeId: DEFAULT_THEME_ID,
  preferences: { extras: true, text: true, motion: true, fonts: true, effects: true },
  customThemes: [{ id: "local:00000000-0000-4000-8000-000000000000", document: minimal, basedOn: "editing-suite" }],
  onboardingCompleted: false,
  migration: { from: "1.1.0", notices: [] },
};
// @ts-expect-error favorites are not part of settings.
export const withFavorites: SettingsV2 = { ...settings, favorites: [] };

export const boot: BootRecord = {
  settingsRevision: 0,
  rendererVersion: 1,
  engineVersion: 1,
  pairMatrixVersion: 1,
  catalogHash: "0".repeat(64),
  selectedSourceHash: themed.sourceHash,
  validatedTokenSnapshot: themed,
  effectivePreferences: preferences,
};
export const nativeBoot: BootRecord = { ...boot, validatedTokenSnapshot: forced };
// @ts-expect-error the snapshot is a full resolved branch, not loose tokens.
export const looseBoot: BootRecord = { ...boot, validatedTokenSnapshot: { canvas: "#000000" } };

export const actions: CommitAction[] = [
  { type: "selectTheme", id: "nord" },
  { type: "setPreference", key: "motion", value: false },
  { type: "saveCustom", document: rich, select: true },
  { type: "resetAll" },
];

export async function commitWith(host: UiHost): Promise<string> {
  const reply: SettingsReply = await host.commit({ type: "setEnabled", enabled: false }, 3);
  return reply.ok ? reply.settings.selectedThemeId : reply.code;
}

// ---------------------------------------------------------------------------------------------
// Editor: exactly nine actions and one-change undo.

export const edits: EditorAction[] = [
  { type: "setColor", role: "accent", value: "#ff0000" },
  { type: "setBase", base: "light" },
  { type: "setFont", font: "fraunces" },
  { type: "toggleEffect", effect: "grid", enabled: true },
  { type: "setFlavorEnabled", enabled: false },
  { type: "setFlavorSlot", slot: "profile.tag", text: null },
  { type: "undo" },
  { type: "reset" },
  { type: "loadImport", theme: rich },
];
export const registry = exact<
  Equal<EditorAction["type"], "setColor" | "setBase" | "setFont" | "toggleEffect" | "setFlavorEnabled" | "setFlavorSlot" | "undo" | "reset" | "loadImport">
>();
export const registryValues: readonly EditorAction["type"][] = EDITOR_ACTION_TYPES;
// @ts-expect-error only background, text and accent are edited directly.
export const linkEdit: EditorAction = { type: "setColor", role: "link", value: "#ff0000" };
// @ts-expect-error effects are toggled, not given parameters.
export const effectEdit: EditorAction = { type: "setEffect", effect: "grid", params: { opacity: 0.1 } };
// @ts-expect-error there is no redo.
export const redo: EditorAction = { type: "redo" };
// @ts-expect-error graph levels are not edited directly.
export const graphEdit: EditorAction = { type: "setGraph", levels: null };
// @ts-expect-error there is no remix.
export const remix: EditorAction = { type: "remix", seed: 1, lockedColors: [] };
declare const state: EditorState;
// @ts-expect-error there is no redo state.
state.canRedo;
export const undoable: boolean = state.canUndo;

// ---------------------------------------------------------------------------------------------
// Check routes and the site build hook

export const check: CheckRunner = async ({ command, args, root, outDir }) => ({ exitCode: args.length && command && root && outDir ? 0 : 1, testCount: 1 });
// @ts-expect-error a check reports its test count.
export const uncounted: CheckRunner = async () => ({ exitCode: 0 });
export const site: SiteBuild = async ({ outDir, config }) => void [outDir, config.site.base];

export const cap: number = LIMITS.fileUtf8Bytes;
