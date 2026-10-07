// GENERATED FROM OXC — do not edit by hand. Run `pnpm gen:fixtures` to regenerate.
// Source: oxc-project/oxc `crates/oxc_linter/src/rules/react/no_is_mounted.rs`
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
            };
        `,
  },
  {
    code: `
            var Hello = createReactClass({
                componentDidUpdate: function() {
                    someNonMemberFunction(arg);
                    this.someFunc = this.isMounted;
                },
                render: function() {
                    return <div>Hello</div>;
                }
            });
            `,
  },
  {
    code: `
            class Hello extends React.Component {
                notIsMounted() {}
                render() {
                    this.notIsMounted();
                    return <div>Hello</div>;
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
                  if (!this.isMounted()) {
                    return;
                  }
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
                someMethod: function() {
                  if (!this.isMounted()) {
                    return;
                  }
                },
                render: function() {
                  return <div onClick={this.someMethod.bind(this)}>Hello</div>;
                }
            });
            `,
  },
  {
    code: `
            class Hello extends React.Component {
                someMethod() {
                  if (!this.isMounted()) {
                    return;
                  }
                }
                render() {
                  return <div onClick={this.someMethod.bind(this)}>Hello</div>;
                }
            };
            `,
  },
];
