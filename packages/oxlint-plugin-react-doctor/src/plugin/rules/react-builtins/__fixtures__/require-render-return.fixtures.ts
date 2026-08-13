// GENERATED FROM OXC — do not edit by hand. Run `pnpm gen:fixtures` to regenerate.
// Source: oxc-project/oxc `crates/oxc_linter/src/rules/react/require_render_return.rs`
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
                    class Hello extends React.Component {
                      render = () => {
                        return <div>Hello {this.props.name}</div>;
                      }
                    }
                  `,
  },
  {
    code: `
                    class Hello extends React.Component {
                      render = () => (
                        <div>Hello {this.props.name}</div>
                      )
                    }
                  `,
  },
  {
    code: `
                    var Hello = createReactClass({
                      displayName: 'Hello',
                      render: function() {
                        return <div></div>
                      }
                    });
                  `,
  },
  {
    code: `
                    function Hello() {
                      return <div></div>;
                    }
                  `,
  },
  {
    code: `
                    var Hello = () => (
                      <div></div>
                    );
                  `,
  },
  {
    code: `
                    var Hello = createReactClass({
                      render: function() {
                        switch (this.props.name) {
                          case 'Foo':
                            return <div>Hello Foo</div>;
                          default:
                            return <div>Hello {this.props.name}</div>;
                        }
                      }
                    });
                  `,
  },
  {
    code: `
                    var Hello = createReactClass({
                      render: function() {
                        if (this.props.name === 'Foo') {
                          return <div>Hello Foo</div>;
                        } else {
                          return <div>Hello {this.props.name}</div>;
                        }
                      }
                    });
                  `,
  },
  {
    code: `
                    class Hello {
                      render() {}
                    }
                  `,
  },
  { code: `class Hello extends React.Component {}` },
  { code: `var Hello = createReactClass({});` },
  {
    code: `
                    var render = require('./render');
                    var Hello = createReactClass({
                      render
                    });
                  `,
  },
  {
    code: `
                    class Foo extends Component {
                      render
                    }
                  `,
  },
  {
    code: `
           class Foo extends Component {
             render = () => {
               if (true) {
                  return <div>Hello</div>;
                }
              }
           }
        `,
  },
];

export const failCases: ReadonlyArray<OxcFixture> = [
  {
    code: `
                    var Hello = createReactClass({
                      displayName: 'Hello',
                      render: function() {}
                    });
                  `,
  },
  {
    code: `
                    class Hello extends React.Component {
                      render() {}
                    }
                  `,
  },
  {
    code: `
                    class Hello extends React.Component {
                      render() {
                        const names = this.props.names.map(function(name) {
                          return <div>{name}</div>
                        });
                      }
                    }
                  `,
  },
  {
    code: `
                    class Hello extends React.Component {
                      render = () => {
                        <div>Hello {this.props.name}</div>
                      }
                    }
                  `,
  },
  {
    code: `
            class Hello extends React.Component {
              render() {
                function foo() {
                        return <div>Hello {this.props.name}</div>;
                    }
                }
            }
         `,
  },
  {
    code: `
            class Hello extends React.Component {
              render() {
                return
              }
            }
         `,
  },
];
