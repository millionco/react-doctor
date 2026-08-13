// GENERATED FROM OXC — do not edit by hand. Run `pnpm gen:fixtures` to regenerate.
// Source: oxc-project/oxc `crates/oxc_linter/src/rules/react/no_set_state.rs`
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
			          this.setState({})
			        };
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
  },
  {
    code: `
			        var Hello = createReactClass({
			          componentDidUpdate: function() {
			            someNonMemberFunction(arg);
			            this.someHandler = this.setState;
			          },
			          render: function() {
			            return <div>Hello {this.props.name}</div>;
			          }
			        });
			      `,
  },
  {
    code: `
			        var Hello = function() {
			          this.setState({})
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
			          this.setState({})
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
			          someMethod: function() {
			            this.setState({
			              name: this.props.name.toUpperCase()
			            });
			          },
			          render: function() {
			            return <div onClick={this.someMethod.bind(this)}>Hello {this.state.name}</div>;
			          }
			        });
			      `,
  },
  {
    code: `
			        class Hello extends React.Component {
			          someMethod() {
			            this.setState({
			              name: this.props.name.toUpperCase()
			            });
			          }
			          render() {
			            return <div onClick={this.someMethod.bind(this)}>Hello {this.state.name}</div>;
			          }
			        };
			      `,
  },
  {
    code: `
			        class Hello extends React.Component {
			          someMethod = () => {
			            this.setState({
			              name: this.props.name.toUpperCase()
			            });
			          }
			          render() {
			            return <div onClick={this.someMethod.bind(this)}>Hello {this.state.name}</div>;
			          }
			        };
			      `,
  },
  {
    code: `
			        class Hello extends React.Component {
			          render() {
			            return <div onMouseEnter={() => this.setState({dropdownIndex: index})} />;
			          }
			        };
			      `,
  },
];
