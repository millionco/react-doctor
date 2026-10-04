// GENERATED FROM OXC — do not edit by hand. Run `pnpm gen:fixtures` to regenerate.
// Source: oxc-project/oxc `crates/oxc_linter/src/rules/react/prefer_es6_class.rs`
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
            class Hello extends React.Component {
              render() {
                return <div>Hello {this.props.name}</div>;
              }
            }
            Hello.displayName = 'Hello'
            `,
  },
  {
    code: `
            export default class Hello extends React.Component {
              render() {
                return <div>Hello {this.props.name}</div>;
              }
            }
            Hello.displayName = 'Hello'
            `,
  },
  {
    code: `
            var Hello = 'foo';
            module.exports = {};
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
    oxcOptions: ["never"],
  },
  {
    code: `
            class Hello extends React.Component {
              render() {
                return <div>Hello {this.props.name}</div>;
              }
            }
            `,
    oxcOptions: ["always"],
  },
];

export const failCases: ReadonlyArray<OxcFixture> = [
  {
    code: `
            var Hello = createReactClass({
              displayName: 'Hello',
              render: function() {
                return <div>Hello {this.props.name}</div>;
              }
            });
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
    oxcOptions: ["always"],
  },
  {
    code: `
            class Hello extends React.Component {
              render() {
                  return <div>Hello {this.props.name}</div>;
              }
            }
            `,
    oxcOptions: ["never"],
  },
];
