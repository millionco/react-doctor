// GENERATED FROM OXC — do not edit by hand. Run `pnpm gen:fixtures` to regenerate.
// Source: oxc-project/oxc `crates/oxc_linter/src/rules/react/forward_ref_uses_ref.rs`
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
			        import { forwardRef } from 'react'
			        forwardRef((props, ref) => {
			          return null;
			        });
			      `,
  },
  {
    code: `
			        import { forwardRef } from 'react'
			        forwardRef((props, ref) => null);
			      `,
  },
  {
    code: `
			        import { forwardRef } from 'react'
			        forwardRef(function (props, ref) {
			          return null;
			        });
			      `,
  },
  {
    code: `
			        import { forwardRef } from 'react'
			        forwardRef(function Component(props, ref) {
			          return null;
			        });
			      `,
  },
  {
    code: `
			        import * as React from 'react'
			        React.forwardRef((props, ref) => {
			          return null;
			        });
			      `,
  },
  {
    code: `
			        import * as React from 'react'
			        React.forwardRef((props, ref) => null);
			      `,
  },
  {
    code: `
			        import * as React from 'react'
			        React.forwardRef(function (props, ref) {
			          return null;
			        });
			      `,
  },
  {
    code: `
			        import * as React from 'react'
			        React.forwardRef(function Component(props, ref) {
			          return null;
			        });
			      `,
  },
  {
    code: `
			        import * as React from 'react'
			        function Component(props) {
			          return null;
			        };
			      `,
  },
  {
    code: `
			        import * as React from 'react'
			        (props) => null;
			      `,
  },
  { code: `forwardRef(() => {})` },
  { code: `forwardRef(function () {})` },
  { code: `forwardRef(function (a, b, c) {})` },
];

export const failCases: ReadonlyArray<OxcFixture> = [
  {
    code: `
			        import { forwardRef } from 'react'
			        forwardRef((props) => {
			          return null;
			        });
			      `,
  },
  {
    code: `
			        import { forwardRef } from 'react'
			        forwardRef(props => {
			          return null;
			        });
			      `,
  },
  {
    code: `
			        import * as React from 'react'
			        React.forwardRef((props) => null);
			      `,
  },
  {
    code: `
			        import { forwardRef } from 'react'
			        const Component = forwardRef(function (props) {
			          return null;
			        });
			      `,
  },
  {
    code: `
			        import * as React from 'react'
			        React.forwardRef(function Component(props) {
			          return null;
			        });
			      `,
  },
];
