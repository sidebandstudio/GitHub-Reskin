# Contracts

The shared vocabulary for GitHub Reskin modules. `index.js` holds the runtime values: format,
settings, renderer and engine versions, `DEFAULT_THEME_ID`, legacy IDs and storage keys, the
font, effect, slot, color-role, preference and action registries, issue codes, `LIMITS` and
release `BUDGETS`. `index.d.ts` declares those values and the module interfaces from
ARCHITECTURE.md: `ThemeV1`, `ImportResult`, `ResolvedTheme`, `ModeIndex`, `CompiledStyle`,
`SettingsV2`, `SettingsRequest`, `UiHost`, `EditorController`, `ReleaseConfig`, `BuildOptions`
and the rest.

Changing a value or shape here is a contract change. It needs review before a dependent unit
relies on it, and `tests/foundation/contracts.test.mjs` must still pass: every declared constant
exists at runtime, the declarations type-check strictly against `tests/foundation/contracts-usage.ts`,
values are frozen, and legacy IDs match what 1.1.0 stores. The theme schema stays authoritative
for the format; `ThemeV1` mirrors it.

## Package conventions

Each package under `packages/` is plain ESM JavaScript with its own `package.json`
(`"type": "module"` and an `"exports"` `"."` entry). Packages import each other by relative path,
for example `../contracts/index.js`, so adding one needs no root package or lockfile change.
`npm run build:shared` bundles every package that has a `package.json` into `dist/shared/<name>.js`
for browsers. It builds platform-neutral, so a shared package that imports Node built-ins fails there.
