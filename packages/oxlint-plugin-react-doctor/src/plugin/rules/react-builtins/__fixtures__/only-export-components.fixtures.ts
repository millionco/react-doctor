// GENERATED FROM OXC — do not edit by hand. Run `pnpm gen:fixtures` to regenerate.
// Source: oxc-project/oxc `crates/oxc_linter/src/rules/react/only_export_components.rs`
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
  { code: `export function Foo() {};` },
  { code: `function Foo() {}; export { Foo };` },
  { code: `function Foo() {}; export default Foo;` },
  { code: `export default function Foo() {}` },
  { code: `export const Foo = () => {};` },
  { code: `export const Foo2 = () => {};` },
  { code: `export const Foo_ = () => {};` },
  { code: `export function CMS() {};` },
  { code: `export const SVG = forwardRef(() => <svg/>);` },
  { code: `export const CMS = () => {};` },
  { code: `const Foo = () => {}; export { Foo };` },
  { code: `const Foo = () => {}; export default Foo;` },
  { code: `const foo = 4; export const Bar = () => {}; export const Baz = () => {};` },
  { code: `const foo = () => {}; export const Bar = () => {}; export const Baz = () => {};` },
  { code: `export const Foo = () => {}; export const Bar = styled.div\`padding-bottom: 6px;\`;` },
  {
    code: `export const Foo = () => {}; export const Flex = styled.div({ display: 'flex' });`,
    oxcOptions: [{ customHOCs: ["styled"] }],
  },
  {
    code: `export const Foo = () => {}; export const Flex = styled('div')({display: 'flex'});`,
    oxcOptions: [{ customHOCs: ["styled"] }],
  },
  {
    code: `export const Foo = () => {}; export const Flex = styled('div')\`display: flex;\`;`,
    oxcOptions: [{ customHOCs: ["styled"] }],
  },
  {
    code: `export const Foo = () => {}; export const Flex = styled('div');`,
    oxcOptions: [{ customHOCs: ["styled"] }],
  },
  { code: `export const foo = 3;` },
  { code: `const foo = 3; const bar = 'Hello'; export { foo, bar };` },
  { code: `export const foo = () => {};` },
  { code: `export default function foo () {};` },
  { code: `export default memo(function Foo () {});` },
  { code: `export default React.memo(function Foo () {});` },
  { code: `const Foo = () => {}; export default memo(Foo);` },
  { code: `const Foo = () => {}; export default React.memo(Foo);` },
  { code: `function Foo() {}; export default memo(Foo);` },
  { code: `function Foo() {}; export default React.memo(Foo);` },
  { code: `function Foo() {}; export default React.memo(Foo) as typeof Foo;` },
  { code: `export type * from './module';` },
  { code: `export { Foo } from './mod';` },
  { code: `export type { Foo, helper } from './mod';` },
  { code: `type foo = string; export const Foo = () => null; export type { foo };` },
  { code: `export type foo = string; export const Foo = () => null;` },
  {
    code: `export const foo = 4; export const Bar = () => {};`,
    oxcOptions: [{ allowConstantExport: true }],
  },
  {
    code: `export const foo = -4; export const Bar = () => {};`,
    oxcOptions: [{ allowConstantExport: true }],
  },
  {
    code: `export const CONSTANT = 'Hello world'; export const Foo = () => {};`,
    oxcOptions: [{ allowConstantExport: true }],
  },
  {
    code: `const foo = 'world'; export const CONSTANT = \`Hello \${foo}\`; export const Foo = () => {};`,
    oxcOptions: [{ allowConstantExport: true }],
  },
  {
    code: `export const loader = () => {}; export const Bar = () => {};`,
    oxcOptions: [{ allowExportNames: ["loader", "meta"] }],
  },
  {
    code: `export function loader() {}; export const Bar = () => {};`,
    oxcOptions: [{ allowExportNames: ["loader", "meta"] }],
  },
  {
    code: `export const loader = () => {}; export const meta = { title: 'Home' };`,
    oxcOptions: [{ allowExportNames: ["loader", "meta"] }],
  },
  {
    code: `export const viewport = { width: 'device-width', initialScale: 1 }; export const Page = () => {};`,
    oxcOptions: [{ allowExportNames: ["viewport"] }],
  },
  { code: `export { App as default }; const App = () => <>Test</>;` },
  { code: `const MyComponent = () => {}; export default connect(() => ({}))(MyComponent);` },
  { code: `export const MyComponent = () => {}; export const ChatContext = () => {};` },
  { code: `export const MyComponent = () => {}; const MyContext = createContext('test');` },
  { code: `export const MyContext = createContext('test');` },
  {
    code: `const MyComponent = () => {}; export default observer(MyComponent);`,
    oxcOptions: [{ customHOCs: ["observer"] }],
  },
  {
    code: `export const Route = createFileRoute('/profile')({ component: Component }); function Component() { return <div />; }`,
    oxcOptions: [{ customHOCs: ["createFileRoute"] }],
  },
  {
    code: `export const Route = createFileRoute('/profile')({ component: Component }); function Component() { return <div />; }`,
    oxcOptions: [{ customHOCs: ["createFileRoute"], allowExportNames: ["Route"] }],
  },
  { code: `const SomeConstant = 42; export function someUtility() { return SomeConstant }` },
  {
    code: `export const MyComponent = () => {}; export const MENU_WIDTH = 232 as const;`,
    oxcOptions: [{ allowConstantExport: true }],
  },
  { code: `export const MyComponent = () => {}; export default memo(MyComponent as any);` },
  { code: `export const MyComponent = () => {}; export default memo(MyComponent) as any;` },
  { code: `export const MyComponent = () => {}; export default memo(forwardRef(MyComponent));` },
  {
    code: `export const Devtools = import.meta.env.PROD ? () => null : React.lazy(() => import('devtools')); export const OtherComponent = () => {};`,
  },
  {
    code: `const RootComponent = () => {}; export const Route = createRootRoute()({ component: RootComponent });`,
    oxcOptions: [{ customHOCs: ["createRootRoute"] }],
  },
  { code: `export const Link = () => {}; export const RenamedLink = Link;` },
  { code: `export const Link = () => {}; export const TypedLink = Link<RouteParams>;` },
  {
    code: `export class MyComponent extends React.Component<Props, State> { render() { return <div>Hello</div>; } }`,
  },
  {
    code: `export default class MyComponent extends Component { render() { return <div>Hello</div>; } }`,
  },
  {
    code: `export function Button(props: PropsWithChildren<{ onClick: () => void }>): ReactNode;
export function Button(props: PropsWithChildren): ReactNode {
  return <button {...props}>{props.children}</button>;
}`,
  },
  {
    code: `export const Link = () => {}; export const Styles = styled('div').attrs((props) => ({ className: 'form-control' }))\`\`;`,
    oxcOptions: [{ customHOCs: ["styled"] }],
  },
  { code: `export const Foo = React.lazy(() => import('./Foo')); export const Bar = () => null;` },
];

export const failCases: ReadonlyArray<OxcFixture> = [
  { code: `export const foo = () => {}; export const Bar = () => {};` },
  { code: `export const _Foo = () => {}; export const Foo = () => {};` },
  {
    code: `export const foo = () => {}; export const Bar = () => {};`,
    oxcOptions: [{ allowConstantExport: true }],
  },
  { code: `export const foo = 4; export const Bar = () => {};` },
  { code: `export function Component() {}; export const Aa = 'a'` },
  { code: `const foo = 4; const Bar = () => {}; export { foo, Bar };` },
  { code: `export { Foo, helper } from './mod';` },
  { code: `export * from './foo';` },
  { code: `export default () => {};` },
  { code: `export default memo(() => {});` },
  { code: `export default function () {};` },
  { code: `export const CONSTANT = 3; export const Foo = () => {};` },
  { code: `export enum Tab { Home, Settings }; export const Bar = () => {};` },
  { code: `const Tab = () => {}; export const tabs = [<Tab />, <Tab />];` },
  { code: `const App = () => {}; createRoot(document.getElementById('root')).render(<App />);` },
  {
    code: `
        import React from 'react';
        export const CONSTANT = 3; export const Foo = () => {};
        `,
    oxcOptions: [{ checkJS: true }],
  },
  { code: `const MainView = () => {}; export default compose()(MainView);` },
  {
    code: `export const loader = () => {}; export const Bar = () => {}; export const foo = () => {};`,
    oxcOptions: [{ allowExportNames: ["loader", "meta"] }],
  },
  { code: `const Foo = () => {}; export { Foo as "🍌"}` },
  { code: `export const MyComponent = () => {}; export const MyContext = createContext('test');` },
  {
    code: `export const MyComponent = () => {}; export const MyContext = React.createContext('test');`,
  },
  { code: `const MyComponent = () => {}; export default observer(MyComponent);` },
  { code: `const MyComponent = () => {}; export const ENUM = Object.keys(TABLE) as EnumType[];` },
  {
    code: `export const DevtoolsNotComponentInProd = import.meta.env.PROD ? null : React.lazy(() => import('devtools')); export const OtherComponent = () => {};`,
  },
  {
    code: `export const Foo = () => {}; export class MyComponent { bar() { return <div>Hello</div>; } }`,
  },
  { code: `export default class { bar() { return <div>Hello</div>; } }` },
];
