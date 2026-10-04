// GENERATED FROM OXC — do not edit by hand. Run `pnpm gen:fixtures` to regenerate.
// Source: oxc-project/oxc `crates/oxc_linter/src/rules/react/jsx_props_no_spreading.rs`
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
                    const {one_prop, two_prop} = props;
                    <App one_prop={one_prop} two_prop={two_prop}/>
                  `,
  },
  {
    code: `
                    const {one_prop, two_prop} = props;
                    <div one_prop={one_prop} two_prop={two_prop}></div>
                  `,
  },
  {
    code: `
                    const newProps = {...props};
                    <App one_prop={newProps.one_prop} two_prop={newProps.two_prop} style={{...styles}}/>
                  `,
  },
  {
    code: `
                    const props = {src: "dummy.jpg", alt: "dummy"};
                    <App>
                       <Image {...props}/>
                       <img {...props}/>
                    </App>
                  `,
    oxcOptions: [{ exceptions: ["Image", "img"] }],
  },
  {
    code: `
                    const props = {src: "dummy.jpg", alt: "dummy"};
                    const { src, alt } = props;
                    <App>
                       <Image {...props}/>
                       <img src={src} alt={alt}/>
                    </App>
                  `,
    oxcOptions: [{ custom: "ignore" }],
  },
  {
    code: `
                    const props = {src: "dummy.jpg", alt: "dummy"};
                    const { src, alt } = props;
                    <App>
                       <Image {...props}/>
                       <img {...props}/>
                    </App>
                  `,
    oxcOptions: [{ custom: "enforce", html: "ignore", exceptions: ["Image"] }],
  },
  {
    code: `
                    const props = {src: "dummy.jpg", alt: "dummy"};
                    const { src, alt } = props;
                    <App>
                       <img {...props}/>
                       <Image src={src} alt={alt}/>
                       <div {...someOtherProps}/>
                    </App>
                  `,
    oxcOptions: [{ html: "ignore" }],
  },
  {
    code: `
                    <App>
                      <Foo {...{ prop1, prop2, prop3 }} />
                    </App>
                  `,
    oxcOptions: [{ explicitSpread: "ignore" }],
  },
  {
    code: `
                    const props = {};
                    <App>
                       <components.Group {...props}/>
                       <Nav.Item {...props}/>
                    </App>
                  `,
    oxcOptions: [{ exceptions: ["components.Group", "Nav.Item"] }],
  },
  {
    code: `
                    const props = {};
                    <App>
                       <components.Group {...props}/>
                       <Nav.Item {...props}/>
                    </App>
                  `,
    oxcOptions: [{ custom: "ignore" }],
  },
  {
    code: `
                    const props = {};
                    <App>
                       <components.Group {...props}/>
                       <Nav.Item {...props}/>
                    </App>
                  `,
    oxcOptions: [
      { custom: "enforce", html: "ignore", exceptions: ["components.Group", "Nav.Item"] },
    ],
  },
];

export const failCases: ReadonlyArray<OxcFixture> = [
  {
    code: `
                    <App {...props}/>
                  `,
  },
  {
    code: `
                    <div {...props}></div>
                  `,
  },
  {
    code: `
                    <App {...props} some_other_prop={some_other_prop}/>
                  `,
  },
  {
    code: `
                    const props = {src: "dummy.jpg", alt: "dummy"};
                    <App>
                       <Image {...props}/>
                       <span {...props}/>
                    </App>
                  `,
    oxcOptions: [{ exceptions: ["Image", "img"] }],
  },
  {
    code: `
                    const props = {src: "dummy.jpg", alt: "dummy"};
                    const { src, alt } = props;
                    <App>
                       <Image {...props}/>
                       <img {...props}/>
                    </App>
                  `,
    oxcOptions: [{ custom: "ignore" }],
  },
  {
    code: `
                    const props = {src: "dummy.jpg", alt: "dummy"};
                    const { src, alt } = props;
                    <App>
                       <Image {...props}/>
                       <img {...props}/>
                    </App>
                  `,
    oxcOptions: [{ html: "ignore", exceptions: ["Image", "img"] }],
  },
  {
    code: `
                    const props = {src: "dummy.jpg", alt: "dummy"};
                    const { src, alt } = props;
                    <App>
                       <Image {...props}/>
                       <img {...props}/>
                       <div {...props}/>
                    </App>
                  `,
    oxcOptions: [{ custom: "ignore", html: "ignore", exceptions: ["Image", "img"] }],
  },
  {
    code: `
                    const props = {src: "dummy.jpg", alt: "dummy"};
                    const { src, alt } = props;
                    <App>
                       <img {...props}/>
                       <Image {...props}/>
                    </App>
                  `,
    oxcOptions: [{ html: "ignore" }],
  },
  {
    code: `
                    <App>
                      <Foo {...{ prop1, prop2, prop3 }} />
                    </App>
                  `,
  },
  {
    code: `
                    <App>
                      <Foo {...{ prop1, ...rest }} />
                    </App>
                  `,
    oxcOptions: [{ explicitSpread: "ignore" }],
  },
  {
    code: `
                    <App>
                      <Foo {...{ ...props }} />
                    </App>
                  `,
    oxcOptions: [{ explicitSpread: "ignore" }],
  },
  {
    code: `
                    <App>
                      <Foo {...props } />
                    </App>
                  `,
    oxcOptions: [{ explicitSpread: "ignore" }],
  },
  {
    code: `
                    const props = {};
                    <App>
                       <components.Group {...props}/>
                       <Nav.Item {...props}/>
                    </App>
                  `,
    oxcOptions: [{ exceptions: ["components.DropdownIndicator", "Nav.Item"] }],
  },
];
