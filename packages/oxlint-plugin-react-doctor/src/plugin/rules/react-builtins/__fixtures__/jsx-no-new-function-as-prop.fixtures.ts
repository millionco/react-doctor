// GENERATED FROM OXC — do not edit by hand. Run `pnpm gen:fixtures` to regenerate.
// Source: oxc-project/oxc `crates/oxc_linter/src/rules/react_perf/jsx_no_new_function_as_prop.rs`
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
  { code: `const Foo = () => <Item callback={this.props.callback} />` },
  { code: `const Foo = () => (<Item promise={new Promise()} />)` },
  { code: `const Foo = () => (<Item onClick={bind(foo)} />)` },
  { code: `const Foo = () => (<Item prop={0} />)` },
  { code: `const Foo = () => { var a; return <Item prop={a} /> }` },
  { code: `const Foo = () => { var a;a = 1; return <Item prop={a} /> }` },
  { code: `const Foo = () => { var a;<Item prop={a} /> }` },
  {
    code: `function foo ({prop1 = function(){}, prop2}) {
            return <Comp prop={prop2} />
          }`,
  },
  {
    code: `function foo ({prop1, prop2 = function(){}}) {
            return <Comp prop={prop1} />
          }`,
  },
  { code: `<Item prop={function(){return true}} />` },
  { code: `<Item prop={() => true} />` },
  { code: `<Item prop={new Function('a', 'alert(a)')}/>` },
  { code: `<Item prop={Function()}/>` },
  { code: `<Item onClick={this.clickHandler.bind(this)} />` },
  { code: `<Item callback={this.props.callback || function() {}} />` },
  { code: `<Item callback={this.props.callback ? this.props.callback : function() {}} />` },
  {
    code: `<Item prop={this.props.callback || this.props.callback ? this.props.callback : function(){}} />`,
  },
  { code: `<Item prop={this.props.callback || (this.props.cb ? this.props.cb : function(){})} />` },
  {
    code: `
        import { FC, useCallback } from 'react';
        export const Foo: FC = props => {
            const onClick = useCallback(
                e => { props.onClick?.(e) },
                [props.onClick]
            );
            return <button onClick={onClick} />
        }`,
  },
  {
    code: `
        import React from 'react'
        function onClick(e: React.MouseEvent) {
            window.location.navigate(e.target.href)
        }
        export default function Foo() {
            return <a onClick={onClick} />
        }
        `,
  },
  {
    code: `const Foo = () => <button onClick={() => true} />`,
    oxcOptions: [{ nativeAllowList: "all" }],
  },
  {
    code: `const Foo = () => <button onClick={() => true} />`,
    oxcOptions: [{ nativeAllowList: ["onClick"] }],
  },
];

export const failCases: ReadonlyArray<OxcFixture> = [
  { code: `const Foo = () => (<Item prop={function(){return true}} />)` },
  { code: `const Foo = () => (<Item prop={() => true} />)` },
  { code: `const Foo = () => (<Item prop={new Function('a', 'alert(a)')}/>)` },
  { code: `const Foo = () => (<Item prop={Function()}/>)` },
  { code: `const Foo = () => (<Item onClick={this.clickHandler.bind(this)} />)` },
  { code: `const Foo = () => (<Item callback={this.props.callback || function() {}} />)` },
  {
    code: `const Foo = () => (<Item callback={this.props.callback ? this.props.callback : function() {}} />)`,
  },
  {
    code: `const Foo = () => (<Item prop={this.props.callback || this.props.callback ? this.props.callback : function(){}} />)`,
  },
  {
    code: `const Foo = () => (<Item prop={this.props.callback || (this.props.cb ? this.props.cb : function(){})} />)`,
  },
  {
    code: `
        const Foo = ({ onClick }) => {
            const _onClick = onClick.bind(this)
            return <button onClick={_onClick} />
        }`,
  },
  {
    code: `
        const Foo = () => {
            function onClick(e) {
                window.location.navigate(e.target.href)
            }
            return <a onClick={onClick} />
        }
        `,
  },
  {
    code: `
        const Foo = () => {
            const onClick = (e) => {
                window.location.navigate(e.target.href)
            }
            return <a onClick={onClick} />
        }
        `,
  },
  {
    code: `
        const Foo = () => {
            const onClick = function (e) {
                window.location.navigate(e.target.href)
            }
            return <a onClick={onClick} />
        }
        `,
  },
  {
    code: `const Foo = () => <button onClick={() => true} />`,
    oxcOptions: [{ nativeAllowList: ["onChange"] }],
  },
];
