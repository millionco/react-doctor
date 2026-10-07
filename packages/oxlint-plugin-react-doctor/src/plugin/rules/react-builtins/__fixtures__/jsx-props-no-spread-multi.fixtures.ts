// GENERATED FROM OXC — do not edit by hand. Run `pnpm gen:fixtures` to regenerate.
// Source: oxc-project/oxc `crates/oxc_linter/src/rules/react/jsx_props_no_spread_multi.rs`
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
    code: `
          const a = {};
          <App {...a} />
        `,
  },
  {
    code: `
          const a = {};
          const b = {};
          <App {...a} {...b} />
        `,
  },
  {
    code: `
        const props = {};
        <App {...props.x} {...props.foo} />
      `,
  },
  {
    code: `
        const props = {};
        <App {...(props.foo).baz} {...(props.y.baz)} />
      `,
  },
];

export const failCases: ReadonlyArray<OxcFixture> = [
  {
    code: `
          const props = {};
          <App {...props} {...props} />
        `,
  },
  {
    code: `
          const props = {};
          <App {...props.foo} {...props.foo} />
        `,
  },
  {
    code: `
          const props = {};
          <App {...(props.foo).baz} {...(props.foo.baz)} />
        `,
  },
  {
    code: `
          const props = {};
          <div {...props} a="a" {...props} />
        `,
  },
  {
    code: `
          const props = {};
          <div {...props} {...props} {...props} />
        `,
  },
];
