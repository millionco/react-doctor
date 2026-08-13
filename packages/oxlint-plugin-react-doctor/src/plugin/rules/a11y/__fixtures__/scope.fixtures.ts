// GENERATED FROM OXC — do not edit by hand. Run `pnpm gen:fixtures` to regenerate.
// Source: oxc-project/oxc `crates/oxc_linter/src/rules/jsx_a11y/scope.rs`
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
  { code: `<div foo />;` },
  { code: `<th scope />` },
  { code: `<th scope='row' />` },
  { code: `<th scope={foo} />` },
  { code: `<th scope={'col'} {...props} />` },
  { code: `<Foo scope='bar' {...props} />` },
  {
    code: `<TableHeader scope='row' />`,
    oxcSettings: {
      settings: {
        "jsx-a11y": {
          components: {
            Foo: "div",
            TableHeader: "th",
          },
        },
      },
    },
  },
];

export const failCases: ReadonlyArray<OxcFixture> = [
  { code: `<div scope />` },
  {
    code: `<Foo scope='bar' />;`,
    oxcSettings: {
      settings: {
        "jsx-a11y": {
          components: {
            Foo: "div",
            TableHeader: "th",
          },
        },
      },
    },
  },
];
