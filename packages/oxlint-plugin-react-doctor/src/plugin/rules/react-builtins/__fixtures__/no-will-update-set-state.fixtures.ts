// GENERATED FROM OXC — do not edit by hand. Run `pnpm gen:fixtures` to regenerate.
// Source: oxc-project/oxc `crates/oxc_linter/src/rules/react/no_will_update_set_state.rs`
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
                    var Hello = createReactClass({
                      render: function() {
                        return <div>Hello {this.props.name}</div>;
                      }
                    });
                  `,
  },
  {
    code: `
                    var Hello = createReactClass({
                      componentWillUpdate: function() {}
                    });
                  `,
  },
  {
    code: `
                    var Hello = createReactClass({
                      componentWillUpdate: function() {
                        someNonMemberFunction(arg);
                        this.someHandler = this.setState;
                      }
                    });
                  `,
  },
  {
    code: `
                    var Hello = createReactClass({
                      componentWillUpdate: function() {
                        someClass.onSomeEvent(function(data) {
                          this.setState({
                            data: data
                          });
                        })
                      }
                    });
                  `,
  },
  {
    code: `
                    var Hello = createReactClass({
                      componentWillUpdate: function() {
                        function handleEvent(data) {
                          this.setState({
                            data: data
                          });
                        }
                        someClass.onSomeEvent(handleEvent)
                      }
                    });
                  `,
  },
  {
    code: `
                    class Hello extends React.Component {
                      UNSAFE_componentWillUpdate() {
                        this.setState({
                          data: data
                        });
                      }
                    }
                  `,
    oxcSettings: { settings: { react: { version: "16.2.0" } } },
  },
];

export const failCases: ReadonlyArray<OxcFixture> = [
  {
    code: `
                    var Hello = createReactClass({
                      componentWillUpdate: function() {
                        this.setState({
                          data: data
                        });
                      }
                    });
                  `,
  },
  {
    code: `
                    class Hello extends React.Component {
                      componentWillUpdate() {
                        this.setState({
                          data: data
                        });
                      }
                    }
                  `,
  },
  {
    code: `
                    var Hello = createReactClass({
                      componentWillUpdate: function() {
                        this.setState({
                          data: data
                        });
                      }
                    });
                  `,
    oxcOptions: ["disallow-in-func"],
  },
  {
    code: `
                    class Hello extends React.Component {
                      componentWillUpdate() {
                        this.setState({
                          data: data
                        });
                      }
                    }
                  `,
    oxcOptions: ["disallow-in-func"],
  },
  {
    code: `
                    var Hello = createReactClass({
                      componentWillUpdate: function() {
                        someClass.onSomeEvent(function(data) {
                          this.setState({
                            data: data
                          });
                        })
                      }
                    });
                  `,
    oxcOptions: ["disallow-in-func"],
  },
  {
    code: `
                    class Hello extends React.Component {
                      componentWillUpdate() {
                        someClass.onSomeEvent(function(data) {
                          this.setState({
                            data: data
                          });
                        })
                      }
                    }
                  `,
    oxcOptions: ["disallow-in-func"],
  },
  {
    code: `
                    var Hello = createReactClass({
                      componentWillUpdate: function() {
                        if (true) {
                          this.setState({
                            data: data
                          });
                        }
                      }
                    });
                  `,
  },
  {
    code: `
                    class Hello extends React.Component {
                      componentWillUpdate() {
                        if (true) {
                          this.setState({
                            data: data
                          });
                        }
                      }
                    }
                  `,
  },
  {
    code: `
                    var Hello = createReactClass({
                      componentWillUpdate: function() {
                        someClass.onSomeEvent((data) => this.setState({data: data}));
                      }
                    });
                  `,
    oxcOptions: ["disallow-in-func"],
  },
  {
    code: `
                    class Hello extends React.Component {
                      componentWillUpdate() {
                        someClass.onSomeEvent((data) => this.setState({data: data}));
                      }
                    }
                  `,
    oxcOptions: ["disallow-in-func"],
  },
  {
    code: `
                    class Hello extends React.Component {
                      UNSAFE_componentWillUpdate() {
                        this.setState({
                          data: data
                        });
                      }
                    }
                  `,
    oxcSettings: { settings: { react: { version: "16.3.0" } } },
  },
  {
    code: `
                    var Hello = createReactClass({
                      UNSAFE_componentWillUpdate: function() {
                        this.setState({
                          data: data
                        });
                      }
                    });
                  `,
    oxcSettings: { settings: { react: { version: "16.3.0" } } },
  },
];
