// GENERATED FROM OXC — do not edit by hand. Run `pnpm gen:fixtures` to regenerate.
// Source: oxc-project/oxc `crates/oxc_linter/src/rules/react_perf/jsx_no_new_object_as_prop.rs`
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
  { code: `<Item config={staticConfig} />` },
  { code: `<Item config={{}} />` },
  { code: `<Item config={'foo'} />` },
  { code: `const Foo = () => <Item config={staticConfig} />` },
  { code: `const Foo = (props) => <Item {...props} />` },
  { code: `const Foo = (props) => <Item x={props.x} />` },
  { code: `const Foo = ({ x = 5 }) => <Item x={x} />` },
  { code: `const x = {}; const Foo = () => <Bar x={x} />` },
  { code: `const DEFAULT_X = {}; const Foo = ({ x = DEFAULT_X }) => <Bar x={x} />` },
  {
    code: `
        import { FC, useMemo } from 'react';
        import { Bar } from './bar';
        export const Foo: FC = () => {
            const x = useMemo(() => ({ foo: 'bar' }), []);
            return <Bar prop={x} />
        }
        `,
  },
  {
    code: `
        import { FC, useMemo } from 'react';
        import { Bar } from './bar';
        export const Foo: FC = () => {
            const x = useMemo(() => ({ foo: 'bar' }), []);
            const y = x;
            return <Bar prop={y} />
        }
        `,
  },
  { code: `const Foo = () => <div style={{}} />`, oxcOptions: [{ nativeAllowList: "all" }] },
  { code: `const Foo = () => <div style={{}} />`, oxcOptions: [{ nativeAllowList: ["style"] }] },
];

export const failCases: ReadonlyArray<OxcFixture> = [
  { code: `const Foo = () => <Item config={{}} />` },
  { code: `const Foo = () => <Item config={Object.create(null)} />` },
  { code: `const Foo = ({ x }) => <Item config={Object.assign({}, x)} />` },
  { code: `const Foo = () => (<Item config={new Object()} />)` },
  { code: `const Foo = () => (<Item config={Object()} />)` },
  { code: `const Foo = () => (<div style={{display: 'none'}} />)` },
  { code: `const Foo = () => (<Item config={this.props.config || {}} />)` },
  { code: `const Foo = () => (<Item config={this.props.config ? this.props.config : {}} />)` },
  {
    code: `const Foo = () => (<Item config={this.props.config || (this.props.default ? this.props.default : {})} />)`,
  },
  { code: `const Foo = () => { const x = {}; return <Bar x={x} /> }` },
  { code: `const Foo = ({ x = {} }) => <Item x={x} />` },
  { code: `const Foo = () => { const x: Foo = {}; return <Bar x={x} /> }` },
  { code: `const Foo = () => { const x: Foo = {} as Foo; return <Bar x={x} /> }` },
  { code: `const Foo = () => { const x: Foo = {} satisfies Foo; return <Bar x={x} /> }` },
  { code: `const Foo = () => { const x: Foo = {} as const; return <Bar x={x} /> }` },
  { code: `const Foo = () => <div config={{}} />`, oxcOptions: [{ nativeAllowList: ["style"] }] },
];
