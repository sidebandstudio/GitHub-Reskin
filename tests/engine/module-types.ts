// Type-checked by module-types.test.mjs under strict settings, without allowJs: the engine's
// declarations satisfy the frozen EngineModule and keep the contract types. Not run.
import * as engine from "../../packages/engine/index.js";
import type { EngineModule, Issue, ModeSeed, Repair, ResolvedTheme, ThemeV1 } from "../../packages/contracts/index.js";

const module: EngineModule = engine;

declare const theme: ThemeV1;
declare const seed: ModeSeed;
const resolved: ResolvedTheme = engine.resolveTheme(theme, { seed, policy: "themed", reducedMotion: false, forcedColors: false });
if (resolved.policy === "themed") {
  const ratios: readonly number[] = engine.auditPairs(resolved).map((result) => result.ratio);
  const level: `#${string}` = resolved.graph[4];
  void ratios, level;
} else {
  const tokens: null = resolved.tokens;
  void tokens;
}

const { repairs } = engine.repairTheme(theme, seed);
const repair: Repair | undefined = repairs[0];
if (repair?.persistence === "source") {
  const path: string = repair.path;
  void path;
}
// @ts-expect-error Repairs are the discriminated contract records, not plain objects.
const notRepairs: readonly { persistence: "native" }[] = repairs;

const conflict: Issue | null = engine.basePolarityIssue(theme);
const direction: "up" | "down" = engine.rampDirection(theme.base);
// @ts-expect-error The ramp direction comes from the base alone.
engine.rampDirection(theme.base, "#ffffff");
const levels: readonly `#${string}`[] = engine.deriveRamp("#0d1117", "#e6edf3", "#39d353");
const problems: string[] = engine.graphProblems(levels, "#0d1117", direction);

void module, repairs, notRepairs, conflict, problems;
