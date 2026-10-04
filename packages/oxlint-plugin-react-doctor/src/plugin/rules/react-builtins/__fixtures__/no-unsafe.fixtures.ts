// GENERATED FROM OXC — do not edit by hand. Run `pnpm gen:fixtures` to regenerate.
// Source: oxc-project/oxc `crates/oxc_linter/src/rules/react/no_unsafe.rs`
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
			          componentDidUpdate() {}
			          render() {}
			        }
			      `,
    oxcSettings: { settings: { react: { version: "16.4.0" } } },
  },
  {
    code: `
			        const Foo = createReactClass({
			          componentDidUpdate: function() {},
			          render: function() {}
			        });
			      `,
    oxcSettings: { settings: { react: { version: "16.4.0" } } },
  },
  {
    code: `
			        class Foo extends Bar {
			          componentWillMount() {}
			          componentWillReceiveProps() {}
			          componentWillUpdate() {}
			        }
			      `,
    oxcSettings: { settings: { react: { version: "16.4.0" } } },
  },
  {
    code: `
			        class Foo extends Bar {
			          UNSAFE_componentWillMount() {}
			          UNSAFE_componentWillReceiveProps() {}
			          UNSAFE_componentWillUpdate() {}
			        }
			      `,
    oxcSettings: { settings: { react: { version: "16.4.0" } } },
  },
  {
    code: `
			        const Foo = bar({
			          componentWillMount: function() {},
			          componentWillReceiveProps: function() {},
			          componentWillUpdate: function() {},
			        });
			      `,
    oxcSettings: { settings: { react: { version: "16.4.0" } } },
  },
  {
    code: `
			        const Foo = bar({
			          UNSAFE_componentWillMount: function() {},
			          UNSAFE_componentWillReceiveProps: function() {},
			          UNSAFE_componentWillUpdate: function() {},
			        });
			      `,
    oxcSettings: { settings: { react: { version: "16.4.0" } } },
  },
  {
    code: `
			        class Foo extends React.Component {
			          componentWillMount() {}
			          componentWillReceiveProps() {}
			          componentWillUpdate() {}
			        }
			      `,
    oxcSettings: { settings: { react: { version: "16.4.0" } } },
  },
  {
    code: `
			        class Foo extends React.Component {
			          UNSAFE_componentWillMount() {}
			          UNSAFE_componentWillReceiveProps() {}
			          UNSAFE_componentWillUpdate() {}
			        }
			      `,
    oxcSettings: { settings: { react: { version: "16.2.0" } } },
  },
  {
    code: `
			        const Foo = createReactClass({
			          componentWillMount: function() {},
			          componentWillReceiveProps: function() {},
			          componentWillUpdate: function() {},
			        });
			      `,
    oxcSettings: { settings: { react: { version: "16.4.0" } } },
  },
  {
    code: `
			        const Foo = createReactClass({
			          UNSAFE_componentWillMount: function() {},
			          UNSAFE_componentWillReceiveProps: function() {},
			          UNSAFE_componentWillUpdate: function() {},
			        });
			      `,
    oxcSettings: { settings: { react: { version: "16.2.0" } } },
  },
];

export const failCases: ReadonlyArray<OxcFixture> = [
  {
    code: `
			        class Foo extends React.Component {
			          componentWillMount() {}
			          componentWillReceiveProps() {}
			          componentWillUpdate() {}
			        }
			      `,
    oxcOptions: [{ checkAliases: true }],
    oxcSettings: { settings: { react: { version: "16.4.0" } } },
  },
  {
    code: `
			        class Foo extends React.Component {
			          UNSAFE_componentWillMount() {}
			          UNSAFE_componentWillReceiveProps() {}
			          UNSAFE_componentWillUpdate() {}
			        }
			      `,
    oxcSettings: { settings: { react: { version: "16.3.0" } } },
  },
  {
    code: `
			        const Foo = createReactClass({
			          componentWillMount: function() {},
			          componentWillReceiveProps: function() {},
			          componentWillUpdate: function() {},
			        });
			      `,
    oxcOptions: [{ checkAliases: true }],
    oxcSettings: { settings: { react: { version: "16.3.0" } } },
  },
  {
    code: `
			        const Foo = createReactClass({
			          UNSAFE_componentWillMount: function() {},
			          UNSAFE_componentWillReceiveProps: function() {},
			          UNSAFE_componentWillUpdate: function() {},
			        });
			      `,
    oxcSettings: { settings: { react: { version: "16.3.0" } } },
  },
];
