// GENERATED FROM OXC — do not edit by hand. Run `pnpm gen:fixtures` to regenerate.
// Source: oxc-project/oxc `crates/oxc_linter/src/rules/react/jsx_fragments.rs`
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
  { code: `<><Foo /></>` },
  { code: `<Fragment key="key"><Foo /></Fragment>` },
  { code: `<React.Fragment key="key"><Foo /></React.Fragment>` },
  { code: `<Fragment />` },
  { code: `<React.Fragment />` },
  { code: `<><Foo /></>`, oxcOptions: [{ mode: "syntax" }] },
  { code: `<React.Fragment><Foo /></React.Fragment>`, oxcOptions: ["element"] },
  { code: `<React.Fragment><Foo /></React.Fragment>`, oxcOptions: [{ mode: "element" }] },
];

export const failCases: ReadonlyArray<OxcFixture> = [
  { code: `<Fragment><Foo /></Fragment>` },
  { code: `<React.Fragment><Foo /></React.Fragment>` },
  { code: `<><Foo /></>`, oxcOptions: ["element"] },
  { code: `<><Foo /></>`, oxcOptions: [{ mode: "element" }] },
];
