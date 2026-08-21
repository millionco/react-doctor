// GENERATED FROM OXC — do not edit by hand. Run `pnpm gen:fixtures` to regenerate.
// Source: oxc-project/oxc `crates/oxc_linter/src/rules/react/no_find_dom_node.rs`
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
  { code: `var Hello = function() {};` },
  {
    code: `
            var Hello = createReactClass({
              render: function() {
                return <div>Hello</div>;
              }
            });
            `,
  },
  {
    code: `
            var Hello = createReactClass({
              componentDidMount: function() {
                someNonMemberFunction(arg);
                this.someFunc = React.findDOMNode;
              },
              render: function() {
                return <div>Hello</div>;
              }
            });
            `,
  },
  {
    code: `
            var Hello = createReactClass({
              componentDidMount: function() {
                React.someFunc(this);
              },
              render: function() {
                return <div>Hello</div>;
              }
            });
            `,
  },
  {
    code: `
            var Hello = createReactClass({
              componentDidMount: function() {
                SomeModule.findDOMNode(this).scrollIntoView();
              },
              render: function() {
                return <div>Hello</div>;
              }
            });
            `,
  },
];

export const failCases: ReadonlyArray<OxcFixture> = [
  {
    code: `
            var Hello = createReactClass({
              componentDidMount: function() {
                React.findDOMNode(this).scrollIntoView();
              },
              render: function() {
                return <div>Hello</div>;
              }
            });
            `,
  },
  {
    code: `
            var Hello = createReactClass({
              componentDidMount: function() {
                ReactDOM.findDOMNode(this).scrollIntoView();
              },
              render: function() {
                return <div>Hello</div>;
              }
            });
            `,
  },
  {
    code: `
            var Hello = createReactClass({
              componentDidMount: function() {
                ReactDom.findDOMNode(this).scrollIntoView();
              },
              render: function() {
                return <div>Hello</div>;
              }
            });
            `,
  },
  {
    code: `
            class Hello extends Component {
              componentDidMount() {
                findDOMNode(this).scrollIntoView();
              }
              render() {
                return <div>Hello</div>;
              }
            }
            `,
  },
  {
    code: `
            class Hello extends Component {
              componentDidMount() {
                this.node = findDOMNode(this);
              }
              render() {
                return <div>Hello</div>;
              }
            }
            `,
  },
  {
    code: `
            import ReactDOM from 'react-dom';
            class Demo extends React.Component {
              foo() {
                ReactDOM.findDOMNode(this);
              }
            }
            `,
    oxcFilename: "demo.ts",
  },
];
