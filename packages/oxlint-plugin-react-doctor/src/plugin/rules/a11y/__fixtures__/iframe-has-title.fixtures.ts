// GENERATED FROM OXC — do not edit by hand. Run `pnpm gen:fixtures` to regenerate.
// Source: oxc-project/oxc `crates/oxc_linter/src/rules/jsx_a11y/iframe_has_title.rs`
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
  { code: `<iframe title='Unique title' />` },
  { code: `<iframe title={foo} />` },
  { code: `<iframe title={\`Title\`} />` },
  { code: `<iframe title={\`\${title}\`} />` },
  { code: `<FooComponent />` },
  { code: `<iframe title={titleGenerator('hello')} />` },
  { code: `<iframe title={obj.prop.name} />` },
  { code: `<iframe title={obj['prop']} />` },
  { code: `<iframe title={a && b} />` },
  { code: `<iframe title={a ? b : c} />` },
  { code: `<iframe title={i18n\`title\`} />` },
  { code: `<iframe title={new Title()} />` },
];

export const failCases: ReadonlyArray<OxcFixture> = [
  { code: `<iframe {...props} />` },
  { code: `<iframe title={undefined} />` },
  { code: `<iframe title='' />` },
  { code: `<iframe title={false} />` },
  { code: `<iframe title={true} />` },
  { code: `<iframe title={''} />` },
  { code: `<iframe title={\`\`} />` },
  { code: `<iframe title={42} />` },
];
