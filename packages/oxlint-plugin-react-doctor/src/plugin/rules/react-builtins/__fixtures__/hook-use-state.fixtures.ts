// GENERATED FROM OXC — do not edit by hand. Run `pnpm gen:fixtures` to regenerate.
// Source: oxc-project/oxc `crates/oxc_linter/src/rules/react/hook_use_state.rs`
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
            import React from 'react';
            export default function useColor() {
                return React.useState();
            }`,
  },
  {
    code: `
            import React from 'react';
            export default function useColor() {
                const [color, setColor] = React.useState();
                return [color, setColor];
            }`,
  },
  {
    code: `
            import React from 'react';
            export default function useColor() {
                return React.useState('');
            }`,
  },
  {
    code: `
            import React from 'react';
            export default function useReq() {
                const [{ res, error }, setRes] = React.useState({ res: '', error: '' });
                return { res, error, setRes };
            }`,
    oxcOptions: [{ allowDestructuredState: true }],
  },
  {
    code: `
            import React from 'react';
            export default function useReq() {
                const [[ res, error ], setRes] = React.useState(['', '']);
                return { res, error, setRes };
            }`,
    oxcOptions: [{ allowDestructuredState: true }],
  },
];

export const failCases: ReadonlyArray<OxcFixture> = [
  {
    code: `
            import React from 'react';
            export default function useColor() {
                const color = React.useState();
                return color;
            }`,
  },
  {
    code: `
            import React from 'react';
            export default function useColor() {
                const [color, updateColor] = React.useState();
                return [color, updateColor];
            }`,
  },
  {
    code: `
                import React from 'react';
                export default function useColor() {
                  const [RGB , setRGB] = React.useState();
                  return [RGB, setRGB];
                }`,
  },
  {
    code: `
            import React from 'react';
            export default function useReq() {
                const [{ res, error }, setRes] = React.useState({ res: '', error: '' });
                return { res, error, setRes };
            }`,
  },
  {
    code: `
            import React from 'react';
            export default function useReq() {
                const [[ res, error ], setRes] = React.useState(['', '']);
                return { res, error, setRes };
            }`,
  },
  {
    code: `
            import React from 'react';
            export default function useReq() {
                const [res, {}] = React.useState('');
                return [res, {}];
            }`,
  },
];
