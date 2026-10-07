// GENERATED FROM OXC — do not edit by hand. Run `pnpm gen:fixtures` to regenerate.
// Source: oxc-project/oxc `crates/oxc_linter/src/rules/react/forbid_dom_props.rs`
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
                    const First = (props) => (
                      <div name="foo" />
                    );
                  `,
  },
  {
    code: `
                    var First = createReactClass({
                      render: function() {
                        return <Foo id="foo" />;
                      }
                    });
                  `,
    oxcOptions: [{ forbid: ["id"] }],
  },
  {
    code: `
                    var First = createReactClass({
                      propTypes: externalPropTypes,
                      render: function() {
                        return <Foo id="bar" style={{color: "red"}} />;
                      }
                    });
                  `,
    oxcOptions: [{ forbid: ["style", "id"] }],
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
    oxcOptions: [{ forbid: ["id"] }],
  },
  {
    code: `
                    class First extends createReactClass {
                      render() {
                        return <this.foo id="bar" />;
                      }
                    }
                  `,
    oxcOptions: [{ forbid: ["id"] }],
  },
  {
    code: `
                    const First = (props) => (
                      <this.Foo {...props} />
                    );
                  `,
    oxcOptions: [{ forbid: ["id"] }],
  },
  {
    code: `
                    const First = (props) => (
                      <fbt:param name="name">{props.name}</fbt:param>
                    );
                  `,
    oxcOptions: [{ forbid: ["id"] }],
  },
  {
    code: `
                    const First = (props) => (
                      <div name="foo" />
                    );
                  `,
    oxcOptions: [{ forbid: ["id"] }],
  },
  {
    code: `
                    const First = (props) => (
                      <div otherProp="bar" />
                    );
                  `,
    oxcOptions: [{ forbid: [{ propName: "otherProp", disallowedFor: ["span"] }] }],
  },
  {
    code: `
                    const First = (props) => (
                      <div someProp="someValue" />
                    );
                  `,
    oxcOptions: [{ forbid: [{ propName: "someProp", disallowedValues: [] }] }],
  },
  {
    code: `
                    const First = (props) => (
                      <Foo someProp="someValue" />
                    );
                  `,
    oxcOptions: [{ forbid: [{ propName: "someProp", disallowedValues: ["someValue"] }] }],
  },
  {
    code: `
                    const First = (props) => (
                      <div someProp="value" />
                    );
                  `,
    oxcOptions: [{ forbid: [{ propName: "someProp", disallowedValues: ["someValue"] }] }],
  },
  {
    code: `
                    const First = (props) => (
                      <div someProp={\`some\${value}\`} />
                    );
                  `,
    oxcOptions: [{ forbid: [{ propName: "someProp", disallowedValues: ["someValue"] }] }],
  },
  {
    code: `
                    const First = (props) => (
                      <div someProp="someValue" />
                    );
                  `,
    oxcOptions: [
      {
        forbid: [
          { propName: "someProp", disallowedValues: ["someValue"], disallowedFor: ["span"] },
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
                        return <div id="bar" />;
                      }
                    });
                  `,
    oxcOptions: [{ forbid: ["id"] }],
  },
  {
    code: `
                    class First extends createReactClass {
                      render() {
                        return <div id="bar" />;
                      }
                    }
                  `,
    oxcOptions: [{ forbid: ["id"] }],
  },
  {
    code: `
                    const First = (props) => (
                      <div id="foo" />
                    );
                  `,
    oxcOptions: [{ forbid: ["id"] }],
  },
  {
    code: `
                    const First = (props) => (
                      <div className="foo" />
                    );
                  `,
    oxcOptions: [
      { forbid: [{ propName: "className", message: "Please use class instead of ClassName" }] },
    ],
  },
  {
    code: `
                    const First = (props) => (
                      <span otherProp="bar" />
                    );
                  `,
    oxcOptions: [{ forbid: [{ propName: "otherProp", disallowedFor: ["span"] }] }],
  },
  {
    code: `
                    const First = (props) => (
                      <div someProp="someValue" />
                    );
                  `,
    oxcOptions: [{ forbid: [{ propName: "someProp", disallowedValues: ["someValue"] }] }],
  },
  {
    code: `
                    const First = (props) => (
                      <div someProp={"someValue"} />
                    );
                  `,
    oxcOptions: [{ forbid: [{ propName: "someProp", disallowedValues: ["someValue"] }] }],
  },
  {
    code: `
                    const First = (props) => (
                      <div someProp={\`someValue\`} />
                    );
                  `,
    oxcOptions: [{ forbid: [{ propName: "someProp", disallowedValues: ["someValue"] }] }],
  },
  {
    code: `
                    const First = (props) => (
                      <div className="foo">
                        <div otherProp="bar" />
                      </div>
                    );
                  `,
    oxcOptions: [
      {
        forbid: [
          { propName: "className", message: "Please use class instead of ClassName" },
          { propName: "otherProp", message: "Avoid using otherProp" },
        ],
      },
    ],
  },
  {
    code: `
                    const First = (props) => (
                      <div className="foo">
                        <div otherProp="bar" />
                      </div>
                    );
                  `,
    oxcOptions: [
      {
        forbid: [
          { propName: "className" },
          { propName: "otherProp", message: "Avoid using otherProp" },
        ],
      },
    ],
  },
  {
    code: `
                    const First = (props) => (
                      <form accept='file'>
                        <input type="file" id="videoFile" accept="video/*" />
                        <input type="hidden" name="fullname" />
                      </form>
                    );
                  `,
    oxcOptions: [
      {
        forbid: [
          {
            propName: "accept",
            disallowedFor: ["form"],
            message: "Avoid using the accept attribute on <form>",
          },
        ],
      },
    ],
  },
  {
    code: `
                    const First = (props) => (
                      <div className="foo">
                        <input className="boo" />
                        <span className="foobar">Foobar</span>
                        <div otherProp="bar" />
                      </div>
                    );
                  `,
    oxcOptions: [
      {
        forbid: [
          {
            propName: "className",
            disallowedFor: ["div", "span"],
            message: "Please use class instead of ClassName",
          },
          { propName: "otherProp", message: "Avoid using otherProp" },
        ],
      },
    ],
  },
  {
    code: `
                    const First = (props) => (
                      <div className="foo">
                        <input className="boo" />
                        <span className="foobar">Foobar</span>
                        <div otherProp="bar" />
                        <p thirdProp="foo" />
                        <div thirdProp="baz" />
                        <p thirdProp="bar" />
                        <p thirdProp="baz" />
                      </div>
                    );
                  `,
    oxcOptions: [
      {
        forbid: [
          {
            propName: "className",
            disallowedFor: ["div", "span"],
            message: "Please use class instead of ClassName",
          },
          { propName: "otherProp", message: "Avoid using otherProp" },
          {
            propName: "thirdProp",
            disallowedFor: ["p"],
            disallowedValues: ["bar", "baz"],
            message: "Do not use thirdProp with values bar and baz on p",
          },
        ],
      },
    ],
  },
];
