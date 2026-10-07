// GENERATED FROM OXC — do not edit by hand. Run `pnpm gen:fixtures` to regenerate.
// Source: oxc-project/oxc `crates/oxc_linter/src/rules/jsx_a11y/img_redundant_alt.rs`
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
  { code: `<img alt='foo' />;` },
  { code: `<img alt='picture of me taking a photo of an image' aria-hidden />` },
  { code: `<img aria-hidden alt='photo of image' />` },
  { code: `<img ALt='foo' />;` },
  { code: `<img {...this.props} alt='foo' />` },
  { code: `<img {...this.props} alt={'foo'} />` },
  { code: `<img {...this.props} alt={alt} />` },
  { code: `<a />` },
  { code: `<img />` },
  { code: `<IMG />` },
  { code: `<img alt={undefined} />` },
  { code: `<img alt={\`this should pass for \${now}\`} />` },
  { code: `<img alt={\`this should pass for \${photo}\`} />` },
  { code: `<img alt={\`this should pass for \${image}\`} />` },
  { code: `<img alt={\`this should pass for \${picture}\`} />` },
  { code: `<img alt={\`\${photo}\`} />` },
  { code: `<img alt={\`\${image}\`} />` },
  { code: `<img alt={\`\${picture}\`} />` },
  { code: `<img alt={'undefined'} />` },
  { code: `<img alt={() => {}} />` },
  { code: `<img alt={function(e){}} />` },
  { code: `<img aria-hidden={false} alt='Doing cool things.' />` },
  { code: `<img alt='photo of cool person' aria-hidden={true} />` },
  { code: `<UX.Layout>test</UX.Layout>` },
  { code: `<img alt />` },
  { code: `<img alt={imageAlt} />` },
  { code: `<img alt={imageAlt.name} />` },
  { code: `<img alt={imageAlt?.name} />` },
  { code: `<img alt='Doing cool things' aria-hidden={foo?.bar}/>` },
  { code: `<img alt='Photography' />;` },
  { code: `<img alt='ImageMagick' />;` },
  { code: `<img alt='helloImage' />;` },
  { code: `<Image alt='Photo of a friend' />` },
  {
    code: `<Image alt='Foo' />`,
    oxcSettings: {
      settings: {
        "jsx-a11y": {
          components: {
            Image: "img",
          },
        },
      },
    },
  },
];

export const failCases: ReadonlyArray<OxcFixture> = [
  { code: `<img alt='Photo of friend.' />;` },
  { code: `<img alt='Picture of friend.' />;` },
  { code: `<img alt='Image of friend.' />;` },
  { code: `<img alt='thing not to say' />;`, oxcOptions: [{ words: ["not to say"] }] },
  {
    code: `<PicVersionThree alt='this is a photo' />;`,
    oxcOptions: [{ components: ["PicVersionThree"] }],
  },
  {
    code: `<PicVersionThree alt='this is a photo.' />;`,
    oxcOptions: [{ components: ["PicVersionThree"] }],
  },
  { code: `<img alt='PhOtO of friend.' />;` },
  { code: `<img alt={'photo'} />;` },
  { code: `<img alt='piCTUre of friend.' />;` },
  { code: `<img alt='imAGE of friend.' />;` },
  { code: `<img alt='photo of cool person' aria-hidden={false} />` },
  { code: `<img alt='picture of cool person' aria-hidden={false} />` },
  { code: `<img alt='image of cool person' aria-hidden={false} />` },
  { code: `<img alt='photo' {...this.props} />` },
  { code: `<img alt='image' {...this.props} />` },
  { code: `<img alt='picture' {...this.props} />` },
  { code: `<img alt={\`picture doing \${things}\`} {...this.props} />` },
  { code: `<img alt={\`photo doing \${things}\`} {...this.props} />` },
  { code: `<img alt={\`image doing \${things}\`} {...this.props} />` },
  { code: `<img alt={\`picture doing \${picture}\`} {...this.props} />` },
  { code: `<img alt={\`photo doing \${photo}\`} {...this.props} />` },
  { code: `<img alt={\`image doing \${image}\`} {...this.props} />` },
  {
    code: `<Image alt='Photo of a friend' />`,
    oxcOptions: [
      {
        components: ["Image"],
        words: ["Word1", "Word2"],
      },
    ],
  },
  {
    code: `<Image alt='Photo of a friend' />`,
    oxcSettings: {
      settings: {
        "jsx-a11y": {
          components: {
            Image: "img",
          },
        },
      },
    },
  },
  {
    code: `<img alt='Word2' />;`,
    oxcOptions: [
      {
        components: ["Image"],
        words: ["Word1", "Word2"],
      },
    ],
  },
  {
    code: `<Image alt='Word1' />;`,
    oxcOptions: [
      {
        components: ["Image"],
        words: ["Word1", "Word2"],
      },
    ],
  },
  {
    code: `<Image alt='Word2' />;`,
    oxcOptions: [
      {
        components: ["Image"],
        words: ["Word1", "Word2"],
      },
    ],
  },
];
