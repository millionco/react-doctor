// GENERATED FROM OXC — do not edit by hand. Run `pnpm gen:fixtures` to regenerate.
// Source: oxc-project/oxc `crates/oxc_linter/src/rules/jsx_no_target_blank.rs`
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
  { code: `<a href="foobar"></a>` },
  { code: `<a randomTag></a>` },
  { code: `<a target />` },
  { code: `<a href="foobar" target="_blank" rel="noopener noreferrer"></a>` },
  { code: `<a href="foobar" target="_blank" rel="noreferrer"></a>` },
  { code: `<a href="foobar" target="_blank" rel={"noopener noreferrer"}></a>` },
  { code: `<a href="foobar" target="_blank" rel={"noreferrer"}></a>` },
  { code: `<a href={"foobar"} target={"_blank"} rel={"noopener noreferrer"}></a>` },
  { code: `<a href={"foobar"} target={"_blank"} rel={"noreferrer"}></a>` },
  { code: `<a href={'foobar'} target={'_blank'} rel={'noopener noreferrer'}></a>` },
  { code: `<a href={'foobar'} target={'_blank'} rel={'noreferrer'}></a>` },
  { code: `<a href={\`foobar\`} target={\`_blank\`} rel={\`noopener noreferrer\`}></a>` },
  { code: `<a href={\`foobar\`} target={\`_blank\`} rel={\`noreferrer\`}></a>` },
  { code: `<a target="_blank" {...spreadProps} rel="noopener noreferrer"></a>` },
  { code: `<a target="_blank" {...spreadProps} rel="noreferrer"></a>` },
  {
    code: `<a {...spreadProps} target="_blank" rel="noopener noreferrer" href="https://example.com">s</a>`,
  },
  { code: `<a {...spreadProps} target="_blank" rel="noreferrer" href="https://example.com">s</a>` },
  { code: `<a target="_blank" rel="noopener noreferrer" {...spreadProps}></a>` },
  { code: `<a target="_blank" rel="noreferrer" {...spreadProps}></a>` },
  { code: `<p target="_blank"></p>` },
  { code: `<a href="foobar" target="_BLANK" rel="NOOPENER noreferrer"></a>` },
  { code: `<a href="foobar" target="_BLANK" rel="NOREFERRER"></a>` },
  { code: `<a target="_blank" rel={relValue}></a>` },
  { code: `<a target={targetValue} rel="noopener noreferrer"></a>` },
  { code: `<a target={targetValue} rel="noreferrer"></a>` },
  { code: `<a target={targetValue} rel={"noopener noreferrer"}></a>` },
  { code: `<a target={targetValue} rel={"noreferrer"}></a>` },
  { code: `<a target={targetValue} href="relative/path"></a>` },
  { code: `<a target={targetValue} href="/absolute/path"></a>` },
  { code: `<a target={'targetValue'} href="/absolute/path"></a>` },
  { code: `<a target={"targetValue"} href="/absolute/path"></a>` },
  { code: `<a target={null} href="//example.com"></a>` },
  {
    code: `<a {...someObject} href="/absolute/path"></a>`,
    oxcOptions: [{ enforceDynamicLinks: "always", warnOnSpreadAttributes: true }],
  },
  {
    code: `<a {...someObject} rel="noreferrer"></a>`,
    oxcOptions: [{ enforceDynamicLinks: "always", warnOnSpreadAttributes: true }],
  },
  {
    code: `<a {...someObject} rel="noreferrer" target="_blank"></a>`,
    oxcOptions: [{ enforceDynamicLinks: "always", warnOnSpreadAttributes: true }],
  },
  {
    code: `<a {...someObject} href="foobar" target="_blank"></a>`,
    oxcOptions: [{ enforceDynamicLinks: "always", warnOnSpreadAttributes: true }],
  },
  {
    code: `<a target="_blank" href={ dynamicLink }></a>`,
    oxcOptions: [{ enforceDynamicLinks: "never" }],
  },
  {
    code: `<a target={"_blank"} href={ dynamicLink }></a>`,
    oxcOptions: [{ enforceDynamicLinks: "never" }],
  },
  {
    code: `<a target={'_blank'} href={ dynamicLink }></a>`,
    oxcOptions: [{ enforceDynamicLinks: "never" }],
  },
  {
    code: `<Link target="_blank" href={ dynamicLink }></Link>`,
    oxcOptions: [{ enforceDynamicLinks: "never" }],
    oxcSettings: { settings: { react: { linkComponents: ["Link"] } } },
  },
  {
    code: `<Link target="_blank" to={ dynamicLink }></Link>`,
    oxcOptions: [{ enforceDynamicLinks: "never" }],
    oxcSettings: {
      settings: { react: { linkComponents: [{ name: "Link", linkAttribute: "to" }] } },
    },
  },
  {
    code: `<Link target="_blank" to={ dynamicLink }></Link>`,
    oxcOptions: [{ enforceDynamicLinks: "never" }],
    oxcSettings: {
      settings: { react: { linkComponents: [{ name: "Link", linkAttribute: ["to"] }] } },
    },
  },
  {
    code: `<a href="foobar" target="_blank" rel="noopener"></a>`,
    oxcOptions: [{ allowReferrer: true }],
  },
  {
    code: `<a href="foobar" target="_blank" rel="noreferrer"></a>`,
    oxcOptions: [{ allowReferrer: true }],
  },
  { code: `<a target={3} />` },
  { code: `<a href="some-link" {...otherProps} target="some-non-blank-target"></a>` },
  { code: `<a href="some-link" target="some-non-blank-target" {...otherProps}></a>` },
  { code: `<a target="_blank" href="/absolute/path"></a>`, oxcOptions: [{ forms: false }] },
  {
    code: `<a target="_blank" href="/absolute/path"></a>`,
    oxcOptions: [{ forms: false, links: true }],
  },
  { code: `<form action="https://example.com" target="_blank"></form>`, oxcOptions: [] },
  {
    code: `<form action="https://example.com" target="_blank" rel="noopener noreferrer"></form>`,
    oxcOptions: [{ forms: true }],
  },
  {
    code: `<form action="https://example.com" target="_blank" rel="noopener noreferrer"></form>`,
    oxcOptions: [{ forms: true, links: false }],
  },
  { code: `<a href target="_blank"/>` },
  {
    code: `<a href={href} target={isExternal ? "_blank" : undefined} rel="noopener noreferrer" />`,
  },
  {
    code: `<a href={href} target={isExternal ? undefined : "_blank"} rel={isExternal ? "noreferrer" : "noopener noreferrer"} />`,
  },
  {
    code: `<a href={href} target={isExternal ? undefined : "_blank"} rel={isExternal ? "noreferrer noopener" : "noreferrer"} />`,
  },
  {
    code: `<a href={href} target="_blank" rel={isExternal ? "noreferrer" : "noopener"} />`,
    oxcOptions: [{ allowReferrer: true }],
  },
  {
    code: `<a href={href} target={isExternal ? "_blank" : undefined} rel={isExternal ? "noreferrer" : undefined} />`,
  },
  {
    code: `<a href={href} target={isSelf ? "_self" : "_blank"} rel={isSelf ? undefined : "noreferrer"} />`,
  },
  { code: `<a href={href} target={isSelf ? "_self" : ""} rel={isSelf ? undefined : ""} />` },
  {
    code: `<a href={href} target={isExternal ? "_blank" : undefined} rel={isExternal ? "noopener noreferrer" : undefined} />`,
  },
  { code: `<form action={action} />`, oxcOptions: [{ forms: true }] },
  { code: `<form action={action} {...spread} />`, oxcOptions: [{ forms: true }] },
];

export const failCases: ReadonlyArray<OxcFixture> = [
  { code: `<a target="_blank" href="https://example.com/1"></a>` },
  { code: `<a target="_blank" rel="" href="https://example.com/2"></a>` },
  { code: `<a target="_blank" rel={0} href="https://example.com/3"></a>` },
  { code: `<a target="_blank" rel={1} href="https://example.com/3"></a>` },
  { code: `<a target="_blank" rel={false} href="https://example.com/4"></a>` },
  { code: `<a target="_blank" rel={null} href="https://example.com/5"></a>` },
  { code: `<a target="_blank" rel="noopenernoreferrer" href="https://example.com/6"></a>` },
  { code: `<a target="_blank" rel="no referrer" href="https://example.com/7"></a>` },
  { code: `<a target="_BLANK" href="https://example.com/8"></a>` },
  { code: `<a target="_blank" href="//example.com/9"></a>` },
  { code: `<a target="_blank" href="//example.com/10" rel={true}></a>` },
  { code: `<a target="_blank" href="//example.com/11" rel={3}></a>` },
  { code: `<a target="_blank" href="//example.com/12" rel={null}></a>` },
  { code: `<a target="_blank" href="//example.com/13" rel={getRel()}></a>` },
  { code: `<a target="_blank" href="//example.com/14" rel={"noopenernoreferrer"}></a>` },
  { code: `<a target={"_blank"} href={"//example.com/15"} rel={"noopenernoreferrer"}></a>` },
  {
    code: `<a target={"_blank"} href={"//example.com/16"} rel={"noopenernoreferrernoreferrernoreferrernoreferrernoreferrer"}></a>`,
  },
  { code: `<a target="_blank" href="//example.com/17" rel></a>` },
  { code: `<a target="_blank" href={ dynamicLink }></a>` },
  { code: `<a target={'_blank'} href="//example.com/18"></a>` },
  { code: `<a target={"_blank"} href="//example.com/19"></a>` },
  {
    code: `<a href="https://example.com/20" target="_blank" rel></a>`,
    oxcOptions: [{ allowReferrer: true }],
  },
  {
    code: `<a href="https://example.com/20" target="_blank"></a>`,
    oxcOptions: [{ allowReferrer: true }],
  },
  {
    code: `<a target="_blank" href={ dynamicLink }></a>`,
    oxcOptions: [{ enforceDynamicLinks: "always" }],
  },
  {
    code: `<a {...someObject}></a>`,
    oxcOptions: [{ enforceDynamicLinks: "always", warnOnSpreadAttributes: true }],
  },
  {
    code: `<a {...someObject} target="_blank"></a>`,
    oxcOptions: [{ enforceDynamicLinks: "always", warnOnSpreadAttributes: true }],
  },
  {
    code: `<a href="foobar" {...someObject} target="_blank"></a>`,
    oxcOptions: [{ enforceDynamicLinks: "always", warnOnSpreadAttributes: true }],
  },
  {
    code: `<a href="foobar" target="_blank" rel="noreferrer" {...someObject}></a>`,
    oxcOptions: [{ enforceDynamicLinks: "always", warnOnSpreadAttributes: true }],
  },
  {
    code: `<a href="foobar" target="_blank" {...someObject}></a>`,
    oxcOptions: [{ enforceDynamicLinks: "always", warnOnSpreadAttributes: true }],
  },
  {
    code: `<Link target="_blank" href={ dynamicLink }></Link>`,
    oxcOptions: [{ enforceDynamicLinks: "always" }],
    oxcSettings: { settings: { react: { linkComponents: ["Link"] } } },
  },
  {
    code: `<Link target="_blank" to={ dynamicLink }></Link>`,
    oxcOptions: [{ enforceDynamicLinks: "always" }],
    oxcSettings: {
      settings: { react: { linkComponents: [{ name: "Link", linkAttribute: "to" }] } },
    },
  },
  {
    code: `<a href="some-link" {...otherProps} target="some-non-blank-target"></a>`,
    oxcOptions: [{ warnOnSpreadAttributes: true }],
  },
  {
    code: `<a href="some-link" target="some-non-blank-target" {...otherProps}></a>`,
    oxcOptions: [{ warnOnSpreadAttributes: true }],
  },
  { code: `<a target="_blank" href="//example.com" rel></a>`, oxcOptions: [{ links: true }] },
  {
    code: `<a target="_blank" href="//example.com" rel></a>`,
    oxcOptions: [{ links: true, forms: true }],
  },
  {
    code: `<a target="_blank" href="//example.com" rel></a>`,
    oxcOptions: [{ links: true, forms: false }],
  },
  {
    code: `<form method="POST" action="https://example.com" target="_blank"></form>`,
    oxcOptions: [{ forms: true }],
  },
  {
    code: `<form method="POST" action="https://example.com" rel="" target="_blank"></form>`,
    oxcOptions: [{ forms: true }],
  },
  {
    code: `<form method="POST" action="https://example.com" rel="noopenernoreferrer" target="_blank"></form>`,
    oxcOptions: [{ forms: true }],
  },
  {
    code: `<form method="POST" action="https://example.com" rel="noopenernoreferrer" target="_blank"></form>`,
    oxcOptions: [{ forms: true, links: false }],
  },
  { code: `<a href={href} target="_blank" rel={isExternal ? "undefined" : "undefined"} />` },
  { code: `<a href={href} target="_blank" rel={isExternal ? "noopener" : undefined} />` },
  { code: `<a href={href} target="_blank" rel={isExternal ? "undefined" : "noopener"} />` },
  {
    code: `<a href={href} target={isExternal ? "_blank" : undefined} rel={isExternal ? undefined : "noopener noreferrer"} />`,
  },
  { code: `<a href={href} target="_blank" rel={isExternal ? 3 : "noopener noreferrer"} />` },
  { code: `<a href={href} target="_blank" rel={isExternal ? "noopener noreferrer" : "3"} />` },
  {
    code: `<a href={href} target="_blank" rel={isExternal ? "noopener" : "2"} />`,
    oxcOptions: [{ allowReferrer: true }],
  },
  {
    code: `<form action={action} target="_blank" />`,
    oxcOptions: [{ allowReferrer: true, forms: true }],
  },
  { code: `<form action={action} target="_blank" />`, oxcOptions: [{ forms: true }] },
  {
    code: `<form action={action} {...spread} />`,
    oxcOptions: [{ forms: true, warnOnSpreadAttributes: true }],
  },
];
