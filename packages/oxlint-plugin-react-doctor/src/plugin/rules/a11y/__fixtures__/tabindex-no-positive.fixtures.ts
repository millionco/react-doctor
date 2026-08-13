// GENERATED FROM OXC — do not edit by hand. Run `pnpm gen:fixtures` to regenerate.
// Source: oxc-project/oxc `crates/oxc_linter/src/rules/jsx_a11y/tabindex_no_positive.rs`
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
  { code: `<div />;` },
  { code: `<div {...props} />` },
  { code: `<div id="main" />` },
  { code: `<div tabIndex={undefined} />` },
  { code: `<div tabIndex={\`\${undefined}\`} />` },
  { code: `<div tabIndex={\`\${undefined}\${undefined}\`} />` },
  { code: `<div tabIndex={0} />` },
  { code: `<div tabIndex={-1} />` },
  { code: `<div tabIndex={null} />` },
  { code: `<div tabIndex={bar()} />` },
  { code: `<div tabIndex={bar} />` },
  { code: `<div tabIndex={"foobar"} />` },
  { code: `<div tabIndex="0" />` },
  { code: `<div tabIndex="-1" />` },
  { code: `<div tabIndex="-5" />` },
  { code: `<div tabIndex="-5.5" />` },
  { code: `<div tabIndex={-5.5} />` },
  { code: `<div tabIndex={-5} />` },
];

export const failCases: ReadonlyArray<OxcFixture> = [
  { code: `<div tabIndex="1" />` },
  { code: `<div tabIndex={1} />` },
  { code: `<div tabIndex={"1"} />` },
  { code: `<div tabIndex={\`1\`} />` },
  { code: `<div tabIndex={1.589} />` },
];
