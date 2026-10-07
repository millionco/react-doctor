// GENERATED FROM OXC — do not edit by hand. Run `pnpm gen:fixtures` to regenerate.
// Source: oxc-project/oxc `crates/oxc_linter/src/rules/react/jsx_no_duplicate_props.rs`
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
  { code: `<App {...this.props} />;` },
  { code: `<App a b c />;` },
  { code: `<App a b c A />;` },
  { code: `<App {...this.props} a b c />;` },
  { code: `<App c {...this.props} a b />;` },
  { code: `<App a="c" b="b" c="a" />;` },
  { code: `<App {...this.props} a="c" b="b" c="a" />;` },
  { code: `<App c="a" {...this.props} a="c" b="b" />;` },
  { code: `<App A a />;` },
  { code: `<App A b a />;` },
  { code: `<App A="a" b="b" B="B" />;` },
];

export const failCases: ReadonlyArray<OxcFixture> = [
  { code: `<App a a />;` },
  { code: `<App A b c A />;` },
  { code: `<App a="a" b="b" a="a" />;` },
  { code: `<App a="a" {...this.props} b="b" a="a" />;` },
  { code: `<App a b="b" {...this.props} a="a" />;` },
  { code: `<App a={[]} b="b" {...this.props} a="a" />;` },
  { code: `<App a="a" b="b" a="a" {...this.props} />;` },
  { code: `<App {...this.props} a="a" b="b" a="a" />;` },
  {
    code: `
            <App
                a="a"
                {...this.props}
                a={{foo: 'bar'}}
                b="b"
            />;
        `,
  },
];
