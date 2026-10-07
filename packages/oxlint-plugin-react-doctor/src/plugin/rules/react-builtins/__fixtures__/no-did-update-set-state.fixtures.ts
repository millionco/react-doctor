// GENERATED FROM OXC — do not edit by hand. Run `pnpm gen:fixtures` to regenerate.
// Source: oxc-project/oxc `crates/oxc_linter/src/rules/react/no_did_update_set_state.rs`
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
              componentDidUpdate: function() {}
            });
            `,
  },
  {
    code: `
            var Hello = createReactClass({
              componentDidUpdate: function() {
                someNonMemberFunction(arg);
                this.someHandler = this.setState;
              }
            });
            `,
  },
  {
    code: `
            var Hello = createReactClass({
              componentDidUpdate: function() {
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
              componentDidUpdate: function() {
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
              componentDidUpdate() {
                this.handleEvent(() => {
                  this.setState({ data: 123 });
                });
              }
            }
            `,
  },
  {
    code: `
            class Hello extends React.Component {
              componentDidMount() {
                this.setState({ data: 123 });
              }
            }
            `,
  },
  {
    code: `
            class Hello extends React.Component {
              componentWillUpdate() {
                this.setState({ data: 123 });
              }
            }
            `,
  },
  {
    code: `
            var Hello = createReactClass({
              componentDidMount: function() {
                this.setState({ data: 123 });
              }
            });
            `,
  },
  {
    code: `
            function Hello() {
              this.setState({ data: 123 });
            }
            `,
  },
  {
    code: `
            var Hello = createReactClass({
              componentDidUpdate: function() {
                setTimeout(() => {
                  this.setState({ data: 123 });
                }, 100);
              }
            });
            `,
  },
  {
    code: `
            class Hello extends React.Component {
              componentDidUpdate() {
                Promise.resolve().then(() => {
                  this.setState({ data: 123 });
                });
              }
            }
            `,
  },
  {
    code: `
            var Hello = createReactClass({
              render: function() {
                return <div>Hello {this.props.name}</div>;
              }
            });
            `,
    oxcOptions: ["disallow-in-func"],
  },
  {
    code: `
            class Hello extends React.Component {
              componentDidUpdate() {
                this.handleEvent(() => {
                  this.setState({ data: 123 });
                });
              }
            }
            `,
    oxcOptions: ["allowed"],
  },
];

export const failCases: ReadonlyArray<OxcFixture> = [
  {
    code: `
            var Hello = createReactClass({
              componentDidUpdate: function() {
                this.setState({
                  name: this.props.name.toUpperCase()
                });
              },
              render: function() {
                return <div>Hello {this.state.name}</div>;
              }
            });
            `,
  },
  {
    code: `
            var Hello = createReactClass({
              componentDidUpdate: function componentDidUpdate() {
                this.setState({
                  name: this.props.name.toUpperCase()
                });
              }
            });
            `,
  },
  {
    code: `
            class Hello extends React.Component {
              componentDidUpdate() {
                this.setState({
                  name: this.props.name.toUpperCase()
                });
              }
            }
            `,
  },
  {
    code: `
            class Hello extends React.Component {
              componentDidUpdate = () => {
                this.setState({
                  name: this.props.name.toUpperCase()
                });
              }
            }
            `,
  },
  {
    code: `
            var Hello = createReactClass({
              componentDidUpdate: function() {
                this.setState({ data: 1 });
                someClass.onSomeEvent(function(data) {
                  this.setState({ data: 2 });
                })
              }
            });
            `,
  },
  {
    code: `
            class Hello extends React.Component {
              componentDidUpdate() {
                if (true) {
                  this.setState({ data: 123 });
                }
              }
            }
            `,
  },
  {
    code: `
            var Hello = createReactClass({
              componentDidUpdate: function() {
                if (true) {
                  this.setState({ data: 123 });
                }
              }
            });
            `,
  },
  {
    code: `
            class Hello extends React.Component {
              componentDidUpdate() {
                const x = true ? this.setState({ data: 123 }) : null;
              }
            }
            `,
  },
  {
    code: `
            var Hello = createReactClass({
              componentDidUpdate: function() {
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
            var Hello = createReactClass({
              componentDidUpdate: function() {
                setTimeout(() => {
                  this.setState({ data: 123 });
                }, 100);
              }
            });
            `,
    oxcOptions: ["disallow-in-func"],
  },
  {
    code: `
            class Hello extends React.Component {
              componentDidUpdate() {
                Promise.resolve().then(() => {
                  this.setState({ data: 123 });
                });
              }
            }
            `,
    oxcOptions: ["disallow-in-func"],
  },
  {
    code: `
            class Hello extends React.Component {
              componentDidUpdate() {
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
            class Hello extends React.Component {
              componentDidUpdate() {
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
              componentDidUpdate: function() {
                someClass.onSomeEvent((data) => this.setState({data: data}));
              }
            });
            `,
    oxcOptions: ["disallow-in-func"],
  },
  {
    code: `
            class Hello extends React.Component {
              componentDidUpdate() {
                someClass.onSomeEvent((data) => this.setState({data: data}));
              }
            }
            `,
    oxcOptions: ["disallow-in-func"],
  },
  {
    code: `
            class Hello extends React.Component {
              componentDidUpdate() {
                this.setState({
                  name: this.props.name.toUpperCase()
                });
              }
            }
            `,
    oxcOptions: ["allowed"],
  },
];
