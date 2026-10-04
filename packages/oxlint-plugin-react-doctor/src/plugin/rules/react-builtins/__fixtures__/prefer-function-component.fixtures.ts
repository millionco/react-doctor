// GENERATED FROM OXC — do not edit by hand. Run `pnpm gen:fixtures` to regenerate.
// Source: oxc-project/oxc `crates/oxc_linter/src/rules/react/prefer_function_component.rs`
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
    code: `const Foo = ({foo}) => <div>{foo}</div>;`,
    oxcOptions: [{ allowJsxUtilityClass: true }],
  },
  {
    code: `class Foo {
               render() {
                 return 'hello'
               }
             };`,
    oxcOptions: [{ allowJsxUtilityClass: true }],
  },
  { code: `const foo = { foo: <h>hello</h> };`, oxcOptions: [{ allowJsxUtilityClass: true }] },
  { code: `const Foo = ({foo}) => <div>{foo}</div>;`, oxcOptions: [{ allowErrorBoundary: false }] },
  {
    code: `class Foo {
               render() {
                 return 'hello'
               }
             };`,
    oxcOptions: [{ allowErrorBoundary: false }],
  },
  { code: `const foo = { foo: <h>hello</h> };`, oxcOptions: [{ allowErrorBoundary: false }] },
  {
    code: `const Foo = ({foo}) => <div>{foo}</div>;`,
    oxcOptions: [{ allowJsxUtilityClass: true, allowErrorBoundary: false }],
  },
  {
    code: `class Foo {
               render() {
                 return 'hello'
               }
             };`,
    oxcOptions: [{ allowJsxUtilityClass: true, allowErrorBoundary: false }],
  },
  {
    code: `const foo = { foo: <h>hello</h> };`,
    oxcOptions: [{ allowJsxUtilityClass: true, allowErrorBoundary: false }],
  },
];

export const failCases: ReadonlyArray<OxcFixture> = [
  {
    code: `class Foo extends React.PureComponent {
               render() {
                 return <div>{this.props.foo}</div>;
               }
             };`,
  },
  {
    code: `const Foo = class extends React.Component {
               render() {
                 return <div>{this.props.foo}</div>;
               }
             };`,
  },
  {
    code: `export default class extends React.Component {
               render() {
                 return <div>{this.props.foo}</div>;
               }
             };`,
  },
  {
    code: `class Foo extends React.PureComponent {
               componentDidCatch(error, errorInfo) {
                 logErrorToMyService(error, errorInfo);
               }
               render() {
                 return <div>{this.props.foo}</div>;
               }
             }`,
    oxcOptions: [{ allowErrorBoundary: false }],
  },
  {
    code: `const Foo = class extends React.Component {
               componentDidCatch(error, errorInfo) {
                 logErrorToMyService(error, errorInfo);
               }
               render() {
                 return <div>{this.props.foo}</div>;
               }
             };`,
    oxcOptions: [{ allowErrorBoundary: false }],
  },
  {
    code: `class Foo extends React.Component {
               constructor(props) {
                 super(props);
                 this.state = { hasError: false };
               }
               static getDerivedStateFromError(error) {
                 return { hasError: true };
               }
               render() {
                 return <div>{this.state.hasError ? 'Error' : this.props.foo}</div>;
               }
             }`,
    oxcOptions: [{ allowErrorBoundary: false }],
  },
  {
    code: `class Foo extends React.PureComponent {
               constructor(props) {
                 super(props);
                 this.state = { hasError: false };
               }
               static getDerivedStateFromError(error) {
                 return { hasError: true };
               }
               render() {
                 return <div>{this.state.hasError ? 'Error' : this.props.foo}</div>;
               }
             }`,
    oxcOptions: [{ allowErrorBoundary: false }],
  },
  {
    code: `const Foo = class extends React.Component {
               constructor(props) {
                 super(props);
                 this.state = { hasError: false };
               }
               static getDerivedStateFromError(error) {
                 return { hasError: true };
               }
               render() {
                 return <div>{this.state.hasError ? 'Error' : this.props.foo}</div>;
               }
             };`,
    oxcOptions: [{ allowErrorBoundary: false }],
  },
  {
    code: `class Foo extends React.Component {
               render() {
                 return <div>{this.props.foo}</div>;
               }
             };`,
    oxcOptions: [{ allowJsxUtilityClass: true }],
  },
  {
    code: `class Foo extends React.PureComponent {
               render() {
                 return <div>{this.props.foo}</div>;
               }
             };`,
    oxcOptions: [{ allowJsxUtilityClass: true }],
  },
  {
    code: `const Foo = class extends React.Component {
               render() {
                 return <div>{this.props.foo}</div>;
               }
             };`,
    oxcOptions: [{ allowJsxUtilityClass: true }],
  },
  {
    code: `export default class extends React.Component {
               render() {
                 return <div>{this.props.foo}</div>;
               }
             };`,
    oxcOptions: [{ allowJsxUtilityClass: true }],
  },
  {
    code: `class Foo extends React.Component {
               render() {
                 return null;
               }
             };`,
    oxcOptions: [{ allowJsxUtilityClass: true }],
  },
  {
    code: `import { Component } from 'react';

             class Foo extends Component {
               render() {
                 return null;
               }
             }`,
    oxcOptions: [{ allowJsxUtilityClass: true }],
  },
  {
    code: `const Foo = class extends React.Component {
               render() {
                 return null;
               }
             };`,
    oxcOptions: [{ allowJsxUtilityClass: true }],
  },
  {
    code: `import { Component } from 'react';

             const Foo = class extends Component {
               render() {
                 return null;
               }
             };`,
    oxcOptions: [{ allowJsxUtilityClass: true }],
  },
  {
    code: `import { Component } from 'react';

             const Foo = class Bar extends Component {
               render() {
                 return null;
               }
             };`,
    oxcOptions: [{ allowJsxUtilityClass: true }],
  },
  {
    code: `import { Component } from 'react';

             export default class extends Component {
               render() {
                 return null;
               }
             };`,
    oxcOptions: [{ allowJsxUtilityClass: true }],
  },
  {
    code: `import { Component } from 'react';

             export default class Foo extends Component {
               render() {
                 return null;
               }
             };`,
    oxcOptions: [{ allowJsxUtilityClass: true }],
  },
  {
    code: `class Foo extends React.Component {
               render() {
                 return <div>{this.props.foo}</div>;
               }
             };`,
    oxcOptions: [{ allowErrorBoundary: false }],
  },
  {
    code: `class Foo extends React.PureComponent {
               render() {
                 return <div>{this.props.foo}</div>;
               }
             };`,
    oxcOptions: [{ allowErrorBoundary: false }],
  },
  {
    code: `const Foo = class extends React.Component {
               render() {
                 return <div>{this.props.foo}</div>;
               }
             };`,
    oxcOptions: [{ allowErrorBoundary: false }],
  },
  {
    code: `export default class extends React.Component {
               render() {
                 return <div>{this.props.foo}</div>;
               }
             };`,
    oxcOptions: [{ allowErrorBoundary: false }],
  },
  {
    code: `class Foo extends React.Component {
               render() {
                 return null;
               }
             };`,
    oxcOptions: [{ allowErrorBoundary: false }],
  },
  {
    code: `import { Component } from 'react';

             class Foo extends Component {
               render() {
                 return null;
               }
             }`,
    oxcOptions: [{ allowErrorBoundary: false }],
  },
  {
    code: `const Foo = class extends React.Component {
               render() {
                 return null;
               }
             };`,
    oxcOptions: [{ allowErrorBoundary: false }],
  },
  {
    code: `import { Component } from 'react';

             const Foo = class extends Component {
               render() {
                 return null;
               }
             };`,
    oxcOptions: [{ allowErrorBoundary: false }],
  },
  {
    code: `import { Component } from 'react';

             const Foo = class Bar extends Component {
               render() {
                 return null;
               }
             };`,
    oxcOptions: [{ allowErrorBoundary: false }],
  },
  {
    code: `import { Component } from 'react';

             export default class extends Component {
               render() {
                 return null;
               }
             };`,
    oxcOptions: [{ allowErrorBoundary: false }],
  },
  {
    code: `import { Component } from 'react';

             export default class Foo extends Component {
               render() {
                 return null;
               }
             };`,
    oxcOptions: [{ allowErrorBoundary: false }],
  },
  {
    code: `class Foo extends React.Component {
               render() {
                 return <div>{this.props.foo}</div>;
               }
             };`,
    oxcOptions: [{ allowJsxUtilityClass: true, allowErrorBoundary: false }],
  },
  {
    code: `class Foo extends React.PureComponent {
               render() {
                 return <div>{this.props.foo}</div>;
               }
             };`,
    oxcOptions: [{ allowJsxUtilityClass: true, allowErrorBoundary: false }],
  },
  {
    code: `const Foo = class extends React.Component {
               render() {
                 return <div>{this.props.foo}</div>;
               }
             };`,
    oxcOptions: [{ allowJsxUtilityClass: true, allowErrorBoundary: false }],
  },
  {
    code: `export default class extends React.Component {
               render() {
                 return <div>{this.props.foo}</div>;
               }
             };`,
    oxcOptions: [{ allowJsxUtilityClass: true, allowErrorBoundary: false }],
  },
  {
    code: `class Foo extends React.Component {
               render() {
                 return null;
               }
             };`,
    oxcOptions: [{ allowJsxUtilityClass: true, allowErrorBoundary: false }],
  },
  {
    code: `import { Component } from 'react';

             class Foo extends Component {
               render() {
                 return null;
               }
             }`,
    oxcOptions: [{ allowJsxUtilityClass: true, allowErrorBoundary: false }],
  },
  {
    code: `const Foo = class extends React.Component {
               render() {
                 return null;
               }
             };`,
    oxcOptions: [{ allowJsxUtilityClass: true, allowErrorBoundary: false }],
  },
  {
    code: `import { Component } from 'react';

             const Foo = class extends Component {
               render() {
                 return null;
               }
             };`,
    oxcOptions: [{ allowJsxUtilityClass: true, allowErrorBoundary: false }],
  },
  {
    code: `import { Component } from 'react';

             const Foo = class Bar extends Component {
               render() {
                 return null;
               }
             };`,
    oxcOptions: [{ allowJsxUtilityClass: true, allowErrorBoundary: false }],
  },
  {
    code: `import { Component } from 'react';

             export default class extends Component {
               render() {
                 return null;
               }
             };`,
    oxcOptions: [{ allowJsxUtilityClass: true, allowErrorBoundary: false }],
  },
  {
    code: `import { Component } from 'react';

             export default class Foo extends Component {
               render() {
                 return null;
               }
             };`,
    oxcOptions: [{ allowJsxUtilityClass: true, allowErrorBoundary: false }],
  },
];
