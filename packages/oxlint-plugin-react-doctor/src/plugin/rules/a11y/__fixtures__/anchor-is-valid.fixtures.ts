// GENERATED FROM OXC — do not edit by hand. Run `pnpm gen:fixtures` to regenerate.
// Source: oxc-project/oxc `crates/oxc_linter/src/rules/jsx_a11y/anchor_is_valid.rs`
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
  { code: `<Anchor />` },
  { code: `<a {...props} />` },
  { code: `<a href='foo' />` },
  { code: `<a href={foo} />` },
  { code: `<a href='/foo' />` },
  { code: `<a href='https://foo.bar.com' />` },
  { code: `<div href='foo' />` },
  { code: `<a href='javascript' />` },
  { code: `<a href='javascriptFoo' />` },
  { code: `<a href={\`#foo\`}/>` },
  { code: `<a href={'foo'}/>` },
  { code: `<a href={'javascript'}/>` },
  { code: `<a href={\`#javascript\`}/>` },
  { code: `<a href='#foo' />` },
  { code: `<a href='#javascript' />` },
  { code: `<a href='#javascriptFoo' />` },
  { code: `<UX.Layout>test</UX.Layout>` },
  { code: `<a href={this} />` },
  { code: `<Anchor {...props} />`, oxcOptions: [{ components: ["Anchor", "Link"] }] },
  { code: `<Anchor href='foo' />`, oxcOptions: [{ components: ["Anchor", "Link"] }] },
  { code: `<Anchor href={foo} />`, oxcOptions: [{ components: ["Anchor", "Link"] }] },
  { code: `<Anchor href='/foo' />`, oxcOptions: [{ components: ["Anchor", "Link"] }] },
  {
    code: `<Anchor href='https://foo.bar.com' />`,
    oxcOptions: [{ components: ["Anchor", "Link"] }],
  },
  { code: `<div href='foo' />`, oxcOptions: [{ components: ["Anchor", "Link"] }] },
  { code: `<Anchor href={\`#foo\`}/>`, oxcOptions: [{ components: ["Anchor", "Link"] }] },
  { code: `<Anchor href={'foo'}/>`, oxcOptions: [{ components: ["Anchor", "Link"] }] },
  { code: `<Anchor href='#foo' />`, oxcOptions: [{ components: ["Anchor", "Link"] }] },
  { code: `<Link {...props} />`, oxcOptions: [{ components: ["Anchor", "Link"] }] },
  { code: `<Link href='foo' />`, oxcOptions: [{ components: ["Anchor", "Link"] }] },
  { code: `<Link href={foo} />`, oxcOptions: [{ components: ["Anchor", "Link"] }] },
  { code: `<Link href='/foo' />`, oxcOptions: [{ components: ["Anchor", "Link"] }] },
  { code: `<Link href='https://foo.bar.com' />`, oxcOptions: [{ components: ["Anchor", "Link"] }] },
  { code: `<div href='foo' />`, oxcOptions: [{ components: ["Anchor", "Link"] }] },
  { code: `<Link href={\`#foo\`}/>`, oxcOptions: [{ components: ["Anchor", "Link"] }] },
  { code: `<Link href={'foo'}/>`, oxcOptions: [{ components: ["Anchor", "Link"] }] },
  { code: `<Link href='#foo' />`, oxcOptions: [{ components: ["Anchor", "Link"] }] },
  {
    code: `<Link href='#foo' />`,
    oxcSettings: {
      settings: {
        "jsx-a11y": {
          components: {
            Anchor: "a",
            Link: "a",
          },
        },
      },
    },
  },
  {
    code: `<Link to='https://example.com' />`,
    oxcSettings: {
      settings: {
        "jsx-a11y": {
          components: { Link: "a" },
          attributes: { href: ["href", "to"] },
        },
      },
    },
  },
  {
    code: `<Link to={dest} />`,
    oxcSettings: {
      settings: {
        "jsx-a11y": {
          components: { Link: "a" },
          attributes: { href: ["href", "to"] },
        },
      },
    },
  },
  { code: `<a {...props} />`, oxcOptions: [{ specialLink: ["hrefLeft", "hrefRight"] }] },
  { code: `<a hrefLeft='foo' />`, oxcOptions: [{ specialLink: ["hrefLeft", "hrefRight"] }] },
  { code: `<a hrefLeft={foo} />`, oxcOptions: [{ specialLink: ["hrefLeft", "hrefRight"] }] },
  { code: `<a hrefLeft='/foo' />`, oxcOptions: [{ specialLink: ["hrefLeft", "hrefRight"] }] },
  {
    code: `<a hrefLeft='https://foo.bar.com' />`,
    oxcOptions: [{ specialLink: ["hrefLeft", "hrefRight"] }],
  },
  { code: `<div hrefLeft='foo' />`, oxcOptions: [{ specialLink: ["hrefLeft", "hrefRight"] }] },
  { code: `<a hrefLeft={\`#foo\`}/>`, oxcOptions: [{ specialLink: ["hrefLeft", "hrefRight"] }] },
  { code: `<a hrefLeft={'foo'}/>`, oxcOptions: [{ specialLink: ["hrefLeft", "hrefRight"] }] },
  { code: `<a hrefLeft='#foo' />`, oxcOptions: [{ specialLink: ["hrefLeft", "hrefRight"] }] },
  { code: `<UX.Layout>test</UX.Layout>`, oxcOptions: [{ specialLink: ["hrefLeft", "hrefRight"] }] },
  { code: `<a hrefRight={this} />`, oxcOptions: [{ specialLink: ["hrefLeft", "hrefRight"] }] },
  { code: `<a {...props} />`, oxcOptions: [{ specialLink: ["hrefLeft", "hrefRight"] }] },
  { code: `<a hrefRight='foo' />`, oxcOptions: [{ specialLink: ["hrefLeft", "hrefRight"] }] },
  { code: `<a hrefRight={foo} />`, oxcOptions: [{ specialLink: ["hrefLeft", "hrefRight"] }] },
  { code: `<a hrefRight='/foo' />`, oxcOptions: [{ specialLink: ["hrefLeft", "hrefRight"] }] },
  {
    code: `<a hrefRight='https://foo.bar.com' />`,
    oxcOptions: [{ specialLink: ["hrefLeft", "hrefRight"] }],
  },
  { code: `<div hrefRight='foo' />`, oxcOptions: [{ specialLink: ["hrefLeft", "hrefRight"] }] },
  { code: `<a hrefRight={\`#foo\`}/>`, oxcOptions: [{ specialLink: ["hrefLeft", "hrefRight"] }] },
  { code: `<a hrefRight={'foo'}/>`, oxcOptions: [{ specialLink: ["hrefLeft", "hrefRight"] }] },
  { code: `<a hrefRight='#foo' />`, oxcOptions: [{ specialLink: ["hrefLeft", "hrefRight"] }] },
  { code: `<UX.Layout>test</UX.Layout>`, oxcOptions: [{ specialLink: ["hrefLeft", "hrefRight"] }] },
  { code: `<a hrefRight={this} />`, oxcOptions: [{ specialLink: ["hrefLeft", "hrefRight"] }] },
  {
    code: `<Anchor {...props} />`,
    oxcOptions: [{ components: ["Anchor"], specialLink: ["hrefLeft"] }],
  },
  {
    code: `<Anchor hrefLeft='foo' />`,
    oxcOptions: [{ components: ["Anchor"], specialLink: ["hrefLeft"] }],
  },
  {
    code: `<Anchor hrefLeft={foo} />`,
    oxcOptions: [{ components: ["Anchor"], specialLink: ["hrefLeft"] }],
  },
  {
    code: `<Anchor hrefLeft='/foo' />`,
    oxcOptions: [{ components: ["Anchor"], specialLink: ["hrefLeft"] }],
  },
  {
    code: `<Anchor hrefLeft='https://foo.bar.com' />`,
    oxcOptions: [{ components: ["Anchor"], specialLink: ["hrefLeft"] }],
  },
  {
    code: `<div hrefLeft='foo' />`,
    oxcOptions: [{ components: ["Anchor"], specialLink: ["hrefLeft"] }],
  },
  {
    code: `<Anchor hrefLeft={\`#foo\`}/>`,
    oxcOptions: [{ components: ["Anchor"], specialLink: ["hrefLeft"] }],
  },
  {
    code: `<Anchor hrefLeft={'foo'}/>`,
    oxcOptions: [{ components: ["Anchor"], specialLink: ["hrefLeft"] }],
  },
  {
    code: `<Anchor hrefLeft='#foo' />`,
    oxcOptions: [{ components: ["Anchor"], specialLink: ["hrefLeft"] }],
  },
  {
    code: `<UX.Layout>test</UX.Layout>`,
    oxcOptions: [{ components: ["Anchor"], specialLink: ["hrefLeft"] }],
  },
  { code: `<a {...props} onClick={() => void 0} />` },
  { code: `<a href='foo' onClick={() => void 0} />` },
  { code: `<a href={foo} onClick={() => void 0} />` },
  { code: `<a href='/foo' onClick={() => void 0} />` },
  { code: `<a href='https://foo.bar.com' onClick={() => void 0} />` },
  { code: `<div href='foo' onClick={() => void 0} />` },
  { code: `<a href={\`#foo\`} onClick={() => void 0} />` },
  { code: `<a href={'foo'} onClick={() => void 0} />` },
  { code: `<a href='#foo' onClick={() => void 0} />` },
  { code: `<a href={this} onClick={() => void 0} />` },
  {
    code: `<Anchor {...props} onClick={() => void 0} />`,
    oxcOptions: [{ components: ["Anchor", "Link"] }],
  },
  {
    code: `<Anchor href='foo' onClick={() => void 0} />`,
    oxcOptions: [{ components: ["Anchor", "Link"] }],
  },
  {
    code: `<Anchor href={foo} onClick={() => void 0} />`,
    oxcOptions: [{ components: ["Anchor", "Link"] }],
  },
  {
    code: `<Anchor href='/foo' onClick={() => void 0} />`,
    oxcOptions: [{ components: ["Anchor", "Link"] }],
  },
  {
    code: `<Anchor href='https://foo.bar.com' onClick={() => void 0} />`,
    oxcOptions: [{ components: ["Anchor", "Link"] }],
  },
  {
    code: `<Anchor href={\`#foo\`} onClick={() => void 0} />`,
    oxcOptions: [{ components: ["Anchor", "Link"] }],
  },
  {
    code: `<Anchor href={'foo'} onClick={() => void 0} />`,
    oxcOptions: [{ components: ["Anchor", "Link"] }],
  },
  {
    code: `<Anchor href='#foo' onClick={() => void 0} />`,
    oxcOptions: [{ components: ["Anchor", "Link"] }],
  },
  {
    code: `<Link {...props} onClick={() => void 0} />`,
    oxcOptions: [{ components: ["Anchor", "Link"] }],
  },
  {
    code: `<Link href='foo' onClick={() => void 0} />`,
    oxcOptions: [{ components: ["Anchor", "Link"] }],
  },
  {
    code: `<Link href={foo} onClick={() => void 0} />`,
    oxcOptions: [{ components: ["Anchor", "Link"] }],
  },
  {
    code: `<Link href='/foo' onClick={() => void 0} />`,
    oxcOptions: [{ components: ["Anchor", "Link"] }],
  },
  {
    code: `<Link href='https://foo.bar.com' onClick={() => void 0} />`,
    oxcOptions: [{ components: ["Anchor", "Link"] }],
  },
  {
    code: `<div href='foo' onClick={() => void 0} />`,
    oxcOptions: [{ components: ["Anchor", "Link"] }],
  },
  {
    code: `<Link href={\`#foo\`} onClick={() => void 0} />`,
    oxcOptions: [{ components: ["Anchor", "Link"] }],
  },
  {
    code: `<Link href={'foo'} onClick={() => void 0} />`,
    oxcOptions: [{ components: ["Anchor", "Link"] }],
  },
  {
    code: `<Link href='#foo' onClick={() => void 0} />`,
    oxcOptions: [{ components: ["Anchor", "Link"] }],
  },
  {
    code: `<a {...props} onClick={() => void 0} />`,
    oxcOptions: [{ specialLink: ["hrefLeft", "hrefRight"] }],
  },
  {
    code: `<a hrefLeft='foo' onClick={() => void 0} />`,
    oxcOptions: [{ specialLink: ["hrefLeft", "hrefRight"] }],
  },
  {
    code: `<a hrefLeft={foo} onClick={() => void 0} />`,
    oxcOptions: [{ specialLink: ["hrefLeft", "hrefRight"] }],
  },
  {
    code: `<a hrefLeft='/foo' onClick={() => void 0} />`,
    oxcOptions: [{ specialLink: ["hrefLeft", "hrefRight"] }],
  },
  {
    code: `<a hrefLeft href='https://foo.bar.com' onClick={() => void 0} />`,
    oxcOptions: [{ specialLink: ["hrefLeft", "hrefRight"] }],
  },
  {
    code: `<div hrefLeft='foo' onClick={() => void 0} />`,
    oxcOptions: [{ specialLink: ["hrefLeft", "hrefRight"] }],
  },
  {
    code: `<a hrefLeft={\`#foo\`} onClick={() => void 0} />`,
    oxcOptions: [{ specialLink: ["hrefLeft", "hrefRight"] }],
  },
  {
    code: `<a hrefLeft={'foo'} onClick={() => void 0} />`,
    oxcOptions: [{ specialLink: ["hrefLeft", "hrefRight"] }],
  },
  {
    code: `<a hrefLeft='#foo' onClick={() => void 0} />`,
    oxcOptions: [{ specialLink: ["hrefLeft", "hrefRight"] }],
  },
  {
    code: `<a hrefRight={this} onClick={() => void 0} />`,
    oxcOptions: [{ specialLink: ["hrefLeft", "hrefRight"] }],
  },
  {
    code: `<a {...props} onClick={() => void 0} />`,
    oxcOptions: [{ specialLink: ["hrefLeft", "hrefRight"] }],
  },
  {
    code: `<a hrefRight='foo' onClick={() => void 0} />`,
    oxcOptions: [{ specialLink: ["hrefLeft", "hrefRight"] }],
  },
  {
    code: `<a hrefRight={foo} onClick={() => void 0} />`,
    oxcOptions: [{ specialLink: ["hrefLeft", "hrefRight"] }],
  },
  {
    code: `<a hrefRight='/foo' onClick={() => void 0} />`,
    oxcOptions: [{ specialLink: ["hrefLeft", "hrefRight"] }],
  },
  {
    code: `<a hrefRight href='https://foo.bar.com' onClick={() => void 0} />`,
    oxcOptions: [{ specialLink: ["hrefLeft", "hrefRight"] }],
  },
  {
    code: `<div hrefRight='foo' onClick={() => void 0} />`,
    oxcOptions: [{ specialLink: ["hrefLeft", "hrefRight"] }],
  },
  {
    code: `<a hrefRight={\`#foo\`} onClick={() => void 0} />`,
    oxcOptions: [{ specialLink: ["hrefLeft", "hrefRight"] }],
  },
  {
    code: `<a hrefRight={'foo'} onClick={() => void 0} />`,
    oxcOptions: [{ specialLink: ["hrefLeft", "hrefRight"] }],
  },
  {
    code: `<a hrefRight='#foo' onClick={() => void 0} />`,
    oxcOptions: [{ specialLink: ["hrefLeft", "hrefRight"] }],
  },
  {
    code: `<a hrefRight={this} onClick={() => void 0} />`,
    oxcOptions: [{ specialLink: ["hrefLeft", "hrefRight"] }],
  },
  {
    code: `<Anchor {...props} onClick={() => void 0} />`,
    oxcOptions: [{ components: ["Anchor"], specialLink: ["hrefLeft"] }],
  },
  {
    code: `<Anchor hrefLeft='foo' onClick={() => void 0} />`,
    oxcOptions: [{ components: ["Anchor"], specialLink: ["hrefLeft"] }],
  },
  {
    code: `<Anchor hrefLeft={foo} onClick={() => void 0} />`,
    oxcOptions: [{ components: ["Anchor"], specialLink: ["hrefLeft"] }],
  },
  {
    code: `<Anchor hrefLeft='/foo' onClick={() => void 0} />`,
    oxcOptions: [{ components: ["Anchor"], specialLink: ["hrefLeft"] }],
  },
  {
    code: `<Anchor hrefLeft href='https://foo.bar.com' onClick={() => void 0} />`,
    oxcOptions: [{ components: ["Anchor"], specialLink: ["hrefLeft"] }],
  },
  {
    code: `<Anchor hrefLeft={\`#foo\`} onClick={() => void 0} />`,
    oxcOptions: [{ components: ["Anchor"], specialLink: ["hrefLeft"] }],
  },
  {
    code: `<Anchor hrefLeft={'foo'} onClick={() => void 0} />`,
    oxcOptions: [{ components: ["Anchor"], specialLink: ["hrefLeft"] }],
  },
  {
    code: `<Anchor hrefLeft='#foo' onClick={() => void 0} />`,
    oxcOptions: [{ components: ["Anchor"], specialLink: ["hrefLeft"] }],
  },
  { code: `<a />`, oxcOptions: [{ aspects: ["invalidHref"] }] },
  { code: `<a href={undefined} />`, oxcOptions: [{ aspects: ["invalidHref"] }] },
  { code: `<a href={null} />`, oxcOptions: [{ aspects: ["invalidHref"] }] },
  { code: `<a />`, oxcOptions: [{ aspects: ["preferButton"] }] },
  { code: `<a href={undefined} />`, oxcOptions: [{ aspects: ["preferButton"] }] },
  { code: `<a href={null} />`, oxcOptions: [{ aspects: ["preferButton"] }] },
  { code: `<a />`, oxcOptions: [{ aspects: ["preferButton", "invalidHref"] }] },
  { code: `<a href={undefined} />`, oxcOptions: [{ aspects: ["preferButton", "invalidHref"] }] },
  { code: `<a href={null} />`, oxcOptions: [{ aspects: ["preferButton", "invalidHref"] }] },
  { code: `<a href="" />;`, oxcOptions: [{ aspects: ["preferButton"] }] },
  { code: `<a href='#' />`, oxcOptions: [{ aspects: ["preferButton"] }] },
  { code: `<a href={'#'} />`, oxcOptions: [{ aspects: ["preferButton"] }] },
  { code: `<a href='javascript:void(0)' />`, oxcOptions: [{ aspects: ["preferButton"] }] },
  { code: `<a href={'javascript:void(0)'} />`, oxcOptions: [{ aspects: ["preferButton"] }] },
  { code: `<a href="" />;`, oxcOptions: [{ aspects: ["noHref"] }] },
  { code: `<a href='#' />`, oxcOptions: [{ aspects: ["noHref"] }] },
  { code: `<a href={'#'} />`, oxcOptions: [{ aspects: ["noHref"] }] },
  { code: `<a href='javascript:void(0)' />`, oxcOptions: [{ aspects: ["noHref"] }] },
  { code: `<a href={'javascript:void(0)'} />`, oxcOptions: [{ aspects: ["noHref"] }] },
  { code: `<a href="" />;`, oxcOptions: [{ aspects: ["noHref", "preferButton"] }] },
  { code: `<a href='#' />`, oxcOptions: [{ aspects: ["noHref", "preferButton"] }] },
  { code: `<a href={'#'} />`, oxcOptions: [{ aspects: ["noHref", "preferButton"] }] },
  {
    code: `<a href='javascript:void(0)' />`,
    oxcOptions: [{ aspects: ["noHref", "preferButton"] }],
  },
  {
    code: `<a href={'javascript:void(0)'} />`,
    oxcOptions: [{ aspects: ["noHref", "preferButton"] }],
  },
  { code: `<a onClick={() => void 0} />`, oxcOptions: [{ aspects: ["invalidHref"] }] },
  { code: `<a href='#' onClick={() => void 0} />`, oxcOptions: [{ aspects: ["noHref"] }] },
  {
    code: `<a href='javascript:void(0)' onClick={() => void 0} />`,
    oxcOptions: [{ aspects: ["noHref"] }],
  },
  {
    code: `<a href={'javascript:void(0)'} onClick={() => void 0} />`,
    oxcOptions: [{ aspects: ["noHref"] }],
  },
  {
    code: `<Anchor hrefLeft={undefined} />`,
    oxcOptions: [
      {
        components: ["Anchor"],
        specialLink: ["hrefLeft"],
        aspects: ["invalidHref"],
      },
    ],
  },
  {
    code: `<Anchor hrefLeft={null} />`,
    oxcOptions: [
      {
        components: ["Anchor"],
        specialLink: ["hrefLeft"],
        aspects: ["invalidHref"],
      },
    ],
  },
];

export const failCases: ReadonlyArray<OxcFixture> = [
  { code: `<a />` },
  { code: `<a href />` },
  { code: `<a href={undefined} />` },
  { code: `<a href={null} />` },
  { code: `<a href='' />;` },
  { code: `<a href='#' />` },
  { code: `<a href={'#'} />` },
  { code: `<a href={\`#\`} />` },
  { code: `<a href='javascript:void(0)' />` },
  { code: `<a href={'javascript:void(0)'} />` },
  { code: `<a onClick={() => void 0} />` },
  { code: `<a href='#' onClick={() => void 0} />` },
  { code: `<a href='javascript:void(0)' onClick={() => void 0} />` },
  { code: `<a href={'javascript:void(0)'} onClick={() => void 0} />` },
  { code: `<Link />`, oxcOptions: [{ components: ["Anchor", "Link"] }] },
  { code: `<Link href={undefined} />`, oxcOptions: [{ components: ["Anchor", "Link"] }] },
  { code: `<Link href={null} />`, oxcOptions: [{ components: ["Anchor", "Link"] }] },
  { code: `<Link href="" />`, oxcOptions: [{ components: ["Anchor", "Link"] }] },
  { code: `<Link href='#' />`, oxcOptions: [{ components: ["Anchor", "Link"] }] },
  { code: `<Link href={'#'} />`, oxcOptions: [{ components: ["Anchor", "Link"] }] },
  { code: `<Link href='javascript:void(0)' />`, oxcOptions: [{ components: ["Anchor", "Link"] }] },
  {
    code: `<Link href={'javascript:void(0)'} />`,
    oxcOptions: [{ components: ["Anchor", "Link"] }],
  },
  { code: `<Anchor href="" />`, oxcOptions: [{ components: ["Anchor", "Link"] }] },
  { code: `<Anchor href='#' />`, oxcOptions: [{ components: ["Anchor", "Link"] }] },
  { code: `<Anchor href={'#'} />`, oxcOptions: [{ components: ["Anchor", "Link"] }] },
  {
    code: `<Anchor href='javascript:void(0)' />`,
    oxcOptions: [{ components: ["Anchor", "Link"] }],
  },
  {
    code: `<Anchor href={'javascript:void(0)'} />`,
    oxcOptions: [{ components: ["Anchor", "Link"] }],
  },
  { code: `<Link onClick={() => void 0} />`, oxcOptions: [{ components: ["Anchor", "Link"] }] },
  {
    code: `<Link href='#' onClick={() => void 0} />`,
    oxcOptions: [{ components: ["Anchor", "Link"] }],
  },
  {
    code: `<Link href='javascript:void(0)' onClick={() => void 0} />`,
    oxcOptions: [{ components: ["Anchor", "Link"] }],
  },
  {
    code: `<Link href={'javascript:void(0)'} onClick={() => void 0} />`,
    oxcOptions: [{ components: ["Anchor", "Link"] }],
  },
  { code: `<Anchor onClick={() => void 0} />`, oxcOptions: [{ components: ["Anchor", "Link"] }] },
  {
    code: `<Anchor href='#' onClick={() => void 0} />`,
    oxcOptions: [{ components: ["Anchor", "Link"] }],
  },
  {
    code: `<Anchor href='javascript:void(0)' onClick={() => void 0} />`,
    oxcOptions: [{ components: ["Anchor", "Link"] }],
  },
  {
    code: `<Anchor href={'javascript:void(0)'} onClick={() => void 0} />`,
    oxcOptions: [{ components: ["Anchor", "Link"] }],
  },
  {
    code: `<Link href='#' onClick={() => void 0} />`,
    oxcSettings: {
      settings: {
        "jsx-a11y": {
          components: {
            Anchor: "a",
            Link: "a",
          },
        },
      },
    },
  },
  {
    code: `<Link />`,
    oxcSettings: {
      settings: {
        "jsx-a11y": {
          components: { Link: "a" },
          attributes: { href: ["href", "to"] },
        },
      },
    },
  },
  {
    code: `<Link to='#' />`,
    oxcSettings: {
      settings: {
        "jsx-a11y": {
          components: { Link: "a" },
          attributes: { href: ["href", "to"] },
        },
      },
    },
  },
  { code: `<a hrefLeft={undefined} />`, oxcOptions: [{ specialLink: ["hrefLeft", "hrefRight"] }] },
  { code: `<a hrefLeft />`, oxcOptions: [{ specialLink: ["hrefLeft", "hrefRight"] }] },
  { code: `<a hrefLeft={null} />`, oxcOptions: [{ specialLink: ["hrefLeft", "hrefRight"] }] },
  { code: `<a hrefLeft="" />;`, oxcOptions: [{ specialLink: ["hrefLeft", "hrefRight"] }] },
  { code: `<a hrefLeft='#' />`, oxcOptions: [{ specialLink: ["hrefLeft", "hrefRight"] }] },
  { code: `<a hrefLeft={'#'} />`, oxcOptions: [{ specialLink: ["hrefLeft", "hrefRight"] }] },
  {
    code: `<a hrefLeft='javascript:void(0)' />`,
    oxcOptions: [{ specialLink: ["hrefLeft", "hrefRight"] }],
  },
  {
    code: `<a hrefLeft={'javascript:void(0)'} />`,
    oxcOptions: [{ specialLink: ["hrefLeft", "hrefRight"] }],
  },
  {
    code: `<a hrefLeft='#' onClick={() => void 0} />`,
    oxcOptions: [{ specialLink: ["hrefLeft", "hrefRight"] }],
  },
  {
    code: `<a hrefLeft='javascript:void(0)' onClick={() => void 0} />`,
    oxcOptions: [{ specialLink: ["hrefLeft", "hrefRight"] }],
  },
  {
    code: `<a hrefLeft={'javascript:void(0)'} onClick={() => void 0} />`,
    oxcOptions: [{ specialLink: ["hrefLeft", "hrefRight"] }],
  },
  {
    code: `<Anchor Anchor={undefined} />`,
    oxcOptions: [{ components: ["Anchor"], specialLink: ["hrefLeft"] }],
  },
  {
    code: `<Anchor hrefLeft={null} />`,
    oxcOptions: [{ components: ["Anchor"], specialLink: ["hrefLeft"] }],
  },
  {
    code: `<Anchor hrefLeft="" />;`,
    oxcOptions: [{ components: ["Anchor"], specialLink: ["hrefLeft"] }],
  },
  {
    code: `<Anchor hrefLeft='#' />`,
    oxcOptions: [{ components: ["Anchor"], specialLink: ["hrefLeft"] }],
  },
  {
    code: `<Anchor hrefLeft={'#'} />`,
    oxcOptions: [{ components: ["Anchor"], specialLink: ["hrefLeft"] }],
  },
  {
    code: `<Anchor hrefLeft='javascript:void(0)' />`,
    oxcOptions: [{ components: ["Anchor"], specialLink: ["hrefLeft"] }],
  },
  {
    code: `<Anchor hrefLeft={'javascript:void(0)'} />`,
    oxcOptions: [{ components: ["Anchor"], specialLink: ["hrefLeft"] }],
  },
  {
    code: `<Anchor hrefLeft='#' onClick={() => void 0} />`,
    oxcOptions: [{ components: ["Anchor"], specialLink: ["hrefLeft"] }],
  },
  {
    code: `<Anchor hrefLeft='javascript:void(0)' onClick={() => void 0} />`,
    oxcOptions: [{ components: ["Anchor"], specialLink: ["hrefLeft"] }],
  },
  {
    code: `<Anchor hrefLeft={'javascript:void(0)'} onClick={() => void 0} />`,
    oxcOptions: [{ components: ["Anchor"], specialLink: ["hrefLeft"] }],
  },
  { code: `<a />`, oxcOptions: [{ aspects: ["noHref"] }] },
  { code: `<a />`, oxcOptions: [{ aspects: ["noHref", "preferButton"] }] },
  { code: `<a />`, oxcOptions: [{ aspects: ["noHref", "invalidHref"] }] },
  { code: `<a href={undefined} />`, oxcOptions: [{ aspects: ["noHref"] }] },
  { code: `<a href={undefined} />`, oxcOptions: [{ aspects: ["noHref", "preferButton"] }] },
  { code: `<a href={undefined} />`, oxcOptions: [{ aspects: ["noHref", "invalidHref"] }] },
  { code: `<a href={null} />`, oxcOptions: [{ aspects: ["noHref"] }] },
  { code: `<a href={null} />`, oxcOptions: [{ aspects: ["noHref", "preferButton"] }] },
  { code: `<a href={null} />`, oxcOptions: [{ aspects: ["noHref", "invalidHref"] }] },
  { code: `<a href="" />;`, oxcOptions: [{ aspects: ["invalidHref"] }] },
  { code: `<a href="" />;`, oxcOptions: [{ aspects: ["noHref", "invalidHref"] }] },
  { code: `<a href="" />;`, oxcOptions: [{ aspects: ["preferButton", "invalidHref"] }] },
  { code: `<a href='#' />;`, oxcOptions: [{ aspects: ["invalidHref"] }] },
  { code: `<a href='#' />;`, oxcOptions: [{ aspects: ["noHref", "invalidHref"] }] },
  { code: `<a href='#' />;`, oxcOptions: [{ aspects: ["preferButton", "invalidHref"] }] },
  { code: `<a href={'#'} />;`, oxcOptions: [{ aspects: ["invalidHref"] }] },
  { code: `<a href={'#'} />;`, oxcOptions: [{ aspects: ["noHref", "invalidHref"] }] },
  { code: `<a href={'#'} />;`, oxcOptions: [{ aspects: ["preferButton", "invalidHref"] }] },
  { code: `<a href='javascript:void(0)' />;`, oxcOptions: [{ aspects: ["invalidHref"] }] },
  {
    code: `<a href='javascript:void(0)' />;`,
    oxcOptions: [{ aspects: ["noHref", "invalidHref"] }],
  },
  {
    code: `<a href='javascript:void(0)' />;`,
    oxcOptions: [{ aspects: ["preferButton", "invalidHref"] }],
  },
  { code: `<a href={'javascript:void(0)'} />;`, oxcOptions: [{ aspects: ["invalidHref"] }] },
  {
    code: `<a href={'javascript:void(0)'} />;`,
    oxcOptions: [{ aspects: ["noHref", "invalidHref"] }],
  },
  {
    code: `<a href={'javascript:void(0)'} />;`,
    oxcOptions: [{ aspects: ["preferButton", "invalidHref"] }],
  },
  { code: `<a onClick={() => void 0} />`, oxcOptions: [{ aspects: ["preferButton"] }] },
  {
    code: `<a onClick={() => void 0} />`,
    oxcOptions: [{ aspects: ["preferButton", "invalidHref"] }],
  },
  { code: `<a onClick={() => void 0} />`, oxcOptions: [{ aspects: ["noHref", "preferButton"] }] },
  { code: `<a onClick={() => void 0} />`, oxcOptions: [{ aspects: ["noHref"] }] },
  { code: `<a onClick={() => void 0} />`, oxcOptions: [{ aspects: ["noHref", "invalidHref"] }] },
  { code: `<a href='#' onClick={() => void 0} />`, oxcOptions: [{ aspects: ["preferButton"] }] },
  {
    code: `<a href='#' onClick={() => void 0} />`,
    oxcOptions: [{ aspects: ["noHref", "preferButton"] }],
  },
  {
    code: `<a href='#' onClick={() => void 0} />`,
    oxcOptions: [{ aspects: ["preferButton", "invalidHref"] }],
  },
  { code: `<a href='#' onClick={() => void 0} />`, oxcOptions: [{ aspects: ["invalidHref"] }] },
  {
    code: `<a href='#' onClick={() => void 0} />`,
    oxcOptions: [{ aspects: ["noHref", "invalidHref"] }],
  },
  {
    code: `<a href='javascript:void(0)' onClick={() => void 0} />`,
    oxcOptions: [{ aspects: ["preferButton"] }],
  },
  {
    code: `<a href='javascript:void(0)' onClick={() => void 0} />`,
    oxcOptions: [{ aspects: ["noHref", "preferButton"] }],
  },
  {
    code: `<a href='javascript:void(0)' onClick={() => void 0} />`,
    oxcOptions: [{ aspects: ["preferButton", "invalidHref"] }],
  },
  {
    code: `<a href='javascript:void(0)' onClick={() => void 0} />`,
    oxcOptions: [{ aspects: ["invalidHref"] }],
  },
  {
    code: `<a href='javascript:void(0)' onClick={() => void 0} />`,
    oxcOptions: [{ aspects: ["noHref", "invalidHref"] }],
  },
  {
    code: `<a href={'javascript:void(0)'} onClick={() => void 0} />`,
    oxcOptions: [{ aspects: ["preferButton"] }],
  },
  {
    code: `<a href={'javascript:void(0)'} onClick={() => void 0} />`,
    oxcOptions: [{ aspects: ["noHref", "preferButton"] }],
  },
  {
    code: `<a href={'javascript:void(0)'} onClick={() => void 0} />`,
    oxcOptions: [{ aspects: ["preferButton", "invalidHref"] }],
  },
  {
    code: `<a href={'javascript:void(0)'} onClick={() => void 0} />`,
    oxcOptions: [{ aspects: ["invalidHref"] }],
  },
  {
    code: `<a href={'javascript:void(0)'} onClick={() => void 0} />`,
    oxcOptions: [{ aspects: ["noHref", "invalidHref"] }],
  },
  {
    code: `<Anchor hrefLeft={undefined} />`,
    oxcOptions: [
      {
        components: ["Anchor"],
        specialLink: ["hrefLeft"],
        aspects: ["noHref"],
      },
    ],
  },
  {
    code: `<Anchor hrefLeft={null} />`,
    oxcOptions: [
      {
        components: ["Anchor"],
        specialLink: ["hrefLeft"],
        aspects: ["noHref"],
      },
    ],
  },
];
