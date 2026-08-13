// GENERATED FROM OXC — do not edit by hand. Run `pnpm gen:fixtures` to regenerate.
// Source: oxc-project/oxc `crates/oxc_linter/src/rules/react/no_did_mount_set_state.rs`
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
          componentDidMount: function() {}
        });
        `,
  },
  {
    code: `
        var Hello = createReactClass({
          componentDidMount: function() {
            someNonMemberFunction(arg);
            this.someHandler = this.setState;
          }
        });
        `,
  },
  {
    code: `
        var Hello = createReactClass({
          componentDidMount: function() {
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
          componentDidMount: function() {
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
          componentDidMount() {
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
          componentDidUpdate() {
            this.setState({ data: 123 });
          }
        }
        `,
  },
  {
    code: `
        class Hello extends React.Component {
          componentWillMount() {
            this.setState({ data: 123 });
          }
        }
        `,
  },
  {
    code: `
        var Hello = createReactClass({
          componentDidUpdate: function() {
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
          componentDidMount: function() {
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
          componentDidMount() {
            Promise.resolve().then(() => {
              this.setState({ data: 123 });
            });
          }
        }
        `,
  },
];

export const failCases: ReadonlyArray<OxcFixture> = [
  {
    code: `
        var Hello = createReactClass({
          componentDidMount: function() {
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
          componentDidMount: function componentDidMount() {
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
          componentDidMount() {
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
          componentDidMount = () => {
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
          componentDidMount: function() {
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
          componentDidMount() {
            if (true) {
              this.setState({ data: 123 });
            }
          }
        }
        `,
  },
  {
    code: `
        class Hello extends React.Component {
          componentDidMount() {
            const x = true ? this.setState({ data: 123 }) : null;
          }
        }
        `,
  },
];
