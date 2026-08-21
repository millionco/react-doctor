// GENERATED FROM OXC — do not edit by hand. Run `pnpm gen:fixtures` to regenerate.
// Source: oxc-project/oxc `crates/oxc_linter/src/rules/react/no_render_return_value.rs`
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
  { code: `ReactDOM.render(<div />, document.body);` },
  {
    code: `
                    let node;
                    ReactDOM.render(<div ref={ref => node = ref}/>, document.body);
                  `,
  },
  { code: `ReactDOM.render(<div ref={ref => this.node = ref}/>, document.body);` },
  { code: `React.render(<div ref={ref => this.node = ref}/>, document.body);` },
  { code: `React.render(<div ref={ref => this.node = ref}/>, document.body);` },
  { code: `var foo = React.render(<div />, root);` },
  { code: `var foo = render(<div />, root)` },
  { code: `var foo = ReactDom.renderder(<div />, root)` },
  {
    code: `export const foo = () => ({ destroy: ({ dom }) => { ReactDOM.unmountComponentAtNode(dom); } });`,
  },
];

export const failCases: ReadonlyArray<OxcFixture> = [
  { code: `var Hello = ReactDOM.render(<div />, document.body);` },
  {
    code: `
                    var o = {
                      inst: ReactDOM.render(<div />, document.body)
                    };
                  `,
  },
  {
    code: `
                    function render () {
                      return ReactDOM.render(<div />, document.body)
                    }
                  `,
  },
  { code: `var render = (a, b) => ReactDOM.render(a, b)` },
  { code: `this.o = ReactDOM.render(<div />, document.body);` },
  { code: `var v; v = ReactDOM.render(<div />, document.body);` },
  { code: `var inst = ReactDOM.render(<div />, document.body);` },
];
