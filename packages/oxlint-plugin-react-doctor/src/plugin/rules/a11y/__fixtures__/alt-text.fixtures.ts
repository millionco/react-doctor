// GENERATED FROM OXC — do not edit by hand. Run `pnpm gen:fixtures` to regenerate.
// Source: oxc-project/oxc `crates/oxc_linter/src/rules/jsx_a11y/alt_text.rs`
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
  { code: `<img alt="foo" />;` },
  { code: `<img alt={"foo"} />;` },
  { code: `<img alt={alt} />;` },
  { code: `<img ALT="foo" />;` },
  { code: `<img ALT={\`This is the \${alt} text\`} />;` },
  { code: `<img ALt="foo" />;` },
  { code: `<img alt="foo" salt={undefined} />;` },
  { code: `<img {...this.props} alt="foo" />` },
  { code: `<a />` },
  { code: `<div />` },
  { code: `<img alt={function(e) {} } />` },
  { code: `<div alt={function(e) {} } />` },
  { code: `<img alt={() => void 0} />` },
  { code: `<IMG />` },
  { code: `<UX.Layout>test</UX.Layout>` },
  { code: `<img alt={alt || "Alt text" } />` },
  { code: `<img alt={photo.caption} />;` },
  { code: `<img alt={bar()} />;` },
  { code: `<img alt={foo.bar || ""} />` },
  { code: `<img alt={bar() || ""} />` },
  { code: `<img alt={foo.bar() || ""} />` },
  { code: `<img alt="" />` },
  { code: `<img alt={\`\${undefined}\`} />` },
  { code: `<img alt=" " />` },
  { code: `<img alt="" role="presentation" />` },
  { code: `<img alt="" role="none" />` },
  { code: `<img alt="" role={\`presentation\`} />` },
  { code: `<img alt="" role={"presentation"} />` },
  { code: `<img alt="this is lit..." role="presentation" />` },
  { code: `<img alt={error ? "not working": "working"} />` },
  { code: `<img alt={undefined ? "working": "not working"} />` },
  { code: `<img alt={plugin.name + " Logo"} />` },
  { code: `<img aria-label="foo" />` },
  { code: `<img aria-labelledby="id1" />` },
  { code: `<object aria-label="foo" />` },
  { code: `<object aria-labelledby="id1" />` },
  { code: `<object>Foo</object>` },
  { code: `<object><p>This is descriptive!</p></object>` },
  { code: `<Object />` },
  { code: `<object title="An object" />` },
  { code: `<area aria-label="foo" />` },
  { code: `<area aria-labelledby="id1" />` },
  { code: `<area alt="" />` },
  { code: `<area alt="This is descriptive!" />` },
  { code: `<area alt={altText} />` },
  { code: `<Area />` },
  { code: `<input />` },
  { code: `<input type="foo" />` },
  { code: `<input type="image" aria-label="foo" />` },
  { code: `<input type="image" aria-labelledby="id1" />` },
  { code: `<input type="image" alt="" />` },
  { code: `<input type="image" alt="This is descriptive!" />` },
  { code: `<input type="image" alt={altText} />` },
  { code: `<InputImage />` },
  { code: `<Input type="image" alt="" />` },
  { code: `<SomeComponent as="input" type="image" alt="" />` },
  {
    code: `<Thumbnail alt="foo" />;`,
    oxcOptions: [
      {
        img: ["Thumbnail", "Image"],
        object: ["Object"],
        area: ["Area"],
        'input[type="image"]': ["InputImage"],
      },
    ],
  },
  {
    code: `<Thumbnail alt={"foo"} />;`,
    oxcOptions: [
      {
        img: ["Thumbnail", "Image"],
        object: ["Object"],
        area: ["Area"],
        'input[type="image"]': ["InputImage"],
      },
    ],
  },
  {
    code: `<Thumbnail alt={alt} />;`,
    oxcOptions: [
      {
        img: ["Thumbnail", "Image"],
        object: ["Object"],
        area: ["Area"],
        'input[type="image"]': ["InputImage"],
      },
    ],
  },
  {
    code: `<Thumbnail ALT="foo" />;`,
    oxcOptions: [
      {
        img: ["Thumbnail", "Image"],
        object: ["Object"],
        area: ["Area"],
        'input[type="image"]': ["InputImage"],
      },
    ],
  },
  {
    code: `<Thumbnail ALT={\`This is the \${alt} text\`} />;`,
    oxcOptions: [
      {
        img: ["Thumbnail", "Image"],
        object: ["Object"],
        area: ["Area"],
        'input[type="image"]': ["InputImage"],
      },
    ],
  },
  {
    code: `<Thumbnail ALt="foo" />;`,
    oxcOptions: [
      {
        img: ["Thumbnail", "Image"],
        object: ["Object"],
        area: ["Area"],
        'input[type="image"]': ["InputImage"],
      },
    ],
  },
  {
    code: `<Thumbnail alt="foo" salt={undefined} />;`,
    oxcOptions: [
      {
        img: ["Thumbnail", "Image"],
        object: ["Object"],
        area: ["Area"],
        'input[type="image"]': ["InputImage"],
      },
    ],
  },
  {
    code: `<Thumbnail {...this.props} alt="foo" />`,
    oxcOptions: [
      {
        img: ["Thumbnail", "Image"],
        object: ["Object"],
        area: ["Area"],
        'input[type="image"]': ["InputImage"],
      },
    ],
  },
  {
    code: `<thumbnail />`,
    oxcOptions: [
      {
        img: ["Thumbnail", "Image"],
        object: ["Object"],
        area: ["Area"],
        'input[type="image"]': ["InputImage"],
      },
    ],
  },
  {
    code: `<Thumbnail alt={function(e) {} } />`,
    oxcOptions: [
      {
        img: ["Thumbnail", "Image"],
        object: ["Object"],
        area: ["Area"],
        'input[type="image"]': ["InputImage"],
      },
    ],
  },
  {
    code: `<div alt={function(e) {} } />`,
    oxcOptions: [
      {
        img: ["Thumbnail", "Image"],
        object: ["Object"],
        area: ["Area"],
        'input[type="image"]': ["InputImage"],
      },
    ],
  },
  {
    code: `<Thumbnail alt={() => void 0} />`,
    oxcOptions: [
      {
        img: ["Thumbnail", "Image"],
        object: ["Object"],
        area: ["Area"],
        'input[type="image"]': ["InputImage"],
      },
    ],
  },
  {
    code: `<THUMBNAIL />`,
    oxcOptions: [
      {
        img: ["Thumbnail", "Image"],
        object: ["Object"],
        area: ["Area"],
        'input[type="image"]': ["InputImage"],
      },
    ],
  },
  {
    code: `<Thumbnail alt={alt || "foo" } />`,
    oxcOptions: [
      {
        img: ["Thumbnail", "Image"],
        object: ["Object"],
        area: ["Area"],
        'input[type="image"]': ["InputImage"],
      },
    ],
  },
  {
    code: `<Image alt="foo" />;`,
    oxcOptions: [
      {
        img: ["Thumbnail", "Image"],
        object: ["Object"],
        area: ["Area"],
        'input[type="image"]': ["InputImage"],
      },
    ],
  },
  {
    code: `<Image alt={"foo"} />;`,
    oxcOptions: [
      {
        img: ["Thumbnail", "Image"],
        object: ["Object"],
        area: ["Area"],
        'input[type="image"]': ["InputImage"],
      },
    ],
  },
  {
    code: `<Image alt={alt} />;`,
    oxcOptions: [
      {
        img: ["Thumbnail", "Image"],
        object: ["Object"],
        area: ["Area"],
        'input[type="image"]': ["InputImage"],
      },
    ],
  },
  {
    code: `<Image ALT="foo" />;`,
    oxcOptions: [
      {
        img: ["Thumbnail", "Image"],
        object: ["Object"],
        area: ["Area"],
        'input[type="image"]': ["InputImage"],
      },
    ],
  },
  {
    code: `<Image ALT={\`This is the \${alt} text\`} />;`,
    oxcOptions: [
      {
        img: ["Thumbnail", "Image"],
        object: ["Object"],
        area: ["Area"],
        'input[type="image"]': ["InputImage"],
      },
    ],
  },
  {
    code: `<Image ALt="foo" />;`,
    oxcOptions: [
      {
        img: ["Thumbnail", "Image"],
        object: ["Object"],
        area: ["Area"],
        'input[type="image"]': ["InputImage"],
      },
    ],
  },
  {
    code: `<Image alt="foo" salt={undefined} />;`,
    oxcOptions: [
      {
        img: ["Thumbnail", "Image"],
        object: ["Object"],
        area: ["Area"],
        'input[type="image"]': ["InputImage"],
      },
    ],
  },
  {
    code: `<Image {...this.props} alt="foo" />`,
    oxcOptions: [
      {
        img: ["Thumbnail", "Image"],
        object: ["Object"],
        area: ["Area"],
        'input[type="image"]': ["InputImage"],
      },
    ],
  },
  {
    code: `<image />`,
    oxcOptions: [
      {
        img: ["Thumbnail", "Image"],
        object: ["Object"],
        area: ["Area"],
        'input[type="image"]': ["InputImage"],
      },
    ],
  },
  {
    code: `<Image alt={function(e) {} } />`,
    oxcOptions: [
      {
        img: ["Thumbnail", "Image"],
        object: ["Object"],
        area: ["Area"],
        'input[type="image"]': ["InputImage"],
      },
    ],
  },
  {
    code: `<div alt={function(e) {} } />`,
    oxcOptions: [
      {
        img: ["Thumbnail", "Image"],
        object: ["Object"],
        area: ["Area"],
        'input[type="image"]': ["InputImage"],
      },
    ],
  },
  {
    code: `<Image alt={() => void 0} />`,
    oxcOptions: [
      {
        img: ["Thumbnail", "Image"],
        object: ["Object"],
        area: ["Area"],
        'input[type="image"]': ["InputImage"],
      },
    ],
  },
  {
    code: `<IMAGE />`,
    oxcOptions: [
      {
        img: ["Thumbnail", "Image"],
        object: ["Object"],
        area: ["Area"],
        'input[type="image"]': ["InputImage"],
      },
    ],
  },
  {
    code: `<Image alt={alt || "foo" } />`,
    oxcOptions: [
      {
        img: ["Thumbnail", "Image"],
        object: ["Object"],
        area: ["Area"],
        'input[type="image"]': ["InputImage"],
      },
    ],
  },
  {
    code: `<Object aria-label="foo" />`,
    oxcOptions: [
      {
        img: ["Thumbnail", "Image"],
        object: ["Object"],
        area: ["Area"],
        'input[type="image"]': ["InputImage"],
      },
    ],
  },
  {
    code: `<Object aria-labelledby="id1" />`,
    oxcOptions: [
      {
        img: ["Thumbnail", "Image"],
        object: ["Object"],
        area: ["Area"],
        'input[type="image"]': ["InputImage"],
      },
    ],
  },
  {
    code: `<Object>Foo</Object>`,
    oxcOptions: [
      {
        img: ["Thumbnail", "Image"],
        object: ["Object"],
        area: ["Area"],
        'input[type="image"]': ["InputImage"],
      },
    ],
  },
  {
    code: `<Object><p>This is descriptive!</p></Object>`,
    oxcOptions: [
      {
        img: ["Thumbnail", "Image"],
        object: ["Object"],
        area: ["Area"],
        'input[type="image"]': ["InputImage"],
      },
    ],
  },
  {
    code: `<Object title="An object" />`,
    oxcOptions: [
      {
        img: ["Thumbnail", "Image"],
        object: ["Object"],
        area: ["Area"],
        'input[type="image"]': ["InputImage"],
      },
    ],
  },
  {
    code: `<Area aria-label="foo" />`,
    oxcOptions: [
      {
        img: ["Thumbnail", "Image"],
        object: ["Object"],
        area: ["Area"],
        'input[type="image"]': ["InputImage"],
      },
    ],
  },
  {
    code: `<Area aria-labelledby="id1" />`,
    oxcOptions: [
      {
        img: ["Thumbnail", "Image"],
        object: ["Object"],
        area: ["Area"],
        'input[type="image"]': ["InputImage"],
      },
    ],
  },
  {
    code: `<Area alt="" />`,
    oxcOptions: [
      {
        img: ["Thumbnail", "Image"],
        object: ["Object"],
        area: ["Area"],
        'input[type="image"]': ["InputImage"],
      },
    ],
  },
  {
    code: `<Area alt="This is descriptive!" />`,
    oxcOptions: [
      {
        img: ["Thumbnail", "Image"],
        object: ["Object"],
        area: ["Area"],
        'input[type="image"]': ["InputImage"],
      },
    ],
  },
  {
    code: `<Area alt={altText} />`,
    oxcOptions: [
      {
        img: ["Thumbnail", "Image"],
        object: ["Object"],
        area: ["Area"],
        'input[type="image"]': ["InputImage"],
      },
    ],
  },
  {
    code: `<InputImage aria-label="foo" />`,
    oxcOptions: [
      {
        img: ["Thumbnail", "Image"],
        object: ["Object"],
        area: ["Area"],
        'input[type="image"]': ["InputImage"],
      },
    ],
  },
  {
    code: `<InputImage aria-labelledby="id1" />`,
    oxcOptions: [
      {
        img: ["Thumbnail", "Image"],
        object: ["Object"],
        area: ["Area"],
        'input[type="image"]': ["InputImage"],
      },
    ],
  },
  {
    code: `<InputImage alt="" />`,
    oxcOptions: [
      {
        img: ["Thumbnail", "Image"],
        object: ["Object"],
        area: ["Area"],
        'input[type="image"]': ["InputImage"],
      },
    ],
  },
  {
    code: `<InputImage alt="This is descriptive!" />`,
    oxcOptions: [
      {
        img: ["Thumbnail", "Image"],
        object: ["Object"],
        area: ["Area"],
        'input[type="image"]': ["InputImage"],
      },
    ],
  },
  {
    code: `<InputImage alt={altText} />`,
    oxcOptions: [
      {
        img: ["Thumbnail", "Image"],
        object: ["Object"],
        area: ["Area"],
        'input[type="image"]': ["InputImage"],
      },
    ],
  },
];

export const failCases: ReadonlyArray<OxcFixture> = [
  { code: `<img />;` },
  { code: `<img alt />;` },
  { code: `<img alt={undefined} />;` },
  { code: `<img src="xyz" />` },
  { code: `<img role />` },
  { code: `<img {...this.props} />` },
  { code: `<img alt role="presentation" />;` },
  { code: `<img role="presentation" />;` },
  { code: `<img role="none" />;` },
  { code: `<img aria-label={undefined} />` },
  { code: `<img aria-labelledby={undefined} />` },
  { code: `<img aria-label="" />` },
  { code: `<img aria-labelledby="" />` },
  {
    code: `<SomeComponent as="img" aria-label="" />`,
    oxcSettings: { settings: { "jsx-a11y": { polymorphicPropName: "as" } } },
  },
  { code: `<object />` },
  { code: `<object><div aria-hidden /></object>` },
  { code: `<object title={undefined} />` },
  { code: `<object aria-label="" />` },
  { code: `<object aria-labelledby="" />` },
  { code: `<object aria-label={undefined} />` },
  { code: `<object aria-labelledby={undefined} />` },
  { code: `<area />` },
  { code: `<area alt />` },
  { code: `<area alt={undefined} />` },
  { code: `<area src="xyz" />` },
  { code: `<area {...this.props} />` },
  { code: `<area aria-label="" />` },
  { code: `<area aria-label={undefined} />` },
  { code: `<area aria-labelledby="" />` },
  { code: `<area aria-labelledby={undefined} />` },
  { code: `<input type="image" />` },
  { code: `<input type="image" alt />` },
  { code: `<input type="image" alt={undefined} />` },
  { code: `<input type="image">Foo</input>` },
  { code: `<input type="image" {...this.props} />` },
  { code: `<input type="image" aria-label="" />` },
  { code: `<input type="image" aria-label={undefined} />` },
  { code: `<input type="image" aria-labelledby="" />` },
  { code: `<input type="image" aria-labelledby={undefined} />` },
  {
    code: `<Thumbnail />;`,
    oxcOptions: [
      {
        img: ["Thumbnail", "Image"],
        object: ["Object"],
        area: ["Area"],
        'input[type="image"]': ["InputImage"],
      },
    ],
  },
  {
    code: `<Thumbnail alt />;`,
    oxcOptions: [
      {
        img: ["Thumbnail", "Image"],
        object: ["Object"],
        area: ["Area"],
        'input[type="image"]': ["InputImage"],
      },
    ],
  },
  {
    code: `<Thumbnail alt={undefined} />;`,
    oxcOptions: [
      {
        img: ["Thumbnail", "Image"],
        object: ["Object"],
        area: ["Area"],
        'input[type="image"]': ["InputImage"],
      },
    ],
  },
  {
    code: `<Thumbnail src="xyz" />`,
    oxcOptions: [
      {
        img: ["Thumbnail", "Image"],
        object: ["Object"],
        area: ["Area"],
        'input[type="image"]': ["InputImage"],
      },
    ],
  },
  {
    code: `<Thumbnail {...this.props} />`,
    oxcOptions: [
      {
        img: ["Thumbnail", "Image"],
        object: ["Object"],
        area: ["Area"],
        'input[type="image"]': ["InputImage"],
      },
    ],
  },
  {
    code: `<Image />;`,
    oxcOptions: [
      {
        img: ["Thumbnail", "Image"],
        object: ["Object"],
        area: ["Area"],
        'input[type="image"]': ["InputImage"],
      },
    ],
  },
  {
    code: `<Image alt />;`,
    oxcOptions: [
      {
        img: ["Thumbnail", "Image"],
        object: ["Object"],
        area: ["Area"],
        'input[type="image"]': ["InputImage"],
      },
    ],
  },
  {
    code: `<Image alt={undefined} />;`,
    oxcOptions: [
      {
        img: ["Thumbnail", "Image"],
        object: ["Object"],
        area: ["Area"],
        'input[type="image"]': ["InputImage"],
      },
    ],
  },
  {
    code: `<Image src="xyz" />`,
    oxcOptions: [
      {
        img: ["Thumbnail", "Image"],
        object: ["Object"],
        area: ["Area"],
        'input[type="image"]': ["InputImage"],
      },
    ],
  },
  {
    code: `<Image {...this.props} />`,
    oxcOptions: [
      {
        img: ["Thumbnail", "Image"],
        object: ["Object"],
        area: ["Area"],
        'input[type="image"]': ["InputImage"],
      },
    ],
  },
  {
    code: `<Object />`,
    oxcOptions: [
      {
        img: ["Thumbnail", "Image"],
        object: ["Object"],
        area: ["Area"],
        'input[type="image"]': ["InputImage"],
      },
    ],
  },
  {
    code: `<Object><div aria-hidden /></Object>`,
    oxcOptions: [
      {
        img: ["Thumbnail", "Image"],
        object: ["Object"],
        area: ["Area"],
        'input[type="image"]': ["InputImage"],
      },
    ],
  },
  {
    code: `<Object title={undefined} />`,
    oxcOptions: [
      {
        img: ["Thumbnail", "Image"],
        object: ["Object"],
        area: ["Area"],
        'input[type="image"]': ["InputImage"],
      },
    ],
  },
  {
    code: `<Area />`,
    oxcOptions: [
      {
        img: ["Thumbnail", "Image"],
        object: ["Object"],
        area: ["Area"],
        'input[type="image"]': ["InputImage"],
      },
    ],
  },
  {
    code: `<Area alt />`,
    oxcOptions: [
      {
        img: ["Thumbnail", "Image"],
        object: ["Object"],
        area: ["Area"],
        'input[type="image"]': ["InputImage"],
      },
    ],
  },
  {
    code: `<Area alt={undefined} />`,
    oxcOptions: [
      {
        img: ["Thumbnail", "Image"],
        object: ["Object"],
        area: ["Area"],
        'input[type="image"]': ["InputImage"],
      },
    ],
  },
  {
    code: `<Area src="xyz" />`,
    oxcOptions: [
      {
        img: ["Thumbnail", "Image"],
        object: ["Object"],
        area: ["Area"],
        'input[type="image"]': ["InputImage"],
      },
    ],
  },
  {
    code: `<Area {...this.props} />`,
    oxcOptions: [
      {
        img: ["Thumbnail", "Image"],
        object: ["Object"],
        area: ["Area"],
        'input[type="image"]': ["InputImage"],
      },
    ],
  },
  {
    code: `<InputImage />`,
    oxcOptions: [
      {
        img: ["Thumbnail", "Image"],
        object: ["Object"],
        area: ["Area"],
        'input[type="image"]': ["InputImage"],
      },
    ],
  },
  {
    code: `<InputImage alt />`,
    oxcOptions: [
      {
        img: ["Thumbnail", "Image"],
        object: ["Object"],
        area: ["Area"],
        'input[type="image"]': ["InputImage"],
      },
    ],
  },
  {
    code: `<InputImage alt={undefined} />`,
    oxcOptions: [
      {
        img: ["Thumbnail", "Image"],
        object: ["Object"],
        area: ["Area"],
        'input[type="image"]': ["InputImage"],
      },
    ],
  },
  {
    code: `<InputImage>Foo</InputImage>`,
    oxcOptions: [
      {
        img: ["Thumbnail", "Image"],
        object: ["Object"],
        area: ["Area"],
        'input[type="image"]': ["InputImage"],
      },
    ],
  },
  {
    code: `<InputImage {...this.props} />`,
    oxcOptions: [
      {
        img: ["Thumbnail", "Image"],
        object: ["Object"],
        area: ["Area"],
        'input[type="image"]': ["InputImage"],
      },
    ],
  },
  { code: `<Input type="image" />` },
];
