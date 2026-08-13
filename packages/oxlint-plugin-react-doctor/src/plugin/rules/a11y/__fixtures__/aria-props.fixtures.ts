// GENERATED FROM OXC — do not edit by hand. Run `pnpm gen:fixtures` to regenerate.
// Source: oxc-project/oxc `crates/oxc_linter/src/rules/jsx_a11y/aria_props.rs`
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
  { code: `<div />` },
  { code: `<div></div>` },
  { code: `<div aria="wee"></div>` },
  { code: `<div abcARIAdef="true"></div>` },
  { code: `<div fooaria-foobar="true"></div>` },
  { code: `<div fooaria-hidden="true"></div>` },
  { code: `<Bar baz />` },
  { code: `<input type="text" aria-errormessage="foobar" />` },
];

export const failCases: ReadonlyArray<OxcFixture> = [
  { code: `<div aria-="foobar" />` },
  { code: `<div aria-labeledby="foobar" />` },
  { code: `<div aria-skldjfaria-klajsd="foobar" />` },
];
