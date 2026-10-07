// GENERATED FROM OXC — do not edit by hand. Run `pnpm gen:fixtures` to regenerate.
// Source: oxc-project/oxc `crates/oxc_linter/src/rules/jsx_a11y/anchor_ambiguous_text.rs`
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
  {
    code: `<a><Image alt="documentation" /></a>;`,
    oxcSettings: { settings: { "jsx-a11y": { components: { Image: "img" } } } },
  },
  { code: `<a>documentation</a>;` },
  { code: `<a>\${here}</a>;` },
  { code: `<a aria-label="tutorial on using eslint-plugin-jsx-a11y">click here</a>;` },
  { code: `<a><span aria-label="tutorial on using eslint-plugin-jsx-a11y">click here</span></a>;` },
  { code: `<a><img alt="documentation" /></a>;` },
  { code: `<a>click here</a>`, oxcOptions: [{ words: ["disabling the defaults"] }] },
  {
    code: `<Link>documentation</Link>;`,
    oxcSettings: { settings: { "jsx-a11y": { components: { Link: "a" } } } },
  },
  {
    code: `<a><Image alt="documentation" /></a>;`,
    oxcSettings: { settings: { "jsx-a11y": { components: { Image: "img" } } } },
  },
  {
    code: `<Link>\${here}</Link>;`,
    oxcSettings: { settings: { "jsx-a11y": { components: { Link: "a" } } } },
  },
  {
    code: `<Link aria-label="tutorial on using eslint-plugin-jsx-a11y">click here</Link>;`,
    oxcSettings: { settings: { "jsx-a11y": { components: { Link: "a" } } } },
  },
  {
    code: `<Link>click here</Link>`,
    oxcOptions: [{ words: ["disabling the defaults with components"] }],
    oxcSettings: { settings: { "jsx-a11y": { components: { Link: "a" } } } },
  },
];

export const failCases: ReadonlyArray<OxcFixture> = [
  { code: `<a>here</a>;` },
  { code: `<a>HERE</a>;` },
  { code: `<a>click here</a>;` },
  { code: `<a>learn more</a>;` },
  { code: `<a>learn      more</a>;` },
  { code: `<a>learn more.</a>;` },
  { code: `<a>learn more?</a>;` },
  { code: `<a>learn more,</a>;` },
  { code: `<a>learn more!</a>;` },
  { code: `<a>learn more;</a>;` },
  { code: `<a>learn more:</a>;` },
  { code: `<a>link</a>;` },
  { code: `<a>a link</a>;` },
  { code: `<a aria-label="click here">something</a>;` },
  { code: `<a> a link </a>;` },
  { code: `<a>a<i></i> link</a>;` },
  { code: `<a><i></i>a link</a>;` },
  { code: `<a><span>click</span> here</a>;` },
  { code: `<a><span> click </span> here</a>;` },
  { code: `<a><span aria-hidden>more text</span>learn more</a>;` },
  { code: `<a><span aria-hidden="true">more text</span>learn more</a>;` },
  { code: `<a><img alt="click here"/></a>;` },
  { code: `<a alt="tutorial on using eslint-plugin-jsx-a11y">click here</a>;` },
  { code: `<a><span alt="tutorial on using eslint-plugin-jsx-a11y">click here</span></a>;` },
  { code: `<a><CustomElement>click</CustomElement> here</a>;` },
  {
    code: `<Link>here</Link>`,
    oxcSettings: { settings: { "jsx-a11y": { components: { Link: "a" } } } },
  },
  {
    code: `<a><Image alt="click here" /></a>`,
    oxcSettings: { settings: { "jsx-a11y": { components: { Image: "img" } } } },
  },
  { code: `<a>a disallowed word</a>`, oxcOptions: [{ words: ["a disallowed word"] }] },
];
