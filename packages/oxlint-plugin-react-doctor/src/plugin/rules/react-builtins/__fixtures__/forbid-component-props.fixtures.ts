// GENERATED FROM OXC — do not edit by hand. Run `pnpm gen:fixtures` to regenerate.
// Source: oxc-project/oxc `crates/oxc_linter/src/rules/react/forbid_component_props.rs`
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
                    var First = createReactClass({
                      render: function() {
                        return <div className="foo" />;
                      }
                    });
                  `,
  },
  {
    code: `
                    var First = createReactClass({
                      render: function() {
                        return <div style={{color: "red"}} />;
                      }
                    });
                  `,
    oxcOptions: [{ forbid: ["style"] }],
  },
  {
    code: `
                    var First = createReactClass({
                      propTypes: externalPropTypes,
                      render: function() {
                        return <Foo bar="baz" />;
                      }
                    });
                  `,
  },
  {
    code: `
                    var First = createReactClass({
                      propTypes: externalPropTypes,
                      render: function() {
                        return <Foo className="bar" />;
                      }
                    });
                  `,
    oxcOptions: [{ forbid: ["style"] }],
  },
  {
    code: `
                    var First = createReactClass({
                      propTypes: externalPropTypes,
                      render: function() {
                        return <Foo className="bar" />;
                      }
                    });
                  `,
    oxcOptions: [{ forbid: ["style", "foo"] }],
  },
  {
    code: `
                    var First = createReactClass({
                      propTypes: externalPropTypes,
                      render: function() {
                        return <this.Foo bar="baz" />;
                      }
                    });
                  `,
  },
  {
    code: `
                    class First extends createReactClass {
                      render() {
                        return <this.foo className="bar" />;
                      }
                    }
                  `,
    oxcOptions: [{ forbid: ["style"] }],
  },
  {
    code: `
                    const First = (props) => (
                      <this.Foo {...props} />
                    );
                  `,
  },
  {
    code: `
                    const item = (<ReactModal className="foo" />);
                  `,
    oxcOptions: [{ forbid: [{ propName: "className", allowedFor: ["ReactModal"] }] }],
  },
  {
    code: `
                    const item = (<AntdLayout.Content className="antdFoo" />);
                  `,
    oxcOptions: [{ forbid: [{ propName: "className", allowedFor: ["AntdLayout.Content"] }] }],
  },
  {
    code: `
                    const item = (<this.ReactModal className="foo" />);
                  `,
    oxcOptions: [{ forbid: [{ propName: "className", allowedFor: ["this.ReactModal"] }] }],
  },
  {
    code: `
                    const item = (<Foo className="foo" />);
                  `,
    oxcOptions: [{ forbid: [{ propName: "className", disallowedFor: ["ReactModal"] }] }],
  },
  {
    code: `
                    <fbt:param name="Total number of files" number={true} />
                  `,
  },
  {
    code: `
                    const item = (
                      <Foo className="bar">
                        <ReactModal style={{color: "red"}} />
                      </Foo>
                    );
                  `,
    oxcOptions: [
      {
        forbid: [
          { propName: "className", disallowedFor: ["OtherModal", "ReactModal"] },
          { propName: "style", disallowedFor: ["Foo"] },
        ],
      },
    ],
  },
  {
    code: `
                    const item = (
                      <Foo className="bar">
                        <ReactModal style={{color: "red"}} />
                      </Foo>
                    );
                  `,
    oxcOptions: [
      {
        forbid: [
          { propName: "className", disallowedFor: ["OtherModal", "ReactModal"] },
          { propName: "style", allowedFor: ["ReactModal"] },
        ],
      },
    ],
  },
  {
    code: `
                    const item = (<this.ReactModal className="foo" />);
                  `,
    oxcOptions: [{ forbid: [{ propName: "className", disallowedFor: ["ReactModal"] }] }],
  },
  {
    code: `
                    const MyComponent = () => (
                      <div aria-label="welcome" />
                    );
                  `,
    oxcOptions: [{ forbid: [{ propNamePattern: "**-**", allowedFor: ["div"] }] }],
  },
  {
    code: `
                    const rootElement = (
                      <Root>
                        <SomeIcon className="size-lg" />
                        <AnotherIcon className="size-lg" />
                        <SomeSvg className="size-lg" />
                        <UICard className="size-lg" />
                        <UIButton className="size-lg" />
                      </Root>
                    );
                  `,
    oxcOptions: [
      { forbid: [{ propName: "className", allowedForPatterns: ["*Icon", "*Svg", "UI*"] }] },
    ],
  },
  {
    code: `
                    const rootElement = (
                      <Root>
                        <SomeIcon className="size-lg" />
                        <AnotherIcon className="size-lg" />
                        <SomeSvg className="size-lg" />
                        <UICard className="size-lg" />
                        <UIButton className="size-lg" />
                        <ButtonLegacy className="size-lg" />
                      </Root>
                    );
                  `,
    oxcOptions: [
      {
        forbid: [
          {
            propName: "className",
            allowedFor: ["ButtonLegacy"],
            allowedForPatterns: ["*Icon", "*Svg", "UI*"],
          },
        ],
      },
    ],
  },
  {
    code: `
                    const rootElement = (
                      <Root>
                        <SomeIcon className="size-lg" />
                        <AnotherIcon className="size-lg" />
                        <SomeSvg className="size-lg" />
                        <UICard className="size-lg" />
                        <UIButton className="size-lg" />
                      </Root>
                    );
                  `,
    oxcOptions: [
      {
        forbid: [
          {
            propName: "className",
            disallowedFor: ["Modal"],
            disallowedForPatterns: ["*Legacy", "Shared*"],
          },
        ],
      },
    ],
  },
];

export const failCases: ReadonlyArray<OxcFixture> = [
  {
    code: `
                    var First = createReactClass({
                      propTypes: externalPropTypes,
                      render: function() {
                        return <Foo className="bar" />;
                      }
                    });
                  `,
  },
  {
    code: `
                    var First = createReactClass({
                      propTypes: externalPropTypes,
                      render: function() {
                        return <Foo style={{color: "red"}} />;
                      }
                    });
                  `,
  },
  {
    code: `
                    var First = createReactClass({
                      propTypes: externalPropTypes,
                      render: function() {
                        return <Foo className="bar" />;
                      }
                    });
                  `,
    oxcOptions: [{ forbid: ["className", "style"] }],
  },
  {
    code: `
                    var First = createReactClass({
                      propTypes: externalPropTypes,
                      render: function() {
                        return <Foo style={{color: "red"}} />;
                      }
                    });
                  `,
    oxcOptions: [{ forbid: ["className", "style"] }],
  },
  {
    code: `
                    var First = createReactClass({
                      propTypes: externalPropTypes,
                      render: function() {
                        return <Foo style={{color: "red"}} />;
                      }
                    });
                  `,
    oxcOptions: [{ forbid: [{ propName: "style", disallowedFor: ["Foo"] }] }],
  },
  {
    code: `
                    const item = (<Foo className="foo" />);
                  `,
    oxcOptions: [{ forbid: [{ propName: "className", allowedFor: ["ReactModal"] }] }],
  },
  {
    code: `
                    const item = (<this.ReactModal className="foo" />);
                  `,
    oxcOptions: [{ forbid: [{ propName: "className", allowedFor: ["ReactModal"] }] }],
  },
  {
    code: `
                    const item = (<this.ReactModal className="foo" />);
                  `,
    oxcOptions: [{ forbid: [{ propName: "className", disallowedFor: ["this.ReactModal"] }] }],
  },
  {
    code: `
                    const item = (<ReactModal className="foo" />);
                  `,
    oxcOptions: [{ forbid: [{ propName: "className", disallowedFor: ["ReactModal"] }] }],
  },
  {
    code: `
                    const item = (<AntdLayout.Content className="antdFoo" />);
                  `,
    oxcOptions: [{ forbid: [{ propName: "className", disallowedFor: ["AntdLayout.Content"] }] }],
  },
  {
    code: `
                    const item = (<Foo className="foo" />);
                  `,
    oxcOptions: [
      {
        forbid: [
          { propName: "className", message: "Please use ourCoolClassName instead of ClassName" },
        ],
      },
    ],
  },
  {
    code: `
                    const item = () => (
                      <Foo className="foo">
                        <Bar option="high" />
                      </Foo>
                    );
                  `,
    oxcOptions: [
      {
        forbid: [
          { propName: "className", message: "Please use ourCoolClassName instead of ClassName" },
          { propName: "option", message: "Avoid using option" },
        ],
      },
    ],
  },
  {
    code: `
                    const item = () => (
                      <Foo className="foo">
                        <Bar option="high" />
                      </Foo>
                    );
                  `,
    oxcOptions: [
      {
        forbid: [{ propName: "className" }, { propName: "option", message: "Avoid using option" }],
      },
    ],
  },
  {
    code: `
                    const MyComponent = () => (
                      <Foo kebab-case-prop={123} />
                    );
                  `,
    oxcOptions: [{ forbid: [{ propNamePattern: "**-**" }] }],
  },
  {
    code: `
                    const MyComponent = () => (
                      <Foo kebab-case-prop={123} />
                    );
                  `,
    oxcOptions: [{ forbid: [{ propNamePattern: "**-**", message: "Avoid using kebab-case" }] }],
  },
  {
    code: `
                    const MyComponent = () => (
                      <div>
                        <div aria-label="Hello Akul" />
                        <Foo kebab-case-prop={123} />
                      </div>
                    );
                  `,
    oxcOptions: [{ forbid: [{ propNamePattern: "**-**", allowedFor: ["div"] }] }],
  },
  {
    code: `
                    const MyComponent = () => (
                      <div>
                        <div aria-label="Hello Akul" />
                        <h1 data-id="my-heading" />
                        <Foo kebab-case-prop={123} />
                      </div>
                    );
                  `,
    oxcOptions: [{ forbid: [{ propNamePattern: "**-**", disallowedFor: ["Foo"] }] }],
  },
  {
    code: `
                    const rootElement = () => (
                      <Root>
                        <SomeIcon className="size-lg" />
                        <SomeSvg className="size-lg" />
                      </Root>
                    );
                  `,
    oxcOptions: [
      {
        forbid: [
          {
            propName: "className",
            message: "className available only for icons",
            allowedForPatterns: ["*Icon"],
          },
        ],
      },
    ],
  },
  {
    code: `
                    const rootElement = () => (
                      <Root>
                        <UICard style={{backgroundColor: black}}/>
                        <SomeIcon className="size-lg" />
                        <SomeSvg className="size-lg" style={{fill: currentColor}} />
                      </Root>
                    );
                  `,
    oxcOptions: [
      {
        forbid: [
          {
            propName: "className",
            message: "className available only for icons",
            allowedForPatterns: ["*Icon"],
          },
          {
            propName: "style",
            message: "style available only for SVGs",
            allowedForPatterns: ["*Svg"],
          },
        ],
      },
    ],
  },
  {
    code: `
                    const rootElement = (
                      <Root>
                        <SomeIcon className="size-lg" />
                        <AnotherIcon className="size-lg" />
                        <SomeSvg className="size-lg" />
                        <UICard className="size-lg" />
                        <ButtonLegacy className="size-lg" />
                      </Root>
                    );
                  `,
    oxcOptions: [
      {
        forbid: [
          {
            propName: "className",
            disallowedFor: ["SomeSvg"],
            disallowedForPatterns: ["UI*", "*Icon"],
            message:
              "Avoid using className for SomeSvg and components that match the `UI*` and `*Icon` patterns",
          },
        ],
      },
    ],
  },
];
