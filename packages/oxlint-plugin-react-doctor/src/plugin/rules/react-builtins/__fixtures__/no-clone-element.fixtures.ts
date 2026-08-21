// GENERATED FROM OXC — do not edit by hand. Run `pnpm gen:fixtures` to regenerate.
// Source: oxc-project/oxc `crates/oxc_linter/src/rules/react/no_clone_element.rs`
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
  { code: `/* import { cloneElement } from 'react'; */` },
  { code: `// import { cloneElement } from 'react';` },
  { code: `import { cloneElement } from 'react'; // cloneElement() in a comment.` },
  { code: `import { cloneElement } from 'react'; /* cloneElement() in a comment. */` },
  {
    code: `import { cloneElement } from 'something-else'; const clonedElement = cloneElement(<div />);`,
  },
  {
    code: `import React from 'something-else'; const clonedElement = React.cloneElement(<div />);`,
  },
  { code: `const cloneElement = () => {}; const clonedElement = cloneElement(<div />);` },
];

export const failCases: ReadonlyArray<OxcFixture> = [
  {
    code: `import { cloneElement } from "react";
           const clonedElement = cloneElement(
             <Row title="Cabbage">Hello</Row>,
             { isHighlighted: true },
             "Goodbye",
           );`,
  },
  {
    code: `import { cloneElement } from "react";
           function Component() {
             const element = <div />;
             return cloneElement(element, { isHighlighted: true });
           }`,
  },
  {
    code: `import React, { cloneElement } from 'react';
         const element = <div />;
         const clonedElement = cloneElement(element);`,
  },
  {
    code: `import React from 'react';
         const element = <div />;
         const clonedElement = React.cloneElement(element);`,
  },
  { code: `import React from 'react'; const clonedElement = React.cloneElement(<div />);` },
  { code: `import Aliased from 'react'; const clonedElement = Aliased.cloneElement(<div />);` },
  { code: `import { cloneElement } from 'react'; const clonedElement = (cloneElement)(<div />);` },
  { code: `import React from 'react'; const clonedElement = React["cloneElement"](<div />);` },
  { code: `import React from 'react'; const clonedElement = React?.cloneElement(<div />);` },
];
