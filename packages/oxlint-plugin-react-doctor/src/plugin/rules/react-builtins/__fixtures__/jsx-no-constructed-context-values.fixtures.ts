// GENERATED FROM OXC — do not edit by hand. Run `pnpm gen:fixtures` to regenerate.
// Source: oxc-project/oxc `crates/oxc_linter/src/rules/react/jsx_no_constructed_context_values.rs`
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
  { code: `const Component = () => <Context.Provider value={100}></Context.Provider>` },
  { code: `const Component = () => <Context.Provider value="Some string"></Context.Provider>` },
  {
    code: `function Component() { const foo = useMemo(() => { return {} }, []); return (<Context.Provider value={foo}></Context.Provider>)}`,
  },
  {
    code: `
            function Component({oneProp, twoProp, redProp, blueProp,}) {
              return (
                <NewContext.Provider value={twoProp}></NewContext.Provider>
              );
            }
        `,
  },
  {
    code: `
            function Foo(section) {
              const foo = section.section_components?.edges;
              return (
                <Context.Provider value={foo}></Context.Provider>
              )
            }
        `,
  },
  {
    code: `
            import foo from 'foo';
            function innerContext() {
              return (
                <Context.Provider value={foo.something}></Context.Provider>
              )
            }
        `,
  },
  {
    code: `
            // Passes because the lint rule doesn't handle JSX spread attributes
            function innerContext() {
              const foo = {value: 'something'}
              return (
                <Context.Provider {...foo}></Context.Provider>
              )
            }
        `,
  },
  {
    code: `
            // Passes because the lint rule doesn't handle JSX spread attributes
            function innerContext() {
              const foo = useMemo(() => {
                return bar;
              })
              return (
                <Context.Provider value={foo}></Context.Provider>
              )
            }
        `,
  },
  {
    code: `
            // Passes because we can't statically check if it's using the default value
            function Component({ a = {} }) {
              return (<Context.Provider value={a}></Context.Provider>);
            }
        `,
  },
  {
    code: `
            import React from 'react';
            import MyContext from './MyContext';

            const value = '';

            function ContextProvider(props) {
                return (
                    <MyContext.Provider value={value as any}>
                        {props.children}
                    </MyContext.Provider>
                )
            }
        `,
  },
  {
    code: `
            import React from 'react';
            import BooleanContext from './BooleanContext';

            function ContextProvider(props) {
                return (
                    <BooleanContext.Provider value>
                        {props.children}
                    </BooleanContext.Provider>
                )
            }
        `,
  },
  {
    code: `
            const root = ReactDOM.createRoot(document.getElementById('root'));
            root.render(
              <AppContext.Provider value={{}}>
                <AppView />
              </AppContext.Provider>
            );
        `,
  },
  {
    code: `
            // Passes because the context is not a provider
            function Component() {
              return <MyContext.Consumer value={{ foo: 'bar' }} />;
            }
        `,
  },
  {
    code: `
            import React from 'react';

            const MyContext = React.createContext();
            const Component = () => <MyContext value={100}></MyContext>;
        `,
  },
  {
    code: `
            const SomeContext = createContext();
            const Component = () => <SomeContext value="Some string"></SomeContext>;
        `,
  },
  {
    code: `
            // Passes because MyContext is not a variable declarator
            function Component({ MyContext }) {
              return <MyContext value={{ foo: "bar" }} />;
            }
        `,
  },
];

export const failCases: ReadonlyArray<OxcFixture> = [];
