// GENERATED FROM OXC — do not edit by hand. Run `pnpm gen:fixtures` to regenerate.
// Source: oxc-project/oxc `crates/oxc_linter/src/rules/jsx_a11y/anchor_has_content.rs`
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
  { code: `<a>Foo</a>` },
  { code: `<a><Bar /></a>` },
  { code: `<a>{foo}</a>` },
  { code: `<a>{foo.bar}</a>` },
  { code: `<a dangerouslySetInnerHTML={{ __html: "foo" }} />` },
  { code: `<a children={children} />` },
  { code: `<Link />` },
  {
    code: `<Link>foo</Link>`,
    oxcSettings: { settings: { "jsx-a11y": { components: { Link: "a" } } } },
  },
  { code: `<a title={title} />` },
  { code: `<a aria-label={ariaLabel} />` },
  { code: `<a title={title} aria-label={ariaLabel} />` },
  { code: `<a><Bar aria-hidden="false" /></a>` },
  { code: `<a aria-hidden="true">Foo</a>` },
  { code: `<a hidden>Foo</a>` },
  { code: `<a aria-hidden><span aria-hidden>Foo</span></a>` },
  { code: `<a hidden="true">Foo</a>` },
  { code: `<a hidden="">Foo</a>` },
  { code: `<a><Bar hidden /></a>` },
  { code: `<a><Bar hidden="" /></a>` },
  { code: `<a><Bar hidden="until-hidden" /></a>` },
];

export const failCases: ReadonlyArray<OxcFixture> = [
  { code: `<a />` },
  { code: `<a><Bar aria-hidden /></a>` },
  { code: `<a><Bar aria-hidden="true" /></a>` },
  { code: `<a><input type="hidden" /></a>` },
  { code: `<a>{undefined}</a>` },
  { code: `<a>{null}</a>` },
  { code: `<Link />`, oxcSettings: { settings: { "jsx-a11y": { components: { Link: "a" } } } } },
];
