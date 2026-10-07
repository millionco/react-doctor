// GENERATED FROM OXC — do not edit by hand. Run `pnpm gen:fixtures` to regenerate.
// Source: oxc-project/oxc `crates/oxc_linter/src/rules/jsx_a11y/heading_has_content.rs`
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
  { code: `<h2>Foo</h2>` },
  { code: `<h3>Foo</h3>` },
  { code: `<h4>Foo</h4>` },
  { code: `<h5>Foo</h5>` },
  { code: `<h6>Foo</h6>` },
  { code: `<h6>123</h6>` },
  { code: `<h1><Bar /></h1>` },
  { code: `<h1>{foo}</h1>` },
  { code: `<h1>{foo.bar}</h1>` },
  { code: `<h1 dangerouslySetInnerHTML={{ __html: "foo" }} />` },
  { code: `<h1 children={children} />` },
  {
    code: `<Title>Foo</Title>`,
    oxcOptions: [
      {
        components: ["Heading", "Title"],
      },
    ],
  },
  {
    code: `<Heading><Bar /></Heading>`,
    oxcOptions: [
      {
        components: ["Heading", "Title"],
      },
    ],
  },
  {
    code: `<Heading>{foo}</Heading>`,
    oxcOptions: [
      {
        components: ["Heading", "Title"],
      },
    ],
  },
  {
    code: `<Heading>{foo.bar}</Heading>`,
    oxcOptions: [
      {
        components: ["Heading", "Title"],
      },
    ],
  },
  {
    code: `<Heading dangerouslySetInnerHTML={{ __html: "foo" }} />`,
    oxcOptions: [
      {
        components: ["Heading", "Title"],
      },
    ],
  },
  {
    code: `<Heading children={children} />`,
    oxcOptions: [
      {
        components: ["Heading", "Title"],
      },
    ],
  },
  {
    code: `<h1 aria-hidden />`,
    oxcOptions: [
      {
        components: ["Heading", "Title"],
      },
    ],
  },
  { code: `<h1><CustomInput type="hidden" /></h1>` },
];

export const failCases: ReadonlyArray<OxcFixture> = [
  { code: `<h1><Bar aria-hidden /></h1>` },
  { code: `<h1>{undefined}</h1>` },
  { code: `<h1><></></h1>` },
  { code: `<h1><input type="hidden" /></h1>` },
  {
    code: `<Heading><Bar aria-hidden /></Heading>`,
    oxcOptions: [
      {
        components: ["Heading", "Title"],
      },
    ],
  },
  {
    code: `<Heading>{undefined}</Heading>`,
    oxcOptions: [
      {
        components: ["Heading", "Title"],
      },
    ],
  },
  {
    code: `<h1><CustomInput type="hidden" /></h1>`,
    oxcSettings: {
      settings: {
        "jsx-a11y": {
          components: {
            CustomInput: "input",
            Title: "h1",
            Heading: "h2",
          },
        },
      },
    },
  },
];
