// GENERATED FROM OXC — do not edit by hand. Run `pnpm gen:fixtures` to regenerate.
// Source: oxc-project/oxc `crates/oxc_linter/src/rules/react/no_redundant_should_component_update.rs`
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
			        class Foo extends React.Component {
			          shouldComponentUpdate() {
			            return true;
			          }
			        }
			      `,
  },
  {
    code: `
			        class Foo extends React.Component {
			          shouldComponentUpdate = () => {
			            return true;
			          }
			        }
			      `,
  },
  {
    code: `
			        function Foo() {
			          return class Bar extends React.Component {
			            shouldComponentUpdate() {
			              return true;
			            }
			          };
			        }
			      `,
  },
];

export const failCases: ReadonlyArray<OxcFixture> = [
  {
    code: `
			        class Foo extends React.PureComponent {
			          shouldComponentUpdate() {
			            return true;
			          }
			        }
			      `,
  },
  {
    code: `
			        class Foo extends PureComponent {
			          shouldComponentUpdate() {
			            return true;
			          }
			        }
			      `,
  },
  {
    code: `
			        class Foo extends React.PureComponent {
			          shouldComponentUpdate = () => {
			            return true;
			          }
			        }
			      `,
  },
  {
    code: `
			        function Foo() {
			          return class Bar extends React.PureComponent {
			            shouldComponentUpdate() {
			              return true;
			            }
			          };
			        }
			      `,
  },
  {
    code: `
			        function Foo() {
			          return class Bar extends PureComponent {
			            shouldComponentUpdate() {
			              return true;
			            }
			          };
			        }
			      `,
  },
  {
    code: `
			        var Foo = class extends PureComponent {
			          shouldComponentUpdate() {
			            return true;
			          }
			        }
			      `,
  },
];
