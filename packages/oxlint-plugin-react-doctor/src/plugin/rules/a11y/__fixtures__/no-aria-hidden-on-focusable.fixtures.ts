// GENERATED FROM OXC — do not edit by hand. Run `pnpm gen:fixtures` to regenerate.
// Source: oxc-project/oxc `crates/oxc_linter/src/rules/jsx_a11y/no_aria_hidden_on_focusable.rs`
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
  { code: `<div aria-hidden="true" />;` },
  { code: `<div onClick={() => void 0} aria-hidden="true" />;` },
  { code: `<img aria-hidden="true" />` },
  { code: `<a aria-hidden="false" href="" />` },
  { code: `<button aria-hidden="true" tabIndex="-1" />` },
  { code: `<button />` },
  { code: `<a href="/" />` },
];

export const failCases: ReadonlyArray<OxcFixture> = [
  { code: `<div aria-hidden="true" tabIndex="0" />;` },
  { code: `<input aria-hidden="true" />;` },
  { code: `<a href="/" aria-hidden="true" />` },
  { code: `<button aria-hidden="true" />` },
  { code: `<textarea aria-hidden="true" />` },
  { code: `<p tabIndex="0" aria-hidden="true">text</p>;` },
];
