// GENERATED FROM OXC — do not edit by hand. Run `pnpm gen:fixtures` to regenerate.
// Source: oxc-project/oxc `crates/oxc_linter/src/rules/jsx_a11y/html_has_lang.rs`
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
  { code: `<html lang="en" />` },
  { code: `<html lang="en-US" />` },
  { code: `<html lang={"en-US"} />` },
  { code: `<html lang={\`en-US\`} />` },
  { code: `<html lang={\`\${foo}\`} />` },
  { code: `<html lang={foo} />;` },
  { code: `<html lang />;` },
  { code: `<HTML />;` },
  {
    code: `<HTMLTop lang='en' />`,
    oxcSettings: {
      settings: {
        "jsx-a11y": {
          components: {
            HTMLTop: "html",
          },
        },
      },
    },
  },
];

export const failCases: ReadonlyArray<OxcFixture> = [
  { code: `<html />;` },
  { code: `<html {...props} />;` },
  { code: `<html lang={undefined} />;` },
  { code: `<html lang={null} />;` },
  { code: `<html lang={false} />;` },
  { code: `<html lang={1} />;` },
  { code: `<html lang={''} />;` },
  { code: `<html lang={\`\`} />;` },
  { code: `<html lang="" />;` },
  {
    code: `<HTMLTop />`,
    oxcSettings: {
      settings: {
        "jsx-a11y": {
          components: {
            HTMLTop: "html",
          },
        },
      },
    },
  },
];
