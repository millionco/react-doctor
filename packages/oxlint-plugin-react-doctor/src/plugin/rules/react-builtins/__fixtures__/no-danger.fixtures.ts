// GENERATED FROM OXC — do not edit by hand. Run `pnpm gen:fixtures` to regenerate.
// Source: oxc-project/oxc `crates/oxc_linter/src/rules/react/no_danger.rs`
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
  { code: `<App />;` },
  { code: `<div className="bar"></div>;` },
  { code: `React.createElement("div", { className: "bar" });` },
];

export const failCases: ReadonlyArray<OxcFixture> = [
  { code: `<div dangerouslySetInnerHTML={{ __html: "" }}></div>;` },
  { code: `<button dangerouslySetInnerHTML={{ __html: "baz" }}>Foo</button>;` },
  { code: `React.createElement("div", { dangerouslySetInnerHTML: { __html: "" } });` },
  { code: `React.createElement("button", { dangerouslySetInnerHTML: { __html: "baz" } }, "Foo");` },
];
