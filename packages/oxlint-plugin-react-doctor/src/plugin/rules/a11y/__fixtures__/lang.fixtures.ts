// GENERATED FROM OXC — do not edit by hand. Run `pnpm gen:fixtures` to regenerate.
// Source: oxc-project/oxc `crates/oxc_linter/src/rules/jsx_a11y/lang.rs`
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
  { code: `<div foo='bar' />;` },
  { code: `<div lang='foo' />;` },
  { code: `<html lang='en' />` },
  { code: `<html lang='en-US' />` },
  { code: `<html lang='zh-Hans' />` },
  { code: `<html lang='zh-Hant-HK' />` },
  { code: `<html lang='zh-yue-Hant' />` },
  { code: `<html lang='ja-Latn' />` },
  { code: `<html lang={foo} />` },
  { code: `<HTML lang='foo' />` },
  { code: `<Foo lang={undefined} />` },
  {
    code: `<Foo lang='en' />`,
    oxcSettings: {
      settings: {
        "jsx-a11y": {
          polymorphicPropName: "as",
          components: {
            Foo: "html",
          },
        },
      },
    },
  },
  {
    code: `<Box as='html' lang='en'  />`,
    oxcSettings: {
      settings: {
        "jsx-a11y": {
          polymorphicPropName: "as",
          components: {
            Foo: "html",
          },
        },
      },
    },
  },
];

export const failCases: ReadonlyArray<OxcFixture> = [
  { code: `<html lang='foo' />` },
  { code: `<html lang='n'></html>` },
  { code: `<html lang='zz-LL' />` },
  { code: `<html lang={undefined} />` },
  {
    code: `<Foo lang={undefined} />`,
    oxcSettings: {
      settings: {
        "jsx-a11y": {
          polymorphicPropName: "as",
          components: {
            Foo: "html",
          },
        },
      },
    },
  },
  {
    code: `<Box as='html' lang='foo' />`,
    oxcSettings: {
      settings: {
        "jsx-a11y": {
          polymorphicPropName: "as",
          components: {
            Foo: "html",
          },
        },
      },
    },
  },
];
