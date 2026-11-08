# Contracts

The shared vocabulary for GitHub Reskin modules.

- `index.js` holds the runtime values: format, settings, renderer, engine and pair-matrix
  versions, `DEFAULT_THEME_ID`, legacy IDs and storage keys, the font, effect, slot, color-role,
  preference and action registries, issue codes, `LIMITS`, release `BUDGETS`, build targets and
  shared build scopes.
- `theme-v1.d.ts` mirrors the public theme schema: `ThemeV1` and `EffectRequests`.
- `theme-engine.d.ts` is the frozen renderer 1 block from ARCHITECTURE.md: `ModeSeed`,
  `ColorSet`, `ModeIndex`, `ResolveContext`, `ThemedResolved` and `NativeResolved`, pair and
  repair records, `PreviewOptions` and `PreviewHandle`. The engine functions appear as the
  `EngineModule` interface because this package does not export them; `packages/engine` does.
- `index.d.ts` declares the runtime values, re-exports every type from the two files above, and
  declares the module interfaces: import results, `PrimerModule`, `PreviewModule`, `SettingsV2`,
  `BootRecord`, `SettingsRequest`, `UiHost`, `EditorAction`, `ReleaseConfig`, `BuildOptions`,
  and `CheckRunner` for the check routes in [scripts/README.md](../../scripts/README.md).

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
