// GENERATED FROM OXC — do not edit by hand. Run `pnpm gen:fixtures` to regenerate.
// Source: oxc-project/oxc `crates/oxc_linter/src/rules/react/jsx_boolean_value.rs`
// Each entry is a verbatim port of an OXC `pass`/`fail` vec entry.
// `oxcOptions` (optional) is OXC's first config arg (`Some(json!([…]))`),
// preserved as JS for tests that want to translate it. `oxcSettings`
// (optional) mirrors the third tuple slot used for plugin settings.

export interface OxcFixture {
  code: string;
  oxcOptions?: unknown;
  oxcSettings?: unknown;
  oxcFilename?: string;
}

export const passCases: ReadonlyArray<OxcFixture> = [
  { code: `<App foo />;`, oxcOptions: ["never"] },
  { code: `<App foo bar={true} />;`, oxcOptions: ["always", { never: ["foo"] }] },
  { code: `<App foo />;` },
  { code: `<App foo={true} />;`, oxcOptions: ["always"] },
  { code: `<App foo={true} bar />;`, oxcOptions: ["never", { always: ["foo"] }] },
  { code: `<App />;`, oxcOptions: ["never", { assumeUndefinedIsFalse: true }] },
  {
    code: `<App foo={false} />;`,
    oxcOptions: ["never", { assumeUndefinedIsFalse: true, always: ["foo"] }],
  },
];

export const failCases: ReadonlyArray<OxcFixture> = [
  { code: `<App foo={true} />;`, oxcOptions: ["never"] },
  {
    code: `<App foo={true} bar={true} baz={true} />;`,
    oxcOptions: ["always", { never: ["foo", "bar"] }],
  },
  { code: `<App foo={true} />;` },
  { code: `<App foo = {true} />;` },
  { code: `<App foo />;`, oxcOptions: ["always"] },
  { code: `<App foo bar baz />;`, oxcOptions: ["never", { always: ["foo", "bar"] }] },
  {
    code: `<App foo={false} bak={false} />;`,
    oxcOptions: ["never", { assumeUndefinedIsFalse: true }],
  },
  {
    code: `<App foo={true} bar={false} baz={false} bak={false} />;`,
    oxcOptions: ["always", { assumeUndefinedIsFalse: true, never: ["baz", "bak"] }],
  },
  { code: `<App foo={true} bar={true} baz />;`, oxcOptions: ["always", { never: ["foo", "bar"] }] },
];
