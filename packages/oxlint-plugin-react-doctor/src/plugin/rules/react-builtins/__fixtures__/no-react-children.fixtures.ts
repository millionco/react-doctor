// GENERATED FROM OXC — do not edit by hand. Run `pnpm gen:fixtures` to regenerate.
// Source: oxc-project/oxc `crates/oxc_linter/src/rules/react/no_react_children.rs`
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
  { code: `import React from 'react';` },
  { code: `const children = []; children.map(x => x)` },
  { code: `const Children = { map: () => {} }; Children.map()` },
  { code: `import React from 'react'; React.createElement('div')` },
  { code: `const foo = []; /* import { Children } from 'react'; */` },
  { code: `<div>Children</div>` },
  { code: `<MyComponent>Children</MyComponent>` },
  { code: `import React from 'react'; return <MyComponent>React.Children</MyComponent>` },
  { code: `"React.Children"` },
  { code: `import { Children } from 'something-else'; Children.toArray(children)` },
  { code: `<Foo>{children}</Foo>` },
];

export const failCases: ReadonlyArray<OxcFixture> = [
  { code: `import { Children } from 'react'; Children.map(children, child => <div>{child}</div>)` },
  { code: `import { Children } from 'react'; Children.only(children)` },
  { code: `import { Children } from 'react'; Children.count(children)` },
  { code: `import { Children } from 'react'; Children.forEach(children, (child, index) => {})` },
  { code: `import React from 'react'; React.Children.map(children, child => <div>{child}</div>)` },
  { code: `import React from 'react'; React.Children.only(children)` },
  { code: `import React from 'react'; React.Children.count(children)` },
  { code: `import React from 'react'; React.Children.forEach(children, (child, index) => {})` },
  {
    code: `import React from 'react';
         export const Table = ({ children }) => {
           const mappedChildren = React.Children.map(children, (child) =>
             <tr>{child}</tr>
           );
           return <table>{mappedChildren}</table>;
         }`,
  },
  {
    code: `import { Children } from 'react';
         function SeparatorList({ children }) {
           const result = [];
           Children.forEach(children, (child, index) => {
             result.push(child);
             result.push(<hr key={index} />);
           });
         }`,
  },
  {
    code: `import { Children } from 'react';
           function RowList({ children }) {
             return (
               <div className="RowList">
                 {Children.map(children, child =>
                   <div className="Row">
                     {child}
                   </div>
                 )}
               </div>
             );
           }`,
  },
  {
    code: `import * as React from 'react';
         function SeparatorList({ children }) {
           const result = [];
           React.Children.forEach(children, (child, index) => {
             result.push(child);
             result.push(<hr key={index} />);
           });
           // ...
         }`,
  },
  { code: `import React from 'react'; (React.Children).map(children, child => child)` },
  { code: `import React from 'react'; (React.Children as any).map(children, child => child)` },
];
