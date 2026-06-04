// GENERATED FROM OXC — do not edit by hand. Run `pnpm gen:fixtures` to regenerate.
// Source: oxc-project/oxc `crates/oxc_linter/src/rules/jsx_no_script_url.rs`
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
  { code: `<a href="https://reactjs.org"></a>` },
  { code: `<a href="mailto:foo@bar.com"></a>` },
  { code: `<a href="#"></a>` },
  { code: `<a href=""></a>` },
  { code: `<a name="foo"></a>` },
  { code: `<a href={"javascript:"}></a>` },
  { code: `<Foo href="javascript:"></Foo>` },
  { code: `<a href />` },
  {
    code: `<Foo other="javascript:"></Foo>`,
    oxcOptions: [[{ name: "Foo", props: ["to", "href"] }]],
  },
  {
    code: `<Foo href="javascript:"></Foo>`,
    oxcSettings: {
      settings: { react: { linkComponents: [{ name: "Foo", linkAttribute: ["to", "href"] }] } },
    },
  },
  {
    code: `<Foo other="javascript:"></Foo>`,
    oxcOptions: [[], { includeFromSettings: true }],
    oxcSettings: {
      settings: { react: { linkComponents: [{ name: "Foo", linkAttribute: ["to", "href"] }] } },
    },
  },
  {
    code: `<Foo href="javascript:"></Foo>`,
    oxcOptions: [[], { includeFromSettings: false }],
    oxcSettings: {
      settings: { react: { linkComponents: [{ name: "Foo", linkAttribute: ["to", "href"] }] } },
    },
  },
];

export const failCases: ReadonlyArray<OxcFixture> = [
  { code: `<a href="javascript:"></a>` },
  { code: `<a href="javascript:void(0)"></a>` },
  {
    code: `<a href="j

			a
v	ascript:"></a>`,
  },
  { code: `<Foo to="javascript:"></Foo>`, oxcOptions: [[{ name: "Foo", props: ["to", "href"] }]] },
  {
    code: `<Foo href="javascript:"></Foo>`,
    oxcOptions: [[{ name: "Foo", props: ["to", "href"] }]],
  },
  {
    code: `<a href="javascript:void(0)"></a>`,
    oxcOptions: [[{ name: "Foo", props: ["to", "href"] }]],
  },
  {
    code: `<Foo to="javascript:"></Foo>`,
    oxcOptions: [[{ name: "Bar", props: ["to", "href"] }], { includeFromSettings: true }],
    oxcSettings: {
      settings: { react: { linkComponents: [{ name: "Foo", linkAttribute: "to" }] } },
    },
  },
  {
    code: `<Foo href="javascript:"></Foo>`,
    oxcOptions: [{ includeFromSettings: true }],
    oxcSettings: {
      settings: { react: { linkComponents: [{ name: "Foo", linkAttribute: ["to", "href"] }] } },
    },
  },
  {
    code: `
			      <div>
			        <Foo href="javascript:"></Foo>
			        <Bar link="javascript:"></Bar>
			      </div>
			    `,
    oxcOptions: [[{ name: "Bar", props: ["link"] }], { includeFromSettings: true }],
    oxcSettings: {
      settings: { react: { linkComponents: [{ name: "Foo", linkAttribute: ["to", "href"] }] } },
    },
  },
  {
    code: `
			      <div>
			        <Foo href="javascript:"></Foo>
			        <Bar link="javascript:"></Bar>
			      </div>
			    `,
    oxcOptions: [[{ name: "Bar", props: ["link"] }]],
    oxcSettings: {
      settings: { react: { linkComponents: [{ name: "Foo", linkAttribute: ["to", "href"] }] } },
    },
  },
];
