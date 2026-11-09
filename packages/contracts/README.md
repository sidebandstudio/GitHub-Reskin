# Contracts

The shared vocabulary for GitHub Reskin modules.

- `index.js` holds the runtime values: format, settings, renderer, engine, pair-matrix (2),
  expansion, sanitizer and CSS registry versions and the expansion increment, `DEFAULT_THEME_ID`,
  legacy IDs and storage keys, the font registries (bundled `FONT_IDS`, the schema's
  `HEADING_FONT_IDS` and `BODY_FONT_IDS`, the per-increment `FONT_INVENTORY`), effect, slot,
  color-role (core and extended syntax, ANSI, diff), preference, appearance-mode and action
  registries (with the deferred editor actions), the CSS target kinds, host markers and audited
  variables, issue codes, `LIMITS`, release `BUDGETS`, build targets and shared build scopes.
- `theme-v1.d.ts` mirrors the public theme schema: `ThemeV1`, its Revision 4 groups and
  `EffectRequests`.
- `theme-engine.d.ts` is the frozen renderer 1 block from ARCHITECTURE.md: `ModeSeed`,
  `ColorSet`, `ModeIndex`, `ResolveContext`, `ThemedResolved` and `NativeResolved` with the
  Revision 4 `ResolvedAppearance`, pair (matrix version 2) and repair records, `PreviewOptions` and `PreviewHandle`. The engine functions appear as the
  `EngineModule` interface because this package does not export them; `packages/engine` does.
- `index.d.ts` declares the runtime values, re-exports every type from the two files above, and
  declares the module interfaces: import results, `PrimerModule`, `PreviewModule`, `SettingsV2`,
  `BootRecord`, `SettingsRequest`, `UiHost`, `EditorAction`, the advanced CSS types
  (`CssTargetRegistry`, the input C3 supplies, `SanitizedCss`, `CssConsent`, `CssCompileResult`),
  `ReleaseConfig`, `BuildOptions`, and `CheckRunner`/`CheckModule`, the `run` export every check route calls, in
  [scripts/README.md](../../scripts/README.md).

Import types from `index.js` only, for example
`/** @typedef {import("../contracts/index.js").ModeSeed} ModeSeed */`. Each type has exactly one
definition.

Changing a value or shape here is a contract change. It needs review before a dependent unit
relies on it, and `tests/foundation/contracts.test.mjs` must still pass: every declared constant
exists at runtime, each type is defined once, the declarations type-check strictly against
`tests/foundation/contracts-usage.ts` (which also rejects the replaced shapes), values are frozen,
and legacy IDs match what 1.1.0 stores. The theme schema stays authoritative for the format;
`ThemeV1` mirrors it.

## Package conventions

Each package under `packages/` is plain ESM JavaScript with its own `package.json`
(`"type": "module"` and an `"exports"` `"."` entry). Packages import each other by relative path,
for example `../contracts/index.js`, so adding one needs no root package or lockfile change.
`npm run build:shared -- --scope=engine|primer|preview` bundles a scope's packages into
`dist/shared/<name>.js` for browsers; see scripts/README.md for what each scope includes. It
builds platform-neutral, so a shared package that imports Node built-ins fails there.
