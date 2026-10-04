// GENERATED FROM OXC — do not edit by hand. Run `pnpm gen:fixtures` to regenerate.
// Source: oxc-project/oxc `crates/oxc_linter/src/rules/react/jsx_no_undef.rs`
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
  { code: `var React, App; React.render(<App />);` },
  { code: `var React; React.render(<img />);` },
  { code: `var React; React.render(<x-gif />);` },
  { code: `var React, app; React.render(<app.Foo />);` },
  { code: `var React, app; React.render(<app.foo.Bar />);` },
  { code: `var React; React.render(<Apppp:Foo />);` },
  {
    code: `
        var React;
        class Hello extends React.Component {
          render() {
            return <this.props.tag />
          }
        }
        `,
  },
  { code: `var App; var React; enum A { App };  React.render(<App />);` },
  { code: `var React; enum A { App }; var App; React.render(<App />);` },
  { code: `var React; import App = require('./app'); React.render(<App />);` },
  {
    code: `
        var React;
        import { Foo } from './foo';
        import App = Foo.App;
        React.render(<App />);
        `,
  },
];

export const failCases: ReadonlyArray<OxcFixture> = [
  { code: `var React; React.render(<App />);` },
  { code: `var React; React.render(<Appp.Foo />);` },
  { code: `var React; React.render(<appp.Foo />);` },
  { code: `var React; React.render(<appp.foo.Bar />);` },
  { code: `var React; React.render(<Foo />);` },
  { code: `var React; Unknown; React.render(<Unknown />)` },
  { code: `var React; { const App = null; }; React.render(<App />);` },
  { code: `var React; enum A { App }; React.render(<App />);` },
];
