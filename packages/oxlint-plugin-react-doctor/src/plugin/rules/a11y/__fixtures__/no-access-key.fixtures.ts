// GENERATED FROM OXC — do not edit by hand. Run `pnpm gen:fixtures` to regenerate.
// Source: oxc-project/oxc `crates/oxc_linter/src/rules/jsx_a11y/no_access_key.rs`
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
  { code: `<div accessKey={undefined} />` },
];

export const failCases: ReadonlyArray<OxcFixture> = [
  { code: `<div accesskey="h" />` },
  { code: `<div accessKey="h" />` },
  { code: `<div accessKey="h" {...props} />` },
  { code: `<div acCesSKeY="y" />` },
  { code: `<div accessKey={"y"} />` },
  { code: `<div accessKey={\`\${y}\`} />` },
  { code: `<div accessKey={\`\${undefined}y\${undefined}\`} />` },
  { code: `<div accessKey={\`This is \${bad}\`} />` },
  { code: `<div accessKey={accessKey} />` },
  { code: `<div accessKey={\`\${undefined}\`} />` },
  { code: `<div accessKey={\`\${undefined}\${undefined}\`} />` },
];
