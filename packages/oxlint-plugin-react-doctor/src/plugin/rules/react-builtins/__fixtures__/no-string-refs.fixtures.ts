// GENERATED FROM OXC — do not edit by hand. Run `pnpm gen:fixtures` to regenerate.
// Source: oxc-project/oxc `crates/oxc_linter/src/rules/react/no_string_refs.rs`
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
                    var Hello = function() {
                      return this.refs;
                    };
                  `,
  },
  {
    code: `
                    var Hello = React.createReactClass({
                      componentDidMount: function() {
                        var component = this.hello;
                      },
                      render: function() {
                        return <div ref={c => this.hello = c}>Hello {this.props.name}</div>;
                      }
                    });
                  `,
  },
  {
    code: `
                    var Hello = createReactClass({
                      render: function() {
                        return <div ref={\`hello\`}>Hello {this.props.name}</div>;
                      }
                    });
                  `,
  },
  {
    code: `
                    var Hello = createReactClass({
                      render: function() {
                        return <div ref={\`hello\${index}\`}>Hello {this.props.name}</div>;
                      }
                    });
                  `,
  },
  {
    code: `
                    var Hello = function() {
                      return this.refs;
                    };
                    createReactClass({
                      render: function() {
                        let x;
                      }
                    });
                  `,
  },
  {
    code: `
                    var Hello = function() {
                      return this.refs;
                    };
                    class Other extends React.Component {
                      render() {
                        let x;
                      }
                    };
                  `,
  },
];

export const failCases: ReadonlyArray<OxcFixture> = [
  {
    code: `
              var Hello = createReactClass({
                componentDidMount: function() {
                  var component = this.refs.hello;
                },
                render: function() {
                  return <div>Hello {this.props.name}</div>;
                }
              });
            `,
  },
  {
    code: `
              var Hello = createReactClass({
                render: function() {
                  return <div ref="hello">Hello {this.props.name}</div>;
                }
              });
            `,
  },
  {
    code: `
              var Hello = createReactClass({
                render: function() {
                  return <div ref={'hello'}>Hello {this.props.name}</div>;
                }
              });
            `,
  },
  {
    code: `
              var Hello = createReactClass({
                componentDidMount: function() {
                  var component = this.refs.hello;
                },
                render: function() {
                  return <div ref="hello">Hello {this.props.name}</div>;
                }
              });
            `,
  },
  {
    code: `
              var Hello = createReactClass({
                componentDidMount: function() {
                var component = this.refs.hello;
                },
                render: function() {
                  return <div ref={\`hello\`}>Hello {this.props.name}</div>;
                }
              });
            `,
    oxcOptions: [{ noTemplateLiterals: true }],
  },
  {
    code: `
              var Hello = createReactClass({
                componentDidMount: function() {
                var component = this.refs.hello;
                },
                render: function() {
                  return <div ref={\`hello\${index}\`}>Hello {this.props.name}</div>;
                }
              });
            `,
    oxcOptions: [{ noTemplateLiterals: true }],
  },
  {
    code: `
              var Hello = createReactClass({
                render: function() {
                  return <div ref={\`hello\${index}\`}>Hello {this.props.name}</div>;
                }
              });
            `,
    oxcOptions: [{ noTemplateLiterals: true }],
  },
  {
    code: `
              class Hello extends React.Component {
                componentDidMount() {
                  var component = this.refs.hello;
                }
              }
            `,
  },
  {
    code: `
              class Hello extends React.Component {
                componentDidMount() {
                  var component = this.refs.hello;
                }
              }
            `,
  },
  {
    code: `
              class Hello extends React.PureComponent {
                componentDidMount() {
                  var component = this.refs.hello;
                }
                render() {
                  return <div ref={\`hello\${index}\`}>Hello {this.props.name}</div>;
                }
              }
            `,
    oxcOptions: [{ noTemplateLiterals: true }],
  },
];
