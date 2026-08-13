// GENERATED FROM OXC — do not edit by hand. Run `pnpm gen:fixtures` to regenerate.
// Source: oxc-project/oxc `crates/oxc_linter/src/rules/react/react_in_jsx_scope.rs`
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
  { code: `var React, App; <App />;` },
  { code: `var React; <img />;` },
  { code: `var React; <>fragment</>;` },
  { code: `var React; <x-gif />;` },
  { code: `var React, App, a=1; <App attr={a} />;` },
  { code: `var React, App, a=1; function elem() { return <App attr={a} />; }` },
  { code: `var React, App; <App />;` },
  {
    code: `
			        import React from 'react/addons';
			        const Button = createReactClass({
			          render() {
			            return (
			              <button {...this.props}>{this.props.children}</button>
			            )
			          }
			        });
			        export default Button;
			      `,
  },
  { code: `var React, a = <img />;` },
];

export const failCases: ReadonlyArray<OxcFixture> = [
  { code: `var App, a = <App />;` },
  { code: `var a = <App />;` },
  { code: `var a = <img />;` },
  { code: `var a = <>fragment</>;` },
  { code: `var Foo, a = <img />;` },
];
